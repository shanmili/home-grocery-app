import { supabase } from '../supabase/client';
import { getDatabase } from '../../db/sqlite';
import { getPendingSyncItems, setSyncOutcome, setInventoryPublishing } from '../../db/repositories/syncQueueRepo';
import { applySnapshot } from './snapshot';

const conflictCodes = new Set(['40001', '42501', '23505', '23514', '22023', '22P02', 'P0002']);
let activeTask;

async function inOrder(task) {
  while (activeTask) {
    try { await activeTask; } catch { /* A later request can retry. */ }
  }
  activeTask = task();
  try { return await activeTask; } finally { activeTask = null; }
}

async function requireActor(userId) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  if (data.session?.user.id !== userId) throw new Error('The signed-in account changed.');
  return data.session.access_token;
}

async function rpc(userId, fn, args) {
  const token = await requireActor(userId);
  const { data, error } = await supabase.rpc(fn, args).setHeader('Authorization', 'Bearer ' + token);
  if (error) throw error;
  return data;
}

async function requirePackSupport(userId) {
  try {
    if (await rpc(userId, 'grocery_pack_units_ready')) return;
  } catch (error) {
    if (error.code !== 'PGRST202' && error.code !== '42883') throw error;
  }
  throw new Error('Pack changes are saved locally. Apply the pack-units migration to enable family sync.');
}

async function cycle(user) {
  const ready = await rpc(user.id, 'grocery_sync_ready');
  if (!ready) return { state: 'unpublished' };

  const db = await getDatabase();
  const blockedProducts = new Set();
  let packSupportChecked = false;
  let confirmedChange = false;
  for (const row of await getPendingSyncItems(db)) {
    const { actor, payload, productId, dependsOn } = JSON.parse(row.payload_json);
    if (actor !== user.id) {
      if (productId) blockedProducts.add(productId);
      continue;
    }
    if (blockedProducts.has(productId)) continue;
    if (dependsOn) {
      const prerequisite = await db.getFirstAsync('SELECT status FROM sync_queue WHERE id = ?;', [dependsOn]);
      if (prerequisite?.status !== 'SYNCED') {
        if (prerequisite?.status === 'CONFLICT') await setSyncOutcome(row, 'CONFLICT', 'The original stock change was rejected.');
        continue;
      }
    }
    try {
      if (!packSupportChecked && (payload.pieces_per_pack != null || 'pack_conversion_quantity' in payload)) {
        await requirePackSupport(user.id);
        packSupportChecked = true;
      }
      if (row.operation === 'restock_product') {
        await rpc(user.id, 'confirm_grocery_restock', {
          p_transaction_id: row.transaction_id, p_product_id: row.entity_id,
          p_quantity: payload.quantity, p_expected_version: payload.expected_version,
        });
      } else if (row.operation === 'return_usage') {
        await rpc(user.id, 'return_grocery_usage', {
          p_transaction_id: row.transaction_id, p_product_id: row.entity_id,
          p_original_transaction_id: payload.original_transaction_id,
        });
      } else {
        await rpc(user.id, 'apply_grocery_change', {
          p_transaction_id: row.transaction_id, p_operation: row.operation,
          p_entity_id: row.entity_id, p_payload: payload,
        });
      }
    } catch (error) {
      const conflict = conflictCodes.has(error.code);
      const needsReturnMigration = row.operation === 'return_usage' && ['PGRST202', '42883'].includes(error.code);
      const message = needsReturnMigration ? 'Return saved on this phone. Family sync needs the stock returns migration.' : error.message;
      await setSyncOutcome(row, conflict ? 'CONFLICT' : 'FAILED', message || 'Sync failed');
      if (!conflict) break;
      continue;
    }
    await setSyncOutcome(row, 'SYNCED');
    confirmedChange = true;
  }

  const snapshot = await rpc(user.id, 'grocery_snapshot');
  await requireActor(user.id);
  const changed = snapshot ? await applySnapshot(db, snapshot) : false;

  const pending = (await getPendingSyncItems(db)).filter((row) => JSON.parse(row.payload_json).actor === user.id);
  const conflicts = await db.getAllAsync(
    `SELECT q.entity_id, q.last_error, q.payload_json, coalesce(p.name, s.label, q.entity_id) AS label
      FROM sync_queue q LEFT JOIN products p ON p.id = q.entity_id
      LEFT JOIN shopping_list s ON s.id = q.entity_id
      WHERE q.entity_type = 'GROCERY_V1' AND q.status = 'CONFLICT' ORDER BY q.rowid DESC;`
  );
  return {
    state: 'ready',
    changed: changed || confirmedChange,
    pendingCount: pending.length,
    pendingError: pending.find((row) => row.status === 'FAILED')?.last_error,
    conflicts: conflicts.filter((row) => JSON.parse(row.payload_json).actor === user.id)
      .map(({ entity_id, label, last_error }) => ({ entityId: entity_id, label, message: last_error })),
  };
}

export function runSyncCycle(user) {
  return inOrder(() => cycle(user));
}

export function publishLocalInventory(user) {
  return inOrder(async () => {
    if (user.role !== 'ADMIN') throw new Error('Only admins can publish inventory.');
    const db = await getDatabase();
    setInventoryPublishing(true);
    try {
      let products, shopping;
      await db.withExclusiveTransactionAsync(async (tx) => {
        products = await tx.getAllAsync('SELECT id, name, category, unit, quantity, min_threshold, expiration_date, pieces_per_pack FROM products WHERE is_active = 1;');
        shopping = await tx.getAllAsync('SELECT id, label, unit, requested_quantity FROM shopping_list WHERE is_purchased = 0 AND product_id IS NULL;');
      });
      if (products.some((product) => product.pieces_per_pack != null)) await requirePackSupport(user.id);
      await rpc(user.id, 'initialize_grocery_sync', { p_products: products, p_shopping: shopping });
      return await cycle(user);
    } finally {
      setInventoryPublishing(false);
    }
  });
}

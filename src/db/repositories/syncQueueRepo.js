import { getDatabase } from '../sqlite';
import { generateId } from '../../utils/ids';
import { toIsoNow } from '../../utils/dateTime';
import { createActivityLog } from './activityRepo';

let publishing = false;

export function setInventoryPublishing(value) {
  publishing = value;
}

export const sharedInventoryKey = 'shared-inventory-v1';

export async function recordGroceryChange(tx, {
  actor, operation, entityId, payload, action, productId = null,
  previous = null, next = null, metadata = null, dependsOn = null, transactionId = generateId('txn'),
}) {
  if (publishing) throw new Error('Wait for the initial inventory upload to finish.');
  const ready = await tx.getFirstAsync('SELECT key FROM inventory_setup WHERE key = ?;', [sharedInventoryKey]);
  const status = ready ? 'PENDING' : 'LOCAL_ONLY';
  const now = toIsoNow();
  if (ready) {
    await tx.runAsync(
      `INSERT INTO sync_queue (id, transaction_id, entity_type, entity_id, operation,
        payload_json, status, created_at, updated_at) VALUES (?, ?, 'GROCERY_V1', ?, ?, ?, ?, ?, ?);`,
      [transactionId, transactionId, entityId, operation,
        JSON.stringify({ actor, payload, productId, dependsOn }), status, now, now]
    );
  }
  await createActivityLog({
    transactionId, productId, userId: actor, action,
    prevQuantity: previous, newQuantity: next, occurredAt: now, syncStatus: status,
    metadataJson: metadata ? JSON.stringify(metadata) : null,
  }, tx);
  return transactionId;
}

export async function getPendingSyncItems(db = null) {
  const connection = db || await getDatabase();
  return connection.getAllAsync(
    "SELECT * FROM sync_queue WHERE entity_type = 'GROCERY_V1' AND status IN ('PENDING', 'FAILED') ORDER BY rowid;"
  );
}

export async function setSyncOutcome(row, status, error = null) {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      'UPDATE sync_queue SET status = ?, last_error = ?, retry_count = retry_count + ?, updated_at = ? WHERE id = ?;',
      [status, error, status === 'SYNCED' ? 0 : 1, toIsoNow(), row.id]
    );
    await tx.runAsync('UPDATE activity_logs SET sync_status = ? WHERE transaction_id = ?;',
      [status, row.transaction_id]);
  });
}

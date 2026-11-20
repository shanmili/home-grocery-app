import { LOW_STOCK_LIMIT, TO_BUY_QUANTITY } from '../../constants/stockStatus';
import { getDatabase } from '../sqlite';
import { generateId } from '../../utils/ids';
import { toIsoNow } from '../../utils/dateTime';
import { INVENTORY_ACTIONS } from '../../constants/actions';
import { recordGroceryChange } from './syncQueueRepo';

export async function getActiveProducts() {
  const db = await getDatabase();
  return db.getAllAsync(
    'SELECT * FROM products WHERE is_active = 1 ORDER BY name ASC;'
  );
}

export async function findProductById(productId) {
  const db = await getDatabase();
  return db.getFirstAsync('SELECT * FROM products WHERE id = ? LIMIT 1;', [productId]);
}

export async function getDatedStock() {
  const db = await getDatabase();
  return db.getAllAsync(
    'SELECT id, name, expiration_date FROM products WHERE is_active = 1 AND quantity > 0 AND expiration_date IS NOT NULL ORDER BY expiration_date, name;'
  );
}

export async function getInventorySummary() {
  const db = await getDatabase();

  const row = await db.getFirstAsync(
    `SELECT
      COUNT(*) AS total_active,
      SUM(CASE WHEN quantity > 0 AND quantity <= ? THEN 1 ELSE 0 END) AS low_stock_count,
      SUM(CASE WHEN quantity = ? THEN 1 ELSE 0 END) AS out_of_stock_count
     FROM products
     WHERE is_active = 1;`,
    [LOW_STOCK_LIMIT, TO_BUY_QUANTITY]
  );

  return {
    totalActive: Number(row?.total_active || 0),
    lowStockCount: Number(row?.low_stock_count || 0),
    shoppingCount: Number(row?.out_of_stock_count || 0),
    outOfStockCount: Number(row?.out_of_stock_count || 0),
  };
}

export async function getProductsToBuy(db) {

  return db.getAllAsync(
    `SELECT *
     FROM products
     WHERE is_active = 1 AND quantity = ?
     ORDER BY quantity ASC, name ASC;`,
    [TO_BUY_QUANTITY]
  );
}

async function rejectDuplicate(tx, name, exceptId = null) {
  const duplicate = await tx.getFirstAsync(
    'SELECT id FROM products WHERE is_active = 1 AND lower(trim(name)) = lower(?) AND (? IS NULL OR id <> ?) LIMIT 1;',
    [name, exceptId, exceptId]
  );
  if (duplicate) throw new Error('The product already exists.');
}

function productPayload(input) {
  return {
    name: input.name.trim(), category: input.category.trim(), unit: input.unit.trim(),
    min_threshold: Number(input.minThreshold),
    ...(input.piecesPerPack !== undefined ? { pieces_per_pack: input.piecesPerPack } : {}),
    ...(input.expirationDate !== undefined ? { expiration_date: input.expirationDate || null } : {}),
  };
}

export async function createProduct(input, actorUserId) {
  const db = await getDatabase();
  const now = toIsoNow();
  const id = generateId('product');
  const payload = { ...productPayload(input), quantity: Number(input.quantity) };
  await db.withExclusiveTransactionAsync(async (tx) => {
    await rejectDuplicate(tx, payload.name);
    await tx.runAsync(
      `INSERT INTO products (id, name, category, quantity, unit, min_threshold,
        created_at, updated_at, last_modified_by, expiration_date, server_version, pieces_per_pack)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?);`,
      [id, payload.name, payload.category, payload.quantity, payload.unit,
        payload.min_threshold, now, now, actorUserId, payload.expiration_date ?? null, payload.pieces_per_pack ?? null]
    );
    await recordGroceryChange(tx, {
      actor: actorUserId, operation: 'create_product', entityId: id, payload,
      productId: id, action: INVENTORY_ACTIONS.PRODUCT_CREATED, next: payload.quantity,
    });
  });
  return findProductById(id);
}

async function getCurrentProduct(tx, id) {
  const product = await tx.getFirstAsync('SELECT * FROM products WHERE id = ? AND is_active = 1;', [id]);
  if (!product) throw new Error('Product not found or archived');
  return product;
}

export async function updateProduct(productId, input, actorUserId) {
  const db = await getDatabase();
  const now = toIsoNow();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const current = await getCurrentProduct(tx, productId);
    const details = productPayload(input);
    if (input.expectedVersion !== current.server_version || input.originalQuantity !== current.quantity) {
      throw new Error('This product changed while you were editing it. Close and reopen the form.');
    }
    if (details.name.toLowerCase() !== current.name.trim().toLowerCase()) {
      await rejectDuplicate(tx, details.name, productId);
    }
    const next = Number(input.quantity);
    const packSize = details.pieces_per_pack === undefined ? current.pieces_per_pack : details.pieces_per_pack;
    const convertsQuantity = Boolean(packSize) !== Boolean(current.pieces_per_pack);
    const editedQuantity = convertsQuantity ? next : current.quantity;
    const editId = await recordGroceryChange(tx, {
      actor: actorUserId, operation: 'edit_product', entityId: productId, productId,
      payload: { ...details, expected_version: current.server_version,
        ...(convertsQuantity ? { pack_conversion_quantity: next } : {}) },
      action: INVENTORY_ACTIONS.PRODUCT_UPDATED, previous: current.quantity, next: editedQuantity,
    });
    await tx.runAsync(
      `UPDATE products SET name = ?, category = ?, unit = ?, min_threshold = ?, expiration_date = ?, pieces_per_pack = ?, quantity = ?,
        updated_at = ?, last_modified_by = ?, server_version = server_version + 1 WHERE id = ?;`,
      [details.name, details.category, details.unit, details.min_threshold,
        'expiration_date' in details ? details.expiration_date : current.expiration_date,
        packSize ?? null, editedQuantity, now, actorUserId, productId]
    );
    if (!convertsQuantity && next !== current.quantity) {
      await changeQuantity(tx, current, next, actorUserId, { dependsOn: editId });
    }
  });
  return findProductById(productId);
}

export async function archiveProduct(productId, actorUserId) {
  const db = await getDatabase();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const current = await getCurrentProduct(tx, productId);
    await tx.runAsync(
      `UPDATE products SET is_active = 0, updated_at = ?, last_modified_by = ?,
        server_version = server_version + 1 WHERE id = ?;`,
      [toIsoNow(), actorUserId, productId]
    );
    await recordGroceryChange(tx, {
      actor: actorUserId, operation: 'archive_product', entityId: productId, productId,
      payload: { expected_version: current.server_version },
      action: INVENTORY_ACTIONS.PRODUCT_ARCHIVED, previous: current.quantity, next: current.quantity,
    });
  });
}

export async function changeQuantity(tx, current, next, actor, {
  dependsOn = null, action = null, questIntent = null,
} = {}) {
  const previous = Number(current.quantity);
  const delta = next - previous;
  if (!Number.isFinite(next) || next < 0) throw new Error('Invalid quantity');
  if (!delta) return false;
  await tx.runAsync(
    `UPDATE products SET quantity = ?, updated_at = ?, last_modified_by = ?,
      server_version = server_version + 1 WHERE id = ?;`,
    [next, toIsoNow(), actor, current.id]
  );
  await recordGroceryChange(tx, {
    actor, operation: 'adjust_quantity', entityId: current.id, productId: current.id,
    payload: { delta, ...(questIntent ? { quest_intent: questIntent } : {}) }, previous, next, dependsOn,
    action: action || (delta < 0 ? INVENTORY_ACTIONS.QUANTITY_DECREASED : INVENTORY_ACTIONS.QUANTITY_INCREASED),
  });
  return true;
}

export async function adjustProductQuantity(productId, delta, actorUserId) {
  const db = await getDatabase();
  let previousQuantity, newQuantity, changed;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const current = await getCurrentProduct(tx, productId);
    previousQuantity = Number(current.quantity);
    newQuantity = Math.max(0, previousQuantity + Number(delta));
    changed = await changeQuantity(tx, current, newQuantity, actorUserId, { questIntent: 'usage' });
  });
  return { product: await findProductById(productId), previousQuantity, newQuantity, changed };
}


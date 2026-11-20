import { getDatabase } from '../sqlite';
import { generateId } from '../../utils/ids';
import { SYNC_STATUS } from '../../constants/syncStatus';
import { toIsoNow } from '../../utils/dateTime';

export async function getRecentActivities(limit = 20, userId = null) {
  const db = await getDatabase();
  return db.getAllAsync(
    `SELECT
      a.*, p.name AS product_name
     FROM activity_logs a
     LEFT JOIN products p ON p.id = a.product_id
     WHERE ? IS NULL OR a.user_id = ?
     ORDER BY julianday(a.occurred_at) DESC, a.id DESC
     LIMIT ?;`,
    [userId, userId, limit]
  );
}

export async function getActivityHistory(userId = null) {
  const db = await getDatabase();
  return db.getAllAsync(
    `SELECT a.*, p.name AS product_name
     FROM activity_logs a
     LEFT JOIN products p ON p.id = a.product_id
     WHERE ? IS NULL OR a.user_id = ?
     ORDER BY julianday(a.occurred_at) DESC, a.id DESC;`,
    [userId, userId]
  );
}

export async function createActivityLog(input, transaction) {
  const db = transaction || await getDatabase();

  const record = {
    id: input.id || generateId('activity'),
    transactionId: input.transactionId,
    productId: input.productId || null,
    userId: input.userId,
    action: input.action,
    prevQuantity: input.prevQuantity,
    newQuantity: input.newQuantity,
    metadataJson: input.metadataJson || null,
    occurredAt: input.occurredAt || toIsoNow(),
    syncStatus: input.syncStatus || SYNC_STATUS.PENDING,
  };

  await db.runAsync(
    `INSERT INTO activity_logs (
      id, transaction_id, product_id, user_id, action,
      prev_quantity, new_quantity, metadata_json, occurred_at, sync_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      record.id,
      record.transactionId,
      record.productId,
      record.userId,
      record.action,
      record.prevQuantity,
      record.newQuantity,
      record.metadataJson,
      record.occurredAt,
      record.syncStatus,
    ]
  );

  return record;
}

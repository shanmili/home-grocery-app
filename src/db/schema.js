import { getDatabase } from './sqlite';
import { seedHouseholdProducts } from './seedHouseholdProducts';

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS custom_categories (name TEXT PRIMARY KEY NOT NULL COLLATE NOCASE);`,
  `CREATE TABLE IF NOT EXISTS quest_pending_redemption (
    user_id TEXT PRIMARY KEY NOT NULL,
    request_id TEXT NOT NULL,
    pesos INTEGER NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS quest_profile_cache (user_id TEXT PRIMARY KEY NOT NULL, profile_json TEXT NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS inventory_setup (key TEXT PRIMARY KEY NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL,
    min_threshold REAL NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_modified_by TEXT,
    expiration_date TEXT,
    pieces_per_pack INTEGER
  );`,
  `CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL,
    product_id TEXT,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    prev_quantity REAL,
    new_quantity REAL,
    metadata_json TEXT,
    occurred_at TEXT NOT NULL,
    sync_status TEXT NOT NULL DEFAULT 'PENDING'
  );`,
  `CREATE TABLE IF NOT EXISTS shopping_list (
    id TEXT PRIMARY KEY,
    product_id TEXT,
    label TEXT NOT NULL,
    requested_quantity REAL,
    unit TEXT,
    is_purchased INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL UNIQUE,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    operation TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`,
];

export async function initializeSchema() {
  const db = await getDatabase();

  for (const statement of schemaStatements) {
    await db.execAsync(statement);
  }

  const columns = await db.getAllAsync('PRAGMA table_info(products);');
  if (!columns.some((column) => column.name === 'expiration_date')) {
    await db.execAsync('ALTER TABLE products ADD COLUMN expiration_date TEXT;');
  }

  if (!columns.some((column) => column.name === 'pieces_per_pack')) {
    await db.execAsync('ALTER TABLE products ADD COLUMN pieces_per_pack INTEGER;');
  }

  if (!columns.some((column) => column.name === 'server_version')) {
    await db.execAsync('ALTER TABLE products ADD COLUMN server_version INTEGER;');
  }

  await db.execAsync(`CREATE TABLE IF NOT EXISTS grocery_local_backup (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    products_json TEXT NOT NULL,
    shopping_json TEXT NOT NULL
  );`);
  await db.execAsync('CREATE INDEX IF NOT EXISTS activity_transaction_lookup ON activity_logs(transaction_id);');
  await db.execAsync(`CREATE INDEX IF NOT EXISTS stock_return_original
    ON activity_logs(json_extract(metadata_json, '$.originalTransactionId')) WHERE action = 'STOCK_RETURNED';`);
  await db.execAsync(`CREATE VIEW IF NOT EXISTS returnable_stock_uses AS
    SELECT a.transaction_id, a.user_id, a.product_id, a.occurred_at, a.rowid AS sequence,
      a.prev_quantity - a.new_quantity AS amount, a.sync_status
    FROM activity_logs a JOIN products p ON p.id = a.product_id AND p.is_active = 1
    WHERE a.action = 'QUANTITY_DECREASED' AND a.prev_quantity > a.new_quantity
      AND (a.sync_status IN ('PENDING', 'FAILED', 'SYNCED') OR
        (a.sync_status = 'LOCAL_ONLY' AND NOT EXISTS (
          SELECT 1 FROM inventory_setup WHERE key = 'shared-inventory-v1')))
      AND json_extract(a.metadata_json, '$.usageUnit') =
        CASE WHEN p.pieces_per_pack IS NOT NULL THEN 'pc/s' ELSE p.unit END
      AND NOT EXISTS (SELECT 1 FROM activity_logs r WHERE r.action = 'STOCK_RETURNED'
        AND json_extract(r.metadata_json, '$.originalTransactionId') = a.transaction_id
        AND r.sync_status <> 'CONFLICT');`);
  await seedHouseholdProducts(db);
}


import { getPendingSyncItems, sharedInventoryKey } from '../../db/repositories/syncQueueRepo';

const displayNames = new Map([
  ['Mother', 'Sheila'], ['Daughter', 'Shanmi'],
  ['Younger Sibling 1', 'Shannen'], ['Younger Sibling 2', 'Drexel'],
]);

export async function applySnapshot(db, snapshot) {
  let changed = false;
  await db.withExclusiveTransactionAsync(async (tx) => {
    const save = async (sql, args) => {
      const result = await tx.runAsync(sql, args ?? []);
      if (result.changes) changed = true;
    };
    const initialized = await tx.getFirstAsync('SELECT key FROM inventory_setup WHERE key = ?;', [sharedInventoryKey]);
    if (!initialized) {
      const products = await tx.getAllAsync('SELECT * FROM products;');
      const shopping = await tx.getAllAsync('SELECT * FROM shopping_list;');
      await save(
        'INSERT INTO grocery_local_backup (id, products_json, shopping_json) VALUES (1, ?, ?);',
        [JSON.stringify(products), JSON.stringify(shopping)]
      );
      // Keep the old IDs for historical joins, and hide stock from other local copies.
      await save('UPDATE products SET is_active = 0;');
      await save('UPDATE shopping_list SET is_purchased = 1;');
      await save("UPDATE activity_logs SET sync_status = 'LOCAL_ONLY' WHERE sync_status IN ('PENDING', 'FAILED');");
      await save("UPDATE sync_queue SET status = 'LOCAL_ONLY' WHERE entity_type <> 'GROCERY_V1' AND status IN ('PENDING', 'FAILED');");
      await save('INSERT INTO inventory_setup (key) VALUES (?);', [sharedInventoryKey]);
    }

    const pendingProducts = new Set();
    const pendingShopping = new Set();
    for (const row of await getPendingSyncItems(tx)) {
      const { productId } = JSON.parse(row.payload_json);
      if (productId) pendingProducts.add(productId);
      if (row.operation === 'confirm_purchase' || row.operation === 'add_shopping_item') {
        pendingShopping.add(row.entity_id);
      }
    }

    const remoteProducts = new Set(snapshot.products.map(({ id }) => id));
    for (const { id } of await tx.getAllAsync('SELECT id FROM products WHERE is_active = 1;')) {
      if (!remoteProducts.has(id) && !pendingProducts.has(id)) {
        await save('UPDATE products SET is_active = 0 WHERE id = ?;', [id]);
      }
    }
    for (const product of snapshot.products) {
      if (pendingProducts.has(product.id)) continue;
      await save(
        `INSERT INTO products (id, name, category, quantity, unit, min_threshold, is_active,
          created_at, updated_at, last_modified_by, expiration_date, server_version, pieces_per_pack)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, category=excluded.category,
            quantity=excluded.quantity, unit=excluded.unit, min_threshold=excluded.min_threshold,
            is_active=excluded.is_active, updated_at=excluded.updated_at,
            last_modified_by=excluded.last_modified_by, expiration_date=excluded.expiration_date,
            server_version=excluded.server_version, pieces_per_pack=excluded.pieces_per_pack
          WHERE products.server_version IS NOT excluded.server_version
             OR products.is_active <> excluded.is_active OR products.quantity <> excluded.quantity
             OR products.name <> excluded.name OR products.category <> excluded.category
             OR products.unit <> excluded.unit OR products.min_threshold <> excluded.min_threshold
             OR products.expiration_date IS NOT excluded.expiration_date
             OR products.pieces_per_pack IS NOT excluded.pieces_per_pack;`,
        [product.id, product.name, product.category, Number(product.quantity), product.unit,
          Number(product.min_threshold), Number(product.is_active), product.created_at,
          product.updated_at, product.last_modified_by, product.expiration_date, Number(product.version), product.pieces_per_pack ?? null]
      );
    }

    const remoteShopping = new Set(snapshot.shopping.map(({ id }) => id));
    for (const { id } of await tx.getAllAsync('SELECT id FROM shopping_list WHERE is_purchased = 0 AND product_id IS NULL;')) {
      if (!remoteShopping.has(id) && !pendingShopping.has(id)) {
        await save('UPDATE shopping_list SET is_purchased = 1 WHERE id = ?;', [id]);
      }
    }
    for (const item of snapshot.shopping) {
      if (pendingShopping.has(item.id)) continue;
      await save(
        `INSERT INTO shopping_list (id, product_id, label, requested_quantity, unit, is_purchased, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id, label=excluded.label,
            requested_quantity=excluded.requested_quantity, unit=excluded.unit,
            is_purchased=excluded.is_purchased, updated_at=excluded.updated_at
          WHERE shopping_list.is_purchased <> excluded.is_purchased
             OR shopping_list.updated_at <> excluded.updated_at;`,
        [item.id, item.product_id, item.label, Number(item.requested_quantity), item.unit,
          Number(item.is_purchased), item.created_at, item.updated_at]
      );
    }

    for (const entry of snapshot.activity) {
      await save(
        `INSERT INTO activity_logs (id, transaction_id, product_id, user_id, action,
          prev_quantity, new_quantity, metadata_json, occurred_at, sync_status)
          VALUES (coalesce((SELECT id FROM activity_logs WHERE transaction_id = ? LIMIT 1), ?),
            ?, ?, ?, ?, ?, ?, ?, ?, 'SYNCED')
          ON CONFLICT(id) DO UPDATE SET
            prev_quantity=excluded.prev_quantity, new_quantity=excluded.new_quantity,
            metadata_json=json_patch(coalesce(activity_logs.metadata_json, '{}'), excluded.metadata_json), sync_status='SYNCED'
          WHERE activity_logs.sync_status <> 'SYNCED'
             OR activity_logs.prev_quantity IS NOT excluded.prev_quantity
             OR activity_logs.new_quantity IS NOT excluded.new_quantity
             OR (json_extract(excluded.metadata_json, '$.usageUnit') IS NOT NULL AND
                 json_extract(activity_logs.metadata_json, '$.usageUnit') IS NOT json_extract(excluded.metadata_json, '$.usageUnit'))
             OR json_extract(activity_logs.metadata_json, '$.actorName') IS NULL;`,
        [entry.transaction_id, 'remote-' + entry.id, entry.transaction_id, entry.product_id, entry.user_id, entry.action,
          entry.prev_quantity === null ? null : Number(entry.prev_quantity),
          entry.new_quantity === null ? null : Number(entry.new_quantity),
          JSON.stringify({ ...entry.metadata_json, actorName: displayNames.get(entry.actor_name) ?? entry.actor_name }), entry.occurred_at]
      );
    }
  });
  return changed;
}

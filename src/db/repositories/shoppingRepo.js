import { LOW_STOCK_LIMIT, TO_BUY_QUANTITY } from '../../constants/stockStatus';
import { getDatabase } from '../sqlite';
import { generateId } from '../../utils/ids';
import { toIsoNow } from '../../utils/dateTime';
import { getProductsToBuy } from './productsRepo';
import { recordGroceryChange } from './syncQueueRepo';
import { INVENTORY_ACTIONS } from '../../constants/actions';

export async function getOpenShoppingItems() {
  const db = await getDatabase();

  return db.getAllAsync(
    `SELECT
      s.*,
      CASE WHEN p.pieces_per_pack IS NOT NULL THEN 'pc/s' ELSE s.unit END AS display_unit,
      p.pieces_per_pack,
      p.name AS product_name,
      p.category AS product_category,
      p.quantity AS product_quantity,
      p.min_threshold AS product_min_threshold,
      p.is_active AS product_is_active
     FROM shopping_list s
     LEFT JOIN products p ON p.id = s.product_id
     WHERE s.is_purchased = 0
       AND (s.product_id IS NULL OR (p.is_active = 1 AND p.quantity = ?))
     ORDER BY s.created_at DESC;`,
    [TO_BUY_QUANTITY]
  );
}

export async function syncAutoShoppingItems() {
  const db = await getDatabase();
  const now = toIsoNow();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const productsToBuy = await getProductsToBuy(tx);
    for (const product of productsToBuy) {
      const openItem = await tx.getFirstAsync(
        `SELECT id
         FROM shopping_list
         WHERE is_purchased = 0 AND product_id = ?
         LIMIT 1;`,
        [product.id]
      );

      if (!openItem) {
        const suggestedQuantity = Math.max(
          1,
          Math.ceil(Math.max(LOW_STOCK_LIMIT + 1, Number(product.min_threshold)) - Number(product.quantity))
        );

        await tx.runAsync(
          `INSERT INTO shopping_list (
            id, product_id, label, requested_quantity, unit,
            is_purchased, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 0, ?, ?);`,
          [
            generateId('shop'),
            product.id,
            product.name,
            suggestedQuantity,
            product.pieces_per_pack ? 'pc/s' : product.unit,
            now,
            now,
          ]
        );
      }
    }

    await tx.runAsync(
      `DELETE FROM shopping_list
       WHERE is_purchased = 0
         AND product_id IS NOT NULL
         AND product_id NOT IN (
           SELECT id FROM products
           WHERE is_active = 1 AND quantity = ?
         );`,
      [TO_BUY_QUANTITY]
    );
  });
}

export async function addManualShoppingItem(input, actor) {
  const db = await getDatabase();
  const now = toIsoNow();
  const id = generateId('shop');
  const payload = {
    label: input.label.trim(), requested_quantity: Number(input.requestedQuantity), unit: input.unit.trim(),
  };
  await db.withExclusiveTransactionAsync(async (tx) => {
    await tx.runAsync(
      `INSERT INTO shopping_list (id, label, requested_quantity, unit, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?);`,
      [id, payload.label, payload.requested_quantity, payload.unit, now, now]
    );
    await recordGroceryChange(tx, {
      actor, operation: 'add_shopping_item', entityId: id, payload, action: 'SHOPPING_ITEM_ADDED',
    });
  });
  return id;
}

export async function confirmShoppingItemPurchased(itemId, quantity, unitPrice, actor) {
  const amount = Number(quantity);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Enter a positive purchased quantity.');
  const db = await getDatabase();
  const now = toIsoNow();
  await db.withExclusiveTransactionAsync(async (tx) => {
    const item = await tx.getFirstAsync('SELECT * FROM shopping_list WHERE id = ? AND is_purchased = 0;', [itemId]);
    if (!item) throw new Error('Shopping item not found or already purchased');

    let product;
    if (item.product_id) {
      product = await tx.getFirstAsync('SELECT * FROM products WHERE id = ? AND is_active = 1;', [item.product_id]);
      if (!product) throw new Error('Active product not found');
      if (product.pieces_per_pack && !Number.isInteger(amount)) throw new Error('Enter a whole number of pieces.');
      await tx.runAsync(
        `UPDATE products SET quantity = quantity + ?, server_version = server_version + 1,
          updated_at = ?, last_modified_by = ? WHERE id = ?;`,
        [amount, now, actor, product.id]
      );
    }

    await tx.runAsync('UPDATE shopping_list SET is_purchased = 1, updated_at = ? WHERE id = ?;', [now, itemId]);
    await recordGroceryChange(tx, {
      actor, operation: product ? 'restock_product' : 'confirm_purchase',
      entityId: product?.id || itemId, productId: product?.id,
      payload: { quantity: amount, expected_version: product?.server_version },
      action: INVENTORY_ACTIONS.SHOPPING_MARKED_PURCHASED,
      previous: product?.quantity ?? null, next: product ? Number(product.quantity) + amount : amount,
      metadata: { label: item.label, unitPrice: Number(unitPrice) },
    });
  });
}


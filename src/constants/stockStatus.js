export const LOW_STOCK_LIMIT = 2;
export const TO_BUY_QUANTITY = 0;

export function stockStatus(quantity) {
  const amount = Number(quantity);
  if (amount === TO_BUY_QUANTITY) return 'out';
  if (amount > 0 && amount <= LOW_STOCK_LIMIT) return 'low';
  return 'in-stock';
}

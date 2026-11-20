export function createTransactionKey(transactionId, operation) {
  return `${operation}:${transactionId}`;
}

export function logInfo(scope, message, payload) {
  console.log(`[${scope}] ${message}`, payload ?? '');
}

export function logError(scope, message, error) {
  console.error(`[${scope}] ${message}`, error);
}

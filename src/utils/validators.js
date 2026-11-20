export function validateRequiredString(value, fieldName) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    return `${fieldName} is required.`;
  }
  return null;
}

export function validateNonNegativeNumber(value, fieldName) {
  if (Number.isNaN(Number(value)) || Number(value) < 0) {
    return `${fieldName} must be a non-negative number.`;
  }
  return null;
}

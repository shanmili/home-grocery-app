const dayMs = 86_400_000;

export function localDateString(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function isValidExpirationDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function frozenFishReminderDate(now = new Date()) {
  const date = new Date(now);
  date.setDate(date.getDate() + 14);
  return localDateString(date);
}

export function expirationNotice(date, now = new Date()) {
  if (!isValidExpirationDate(date)) return null;
  const days = (Date.parse(date) - Date.parse(localDateString(now))) / dayMs;
  if (days < 0) return 'Past date';
  if (days === 0) return 'Due today';
  if (days <= 2) return `Oh no, almost expiring! Due in ${days} ${days === 1 ? 'day' : 'days'}.`;
  return null;
}

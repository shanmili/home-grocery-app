const manilaTime = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Manila',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

const dayCodes = { Sun: 'Su', Mon: 'M', Tue: 'Tu', Wed: 'W', Thu: 'Th', Fri: 'F', Sat: 'Sa' };

export function formatRedemptionReference(timestamp) {
  const date = new Date(timestamp);
  if (!timestamp || !Number.isFinite(date.getTime())) return null;
  const { month, day, year, hour, minute, weekday } = Object.fromEntries(
    manilaTime.formatToParts(date).map(({ type, value }) => [type, value])
  );
  return `${month}${day}${year}_${hour}${minute}_${dayCodes[weekday]}`;
}

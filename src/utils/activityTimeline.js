const yearFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric' });
const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'long' });
const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric' });
const timestampFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
});

export function buildActivityTimeline(activities) {
  const rows = [];
  let previousYear;
  let previousMonth;
  let previousDay;

  for (const activity of activities) {
    const date = activity.occurred_at ? new Date(activity.occurred_at) : null;
    if (!date || Number.isNaN(date.getTime())) {
      if (previousYear !== 'unknown') {
        rows.push({ key: 'year-unknown', type: 'year', label: 'Unknown date' });
        previousYear = 'unknown';
      }
      rows.push({ key: 'activity-' + activity.id, type: 'activity', activity, timestamp: 'Time unavailable' });
      continue;
    }

    const year = String(date.getFullYear());
    const month = year + '-' + date.getMonth();
    const day = month + '-' + date.getDate();
    if (year !== previousYear) rows.push({ key: 'year-' + year, type: 'year', label: yearFormat.format(date) });
    if (month !== previousMonth) rows.push({ key: 'month-' + month, type: 'month', label: monthFormat.format(date) });
    if (day !== previousDay) rows.push({ key: 'day-' + day, type: 'day', label: dayFormat.format(date) });
    rows.push({ key: 'activity-' + activity.id, type: 'activity', activity, timestamp: timestampFormat.format(date) });

    previousYear = year;
    previousMonth = month;
    previousDay = day;
  }
  return rows;
}

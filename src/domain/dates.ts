/** Today's date in the device's time zone, as YYYY-MM-DD. */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const dayFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

/** Formats a YYYY-MM-DD calendar date without shifting it across time zones. */
export function formatDay(isoDate: string): string {
  return dayFormatter.format(new Date(`${isoDate}T00:00:00Z`));
}

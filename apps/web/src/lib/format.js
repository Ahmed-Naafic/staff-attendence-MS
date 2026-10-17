const monthFormat = new Intl.DateTimeFormat('en', { month: 'short' });
const monthYearFormat = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' });
const dateFormat = new Intl.DateTimeFormat('en', { month: 'short', day: '2-digit', year: 'numeric' });
const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const monthDate = (yearMonth) => {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month - 1, 1);
};

/** '2026-03' → 'Mar' */
export const formatMonth = (yearMonth) => monthFormat.format(monthDate(yearMonth));

/** '2026-03' → 'March 2026' (for screen reader tables) */
export const formatMonthYear = (yearMonth) => monthYearFormat.format(monthDate(yearMonth));

const dayFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const fullDayFormat = new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' });
const dayDate = (yearMonthDay) => {
  const [year, month, day] = yearMonthDay.split('-').map(Number);
  return new Date(year, month - 1, day);
};

/** '2026-03-07' → 'Mar 7' */
export const formatDay = (yearMonthDay) => dayFormat.format(dayDate(yearMonthDay));

/** '2026-03-07' → 'March 7, 2026' (for screen reader tables) */
export const formatFullDay = (yearMonthDay) => fullDayFormat.format(dayDate(yearMonthDay));

/** ISO date → 'Jan 12, 2026' */
export const formatDate = (iso) => dateFormat.format(new Date(iso));

/** ISO date → '2 hours ago', 'yesterday', '3 days ago' */
export function formatRelative(iso, now = Date.now()) {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const units = [
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

const dateTimeFormat = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

/** ISO date → 'Jan 12, 2026, 10:24:18' (24-hour, local time) */
export const formatDateTime = (iso) => dateTimeFormat.format(new Date(iso));

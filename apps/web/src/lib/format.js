const monthFormat = new Intl.DateTimeFormat('en', { month: 'short' });
const monthYearFormat = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' });
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

/*
 * Platform display settings (Platform Settings → General), applied to absolute dates and times:
 * the platform time zone, date format and time format. Set once the settings are loaded
 * (app/providers/DisplaySettingsProvider.jsx) and after General is saved. Until then, and when a
 * format is not set, the standard display is used: 'Jan 12, 2026' and 24-hour time, in UTC (the
 * server's default platform time zone).
 */
let display = { timeZone: 'UTC', dateFormat: null, timeFormat: null };

/** { timeZone, dateFormat: 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | null, timeFormat: '12h' | '24h' | null } */
export function setDisplaySettings(next) {
  display = { timeZone: next?.timeZone || 'UTC', dateFormat: next?.dateFormat ?? null, timeFormat: next?.timeFormat ?? null };
}

export const getDisplaySettings = () => display;

const formatters = new Map();
const formatterFor = (kind, timeZone) => {
  const key = `${kind}|${timeZone}`;
  if (!formatters.has(key)) {
    formatters.set(
      key,
      kind === 'standard'
        ? new Intl.DateTimeFormat('en', { timeZone, month: 'short', day: '2-digit', year: 'numeric' })
        : new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }),
    );
  }
  return formatters.get(key);
};

// The calendar date and clock time of an instant in the platform time zone.
function partsOf(iso) {
  const parts = Object.fromEntries(formatterFor('parts', display.timeZone).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { year: parts.year, month: parts.month, day: parts.day, hour: Number(parts.hour), minute: parts.minute, second: parts.second };
}

// Offset of the platform time zone from UTC at an instant, in ms.
function offsetAt(ms) {
  const p = partsOf(ms);
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), p.hour, Number(p.minute), Number(p.second)) - Math.floor(ms / 1000) * 1000;
}

/** The instant (ms) a calendar date starts in the platform time zone. */
export function platformMidnight(year, month, day) {
  const guess = Date.UTC(year, month - 1, day);
  const first = guess - offsetAt(guess);
  // Once more at the result, in case a daylight-saving change lies between.
  return guess - offsetAt(first);
}

/** The instant (ms) today (or the day of `ms`) started in the platform time zone. */
export function platformDayStart(ms = Date.now()) {
  const p = partsOf(ms);
  return platformMidnight(Number(p.year), Number(p.month), Number(p.day));
}

const DATE_LAYOUTS = {
  'YYYY-MM-DD': (p) => `${p.year}-${p.month}-${p.day}`,
  'DD/MM/YYYY': (p) => `${p.day}/${p.month}/${p.year}`,
  'MM/DD/YYYY': (p) => `${p.month}/${p.day}/${p.year}`,
};

/** ISO date → the date in the platform time zone and date format, e.g. 'Jan 12, 2026' or '12/01/2026'. */
export function formatDate(iso) {
  const layout = DATE_LAYOUTS[display.dateFormat];
  return layout ? layout(partsOf(iso)) : formatterFor('standard', display.timeZone).format(new Date(iso));
}

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

/** ISO date → date and time in the platform settings, e.g. 'Jan 12, 2026, 10:24:18' or '12/01/2026, 10:24:18 AM'. */
export function formatDateTime(iso) {
  const p = partsOf(iso);
  const time =
    display.timeFormat === '12h'
      ? `${p.hour % 12 || 12}:${p.minute}:${p.second} ${p.hour < 12 ? 'AM' : 'PM'}`
      : `${String(p.hour).padStart(2, '0')}:${p.minute}:${p.second}`;
  return `${formatDate(iso)}, ${time}`;
}

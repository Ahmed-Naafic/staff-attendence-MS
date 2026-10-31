/*
 * Dates and times in the branch time zone given by the API (`today.timeZone`), never the phone's
 * own zone, so the app shows the same day and times as the server. Uses Intl (built into Hermes).
 */

const cache = new Map();
function formatter(timeZone, options) {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  if (!cache.has(key)) {
    let f;
    try {
      f = new Intl.DateTimeFormat('en-GB', { ...options, timeZone });
    } catch {
      // An unknown zone: fall back to UTC rather than the phone's zone.
      f = new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' });
    }
    cache.set(key, f);
  }
  return cache.get(key);
}

const parts = (instant, timeZone, options) => Object.fromEntries(formatter(timeZone, options).formatToParts(instant).map((p) => [p.type, p.value]));

/** 'HH:MM' (24-hour) of an instant in a zone. */
export function formatTime(instant, timeZone) {
  const p = parts(new Date(instant), timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${p.hour}:${p.minute}`;
}

/** 'HH:MM:SS' (24-hour) of an instant in a zone, for the live clock. */
export function formatClock(instant, timeZone) {
  const p = parts(new Date(instant), timeZone, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** 'YYYY-MM-DD' of an instant in a zone. */
export function localDate(instant, timeZone) {
  const p = parts(new Date(instant), timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

/** Hour of the day (0–23) of an instant in a zone. */
export function localHour(instant, timeZone) {
  return Number(parts(new Date(instant), timeZone, { hour: '2-digit', hourCycle: 'h23' }).hour);
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'Tue, 27 Oct 2026' for a calendar date 'YYYY-MM-DD' (no zone involved). */
export function formatDay(day) {
  const d = new Date(`${day}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** 'Tue, 27 Oct 2026, 07:58' for an instant in a zone. */
export const formatDayTime = (instant, timeZone) => `${formatDay(localDate(instant, timeZone))}, ${formatTime(instant, timeZone)}`;

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The Monday of a date's week. */
export function weekStart(day) {
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(day, -weekday);
}

export const monthStart = (day) => `${day.slice(0, 8)}01`;

export function greeting(instant, timeZone) {
  const hour = localHour(instant, timeZone);
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** '5 h 20 min', '12 min', 'less than a minute'. */
export function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'less than a minute';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export const formatMeters = (m) => (m === null || m === undefined || !Number.isFinite(m) ? '—' : `${Math.round(m)} m`);

export const formatCoordinates = (p) => (p ? `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}` : '—');

export const initials = (name) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

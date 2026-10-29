/*
 * Attendance report rules for the web app (docs/reports/). Dates are branch-local work dates
 * ('YYYY-MM-DD'), inclusive at both ends, at most 62 days, never after today. "Today" always comes
 * from the server (the platform time zone), never from this computer's clock. The server checks
 * every rule again; these give early, clear feedback.
 */

export const MAX_DAYS = 62;
export const PAGE_SIZE = 20;

const DAY_MS = 24 * 60 * 60 * 1000;
const parse = (date) => Date.parse(`${date}T00:00:00Z`);
export const addDays = (date, days) => new Date(parse(date) + days * DAY_MS).toISOString().slice(0, 10);
/** Days from `from` to `to`, both included. */
export const daysInclusive = (from, to) => Math.round((parse(to) - parse(from)) / DAY_MS) + 1;
const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(parse(value)).toISOString().slice(0, 10) === value;

export const RANGE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'custom', label: 'Custom dates' },
];

/** { from, to } of a preset for `today` (weeks start on Monday). */
export function presetRange(preset, today) {
  if (preset === 'yesterday') return { from: addDays(today, -1), to: addDays(today, -1) };
  if (preset === 'week') return { from: addDays(today, -((new Date(parse(today)).getUTCDay() + 6) % 7)), to: today };
  if (preset === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  return { from: today, to: today };
}

/** Field errors for a custom range: { from?, to? } (empty when valid). */
export function validateRange(from, to, today) {
  const errors = {};
  if (!isDate(from)) errors.from = 'Choose a start date.';
  if (!isDate(to)) errors.to = 'Choose an end date.';
  if (errors.from || errors.to) return errors;
  if (from > to) errors.from = 'The start date must be on or before the end date.';
  else if (to > today) errors.to = `The end date cannot be after today (${today}).`;
  else if (daysInclusive(from, to) > MAX_DAYS) errors.from = `Choose at most ${MAX_DAYS} days (from ${addDays(to, -(MAX_DAYS - 1))} for this end date).`;
  return errors;
}

export const STATUS = {
  PRESENT: { label: 'Present', variant: 'success' },
  LATE: { label: 'Late', variant: 'warning' },
};

/** Check-out states (D9): never an attendance status, never "absent". */
export const CHECK_OUT = {
  recorded: { label: 'Checked out', variant: 'success' },
  open: { label: 'Not checked out yet', variant: 'info' },
  missing: { label: 'No check-out', variant: 'neutral' },
  not_required: { label: 'Check-out not required', variant: 'neutral' },
};

export const SORTS = [
  { value: 'date:desc', label: 'Newest first' },
  { value: 'date:asc', label: 'Oldest first' },
  { value: 'staffName:asc', label: 'Staff name (A–Z)' },
  { value: 'staffName:desc', label: 'Staff name (Z–A)' },
  { value: 'staffId:asc', label: 'Staff ID' },
  { value: 'branch:asc', label: 'Branch', ownerOnly: true },
  { value: 'checkIn:desc', label: 'Latest check-in' },
  { value: 'checkIn:asc', label: 'Earliest check-in' },
  { value: 'status:asc', label: 'Status' },
];

/** '6 h 5 min', '45 min', '0 min' — a duration calculated from two recorded times. */
export function formatWorked(minutes) {
  if (minutes === null || minutes === undefined) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** '20 m' or null (unavailable) for a recorded distance or accuracy. */
export const formatMeters = (value) => (typeof value === 'number' && Number.isFinite(value) ? `${Number.isInteger(value) ? value : value.toFixed(1)} m` : null);

/** 'HH:MM' from a local 'HH:MM:SS'. */
export const shortTime = (time) => (time ? time.slice(0, 5) : null);

const TABS = ['overview', 'records', 'branches'];
const ENUMS = { status: ['present', 'late'], checkOut: Object.keys(CHECK_OUT), sort: SORTS.map((s) => s.value), range: RANGE_PRESETS.map((p) => p.value) };
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The report view from the URL query. Unknown or invalid values fall back to the default (an old or
 * edited link never breaks the page). Owners only: tab "branches", branch; shift needs a branch (D16).
 */
export function readView(params, role) {
  const owner = role === 'OWNER';
  const pick = (name) => (ENUMS[name].includes(params.get(name)) ? params.get(name) : '');
  const id = (name) => (ID.test(params.get(name) ?? '') ? params.get(name) : '');
  const tab = TABS.includes(params.get('tab')) && (owner || params.get('tab') !== 'branches') ? params.get('tab') : 'overview';
  const branch = owner ? id('branch') : '';
  const sort = pick('sort');
  return {
    tab,
    range: pick('range') || 'today',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    branch,
    staff: id('staff'),
    shift: owner && !branch ? '' : id('shift'),
    status: pick('status'),
    checkOut: pick('checkOut'),
    q: (params.get('q') ?? '').slice(0, 100),
    sort: sort && (owner || !SORTS.find((s) => s.value === sort).ownerOnly) ? sort : 'date:desc',
    page: Math.max(1, Number.parseInt(params.get('page'), 10) || 1),
  };
}

/** Whether any filter differs from the default view (today, everything). */
export const isFiltered = (view) => view.range !== 'today' || Boolean(view.branch || view.staff || view.shift || view.status || view.checkOut || view.q);

/** The dates a view asks for: { from, to, errors } — null dates while today is unknown or the custom range is invalid. */
export function viewRange(view, today) {
  if (!today) return { from: null, to: null, errors: {} };
  if (view.range !== 'custom') return { ...presetRange(view.range, today), errors: {} };
  const errors = validateRange(view.from, view.to, today);
  return Object.keys(errors).length ? { from: null, to: null, errors } : { from: view.from, to: view.to, errors };
}

import { badRequest } from '../../common/httpError.js';
import { nameKey, normalizeText } from '../branches/branchInput.js';

/*
 * Validation for academic year requests (School Owner). Collects every problem so the web app can
 * show them next to the fields: 400 { code: 'VALIDATION_ERROR', details: { field: message } }.
 * Rules: docs/business-rules.md → Academic years. The web app applies the same rules first.
 */

export const NAME_MAX = 40;
/** A year lasts at most this many days (both dates inclusive): two calendar years. */
export const MAX_DAYS = 731;
const DAY_MS = 24 * 60 * 60 * 1000;

const CONTROL = /\p{Cc}/u;
const FIELDS = ['name', 'startDate', 'endDate'];
const FIXED = {
  id: 'The academic year id cannot be set.',
  schoolId: 'The school is decided by your account and cannot be set.',
  school: 'The school is decided by your account and cannot be set.',
  status: 'Use Start or Close to change the status.',
};

export { nameKey as academicYearNameKey };

/** 'YYYY-MM-DD' → Date at 00:00 UTC (how Prisma reads and writes DATE columns), or null when not a real date. */
export function parseDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

/** Days from start to end, both inclusive. */
export const daysInclusive = (start, end) => Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;

function refuseUnknown(body, allowed) {
  const keys = Object.keys(body);
  const fixed = keys.filter((key) => FIXED[key]);
  if (fixed.length) throw badRequest(FIXED[fixed[0]], Object.fromEntries(fixed.map((key) => [key, FIXED[key]])));
  const unknown = keys.filter((key) => !allowed.includes(key));
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);
}

function readFields(body, { partial }) {
  refuseUnknown(body, FIELDS);
  const values = {};
  const errors = {};

  if (!partial || 'name' in body) {
    const raw = body.name;
    if (raw !== undefined && raw !== null && typeof raw !== 'string') errors.name = 'Name must be text.';
    else {
      const name = normalizeText(raw ?? '');
      if (!name) errors.name = 'Name is required, e.g. 2026/2027.';
      else if (name.length > NAME_MAX) errors.name = `Name must be at most ${NAME_MAX} characters.`;
      else if (CONTROL.test(name)) errors.name = 'Name cannot contain control characters.';
      else values.name = name;
    }
  }
  for (const [field, label] of [
    ['startDate', 'Start date'],
    ['endDate', 'End date'],
  ]) {
    if (partial && !(field in body)) continue;
    const date = parseDay(body[field]);
    if (!date) errors[field] = `${label} is required as a date (YYYY-MM-DD).`;
    else values[field] = date;
  }

  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return values;
}

/** Checks a complete date range (after merging an update with the stored dates). */
export function checkRange(startDate, endDate) {
  if (endDate <= startDate) throw badRequest('Check the highlighted fields.', { endDate: 'End date must be after the start date.' });
  if (daysInclusive(startDate, endDate) > MAX_DAYS) {
    throw badRequest('Check the highlighted fields.', { endDate: `An academic year can last at most ${MAX_DAYS} days.` });
  }
}

/** { name, startDate, endDate } — all required. */
export function readAcademicYearCreation(body) {
  const values = readFields(body, { partial: false });
  checkRange(values.startDate, values.endDate);
  return values;
}

/** Any of { name, startDate, endDate }; at least one. The range is checked by the service with the stored dates. */
export function readAcademicYearUpdate(body) {
  const values = readFields(body, { partial: true });
  if (!Object.keys(values).length) throw badRequest('Send at least one of: name, startDate, endDate.');
  return values;
}

/** { closeCurrent?: boolean } — confirms that the school's current year is closed by this start. */
export function readAcademicYearStart(body) {
  refuseUnknown(body, ['closeCurrent']);
  if (body.closeCurrent !== undefined && typeof body.closeCurrent !== 'boolean') {
    throw badRequest('"closeCurrent" must be true or false.', { closeCurrent: 'Must be true or false.' });
  }
  return { closeCurrent: body.closeCurrent === true };
}

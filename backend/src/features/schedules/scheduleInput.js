import { badRequest } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';

/*
 * Validation for branch schedule changes (approved rules: docs/business-rules.md → Branch schedules
 * and shifts). Every problem is collected per field (`shifts.<index>.<field>` for a shift):
 * 400 { code: 'VALIDATION_ERROR', details }. The effective date's range depends on the server's
 * clock in the platform time zone and is checked by the service.
 */

export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
export const MAX_SHIFTS = 20;
export const NAME_MAX = 60;
const DAY_NAMES = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };
const CONTROL = /\p{Cc}/u;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// `key`: the identity of an existing shift being kept (checked against the branch by the service).
const SHIFT_KEYS = ['key', 'name', 'days', 'start', 'end', 'graceMinutes', 'absenceCutoffMinutes'];
const FIXED = {
  branchId: 'The branch is your own branch; it cannot be chosen.',
  schoolId: 'The school cannot be chosen.',
  timeZone: 'The time zone is the platform time zone; it cannot be chosen.',
};

/** 'HH:MM' → minutes after midnight, or null. */
export const toMinutes = (value) => {
  const match = typeof value === 'string' ? TIME.exec(value) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
/** minutes after midnight → 'HH:MM' */
export const toTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** A real calendar date 'YYYY-MM-DD', or false. */
export function isDate(value) {
  if (typeof value !== 'string' || !DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const isInt = (value) => Number.isInteger(value);
export const nameKey = (name) => name.normalize('NFKC').toUpperCase().toLowerCase();
export const dayList = (days) => days.map((d) => DAY_NAMES[d]).join(', ');

function readShift(raw, index, errors) {
  const key = (field) => `shifts.${index}.${field}`;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    errors[`shifts.${index}`] = 'Each shift must be an object.';
    return null;
  }
  const unknown = Object.keys(raw).filter((k) => !SHIFT_KEYS.includes(k));
  if (unknown.length) errors[`shifts.${index}`] = `Unknown shift fields: ${unknown.join(', ')}.`;

  let shiftKey = null;
  if (raw.key !== undefined && raw.key !== null) {
    if (isUuid(raw.key)) shiftKey = raw.key;
    else errors[`shifts.${index}.key`] = 'Unknown shift.';
  }

  const name = typeof raw.name === 'string' ? raw.name.trim().replace(/\s+/g, ' ') : '';
  if (!name) errors[key('name')] = 'Enter a shift name.';
  else if (name.length > NAME_MAX) errors[key('name')] = `The shift name must be at most ${NAME_MAX} characters.`;
  else if (CONTROL.test(name)) errors[key('name')] = 'The shift name cannot contain control characters.';

  let days = [];
  if (!Array.isArray(raw.days) || !raw.days.length) errors[key('days')] = 'Choose at least one working day.';
  else if (!raw.days.every((d) => WEEKDAYS.includes(d))) errors[key('days')] = 'Working days must be MON, TUE, WED, THU, FRI, SAT or SUN.';
  else if (new Set(raw.days).size !== raw.days.length) errors[key('days')] = 'Each working day can be chosen once.';
  else days = WEEKDAYS.filter((d) => raw.days.includes(d));

  const start = toMinutes(raw.start);
  const end = toMinutes(raw.end);
  if (start === null) errors[key('start')] = 'Enter the start time as HH:MM (24-hour).';
  if (end === null) errors[key('end')] = 'Enter the end time as HH:MM (24-hour).';
  else if (start !== null && end <= start) errors[key('end')] = 'The shift must end after it starts, on the same day (no overnight shifts).';
  const length = start !== null && end !== null && end > start ? end - start : null;

  const grace = raw.graceMinutes;
  const cutoff = raw.absenceCutoffMinutes;
  if (!isInt(grace) || grace < 0) errors[key('graceMinutes')] = 'Enter the grace period in whole minutes (0 or more).';
  else if (length !== null && grace > length) errors[key('graceMinutes')] = `The grace period cannot be longer than the shift (${length} minutes).`;
  if (!isInt(cutoff) || cutoff < 0) errors[key('absenceCutoffMinutes')] = 'Enter the absence cutoff in whole minutes after the start.';
  else if (isInt(grace) && grace >= 0 && cutoff < grace) errors[key('absenceCutoffMinutes')] = 'The absence cutoff cannot be earlier than the end of the grace period.';
  else if (length !== null && cutoff > length) errors[key('absenceCutoffMinutes')] = `The absence cutoff must be within the shift (at most ${length} minutes).`;

  return { key: shiftKey, name, days, startMinute: start, endMinute: end, graceMinutes: grace, absenceCutoffMinutes: cutoff };
}

/**
 * A schedule change { effectiveFrom, checkOutEnabled, shifts } → { effectiveFrom: 'YYYY-MM-DD',
 * checkOutEnabled, shifts: [{ key, name, days, startMinute, endMinute, graceMinutes, absenceCutoffMinutes }] }.
 * `key` (optional) keeps an existing shift's identity (staff assignments follow it); null = a new shift.
 * Shift names are unique (regardless of capitalization); shifts sharing a day may not overlap
 * (one may start at the minute another ends).
 */
export function readScheduleChange(body) {
  const keys = Object.keys(body);
  const fixed = keys.filter((k) => FIXED[k]);
  if (fixed.length) throw badRequest(FIXED[fixed[0]], Object.fromEntries(fixed.map((k) => [k, FIXED[k]])));
  const unknown = keys.filter((k) => !['effectiveFrom', 'checkOutEnabled', 'shifts'].includes(k));
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);

  const errors = {};
  if (!isDate(body.effectiveFrom)) errors.effectiveFrom = 'Choose the date the schedule takes effect (YYYY-MM-DD).';
  if (typeof body.checkOutEnabled !== 'boolean') errors.checkOutEnabled = 'Choose whether check-out is on or off.';

  let shifts = [];
  if (!Array.isArray(body.shifts) || !body.shifts.length) errors.shifts = 'Add at least one shift.';
  else if (body.shifts.length > MAX_SHIFTS) errors.shifts = `A schedule can have at most ${MAX_SHIFTS} shifts.`;
  else shifts = body.shifts.map((raw, index) => readShift(raw, index, errors));

  // A kept shift appears once.
  const kept = new Set();
  shifts.forEach((shift, index) => {
    if (!shift?.key) return;
    if (kept.has(shift.key)) errors[`shifts.${index}.key`] = 'This shift is listed twice.';
    kept.add(shift.key);
  });

  // Unique names and no overlap, only between shifts that are themselves valid.
  const seen = new Map();
  shifts.forEach((shift, index) => {
    if (!shift?.name || errors[`shifts.${index}.name`]) return;
    const k = nameKey(shift.name);
    if (seen.has(k)) errors[`shifts.${index}.name`] = `Another shift is already called "${shifts[seen.get(k)].name}".`;
    else seen.set(k, index);
  });
  const usable = (i) => !Object.keys(errors).some((k) => k.startsWith(`shifts.${i}.`) || k === `shifts.${i}`);
  shifts.forEach((b, j) => {
    if (!usable(j)) return;
    for (let i = 0; i < j; i += 1) {
      const a = shifts[i];
      if (!usable(i)) continue;
      const shared = a.days.filter((d) => b.days.includes(d));
      if (shared.length && a.startMinute < b.endMinute && b.startMinute < a.endMinute) {
        errors[`shifts.${j}.start`] = `Overlaps "${a.name}" (${toTime(a.startMinute)}–${toTime(a.endMinute)}) on ${dayList(shared)}. Shifts on the same day cannot overlap.`;
        break;
      }
    }
  });

  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return { effectiveFrom: body.effectiveFrom, checkOutEnabled: body.checkOutEnabled, shifts };
}

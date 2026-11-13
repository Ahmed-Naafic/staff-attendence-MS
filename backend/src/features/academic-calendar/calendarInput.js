import { badRequest } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { parseDay } from '../academic-years/academicYearInput.js';
import { normalizeText } from '../branches/branchInput.js';
import { WEEKDAYS } from '../schedules/scheduleInput.js';
import { daysBetween, MAX_RANGE_DAYS } from './schoolDays.js';

/*
 * Validation for academic calendar requests (docs/business-rules.md → Academic calendar). Collects
 * every problem per field: 400 { code: 'VALIDATION_ERROR', details: { field: message } }. The
 * school, and a Manager's branch, come from the signed-in account and are refused when sent. Rules
 * that need stored data (dates within the year, fixed past days, overlaps) are checked by the service.
 */

export const ENTRY_NAME_MIN = 2;
export const ENTRY_NAME_MAX = 80;
export const NOTE_MAX = 300;
export const ENTRY_TYPES = ['holiday', 'closure', 'reopening', 'school_day'];

const CONTROL = /\p{Cc}/u;
const FIXED = {
  id: 'The id cannot be set.',
  schoolId: 'The school is decided by your account and cannot be set.',
  school: 'The school is decided by your account and cannot be set.',
  academicYearId: 'The academic year is the one in the address.',
};
const invalid = (errors) => badRequest('Check the highlighted fields.', errors);

function refuseUnknown(body, allowed, extraFixed = {}) {
  const fixed = { ...FIXED, ...extraFixed };
  const keys = Object.keys(body);
  const named = keys.filter((key) => fixed[key]);
  if (named.length) throw badRequest(fixed[named[0]], Object.fromEntries(named.map((key) => [key, fixed[key]])));
  const unknown = keys.filter((key) => !allowed.includes(key));
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);
}

const MANAGER_BRANCH = { branch: 'Your branch is decided by your account and cannot be set.', branchId: 'Your branch is decided by your account and cannot be set.' };

function readDate(body, field, label, errors, values) {
  const date = parseDay(body[field]);
  if (!date) errors[field] = `${label} is required as a date (YYYY-MM-DD).`;
  else values[field] = body[field];
}

/** Sorted, unique weekday codes; problems go to errors.days. */
function readDays(raw, errors) {
  if (!Array.isArray(raw) || !raw.length) errors.days = 'Choose at least one school day.';
  else if (!raw.every((d) => WEEKDAYS.includes(d))) errors.days = 'School days must be MON, TUE, WED, THU, FRI, SAT or SUN.';
  else if (new Set(raw).size !== raw.length) errors.days = 'Each day can be chosen once.';
  else return WEEKDAYS.filter((d) => raw.includes(d));
  return null;
}

/**
 * A change of weekly school days from a date. School Owner (the school's days): { days,
 * effectiveFrom }. Manager (their branch's days): { days, effectiveFrom } or { followsSchool: true,
 * effectiveFrom } to return to the school's days. → { days, followsSchool, effectiveFrom ('YYYY-MM-DD') }.
 */
export function readWeekdaysChange(body, { role }) {
  const manager = role === 'MANAGER';
  refuseUnknown(body, manager ? ['days', 'followsSchool', 'effectiveFrom'] : ['days', 'effectiveFrom'], manager ? MANAGER_BRANCH : {});
  const errors = {};
  const values = {};
  readDate(body, 'effectiveFrom', 'Effective date', errors, values);
  if (body.followsSchool !== undefined && typeof body.followsSchool !== 'boolean') errors.followsSchool = 'Must be true or false.';
  const follows = manager && body.followsSchool === true;
  if (follows && body.days !== undefined) errors.days = 'Leave the days out when following the school’s days.';
  const days = follows ? [] : readDays(body.days, errors);
  if (Object.keys(errors).length) throw invalid(errors);
  return { days, followsSchool: follows, effectiveFrom: values.effectiveFrom };
}

/** { branchWeekdaysAllowed: boolean } (School Owner). */
export function readWeekdayPolicy(body) {
  refuseUnknown(body, ['branchWeekdaysAllowed']);
  if (typeof body.branchWeekdaysAllowed !== 'boolean') throw invalid({ branchWeekdaysAllowed: 'Must be true or false.' });
  return { branchWeekdaysAllowed: body.branchWeekdaysAllowed };
}

function readName(raw, errors, { required }) {
  if (raw === undefined || raw === null) {
    if (required) errors.name = 'Name is required, e.g. Eid al-Fitr.';
    return undefined;
  }
  if (typeof raw !== 'string') {
    errors.name = 'Name must be text.';
    return undefined;
  }
  const name = normalizeText(raw);
  if (name.length < ENTRY_NAME_MIN) errors.name = required ? 'Name is required, e.g. Eid al-Fitr.' : `Name must be at least ${ENTRY_NAME_MIN} characters.`;
  else if (name.length > ENTRY_NAME_MAX) errors.name = `Name must be at most ${ENTRY_NAME_MAX} characters.`;
  else if (CONTROL.test(name)) errors.name = 'Name cannot contain control characters.';
  else return name;
  return undefined;
}

/** Optional note: text (trimmed; empty → null). */
function readNote(raw, errors) {
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw !== 'string') {
    errors.note = 'Note must be text.';
    return undefined;
  }
  const note = raw.trim();
  if (note.length > NOTE_MAX) errors.note = `Note must be at most ${NOTE_MAX} characters.`;
  else if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(note)) errors.note = 'Note cannot contain control characters.';
  else return note || null;
  return undefined;
}

function readId(body, field, label, errors) {
  if (!isUuid(body[field])) errors[field] = `Choose ${label}.`;
  return body[field];
}

function readTimetableDay(raw, errors) {
  if (!WEEKDAYS.includes(raw)) errors.timetableDay = 'Choose the weekday whose timetable the day follows (MON … SUN).';
  return raw;
}

/**
 * A new calendar entry. School Owner: { type: 'holiday' | 'closure' | 'reopening' | 'school_day',
 * name, note?, startDate, endDate, branch (closure, reopening; optional for school_day: none = the
 * whole school), holiday (reopening), allowBranchReopening? (holiday), timetableDay (school_day) }.
 * Manager: type 'closure', 'reopening' or 'school_day' for their own branch (no branch field).
 * A reopening's name may be left out (the service names it after the holiday).
 */
export function readEntryCreation(body, { role }) {
  const manager = role === 'MANAGER';
  refuseUnknown(
    body,
    ['type', 'name', 'note', 'startDate', 'endDate', 'holiday', 'allowBranchReopening', 'timetableDay', ...(manager ? [] : ['branch'])],
    manager ? { branchId: MANAGER_BRANCH.branchId, branch: MANAGER_BRANCH.branch } : { branchId: 'Send the branch as "branch".' },
  );
  const allowed = manager ? ['closure', 'reopening', 'school_day'] : ENTRY_TYPES;
  const errors = {};
  const values = {};
  if (!allowed.includes(body.type)) {
    errors.type = manager ? 'Choose closure, reopening or school_day. School holidays are set by your School Owner.' : 'Choose holiday, closure, reopening or school_day.';
  }
  const type = body.type;
  const name = readName(body.name, errors, { required: type !== 'reopening' });
  const note = readNote(body.note, errors);
  readDate(body, 'startDate', 'Start date', errors, values);
  readDate(body, 'endDate', 'End date', errors, values);
  if (values.startDate && values.endDate && values.endDate < values.startDate) errors.endDate = 'End date cannot be before the start date.';

  let branchId = null;
  let holidayId = null;
  if (!manager && (type === 'closure' || type === 'reopening')) branchId = readId(body, 'branch', 'a branch', errors);
  else if (!manager && type === 'school_day' && body.branch !== undefined && body.branch !== null) branchId = readId(body, 'branch', 'a branch', errors);
  else if (!manager && type === 'holiday' && body.branch !== undefined) errors.branch = 'A school holiday applies to every branch; leave the branch out.';
  let timetableDay = null;
  if (type === 'school_day') timetableDay = readTimetableDay(body.timetableDay, errors);
  else if (body.timetableDay !== undefined) errors.timetableDay = 'Only an extra school day follows a weekday’s timetable.';
  if (type === 'reopening') holidayId = readId(body, 'holiday', 'the holiday to reopen', errors);
  else if (body.holiday !== undefined) errors.holiday = 'Only a reopening names a holiday.';
  if (body.allowBranchReopening !== undefined) {
    if (type !== 'holiday') errors.allowBranchReopening = 'Only a school holiday can allow branches to reopen.';
    else if (typeof body.allowBranchReopening !== 'boolean') errors.allowBranchReopening = 'Must be true or false.';
  }

  if (Object.keys(errors).length) throw invalid(errors);
  return {
    type: type.toUpperCase(),
    name: name ?? null,
    note: note ?? null,
    startDate: values.startDate,
    endDate: values.endDate,
    branchId,
    holidayId,
    allowBranchReopening: type === 'holiday' && body.allowBranchReopening === true,
    timetableDay,
  };
}

/** Any of { name, note, startDate, endDate, allowBranchReopening (holidays), timetableDay (extra school days) }; at least one. */
export function readEntryUpdate(body) {
  refuseUnknown(body, ['name', 'note', 'startDate', 'endDate', 'allowBranchReopening', 'timetableDay'], {
    type: 'The type of an entry cannot change.',
    branch: 'The branch of an entry cannot change.',
    branchId: 'The branch of an entry cannot change.',
    holiday: 'The holiday of a reopening cannot change.',
  });
  const errors = {};
  const values = {};
  if ('name' in body) {
    const name = readName(body.name, errors, { required: true });
    if (name !== undefined) values.name = name;
  }
  if ('note' in body) {
    const note = readNote(body.note, errors);
    if (note !== undefined) values.note = note;
  }
  if ('startDate' in body) readDate(body, 'startDate', 'Start date', errors, values);
  if ('endDate' in body) readDate(body, 'endDate', 'End date', errors, values);
  if ('allowBranchReopening' in body) {
    if (typeof body.allowBranchReopening !== 'boolean') errors.allowBranchReopening = 'Must be true or false.';
    else values.allowBranchReopening = body.allowBranchReopening;
  }
  if ('timetableDay' in body) values.timetableDay = readTimetableDay(body.timetableDay, errors);
  if (Object.keys(errors).length) throw invalid(errors);
  if (!Object.keys(values).length) throw badRequest('Send at least one of: name, note, startDate, endDate, allowBranchReopening, timetableDay.');
  return values;
}

/**
 * The school days query: from, to ('YYYY-MM-DD', at most MAX_RANGE_DAYS days) and, for the School
 * Owner, branch (required). Defaults: today's month.
 */
export function readSchoolDaysQuery(query, { role, today }) {
  const single = (v) => (Array.isArray(v) ? v[0] : v);
  const errors = {};
  const month = today.slice(0, 7);
  const from = single(query.from) ?? `${month}-01`;
  const lastOfMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const to = single(query.to) ?? lastOfMonth;
  if (!parseDay(from)) errors.from = '"from" must be a date (YYYY-MM-DD).';
  if (!parseDay(to)) errors.to = '"to" must be a date (YYYY-MM-DD).';
  if (!errors.from && !errors.to) {
    if (to < from) errors.to = '"to" cannot be before "from".';
    else if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) errors.to = `Ask for at most ${MAX_RANGE_DAYS} days at a time.`;
  }
  let branch = null;
  if (role === 'OWNER') {
    branch = single(query.branch);
    if (!isUuid(branch)) errors.branch = 'Choose a branch.';
  } else if (query.branch !== undefined) {
    errors.branch = 'Your branch is decided by your account and cannot be set.';
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return { from, to, branch };
}

import { badRequest } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { parseDay } from '../academic-years/academicYearInput.js';
import { daysBetween } from '../academic-calendar/schoolDays.js';
import { nameKey, normalizeText } from '../branches/branchInput.js';
import { toMinutes, WEEKDAYS } from '../schedules/scheduleInput.js';
import { checkPeriods, MAX_PERIOD_NUMBER } from './bellTimes.js';

/*
 * Validation for bell schedule and timetable requests (docs/business-rules.md → Bell schedules;
 * Timetables). 400 { code: 'VALIDATION_ERROR', details: { field: message } }. The school, and a
 * Manager's branch, come from the signed-in account and are refused when sent. Rules that need
 * stored data (dates, subjects, teachers, clashes) are checked by the service.
 */

export const BELL_NAME_MAX = 60;
export const DESCRIPTION_MAX = 300;
export const MAX_PERIODS = 80;
export const MAX_LESSONS = 7 * MAX_PERIOD_NUMBER;
export const ROOM_MAX = 40;
export const PERIOD_NAME_MAX = 40;
export const MAX_LESSON_RANGE_DAYS = 42;

export { nameKey as bellNameKey };

const CONTROL = /\p{Cc}/u;
const FIXED = {
  id: 'The id cannot be set.',
  schoolId: 'The school is decided by your account and cannot be set.',
  school: 'The school is decided by your account and cannot be set.',
  status: 'Use Deactivate or Reactivate to change the status.',
};
const MANAGER_BRANCH = 'Your branch is decided by your account and cannot be set.';
const invalid = (errors) => badRequest('Check the highlighted fields.', errors);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function refuseUnknown(body, allowed, extraFixed = {}) {
  if (!isObject(body)) throw badRequest('Send a JSON object.');
  const fixed = { ...FIXED, ...extraFixed };
  const keys = Object.keys(body);
  const named = keys.filter((key) => fixed[key]);
  if (named.length) throw badRequest(fixed[named[0]], Object.fromEntries(named.map((key) => [key, fixed[key]])));
  const unknown = keys.filter((key) => !allowed.includes(key));
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);
}

function readText(raw, field, label, { required, max }, values, errors) {
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    errors[field] = `${label} must be text.`;
    return;
  }
  const value = normalizeText(raw ?? '');
  if (!value) {
    if (required) errors[field] = `${label} is required.`;
    else values[field] = null;
  } else if (value.length > max) errors[field] = `${label} must be at most ${max} characters.`;
  else if (CONTROL.test(value)) errors[field] = `${label} cannot contain control characters.`;
  else values[field] = value;
}

function readDate(raw, field, label, errors) {
  if (!parseDay(raw)) {
    errors[field] = `${label} is required as a date (YYYY-MM-DD).`;
    return null;
  }
  return raw;
}

// ---- bell schedules -----------------------------------------------------------------------------

/**
 * A new bell schedule: { name, description?, branch? } — the School Owner leaves the branch out for
 * a school-wide schedule or names one branch; a Manager's is always their own branch.
 */
export function readBellScheduleCreation(body, { role }) {
  const manager = role === 'MANAGER';
  refuseUnknown(body, ['name', 'description', ...(manager ? [] : ['branch'])], manager ? { branch: MANAGER_BRANCH, branchId: MANAGER_BRANCH } : { branchId: 'Send the branch as "branch".' });
  const values = {};
  const errors = {};
  readText(body.name, 'name', 'Name', { required: true, max: BELL_NAME_MAX }, values, errors);
  readText(body.description, 'description', 'Description', { required: false, max: DESCRIPTION_MAX }, values, errors);
  values.branchId = null;
  if (!manager && body.branch !== undefined && body.branch !== null) {
    if (!isUuid(body.branch)) errors.branch = 'Choose a branch, or leave it out for the whole school.';
    else values.branchId = body.branch;
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return values;
}

/** { name?, description? }, at least one. */
export function readBellScheduleUpdate(body) {
  refuseUnknown(body, ['name', 'description'], { branch: 'A bell schedule stays at its level.', branchId: 'A bell schedule stays at its level.' });
  const values = {};
  const errors = {};
  if ('name' in body) readText(body.name, 'name', 'Name', { required: true, max: BELL_NAME_MAX }, values, errors);
  if ('description' in body) readText(body.description, 'description', 'Description', { required: false, max: DESCRIPTION_MAX }, values, errors);
  if (Object.keys(errors).length) throw invalid(errors);
  if (!Object.keys(values).length) throw badRequest('Send at least one of: name, description.');
  return values;
}

const PERIOD_KEYS = ['kind', 'number', 'name', 'days', 'start', 'end', 'mainBreak'];

function readPeriod(raw, i, errors) {
  const at = `periods.${i}`;
  if (!isObject(raw)) {
    errors[at] = 'Each period must be an object.';
    return null;
  }
  const unknown = Object.keys(raw).filter((k) => !PERIOD_KEYS.includes(k));
  if (unknown.length) {
    errors[at] = `Unknown fields: ${unknown.join(', ')}.`;
    return null;
  }
  const problems = [];
  const kind = raw.kind === 'lesson' ? 'LESSON' : raw.kind === 'break' ? 'BREAK' : null;
  if (!kind) problems.push('Choose lesson or break.');
  let number = null;
  if (kind === 'LESSON') {
    if (!Number.isInteger(raw.number) || raw.number < 1 || raw.number > MAX_PERIOD_NUMBER) problems.push(`A lesson needs a period number from 1 to ${MAX_PERIOD_NUMBER}.`);
    else number = raw.number;
  } else if (kind === 'BREAK' && raw.number !== undefined && raw.number !== null) problems.push('A break has no period number.');
  let name = null;
  if (raw.name !== undefined && raw.name !== null) {
    if (typeof raw.name !== 'string') problems.push('The name must be text.');
    else {
      name = normalizeText(raw.name) || null;
      if (name && (name.length > PERIOD_NAME_MAX || CONTROL.test(name))) problems.push(`The name must be at most ${PERIOD_NAME_MAX} characters, without control characters.`);
    }
  }
  let days = null;
  if (!Array.isArray(raw.days) || !raw.days.length || !raw.days.every((d) => WEEKDAYS.includes(d)) || new Set(raw.days).size !== raw.days.length) {
    problems.push('Choose the days (MON … SUN), each once.');
  } else days = WEEKDAYS.filter((d) => raw.days.includes(d));
  const startMinute = toMinutes(raw.start);
  const endMinute = toMinutes(raw.end);
  if (startMinute === null || endMinute === null) problems.push('Start and end are times (HH:MM).');
  else if (endMinute <= startMinute) problems.push('The end must be after the start (same day).');
  if (raw.mainBreak !== undefined && typeof raw.mainBreak !== 'boolean') problems.push('mainBreak must be true or false.');
  if (raw.mainBreak === true && kind !== 'BREAK') problems.push('Only a break can be the main break.');
  if (problems.length) {
    errors[at] = problems.join(' ');
    return null;
  }
  return { kind, number, name: kind === 'BREAK' ? (name ?? 'Break') : name, days, startMinute, endMinute, mainBreak: raw.mainBreak === true };
}

/**
 * New bell times from a date: { effectiveFrom, periods: [{ kind: 'lesson' | 'break', number
 * (lessons), name?, days, start: 'HH:MM', end: 'HH:MM', mainBreak? (one break) }] }. Each weekday's
 * periods are checked together (bellTimes.checkPeriods).
 */
export function readBellVersion(body) {
  refuseUnknown(body, ['effectiveFrom', 'periods']);
  const errors = {};
  const effectiveFrom = readDate(body.effectiveFrom, 'effectiveFrom', 'Effective date', errors);
  let periods = [];
  if (!Array.isArray(body.periods) || !body.periods.length) errors.periods = 'Add the lessons and breaks of the day.';
  else if (body.periods.length > MAX_PERIODS) errors.periods = `At most ${MAX_PERIODS} rows.`;
  else {
    periods = body.periods.map((p, i) => readPeriod(p, i, errors));
    if (!Object.keys(errors).some((k) => k.startsWith('periods'))) Object.assign(errors, checkPeriods(periods));
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return { effectiveFrom, periods };
}

/** List filters: status ('active' default | 'inactive' | 'all'), branch (Owner: a branch id or 'school'). */
export function readBellListQuery(query, { role }) {
  const single = (v) => (Array.isArray(v) ? v[0] : v);
  const status = single(query.status) ?? 'active';
  const errors = {};
  if (!['active', 'inactive', 'all'].includes(status)) errors.status = 'Choose active, inactive or all.';
  let branch = single(query.branch) ?? null;
  if (role === 'MANAGER' && branch !== null) errors.branch = MANAGER_BRANCH;
  else if (branch !== null && branch !== 'school' && !isUuid(branch)) errors.branch = 'Choose a branch, or "school".';
  if (Object.keys(errors).length) throw invalid(errors);
  return { status, branch };
}

// ---- timetables -------------------------------------------------------------------------------

const LESSON_KEYS = ['weekday', 'period', 'subject', 'teacher', 'room'];

/**
 * A section's timetable from a date: { effectiveFrom, bellSchedule, lessons: [{ weekday, period,
 * subject, teacher?, room? }] }. One lesson per weekday and period; no lessons keeps the section
 * on the bell schedule without lessons.
 */
export function readTimetableVersion(body) {
  refuseUnknown(body, ['effectiveFrom', 'bellSchedule', 'lessons'], { section: 'The section is the one in the address.', sectionId: 'The section is the one in the address.' });
  const errors = {};
  const effectiveFrom = readDate(body.effectiveFrom, 'effectiveFrom', 'Effective date', errors);
  if (!isUuid(body.bellSchedule)) errors.bellSchedule = 'Choose a bell schedule.';
  const lessons = [];
  const raw = body.lessons ?? [];
  if (!Array.isArray(raw)) errors.lessons = 'Lessons must be a list.';
  else if (raw.length > MAX_LESSONS) errors.lessons = `At most ${MAX_LESSONS} lessons.`;
  else {
    const taken = new Map();
    raw.forEach((l, i) => {
      const at = `lessons.${i}`;
      if (!isObject(l)) {
        errors[at] = 'Each lesson must be an object.';
        return;
      }
      const unknown = Object.keys(l).filter((k) => !LESSON_KEYS.includes(k));
      if (unknown.length) {
        errors[at] = `Unknown fields: ${unknown.join(', ')}.`;
        return;
      }
      const problems = [];
      if (!WEEKDAYS.includes(l.weekday)) problems.push('Choose a weekday (MON … SUN).');
      if (!Number.isInteger(l.period) || l.period < 1 || l.period > MAX_PERIOD_NUMBER) problems.push(`Choose a period (1–${MAX_PERIOD_NUMBER}).`);
      if (!isUuid(l.subject)) problems.push('Choose a subject.');
      if (l.teacher !== undefined && l.teacher !== null && !isUuid(l.teacher)) problems.push('Choose a teacher, or leave it empty.');
      let room = null;
      if (l.room !== undefined && l.room !== null) {
        if (typeof l.room !== 'string') problems.push('The room must be text.');
        else {
          room = normalizeText(l.room) || null;
          if (room && (room.length > ROOM_MAX || CONTROL.test(room))) problems.push(`The room must be at most ${ROOM_MAX} characters.`);
        }
      }
      if (!problems.length) {
        const key = `${l.weekday}|${l.period}`;
        if (taken.has(key)) problems.push(`Period ${l.period} on ${l.weekday} already has a lesson.`);
        taken.set(key, i);
      }
      if (problems.length) errors[at] = problems.join(' ');
      else lessons.push({ weekday: l.weekday, periodNumber: l.period, subjectId: l.subject, teacherId: l.teacher ?? null, room, index: i });
    });
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return { effectiveFrom, bellScheduleId: body.bellSchedule, lessons };
}

/** The timetable read: an optional version id. */
export function readTimetableQuery(query) {
  const version = Array.isArray(query.version) ? query.version[0] : query.version;
  if (version !== undefined && !isUuid(version)) throw invalid({ version: 'Choose a timetable version.' });
  return { versionId: version ?? null };
}

/** Lessons of dates: from, to (default: the week of today, Mon–Sun), at most MAX_LESSON_RANGE_DAYS. */
export function readLessonsQuery(query, { today }) {
  const single = (v) => (Array.isArray(v) ? v[0] : v);
  const errors = {};
  const monday = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  })();
  const from = single(query.from) ?? monday;
  const to = single(query.to) ?? new Date(Date.parse(`${from}T00:00:00Z`) + 6 * 86_400_000).toISOString().slice(0, 10);
  if (!parseDay(from)) errors.from = '"from" must be a date (YYYY-MM-DD).';
  if (!parseDay(to)) errors.to = '"to" must be a date (YYYY-MM-DD).';
  if (!errors.from && !errors.to) {
    if (to < from) errors.to = '"to" cannot be before "from".';
    else if (daysBetween(from, to) + 1 > MAX_LESSON_RANGE_DAYS) errors.to = `Ask for at most ${MAX_LESSON_RANGE_DAYS} days at a time.`;
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return { from, to };
}

/** Timetable overview filters: academicYear ('current' default or an id), branch (Owner). */
export function readOverviewQuery(query, { role }) {
  const single = (v) => (Array.isArray(v) ? v[0] : v);
  const errors = {};
  const academicYear = single(query.academicYear) ?? 'current';
  if (academicYear !== 'current' && !isUuid(academicYear)) errors.academicYear = 'Choose an academic year.';
  const branch = single(query.branch) ?? null;
  if (role === 'MANAGER' && branch !== null) errors.branch = MANAGER_BRANCH;
  else if (branch !== null && !isUuid(branch)) errors.branch = 'Choose a branch.';
  if (Object.keys(errors).length) throw invalid(errors);
  return { academicYear, branch };
}

import { badRequest } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { parseDay } from '../academic-years/academicYearInput.js';
import { daysBetween } from '../academic-calendar/schoolDays.js';
import { normalizeText } from '../branches/branchInput.js';
import { MAX_PERIOD_NUMBER } from '../timetable/bellTimes.js';
import { HALVES, STATUSES } from './attendanceRules.js';

/*
 * Validation for student attendance requests (docs/business-rules.md → Student attendance).
 * 400 { code: 'VALIDATION_ERROR', details: { field: message } }. The school and a Manager's branch
 * come from the signed-in account; students and sections named in a request are checked by the
 * services against that scope.
 */

export const REASON_MAX = 200;
export const NOTE_MAX = 300;
export const MAX_MARKS = 300;
export const MAX_EXCUSE_DAYS = 366;

const CONTROL = /\p{Cc}/u;
const invalid = (errors) => badRequest('Check the highlighted fields.', errors);
const single = (v) => (Array.isArray(v) ? v[0] : v);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function refuseUnknown(body, allowed) {
  if (!isObject(body)) throw badRequest('Send a JSON object.');
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`, Object.fromEntries(unknown.map((k) => [k, 'This field cannot be set here.'])));
}

/** Optional text → string | null; errors[field] when invalid. */
function text(raw, field, label, max, errors) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    errors[field] = `${label} must be text.`;
    return null;
  }
  const value = normalizeText(raw);
  if (value.length > max) errors[field] = `${label} must be at most ${max} characters.`;
  else if (CONTROL.test(value)) errors[field] = `${label} cannot contain control characters.`;
  return value || null;
}

/** The day overview: date (default today), branch (Owner; optional). */
export function readDayQuery(query, { today, role }) {
  const errors = {};
  const date = single(query.date) ?? today;
  if (!parseDay(date)) errors.date = 'Choose a date (YYYY-MM-DD).';
  const branch = single(query.branch);
  if (branch !== undefined && branch !== '') {
    if (role !== 'OWNER') errors.branch = 'Your branch is decided by your account.';
    else if (!isUuid(branch)) errors.branch = 'Choose a branch.';
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return { date, branch: branch || undefined };
}

/** Opening a session: { section, date, half } (the Manager's half-day session) or { section, date, period } (a lesson). */
export function readSessionOpening(body) {
  refuseUnknown(body, ['section', 'date', 'half', 'period']);
  const errors = {};
  if (!isUuid(body.section)) errors.section = 'Choose a section.';
  if (!parseDay(body.date)) errors.date = 'Choose a date (YYYY-MM-DD).';
  if (body.period !== undefined) {
    if (body.half !== undefined) errors.half = 'Choose a half of the day or a lesson, not both.';
    if (!Number.isInteger(body.period) || body.period < 1 || body.period > MAX_PERIOD_NUMBER) errors.period = `Choose a period from 1 to ${MAX_PERIOD_NUMBER}.`;
  } else if (!Object.values(HALVES).includes(body.half)) errors.half = `Choose one of: ${Object.values(HALVES).join(', ')}.`;
  if (Object.keys(errors).length) throw invalid(errors);
  return body.period !== undefined ? { sectionId: body.section, date: body.date, period: body.period } : { sectionId: body.section, date: body.date, half: body.half };
}

/**
 * Marks: { marks: [{ student, status, reason?, note?, version? }] }. `version`: the entry version the
 * client last saw (stale edits are refused). EXCUSED needs a reason.
 */
export function readMarks(body) {
  refuseUnknown(body, ['marks']);
  if (!Array.isArray(body.marks) || !body.marks.length) throw invalid({ marks: 'Mark at least one student.' });
  if (body.marks.length > MAX_MARKS) throw invalid({ marks: `Send at most ${MAX_MARKS} marks at a time.` });
  const errors = {};
  const seen = new Set();
  const marks = body.marks.map((m, index) => {
    const at = (f) => `marks.${index}.${f}`;
    if (!isObject(m)) {
      errors[`marks.${index}`] = 'Each mark must be an object.';
      return null;
    }
    const unknown = Object.keys(m).filter((k) => !['student', 'status', 'reason', 'note', 'version'].includes(k));
    if (unknown.length) errors[at(unknown[0])] = 'Unknown field.';
    if (!isUuid(m.student)) errors[at('student')] = 'Choose a student.';
    else if (seen.has(m.student)) errors[at('student')] = 'This student is marked twice.';
    else seen.add(m.student);
    if (!STATUSES.includes(m.status)) errors[at('status')] = `Choose one of: ${STATUSES.join(', ')}.`;
    const reason = text(m.reason, at('reason'), 'The reason', REASON_MAX, errors);
    const note = text(m.note, at('note'), 'The note', NOTE_MAX, errors);
    if (m.status === 'excused' && !reason && !errors[at('reason')]) errors[at('reason')] = 'Give the reason for the excuse.';
    if (m.version !== undefined && (!Number.isInteger(m.version) || m.version < 0)) errors[at('version')] = 'Invalid version.';
    return { studentId: m.student, status: m.status, reason, note, version: m.version, index };
  });
  if (Object.keys(errors).length) throw invalid(errors);
  return { marks };
}

/** A new excuse: { student, startDate, endDate?, half?, periods?, reason, note? }. */
export function readExcuseCreation(body) {
  refuseUnknown(body, ['student', 'startDate', 'endDate', 'half', 'periods', 'reason', 'note']);
  const errors = {};
  if (!isUuid(body.student)) errors.student = 'Choose a student.';
  if (!parseDay(body.startDate)) errors.startDate = 'Choose the first day (YYYY-MM-DD).';
  const endDate = body.endDate ?? body.startDate;
  if (!parseDay(endDate)) errors.endDate = 'Choose the last day (YYYY-MM-DD).';
  else if (!errors.startDate) {
    if (endDate < body.startDate) errors.endDate = 'The last day cannot be before the first.';
    else if (daysBetween(body.startDate, endDate) + 1 > MAX_EXCUSE_DAYS) errors.endDate = `An excuse covers at most ${MAX_EXCUSE_DAYS} days.`;
  }
  const half = body.half ?? null;
  if (half !== null && half !== HALVES.BEFORE && half !== HALVES.AFTER) errors.half = `Leave empty for whole days, or choose ${HALVES.BEFORE} or ${HALVES.AFTER}.`;
  let periods = [];
  if (body.periods !== undefined && body.periods !== null) {
    if (!Array.isArray(body.periods) || body.periods.some((p) => !Number.isInteger(p) || p < 1 || p > MAX_PERIOD_NUMBER)) {
      errors.periods = `Choose lesson periods from 1 to ${MAX_PERIOD_NUMBER}.`;
    } else periods = [...new Set(body.periods)].sort((a, b) => a - b);
  }
  if (half && periods.length) errors.periods = 'Choose a half of the day or some lessons, not both.';
  const reason = text(body.reason, 'reason', 'The reason', REASON_MAX, errors);
  if (!reason && !errors.reason) errors.reason = 'Give the reason for the excuse.';
  else if (reason && reason.length < 2) errors.reason = 'The reason must be at least 2 characters.';
  const note = text(body.note, 'note', 'The note', NOTE_MAX, errors);
  if (Object.keys(errors).length) throw invalid(errors);
  return { studentId: body.student, startDate: body.startDate, endDate, half, periods, reason, note };
}

/** Excuse list filters: student, from/to (dates the excuse covers), status, branch (Owner), page. */
export function readExcuseQuery(query, { role }) {
  const errors = {};
  const student = single(query.student);
  if (student !== undefined && student !== '' && !isUuid(student)) errors.student = 'Choose a student.';
  const from = single(query.from);
  const to = single(query.to);
  if (from && !parseDay(from)) errors.from = '"from" must be a date (YYYY-MM-DD).';
  if (to && !parseDay(to)) errors.to = '"to" must be a date (YYYY-MM-DD).';
  const status = single(query.status) || 'active';
  if (!['active', 'cancelled', 'all'].includes(status)) errors.status = 'Choose active, cancelled or all.';
  const branch = single(query.branch);
  if (branch) {
    if (role !== 'OWNER') errors.branch = 'Your branch is decided by your account.';
    else if (!isUuid(branch)) errors.branch = 'Choose a branch.';
  }
  const page = Number(single(query.page) ?? 1);
  const pageSize = Number(single(query.pageSize) ?? 20);
  if (!Number.isInteger(page) || page < 1) errors.page = 'Invalid page.';
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) errors.pageSize = 'Page size must be 1–100.';
  if (Object.keys(errors).length) throw invalid(errors);
  return { student: student || undefined, from: from || undefined, to: to || undefined, status, branch: branch || undefined, page, pageSize };
}

// ---- teacher lessons (Phase 5) ---------------------------------------------------------------------

const isoTime = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** A teacher's day: date (default today). */
export function readTeacherDayQuery(query, { today }) {
  const date = single(query.date) ?? today;
  if (!parseDay(date)) throw invalid({ date: 'Choose a date (YYYY-MM-DD).' });
  return { date };
}

/**
 * A teacher's marks for one lesson: { section, date, period, sentAt, marks: [{ student, status,
 * occurredAt }] }. Times are ISO with a time zone (device clock). The same student may appear more
 * than once (marked offline, then corrected): the marks are applied in the order they were taken.
 */
export function readLessonMarks(body) {
  refuseUnknown(body, ['section', 'date', 'period', 'sentAt', 'marks']);
  const errors = {};
  if (!isUuid(body.section)) errors.section = 'Choose a section.';
  if (!parseDay(body.date)) errors.date = 'Choose a date (YYYY-MM-DD).';
  if (!Number.isInteger(body.period) || body.period < 1 || body.period > MAX_PERIOD_NUMBER) errors.period = `Choose a period from 1 to ${MAX_PERIOD_NUMBER}.`;
  const sentAt = isoTime(body.sentAt);
  if (!sentAt) errors.sentAt = 'Send the device time at sending as an ISO time with a time zone.';
  if (!Array.isArray(body.marks) || !body.marks.length) errors.marks = 'Mark at least one student.';
  else if (body.marks.length > MAX_MARKS) errors.marks = `Send at most ${MAX_MARKS} marks at a time.`;
  const marks = (Array.isArray(body.marks) ? body.marks : []).slice(0, MAX_MARKS).map((m, index) => {
    const at = (f) => `marks.${index}.${f}`;
    if (!isObject(m)) {
      errors[`marks.${index}`] = 'Each mark must be an object.';
      return null;
    }
    const unknown = Object.keys(m).filter((k) => !['student', 'status', 'occurredAt'].includes(k));
    if (unknown.length) errors[at(unknown[0])] = 'Unknown field.';
    if (!isUuid(m.student)) errors[at('student')] = 'Choose a student.';
    if (!['present', 'absent'].includes(m.status)) errors[at('status')] = 'Teachers mark present or absent; Managers record late and excused.';
    const occurredAt = isoTime(m.occurredAt);
    if (!occurredAt) errors[at('occurredAt')] = 'Send the time of the mark as an ISO time with a time zone.';
    return { studentId: m.student, status: m.status, occurredAt };
  });
  if (Object.keys(errors).length) throw invalid(errors);
  return { sectionId: body.section, date: body.date, period: body.period, sentAt, marks };
}

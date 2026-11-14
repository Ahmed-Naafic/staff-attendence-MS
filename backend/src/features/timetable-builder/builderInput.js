import { badRequest } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { parseDay } from '../academic-years/academicYearInput.js';
import { toMinutes, WEEKDAYS } from '../schedules/scheduleInput.js';
import { MAX_PERIOD_NUMBER } from '../timetable/bellTimes.js';

/*
 * Validation for the timetable builder (docs/business-rules.md → Timetable builder). Every problem
 * is collected per field: 400 { code: 'VALIDATION_ERROR', details }. A Manager's branch comes from
 * their account (a branch in the request is refused); the School Owner names the branch.
 */

export const RULE_LIMITS = {
  maxSubjectPerDay: { min: 1, max: 6 },
  teacherMaxPerDay: { min: 1, max: 20 },
  searchSeconds: { min: 5, max: 60 },
  maxPerDay: { min: 1, max: 20 },
  maxPerWeek: { min: 1, max: 140 },
};
const MANAGER_BRANCH = 'Your branch is decided by your account and cannot be set.';
const invalid = (errors) => badRequest('Check the highlighted fields.', errors);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const single = (q, name) => (Array.isArray(q[name]) ? q[name][0] : q[name]);

function refuseUnknown(body, allowed) {
  if (!isObject(body)) throw badRequest('Send a JSON object.');
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);
}

/** academicYear ('current' or an id) and, for the Owner, branch (required) from a query or body. */
function readContext(source, { role, errors }) {
  const academicYear = single(source, 'academicYear') || 'current';
  if (academicYear !== 'current' && !isUuid(academicYear)) errors.academicYear = '"academicYear" must be an id or "current".';
  const branch = single(source, 'branch');
  if (role === 'OWNER') {
    if (!isUuid(branch)) errors.branch = 'Choose a branch.';
  } else if (branch !== undefined && branch !== '') errors.branch = MANAGER_BRANCH;
  return { academicYear, branch: role === 'OWNER' ? branch : null };
}

function readDay(value, name, errors) {
  if (value === undefined || value === null || value === '') return null;
  // 'YYYY-MM-DD' text (as everywhere else); parseDay only checks it is a real date.
  const ok = typeof value === 'string' && parseDay(value);
  if (!ok) errors[name] = 'Use a date like 2026-11-20.';
  return ok ? value : null;
}

/** GET queries: academicYear, branch (Owner), date (optional plan date). */
export function readBuilderQuery(query, { role }) {
  const errors = {};
  const context = readContext(query, { role, errors });
  const date = readDay(single(query, 'date'), 'date', errors);
  if (Object.keys(errors).length) throw invalid(errors);
  return { ...context, date };
}

function readInt(body, name, errors, { nullable = false } = {}) {
  const v = body[name];
  if (v === undefined) return undefined;
  if (v === null || v === '') {
    if (nullable) return null;
    errors[name] = 'Enter a number.';
    return undefined;
  }
  const { min, max } = RULE_LIMITS[name];
  if (!Number.isInteger(v) || v < min || v > max) errors[name] = `A whole number from ${min} to ${max}${nullable ? ', or empty for no limit' : ''}.`;
  return v;
}
function readBool(body, name, errors) {
  const v = body[name];
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') errors[name] = 'Yes or no.';
  return v;
}
function readIds(value, name, errors, { max = 200 } = {}) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > max || !value.every(isUuid)) {
    errors[name] = 'A list of ids.';
    return undefined;
  }
  return [...new Set(value)];
}

/**
 * Setup: rules (any of fillAllPeriods, maxSubjectPerDay, allowDoubleLessons, spreadSubjects, avoidTeacherGaps,
 * teacherMaxPerDay (null: no limit), morningSubjects, searchSeconds), defaultBellSchedule (id or
 * null), sectionBells ({ sectionId: bellScheduleId | null }), excludedSections. At least one.
 */
export function readSetup(body, { role }) {
  const allowed = ['academicYear', 'branch', 'fillAllPeriods', 'maxSubjectPerDay', 'allowDoubleLessons', 'spreadSubjects', 'avoidTeacherGaps', 'teacherMaxPerDay', 'morningSubjects', 'searchSeconds', 'defaultBellSchedule', 'sectionBells', 'excludedSections'];
  refuseUnknown(body, allowed);
  const errors = {};
  const context = readContext(body, { role, errors });
  const values = {
    maxSubjectPerDay: readInt(body, 'maxSubjectPerDay', errors),
    teacherMaxPerDay: readInt(body, 'teacherMaxPerDay', errors, { nullable: true }),
    searchSeconds: readInt(body, 'searchSeconds', errors),
    fillAllPeriods: readBool(body, 'fillAllPeriods', errors),
    allowDoubleLessons: readBool(body, 'allowDoubleLessons', errors),
    spreadSubjects: readBool(body, 'spreadSubjects', errors),
    avoidTeacherGaps: readBool(body, 'avoidTeacherGaps', errors),
    morningSubjectIds: readIds(body.morningSubjects, 'morningSubjects', errors),
    excludedSectionIds: readIds(body.excludedSections, 'excludedSections', errors, { max: 500 }),
  };
  if (body.defaultBellSchedule !== undefined) {
    if (body.defaultBellSchedule !== null && !isUuid(body.defaultBellSchedule)) errors.defaultBellSchedule = 'Choose a bell schedule.';
    else values.defaultBellScheduleId = body.defaultBellSchedule;
  }
  if (body.sectionBells !== undefined) {
    if (!isObject(body.sectionBells) || Object.keys(body.sectionBells).length > 500) errors.sectionBells = 'An object of section id → bell schedule id (or null).';
    else {
      const bad = Object.entries(body.sectionBells).filter(([k, v]) => !isUuid(k) || (v !== null && !isUuid(v)));
      if (bad.length) errors.sectionBells = 'An object of section id → bell schedule id (or null).';
      else values.sectionBells = body.sectionBells;
    }
  }
  if (Object.keys(errors).length) throw invalid(errors);
  const changes = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
  if (!Object.keys(changes).length) throw badRequest('Send at least one setting to change.');
  return { ...context, changes };
}

/** Teacher limits: academicYear, maxPerDay / maxPerWeek (null: none), unavailable: [{ weekday, start, end }]. */
export function readTeacherLimits(body) {
  refuseUnknown(body, ['academicYear', 'maxPerDay', 'maxPerWeek', 'unavailable']);
  const errors = {};
  const academicYear = body.academicYear || 'current';
  if (academicYear !== 'current' && !isUuid(academicYear)) errors.academicYear = '"academicYear" must be an id or "current".';
  const values = { maxPerDay: readInt(body, 'maxPerDay', errors, { nullable: true }), maxPerWeek: readInt(body, 'maxPerWeek', errors, { nullable: true }) };
  if (body.unavailable !== undefined) {
    if (!Array.isArray(body.unavailable) || body.unavailable.length > 70) errors.unavailable = 'A list of at most 70 times.';
    else {
      const list = [];
      body.unavailable.forEach((u, i) => {
        const at = `unavailable.${i}`;
        if (!isObject(u) || !WEEKDAYS.includes(u.weekday)) return void (errors[at] = 'Choose a weekday.');
        const start = typeof u.start === 'string' ? toMinutes(u.start) : null;
        const end = typeof u.end === 'string' ? toMinutes(u.end) : null;
        if (start === null || end === null) return void (errors[at] = 'Times like 08:00.');
        if (end <= start) return void (errors[at] = 'The end must be after the start.');
        list.push({ weekday: u.weekday, startMinute: start, endMinute: end });
      });
      values.unavailable = list.sort((a, b) => WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) || a.startMinute - b.startMinute);
    }
  }
  if (Object.keys(errors).length) throw invalid(errors);
  const changes = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
  if (!Object.keys(changes).length) throw badRequest('Send at least one limit to change.');
  return { academicYear, changes };
}

/** A fixed lesson: section, weekday, period, subject, teacher (optional). */
export function readFixedLesson(body, { role }) {
  refuseUnknown(body, ['academicYear', 'branch', 'section', 'weekday', 'period', 'subject', 'teacher']);
  const errors = {};
  const context = readContext(body, { role, errors });
  if (!isUuid(body.section)) errors.section = 'Choose a class.';
  if (!WEEKDAYS.includes(body.weekday)) errors.weekday = 'Choose a weekday.';
  if (!Number.isInteger(body.period) || body.period < 1 || body.period > MAX_PERIOD_NUMBER) errors.period = `Choose a period (1–${MAX_PERIOD_NUMBER}).`;
  if (!isUuid(body.subject)) errors.subject = 'Choose a subject.';
  if (body.teacher !== undefined && body.teacher !== null && !isUuid(body.teacher)) errors.teacher = 'Choose a teacher.';
  if (Object.keys(errors).length) throw invalid(errors);
  return { ...context, sectionId: body.section, weekday: body.weekday, periodNumber: body.period, subjectId: body.subject, teacherId: body.teacher ?? null };
}

/** Generate: academicYear, branch (Owner), date (plan date; default: the first day it can start), keepLocked, seed. */
export function readGenerate(body, { role }) {
  refuseUnknown(body, ['academicYear', 'branch', 'date', 'keepLocked', 'seed']);
  const errors = {};
  const context = readContext(body, { role, errors });
  const date = readDay(body.date, 'date', errors);
  if (body.keepLocked !== undefined && typeof body.keepLocked !== 'boolean') errors.keepLocked = 'Yes or no.';
  if (body.seed !== undefined && (!Number.isInteger(body.seed) || body.seed < 1 || body.seed > 2 ** 31)) errors.seed = 'A whole number.';
  if (Object.keys(errors).length) throw invalid(errors);
  return { ...context, date, keepLocked: body.keepLocked !== false, seed: body.seed ?? null };
}

const slotOf = (v, name, errors) => {
  if (!isObject(v) || !WEEKDAYS.includes(v.weekday) || !Number.isInteger(v.period) || v.period < 1 || v.period > MAX_PERIOD_NUMBER) {
    errors[name] = 'A weekday and a period.';
    return null;
  }
  return { weekday: v.weekday, periodNumber: v.period };
};

/**
 * A draft edit: { revision, action, … }.
 *  move:    { section, from: { weekday, period }, to: { weekday, period } } (swaps with the lesson there)
 *  lock / unlock / remove: { lesson }
 *  place:   { section, subject, teacher?, to: { weekday, period } } (a lesson left out)
 *  teacher: { lesson, teacher } (another teacher of the subject in that class)
 */
export function readDraftEdit(body) {
  if (!isObject(body)) throw badRequest('Send a JSON object.');
  const errors = {};
  if (!Number.isInteger(body.revision) || body.revision < 1) errors.revision = 'The draft revision you edited.';
  const action = body.action;
  const fields = { move: ['section', 'from', 'to'], lock: ['lesson'], unlock: ['lesson'], remove: ['lesson'], place: ['section', 'subject', 'teacher', 'to'], teacher: ['lesson', 'teacher'] }[action];
  if (!fields) throw badRequest('Unknown action.', { action: 'move, lock, unlock, remove, place or teacher.' });
  refuseUnknown(body, ['revision', 'action', ...fields]);
  const out = { revision: body.revision, action };
  if (fields.includes('lesson')) (isUuid(body.lesson) ? (out.lessonId = body.lesson) : (errors.lesson = 'Choose a lesson.'));
  if (fields.includes('section')) (isUuid(body.section) ? (out.sectionId = body.section) : (errors.section = 'Choose a class.'));
  if (fields.includes('subject')) (isUuid(body.subject) ? (out.subjectId = body.subject) : (errors.subject = 'Choose a subject.'));
  if (action === 'teacher') (isUuid(body.teacher) ? (out.teacherId = body.teacher) : (errors.teacher = 'Choose a teacher.'));
  if (action === 'place' && body.teacher !== undefined && body.teacher !== null) (isUuid(body.teacher) ? (out.teacherId = body.teacher) : (errors.teacher = 'Choose a teacher.'));
  if (fields.includes('from')) out.from = slotOf(body.from, 'from', errors);
  if (fields.includes('to')) out.to = slotOf(body.to, 'to', errors);
  if (Object.keys(errors).length) throw invalid(errors);
  return out;
}

/** Publish: revision, effectiveFrom. */
export function readPublish(body) {
  refuseUnknown(body, ['revision', 'effectiveFrom']);
  const errors = {};
  if (!Number.isInteger(body.revision) || body.revision < 1) errors.revision = 'The draft revision you reviewed.';
  const effectiveFrom = readDay(body.effectiveFrom, 'effectiveFrom', errors);
  if (!effectiveFrom && !errors.effectiveFrom) errors.effectiveFrom = 'Choose the first day.';
  if (Object.keys(errors).length) throw invalid(errors);
  return { revision: body.revision, effectiveFrom };
}

export function readRevision(body) {
  refuseUnknown(body, ['revision']);
  if (!Number.isInteger(body.revision) || body.revision < 1) throw invalid({ revision: 'The draft revision.' });
  return body.revision;
}

/** View queries: academicYear, branch (Owner, master view), date, source ('published' | 'draft'). */
export function readViewQuery(query, { role, needBranch = false }) {
  const errors = {};
  const academicYear = single(query, 'academicYear') || 'current';
  if (academicYear !== 'current' && !isUuid(academicYear)) errors.academicYear = '"academicYear" must be an id or "current".';
  const branch = single(query, 'branch');
  if (role === 'OWNER' && needBranch && !isUuid(branch)) errors.branch = 'Choose a branch.';
  if (role !== 'OWNER' && branch) errors.branch = MANAGER_BRANCH;
  const date = readDay(single(query, 'date'), 'date', errors);
  const source = single(query, 'source') || 'published';
  if (!['published', 'draft'].includes(source)) errors.source = '"published" or "draft".';
  if (Object.keys(errors).length) throw invalid(errors);
  return { academicYear, branch: role === 'OWNER' ? branch || null : null, date, source };
}

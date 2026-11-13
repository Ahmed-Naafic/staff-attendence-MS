import { badRequest } from '../../common/httpError.js';
import { isUuid, optionalEnum, optionalString } from '../../common/validate.js';
import { parseDay } from '../academic-years/academicYearInput.js';

/*
 * Validation for teaching assignment requests (docs/business-rules.md → Teaching assignments).
 * The school, and a Manager's branch, come from the account and are refused when sent.
 */

export const ROLES = { subject: 'SUBJECT_TEACHER', class: 'CLASS_TEACHER' };
export const ASSIGNMENT_STATES = ['scheduled', 'active', 'ended', 'cancelled'];

const FIXED = {
  id: 'The id cannot be set.',
  schoolId: 'The school is decided by your account and cannot be set.',
  school: 'The school is decided by your account and cannot be set.',
  branch: 'The branch is the section’s branch and cannot be set.',
  branchId: 'The branch is the section’s branch and cannot be set.',
  academicYear: 'The academic year is the section’s year and cannot be set.',
};
const invalid = (errors) => badRequest('Check the highlighted fields.', errors);

function refuseUnknown(body, allowed) {
  const keys = Object.keys(body);
  const fixed = keys.filter((key) => FIXED[key]);
  if (fixed.length) throw badRequest(FIXED[fixed[0]], Object.fromEntries(fixed.map((key) => [key, FIXED[key]])));
  const unknown = keys.filter((key) => !allowed.includes(key));
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);
}

function optionalDate(body, field, label, errors) {
  if (body[field] === undefined || body[field] === null || body[field] === '') return null;
  if (!parseDay(body[field])) {
    errors[field] = `${label} must be a date (YYYY-MM-DD).`;
    return null;
  }
  return body[field];
}

/**
 * A new assignment: { role: 'subject' | 'class', teacher, section, subject (subject role only),
 * startDate?, endDate? }. Without startDate it starts today (or when the year starts).
 */
export function readAssignment(body) {
  refuseUnknown(body, ['role', 'teacher', 'section', 'subject', 'startDate', 'endDate']);
  const errors = {};
  if (!ROLES[body.role]) errors.role = 'Choose subject teacher or class teacher.';
  if (!isUuid(body.teacher)) errors.teacher = 'Choose a teacher.';
  if (!isUuid(body.section)) errors.section = 'Choose a section.';
  if (body.role === 'subject' && !isUuid(body.subject)) errors.subject = 'Choose a subject.';
  if (body.role === 'class' && body.subject !== undefined && body.subject !== null) errors.subject = 'A class teacher is not tied to a subject.';
  const startDate = optionalDate(body, 'startDate', 'Start date', errors);
  const endDate = optionalDate(body, 'endDate', 'End date', errors);
  if (startDate && endDate && endDate < startDate) errors.endDate = 'The end date cannot be before the start date.';
  if (Object.keys(errors).length) throw invalid(errors);
  return { role: ROLES[body.role], teacherId: body.teacher, sectionId: body.section, subjectId: body.role === 'subject' ? body.subject : null, startDate, endDate };
}

/** { lastDay: 'YYYY-MM-DD' | null }: the assignment's new last day (null: until the year ends). */
export function readAssignmentEnd(body) {
  refuseUnknown(body, ['lastDay']);
  if (body.lastDay === null) return { lastDay: null };
  if (!parseDay(body.lastDay)) throw invalid({ lastDay: 'Choose the last day (YYYY-MM-DD).' });
  return { lastDay: body.lastDay };
}

/** List filters. academicYear: an id or 'current' (default). */
export function readAssignmentQuery(query, { role }) {
  const single = (name) => (Array.isArray(query[name]) ? query[name][0] : query[name]);
  const errors = {};
  const ids = {};
  for (const name of ['section', 'teacher', 'subject', ...(role === 'OWNER' ? ['branch'] : [])]) {
    const value = single(name);
    if (value === undefined || value === '') continue;
    if (!isUuid(value)) errors[name] = `"${name}" must be an id.`;
    else ids[name] = value;
  }
  if (role !== 'OWNER' && query.branch !== undefined) errors.branch = 'Your branch is decided by your account and cannot be set.';
  const academicYear = single('academicYear') || 'current';
  if (academicYear !== 'current' && !isUuid(academicYear)) errors.academicYear = '"academicYear" must be an id or "current".';
  if (Object.keys(errors).length) throw invalid(errors);
  return {
    academicYear,
    ...ids,
    role: optionalEnum(query, 'role', Object.keys(ROLES)) ?? null,
    state: optionalEnum(query, 'state', [...ASSIGNMENT_STATES, 'live', 'all']) ?? 'live',
  };
}

/** Teacher search: q (name, Staff ID or phone). */
export const readTeacherQuery = (query) => ({ q: optionalString(query, 'q', { max: 60 }) ?? '' });

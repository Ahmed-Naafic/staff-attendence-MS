import { badRequest } from '../../common/httpError.js';
import { isUuid, optionalEnum, optionalString } from '../../common/validate.js';
import { nameKey, normalizeText } from '../branches/branchInput.js';

/*
 * Validation for subject and class curriculum requests (School Owner writes; Managers read).
 * 400 { code: 'VALIDATION_ERROR', details: { field: message } }. Rules: docs/business-rules.md → Subjects.
 */

export const SUBJECT_NAME_MAX = 60;
export const SUBJECT_CODE_MAX = 12;
export const DESCRIPTION_MAX = 300;
export const WEEKLY_LESSONS_MAX = 40;
export const CURRICULUM_MAX = 60;

export { nameKey as subjectNameKey };

const CONTROL = /\p{Cc}/u;
const CODE = /^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/;
const FIXED = {
  id: 'The id cannot be set.',
  schoolId: 'The school is decided by your account and cannot be set.',
  school: 'The school is decided by your account and cannot be set.',
  status: 'Use Deactivate or Reactivate to change the status.',
};
const invalid = (errors) => badRequest('Check the highlighted fields.', errors);

function refuseUnknown(body, allowed) {
  const keys = Object.keys(body);
  const fixed = keys.filter((key) => FIXED[key]);
  if (fixed.length) throw badRequest(FIXED[fixed[0]], Object.fromEntries(fixed.map((key) => [key, FIXED[key]])));
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

function readFields(body, { partial }) {
  refuseUnknown(body, ['name', 'code', 'description']);
  const values = {};
  const errors = {};
  if (!partial || 'name' in body) readText(body.name, 'name', 'Subject name', { required: true, max: SUBJECT_NAME_MAX }, values, errors);
  if (!partial || 'code' in body) {
    readText(body.code, 'code', 'Code', { required: false, max: SUBJECT_CODE_MAX }, values, errors);
    if (values.code) {
      values.code = values.code.toUpperCase();
      if (!CODE.test(values.code)) {
        errors.code = 'Code may use letters, digits, and single hyphens or underscores between them (e.g. MATH, ENG-1).';
        delete values.code;
      }
    }
  }
  if (!partial || 'description' in body) readText(body.description, 'description', 'Description', { required: false, max: DESCRIPTION_MAX }, values, errors);
  if (Object.keys(errors).length) throw invalid(errors);
  return values;
}

/** { name, code?, description? } */
export const readSubjectCreation = (body) => readFields(body, { partial: false });

/** Any of { name, code, description }; at least one. */
export function readSubjectUpdate(body) {
  const values = readFields(body, { partial: true });
  if (!Object.keys(values).length) throw badRequest('Send at least one of: name, code, description.');
  return values;
}

/** List filters: q (name or code), status (active | inactive). */
export const readSubjectListQuery = (query) => ({
  q: optionalString(query, 'q', { max: 60 }) ?? '',
  status: optionalEnum(query, 'status', ['active', 'inactive']) ?? null,
});

/**
 * A class's curriculum, replacing the current one: { subjects: [{ subject, weeklyLessons? }] }
 * (an empty list: the class is open to every active subject). → [{ subjectId, weeklyLessons }].
 */
export function readCurriculum(body) {
  refuseUnknown(body, ['subjects']);
  if (!Array.isArray(body.subjects)) throw invalid({ subjects: 'Send the list of subjects (it may be empty).' });
  if (body.subjects.length > CURRICULUM_MAX) throw invalid({ subjects: `A class can have at most ${CURRICULUM_MAX} subjects.` });
  const errors = {};
  const seen = new Set();
  const items = body.subjects.map((raw, index) => {
    const key = (field) => `subjects.${index}.${field}`;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      errors[`subjects.${index}`] = 'Each item must be an object.';
      return null;
    }
    const unknown = Object.keys(raw).filter((k) => !['subject', 'weeklyLessons'].includes(k));
    if (unknown.length) errors[`subjects.${index}`] = `Unknown fields: ${unknown.join(', ')}.`;
    if (!isUuid(raw.subject)) errors[key('subject')] = 'Choose a subject.';
    else if (seen.has(raw.subject)) errors[key('subject')] = 'This subject is listed twice.';
    else seen.add(raw.subject);
    const lessons = raw.weeklyLessons ?? null;
    if (lessons !== null && (!Number.isInteger(lessons) || lessons < 1 || lessons > WEEKLY_LESSONS_MAX)) {
      errors[key('weeklyLessons')] = `Lessons per week must be a whole number from 1 to ${WEEKLY_LESSONS_MAX}, or empty.`;
    }
    return { subjectId: raw.subject, weeklyLessons: lessons };
  });
  if (Object.keys(errors).length) throw invalid(errors);
  return items;
}

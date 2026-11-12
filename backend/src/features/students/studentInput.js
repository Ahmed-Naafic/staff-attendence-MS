import { badRequest } from '../../common/httpError.js';
import { isUuid, optionalEnum, optionalInt, optionalString } from '../../common/validate.js';
import { nameKey, normalizeText } from '../branches/branchInput.js';
import { isValidPhone } from '../schools/schoolInput.js';

/*
 * Validation for students, enrollments and promotion batches. Collects every problem so the web app
 * can show them next to the fields: 400 { code: 'VALIDATION_ERROR', details: { field: message } }.
 * Rules: docs/business-rules.md → Students; Student enrollment; Academic year promotion.
 */

export const STUDENT_STATUSES = ['pending_enrollment', 'enrolled', 'transferred_out', 'graduated'];
export const DECISIONS = ['PROMOTE', 'REPEAT', 'TRANSFER_OUT', 'GRADUATE', 'PENDING'];
const CONTROL = /\p{Cc}/u;
const EARLIEST_BIRTH = '1950-01-01';

/** The full-name key compared for possible duplicate registrations (with the date of birth). */
export const studentNameKey = ({ firstName, middleName, lastName }) => nameKey([firstName, middleName, lastName].filter(Boolean).join(' '));

const TEXT_FIELDS = {
  firstName: { label: 'First name', required: true, max: 60 },
  middleName: { label: 'Middle name', required: false, max: 60 },
  lastName: { label: 'Last name', required: true, max: 60 },
  address: { label: 'Address', required: false, max: 200 },
  guardianName: { label: 'Guardian name', required: true, max: 120 },
  guardianRelationship: { label: 'Relationship', required: false, max: 40 },
  emergencyContactName: { label: 'Emergency contact name', required: false, max: 120 },
};
const PHONE_FIELDS = {
  phone: { label: 'Phone', required: false },
  guardianPhone: { label: 'Guardian phone', required: true },
  emergencyContactPhone: { label: 'Emergency contact phone', required: false },
};
const PROFILE_FIELDS = [...Object.keys(TEXT_FIELDS), ...Object.keys(PHONE_FIELDS), 'gender', 'dateOfBirth'];
const FIXED = {
  id: 'The id cannot be set.',
  studentNumber: 'The Student ID is generated and cannot be set or changed.',
  schoolId: 'The school is decided by your account and cannot be set.',
  status: 'The status changes through enrollment, transfer out and graduation.',
};

function refuseUnknown(body, allowed, fixed = {}) {
  const all = { ...FIXED, ...fixed };
  const keys = Object.keys(body);
  const refused = keys.filter((key) => all[key] && !allowed.includes(key));
  if (refused.length) throw badRequest(all[refused[0]], Object.fromEntries(refused.map((key) => [key, all[key]])));
  const unknown = keys.filter((key) => !allowed.includes(key));
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);
}

const check = (errors) => {
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
};

function readText(body, field, rule, values, errors) {
  const raw = body[field];
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return void (errors[field] = `${rule.label} must be text.`);
  const value = normalizeText(raw ?? '');
  if (!value) {
    if (rule.required) errors[field] = `${rule.label} is required.`;
    else values[field] = null;
  } else if (value.length > rule.max) errors[field] = `${rule.label} must be at most ${rule.max} characters.`;
  else if (CONTROL.test(value)) errors[field] = `${rule.label} cannot contain control characters.`;
  else values[field] = value;
}

function readPhone(body, field, rule, values, errors) {
  const raw = body[field];
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return void (errors[field] = `${rule.label} must be text.`);
  const value = normalizeText(raw ?? '');
  if (!value) {
    if (rule.required) errors[field] = `${rule.label} is required.`;
    else values[field] = null;
  } else if (!isValidPhone(value)) errors[field] = 'Enter a valid phone number, e.g. +252 61 2345678.';
  else values[field] = value;
}

/** 'YYYY-MM-DD' → Date at 00:00 UTC, or null when not a real date. */
export function parseDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function readProfile(body, { partial, today }) {
  const values = {};
  const errors = {};
  for (const [field, rule] of Object.entries(TEXT_FIELDS)) if (!partial || field in body) readText(body, field, rule, values, errors);
  for (const [field, rule] of Object.entries(PHONE_FIELDS)) if (!partial || field in body) readPhone(body, field, rule, values, errors);
  if (!partial || 'gender' in body) {
    const gender = typeof body.gender === 'string' ? body.gender.toUpperCase() : '';
    if (!['MALE', 'FEMALE'].includes(gender)) errors.gender = 'Choose Male or Female.';
    else values.gender = gender;
  }
  if (!partial || 'dateOfBirth' in body) {
    const date = parseDay(body.dateOfBirth);
    if (!date) errors.dateOfBirth = 'Date of birth is required (YYYY-MM-DD).';
    else if (body.dateOfBirth > today) errors.dateOfBirth = 'Date of birth cannot be in the future.';
    else if (body.dateOfBirth < EARLIEST_BIRTH) errors.dateOfBirth = 'Check the date of birth.';
    else values.dateOfBirth = date;
  }
  return { values, errors };
}

/**
 * Registration: the profile, plus (Owner only) branchId; `confirmDuplicate: true` registers even when
 * a student with the same full name and date of birth already exists in the school (409 POSSIBLE_DUPLICATE otherwise).
 */
export function readStudentRegistration(body, { role, today }) {
  const owner = role === 'OWNER';
  refuseUnknown(body, [...PROFILE_FIELDS, 'confirmDuplicate', ...(owner ? ['branchId'] : [])], owner ? {} : { branchId: 'Students are registered in your own branch; the branch comes from your account.' });
  const { values, errors } = readProfile(body, { partial: false, today });
  if (owner && !isUuid(body.branchId)) errors.branchId = 'Choose a branch.';
  if (body.confirmDuplicate !== undefined && typeof body.confirmDuplicate !== 'boolean') errors.confirmDuplicate = 'Must be true or false.';
  check(errors);
  return { profile: values, branchId: owner ? body.branchId : undefined, confirmDuplicate: body.confirmDuplicate === true };
}

/** Any profile fields. The Student ID, school, branch and status never change here. */
export function readStudentUpdate(body, { today }) {
  refuseUnknown(body, PROFILE_FIELDS, { branchId: 'A student’s branch cannot be changed.' });
  const { values, errors } = readProfile(body, { partial: true, today });
  check(errors);
  if (!Object.keys(values).length) throw badRequest('Send at least one field to change.');
  return values;
}

/** Enrollment: { sectionId } — the academic year, class and branch are the section's. */
export function readEnrollment(body) {
  refuseUnknown(body, ['sectionId'], {
    academicYearId: 'The academic year is the section’s; choose a section of that year.',
    classId: 'The class is the section’s; choose a section of that class.',
    branchId: 'The branch is the section’s.',
  });
  if (!isUuid(body.sectionId)) throw badRequest('Choose a section.', { sectionId: 'Choose a section.' });
  return { sectionId: body.sectionId };
}

/** Enrollment change: { sectionId?, result? ('PASSED' | 'FAILED' | null) }. */
export function readEnrollmentUpdate(body) {
  refuseUnknown(body, ['sectionId', 'result']);
  const values = {};
  const errors = {};
  if ('sectionId' in body) {
    if (!isUuid(body.sectionId)) errors.sectionId = 'Choose a section.';
    else values.sectionId = body.sectionId;
  }
  if ('result' in body) {
    if (body.result === null || body.result === '') values.result = null;
    else if (!['PASSED', 'FAILED'].includes(String(body.result).toUpperCase())) errors.result = 'Choose Passed, Failed or no result.';
    else values.result = String(body.result).toUpperCase();
  }
  check(errors);
  if (!Object.keys(values).length) throw badRequest('Send sectionId or result.');
  return values;
}

/** Transfer out: { reason } (3–300 characters). */
export function readTransferOut(body) {
  refuseUnknown(body, ['reason']);
  const values = {};
  const errors = {};
  readText(body, 'reason', { label: 'Reason', required: true, max: 300 }, values, errors);
  if (!errors.reason && values.reason.length < 3) errors.reason = 'Reason must be at least 3 characters.';
  check(errors);
  return values;
}

/** Student directory query. */
export function readStudentListQuery(query, { role }) {
  if (role === 'MANAGER' && query.branch !== undefined) {
    throw badRequest('Your students are in your own branch; "branch" cannot be chosen.', { branch: 'The branch comes from your account.' });
  }
  const id = (name, label) => {
    const value = optionalString(query, name, { max: 64 });
    if (value !== undefined && !isUuid(value)) throw badRequest(`"${name}" must be an id.`, { [name]: `Choose a ${label} from the list.` });
    return value;
  };
  return {
    q: optionalString(query, 'q', { max: 100 }),
    academicYear: id('academicYear', 'academic year'),
    branch: role === 'OWNER' ? id('branch', 'branch') : undefined,
    classId: id('class', 'class'),
    sectionId: id('section', 'section'),
    status: optionalEnum(query, 'status', STUDENT_STATUSES),
    enrollment: optionalEnum(query, 'enrollment', ['enrolled', 'not_enrolled']),
    page: optionalInt(query, 'page', { min: 1, max: 100000, fallback: 1 }),
    pageSize: optionalInt(query, 'pageSize', { min: 1, max: 100, fallback: 20 }),
  };
}

// ---- promotion ----------------------------------------------------------------------------------

/** New batch: { fromYearId, toYearId } (the branch is the Manager's). */
export function readPromotionStart(body) {
  refuseUnknown(body, ['fromYearId', 'toYearId'], { branchId: 'The branch comes from your account.' });
  const errors = {};
  if (!isUuid(body.fromYearId)) errors.fromYearId = 'Choose the previous academic year.';
  if (!isUuid(body.toYearId)) errors.toYearId = 'Choose the new academic year.';
  if (!errors.fromYearId && body.fromYearId === body.toYearId) errors.toYearId = 'Choose a different academic year.';
  check(errors);
  return { fromYearId: body.fromYearId, toYearId: body.toYearId };
}

/** Decision changes: { items: [{ id, decision, targetSectionId? }] } (1–2000 at once). */
export function readPromotionChanges(body) {
  refuseUnknown(body, ['items']);
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 2000) throw badRequest('Send 1 to 2000 items to change.');
  return body.items.map((item, i) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw badRequest(`Item ${i + 1} must be an object.`);
    const unknown = Object.keys(item).filter((k) => !['id', 'decision', 'targetSectionId'].includes(k));
    if (unknown.length) throw badRequest(`Item ${i + 1}: unknown fields: ${unknown.join(', ')}.`);
    if (!isUuid(item.id)) throw badRequest(`Item ${i + 1}: "id" must be an id.`);
    if (!DECISIONS.includes(item.decision)) throw badRequest(`Item ${i + 1}: "decision" must be one of ${DECISIONS.join(', ')}.`);
    if (item.targetSectionId !== undefined && item.targetSectionId !== null && !isUuid(item.targetSectionId)) {
      throw badRequest(`Item ${i + 1}: "targetSectionId" must be an id or null.`);
    }
    return { id: item.id, decision: item.decision, targetSectionId: item.targetSectionId ?? null };
  });
}

/** Confirmation: { confirm: 'PROCESS' } — typed on purpose, so one accidental click never starts it. */
export function readPromotionConfirm(body) {
  refuseUnknown(body, ['confirm']);
  if (body.confirm !== 'PROCESS') throw badRequest('Type PROCESS to confirm.', { confirm: 'Type PROCESS to confirm.' });
}

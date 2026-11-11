import { badRequest } from '../../common/httpError.js';
import { isUuid, optionalEnum, optionalString } from '../../common/validate.js';
import { nameKey, normalizeText } from '../branches/branchInput.js';

/*
 * Validation for class and section requests. Collects every problem so the web app can show them
 * next to the fields: 400 { code: 'VALIDATION_ERROR', details: { field: message } }.
 * Rules: docs/business-rules.md → Classes and sections. The web app applies the same rules first.
 */

export const CLASS_NAME_MAX = 60;
export const DESCRIPTION_MAX = 300;
export const SEQUENCE_MAX = 100;
export const SECTION_NAME_MAX = 20;
export const ROOM_MAX = 60;
export const CAPACITY_MAX = 1000;

export { nameKey as classNameKey };

const CONTROL = /\p{Cc}/u;
const FIXED = {
  id: 'The id cannot be set.',
  schoolId: 'The school is decided by your account and cannot be set.',
  school: 'The school is decided by your account and cannot be set.',
  status: 'Use Deactivate or Reactivate to change the status.',
};

function refuseUnknown(body, allowed, fixed = {}) {
  const all = { ...FIXED, ...fixed };
  const keys = Object.keys(body);
  const refused = keys.filter((key) => all[key]);
  if (refused.length) throw badRequest(all[refused[0]], Object.fromEntries(refused.map((key) => [key, all[key]])));
  const unknown = keys.filter((key) => !allowed.includes(key));
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);
}

/** Reads a text field: required or optional (empty → null), trimmed, spaces collapsed. */
function text(body, field, label, { required, max }, values, errors) {
  const raw = body[field];
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

/** Reads a whole number in [min, max]; optional ones accept null/'' as "not set". */
function integer(body, field, label, { required, min, max }, values, errors) {
  const raw = body[field];
  if (!required && (raw === null || raw === '' || raw === undefined)) {
    values[field] = null;
    return;
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
    errors[field] = `${label} must be a whole number from ${min} to ${max}.`;
    return;
  }
  values[field] = raw;
}

function check(errors) {
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
}

const CLASS_FIELDS = ['name', 'description', 'sequence'];

function readClass(body, { partial }) {
  refuseUnknown(body, CLASS_FIELDS);
  const values = {};
  const errors = {};
  if (!partial || 'name' in body) text(body, 'name', 'Class name', { required: true, max: CLASS_NAME_MAX }, values, errors);
  if (!partial || 'description' in body) text(body, 'description', 'Description', { required: false, max: DESCRIPTION_MAX }, values, errors);
  if (!partial || 'sequence' in body) integer(body, 'sequence', 'Order', { required: true, min: 1, max: SEQUENCE_MAX }, values, errors);
  check(errors);
  if (partial && !Object.keys(values).length) throw badRequest(`Send at least one of: ${CLASS_FIELDS.join(', ')}.`);
  return values;
}

/** { name, description?, sequence } */
export const readClassCreation = (body) => readClass(body, { partial: false });
/** Any of { name, description, sequence }. */
export const readClassUpdate = (body) => readClass(body, { partial: true });

const SECTION_DETAILS = ['name', 'capacity', 'room'];

function readSectionDetails(body, { partial }, values, errors) {
  if (!partial || 'name' in body) text(body, 'name', 'Section name', { required: true, max: SECTION_NAME_MAX }, values, errors);
  if (!partial || 'capacity' in body) integer(body, 'capacity', 'Capacity', { required: false, min: 1, max: CAPACITY_MAX }, values, errors);
  if (!partial || 'room' in body) text(body, 'room', 'Room', { required: false, max: ROOM_MAX }, values, errors);
}

function readId(body, field, label, values, errors) {
  if (!isUuid(body[field])) errors[field] = `Choose a ${label} from the list.`;
  else values[field] = body[field];
}

/**
 * { classId, academicYearId, branchId (Owner only), name, capacity?, room? }. A Manager's branch comes
 * from the account, so a branchId from a Manager is refused.
 */
export function readSectionCreation(body, { role }) {
  const owner = role === 'OWNER';
  const allowed = ['classId', 'academicYearId', ...(owner ? ['branchId'] : []), ...SECTION_DETAILS];
  refuseUnknown(body, allowed, owner ? {} : { branchId: 'Your sections are for your own branch; the branch comes from your account.' });
  const values = {};
  const errors = {};
  readId(body, 'classId', 'class', values, errors);
  readId(body, 'academicYearId', 'academic year', values, errors);
  if (owner) readId(body, 'branchId', 'branch', values, errors);
  readSectionDetails(body, { partial: false }, values, errors);
  check(errors);
  return values;
}

/** Any of { name, capacity, room }. The class, year and branch of a section never change. */
export function readSectionUpdate(body) {
  const moved = 'The class, academic year and branch of a section cannot be changed. Create a new section instead.';
  refuseUnknown(body, SECTION_DETAILS, { classId: moved, academicYearId: moved, branchId: moved });
  const values = {};
  const errors = {};
  readSectionDetails(body, { partial: true }, values, errors);
  check(errors);
  if (!Object.keys(values).length) throw badRequest(`Send at least one of: ${SECTION_DETAILS.join(', ')}.`);
  return values;
}

/** "Grade 7" + "A" → "Grade 7A"; longer section names get a space: "Grade 7 Blue". */
export const sectionDisplayName = (className, sectionName) =>
  /^[\p{L}\p{N}]{1,2}$/u.test(sectionName) ? `${className}${sectionName}` : `${className} ${sectionName}`;

// ---- list queries ---------------------------------------------------------------------------

function queryId(query, name, label, role) {
  if (name === 'branch' && role === 'MANAGER' && query.branch !== undefined) {
    throw badRequest('Your classes and sections are for your own branch; "branch" cannot be chosen.', { branch: 'The branch comes from your account.' });
  }
  const value = optionalString(query, name, { max: 64 });
  if (value !== undefined && !isUuid(value)) throw badRequest(`"${name}" must be an id.`, { [name]: `Choose a ${label} from the list.` });
  return value;
}

/** Classes list / class details: academicYear?, branch? (Owner), q?, status? ('active' | 'inactive'). */
export function readClassListQuery(query, { role }) {
  return {
    academicYear: queryId(query, 'academicYear', 'academic year', role),
    branch: queryId(query, 'branch', 'branch', role),
    q: optionalString(query, 'q', { max: 100 }),
    status: optionalEnum(query, 'status', ['active', 'inactive']),
  };
}

/** Sections list: academicYear?, branch? (Owner), class?, status?, q? (matches "Grade 7A"). */
export function readSectionListQuery(query, { role }) {
  return { ...readClassListQuery(query, { role }), classId: queryId(query, 'class', 'class', role) };
}

import { badRequest } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { MIN_PASSWORD_LENGTH } from '../auth/password.js';
import { isValidEmail, isValidPhone } from '../schools/schoolInput.js';

/*
 * Validation for School Owner Management requests (add and edit). Like School Management, every
 * problem is collected so the web app can show it next to its field:
 * 400 { code: 'VALIDATION_ERROR', details: { field: message } }. The web app applies the same
 * rules for immediate feedback; these are the ones that count.
 */

const MAX_PASSWORD_LENGTH = 128;

const FIELDS = {
  name: { label: 'Full name', min: 2, max: 120 },
  email: { label: 'Email', max: 254 },
  phone: { label: 'Phone', max: 24 },
};
const EDITABLE = Object.keys(FIELDS);

// Fields that exist on an owner but are never changed by editing (approved rules).
const IMMUTABLE = {
  schoolId: 'The assigned school cannot be changed.',
  role: 'The role cannot be changed.',
  status: 'Use Suspend or Reactivate to change the account status.',
  password: 'The password cannot be changed here.',
};

function readText(body, field, errors) {
  const rule = FIELDS[field];
  const raw = body[field];
  if (raw !== undefined && raw !== null && typeof raw !== 'string') {
    errors[field] = `${rule.label} must be text.`;
    return undefined;
  }
  const value = (raw ?? '').trim().replace(/\s+/g, ' ');
  if (!value) errors[field] = `${rule.label} is required.`;
  else if (value.length > rule.max) errors[field] = `${rule.label} must be at most ${rule.max} characters.`;
  else if (rule.min && value.length < rule.min) errors[field] = `${rule.label} must be at least ${rule.min} characters.`;
  else if (field === 'email' && !isValidEmail(value)) errors[field] = 'Enter a valid email address.';
  else if (field === 'phone' && !isValidPhone(value)) errors[field] = 'Enter a valid phone number, e.g. +252 61 2345678.';
  else return field === 'email' ? value.toLowerCase() : value;
  return undefined;
}

function rejectUnknown(body, allowed) {
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key));
  const fixed = unknown.filter((key) => key in IMMUTABLE);
  if (fixed.length) throw badRequest(IMMUTABLE[fixed[0]], Object.fromEntries(fixed.map((key) => [key, IMMUTABLE[key]])));
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);
}

const fail = (errors) => {
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
};

/**
 * Add Owner: full name, email, phone, the school (an id) and an initial password. The password is
 * returned only to be hashed; it is never trimmed, echoed, logged or stored as text.
 */
export function readOwnerCreation(body) {
  rejectUnknown(body, [...EDITABLE, 'schoolId', 'password']);
  const errors = {};
  const values = {};
  for (const field of EDITABLE) values[field] = readText(body, field, errors);

  if (body.schoolId === undefined || body.schoolId === null || body.schoolId === '') errors.schoolId = 'Choose a school.';
  else if (!isUuid(body.schoolId)) errors.schoolId = 'Choose a school from the list.';
  else values.schoolId = body.schoolId;

  const password = body.password;
  if (typeof password !== 'string' || !password) errors.password = 'Enter an initial password.';
  else if (!password.trim()) errors.password = 'The password cannot be only spaces.';
  else if (password.length < MIN_PASSWORD_LENGTH) errors.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  else if (password.length > MAX_PASSWORD_LENGTH) errors.password = `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  else values.password = password;

  fail(errors);
  return values;
}

/** Edit Owner: any of name, email, phone (never the school, role, status or password); at least one. */
export function readOwnerUpdate(body) {
  rejectUnknown(body, EDITABLE);
  const errors = {};
  const values = {};
  for (const field of EDITABLE) if (field in body) values[field] = readText(body, field, errors);
  fail(errors);
  if (!Object.keys(values).length) throw badRequest('Send at least one field to change.');
  return values;
}

/** Suspension reason: required, 3–500 characters. */
export function readOwnerSuspension(body) {
  rejectUnknown(body, ['reason']);
  const reason = typeof body.reason === 'string' ? body.reason.trim().replace(/\s+/g, ' ') : '';
  if (!reason) throw badRequest('A reason is required to suspend an owner.', { reason: 'Enter the reason for suspending this owner.' });
  if (reason.length < 3 || reason.length > 500) throw badRequest('The reason must be 3–500 characters.', { reason: 'The reason must be 3–500 characters.' });
  return reason;
}

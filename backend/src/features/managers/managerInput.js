import { badRequest } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { passwordProblem } from '../auth/password.js';
import { isValidEmail, isValidPhone } from '../schools/schoolInput.js';

/*
 * Validation for Manager account requests (approved rules: docs/business-rules.md → Manager
 * accounts). The same field rules as School Owner accounts; every problem is collected so the web
 * app can show it next to its field: 400 { code: 'VALIDATION_ERROR', details: { field: message } }.
 * Passwords are returned only to be hashed: never trimmed, echoed, logged or stored as text.
 */

const FIELDS = {
  name: { label: 'Full name', min: 2, max: 120 },
  email: { label: 'Email', max: 254 },
  phone: { label: 'Phone', max: 24 },
};
const DETAILS = Object.keys(FIELDS);

// Fields that exist on a Manager but are never set from these requests.
const FIXED = {
  role: 'The role cannot be changed.',
  schoolId: "The school is your own school; it cannot be chosen.",
  school: "The school is your own school; it cannot be chosen.",
  status: 'Use Suspend or Reactivate to change the account status.',
  mustChangePassword: 'This is set by the server.',
  id: 'The id cannot be changed.',
};
const EDIT_ONLY_FIXED = {
  branchId: 'Use Transfer to move a Manager to another branch.',
  password: 'Use Reset Password to give a new temporary password.',
};

function refuseUnknown(body, allowed, fixed = FIXED) {
  const keys = Object.keys(body);
  const refused = keys.filter((key) => !allowed.includes(key) && fixed[key]);
  if (refused.length) throw badRequest(fixed[refused[0]], Object.fromEntries(refused.map((key) => [key, fixed[key]])));
  const unknown = keys.filter((key) => !allowed.includes(key));
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);
}

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

function readBranchId(body, errors) {
  const value = body.branchId;
  if (value === undefined || value === null || value === '') errors.branchId = 'Choose a branch.';
  else if (!isUuid(value)) errors.branchId = 'Choose a branch from the list.';
  else return value;
  return undefined;
}

function readPassword(body, field, errors) {
  const problem = passwordProblem(body[field]);
  if (problem) errors[field] = problem === 'Enter a password.' ? 'Enter a temporary password.' : problem;
  else return body[field];
  return undefined;
}

const fail = (errors) => {
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
};

/** Create: full name, email, phone, a branch (an id, checked against the owner's school later) and a temporary password. */
export function readManagerCreation(body) {
  refuseUnknown(body, [...DETAILS, 'branchId', 'password']);
  const errors = {};
  const values = {};
  for (const field of DETAILS) values[field] = readText(body, field, errors);
  values.branchId = readBranchId(body, errors);
  values.password = readPassword(body, 'password', errors);
  fail(errors);
  return values;
}

/** Edit: any of full name, email, phone (never the role, school, branch, status or password); at least one. */
export function readManagerUpdate(body) {
  refuseUnknown(body, DETAILS, { ...FIXED, ...EDIT_ONLY_FIXED });
  const errors = {};
  const values = {};
  for (const field of DETAILS) if (field in body) values[field] = readText(body, field, errors);
  fail(errors);
  if (!Object.keys(values).length) throw badRequest('Send at least one field to change.');
  return values;
}

/** Transfer: the destination branch (an id). */
export function readManagerTransfer(body) {
  refuseUnknown(body, ['branchId']);
  const errors = {};
  const branchId = readBranchId(body, errors);
  fail(errors);
  return branchId;
}

/** Suspension reason: required, 3–500 characters. */
export function readManagerSuspension(body) {
  refuseUnknown(body, ['reason']);
  const reason = typeof body.reason === 'string' ? body.reason.trim().replace(/\s+/g, ' ') : '';
  if (!reason) throw badRequest('A reason is required to suspend a Manager.', { reason: 'Enter the reason for suspending this Manager.' });
  if (reason.length < 3 || reason.length > 500) throw badRequest('The reason must be 3–500 characters.', { reason: 'The reason must be 3–500 characters.' });
  return reason;
}

/** New temporary password (reset). */
export function readTemporaryPassword(body) {
  refuseUnknown(body, ['password']);
  const errors = {};
  const password = readPassword(body, 'password', errors);
  fail(errors);
  return password;
}

import { badRequest } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { passwordProblem } from '../auth/password.js';
import { WEEKDAYS, isDate } from '../schedules/scheduleInput.js';
import { isValidEmail, isValidPhone } from '../schools/schoolInput.js';

/*
 * Validation for staff requests (approved rules: docs/business-rules.md → Staff accounts and shift
 * assignments). Every problem is collected per field: 400 { code: 'VALIDATION_ERROR', details }.
 * Passwords are returned only to be hashed: never trimmed, echoed, logged or stored as text.
 */

const CONTROL = /\p{Cc}/u;
const FIELDS = {
  name: { label: 'Full name', min: 2, max: 120, required: true },
  phone: { label: 'Phone', max: 24, required: true },
  jobTitle: { label: 'Job title', min: 2, max: 80, required: true },
  email: { label: 'Email', max: 254, required: false },
};
const DETAILS = Object.keys(FIELDS);
const FIXED = {
  role: 'The role cannot be changed.',
  staffId: 'The Staff ID is generated and cannot be changed.',
  branchId: 'Staff belong to your branch; it cannot be chosen.',
  schoolId: 'The school cannot be chosen.',
  status: 'Use Suspend or Reactivate to change the account status.',
  mustChangePassword: 'This is set by the server.',
  id: 'The id cannot be changed.',
};
const EDIT_FIXED = { password: 'Use Reset Password to give a new temporary password.' };

function refuse(body, allowed, fixed) {
  const keys = Object.keys(body);
  const refused = keys.filter((k) => !allowed.includes(k) && fixed[k]);
  if (refused.length) throw badRequest(fixed[refused[0]], Object.fromEntries(refused.map((k) => [k, fixed[k]])));
  const unknown = keys.filter((k) => !allowed.includes(k));
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
  if (!value) {
    if (rule.required) errors[field] = `${rule.label} is required.`;
    return rule.required ? undefined : null;
  }
  if (value.length > rule.max) errors[field] = `${rule.label} must be at most ${rule.max} characters.`;
  else if (rule.min && value.length < rule.min) errors[field] = `${rule.label} must be at least ${rule.min} characters.`;
  else if (CONTROL.test(value)) errors[field] = `${rule.label} cannot contain control characters.`;
  else if (field === 'email' && !isValidEmail(value)) errors[field] = 'Enter a valid email address.';
  else if (field === 'phone' && !isValidPhone(value)) errors[field] = 'Enter a valid phone number, e.g. +252 61 2345678.';
  else return field === 'email' ? value.toLowerCase() : value;
  return undefined;
}

const fail = (errors) => {
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
};

function readPassword(body, errors) {
  const problem = passwordProblem(body.password);
  if (problem) errors.password = problem === 'Enter a password.' ? 'Enter a temporary password.' : problem;
  else return body.password;
  return undefined;
}

/** Create: full name, phone, job title, optional email and a temporary password. */
export function readStaffCreation(body) {
  refuse(body, [...DETAILS, 'password'], FIXED);
  const errors = {};
  const values = {};
  for (const field of DETAILS) values[field] = readText(body, field, errors);
  values.password = readPassword(body, errors);
  fail(errors);
  return values;
}

/** Edit: any of full name, phone, job title, email (empty email = none); at least one. */
export function readStaffUpdate(body) {
  refuse(body, DETAILS, { ...FIXED, ...EDIT_FIXED });
  const errors = {};
  const values = {};
  for (const field of DETAILS) if (field in body) values[field] = readText(body, field, errors);
  fail(errors);
  if (!Object.keys(values).length) throw badRequest('Send at least one field to change.');
  return values;
}

/** Suspension reason: required, 3–500 characters. */
export function readStaffSuspension(body) {
  refuse(body, ['reason'], {});
  const reason = typeof body.reason === 'string' ? body.reason.trim().replace(/\s+/g, ' ') : '';
  if (!reason) throw badRequest('A reason is required to suspend a staff member.', { reason: 'Enter the reason for suspending this staff member.' });
  if (reason.length < 3 || reason.length > 500) throw badRequest('The reason must be 3–500 characters.', { reason: 'The reason must be 3–500 characters.' });
  return reason;
}

/** New temporary password (reset). */
export function readStaffPassword(body) {
  refuse(body, ['password'], {});
  const errors = {};
  const password = readPassword(body, errors);
  fail(errors);
  return password;
}

/**
 * An assignment set { effectiveFrom, shifts: [{ shiftKey, days }] } → the same, days in week order.
 * Shifts may be empty (no assigned shifts from that date). Whether each shift and day exists in the
 * branch schedule on that date is checked by the service.
 */
export function readAssignmentChange(body) {
  refuse(body, ['effectiveFrom', 'shifts'], { branchId: FIXED.branchId, staffId: 'The staff member is the one in the address.' });
  const errors = {};
  if (!isDate(body.effectiveFrom)) errors.effectiveFrom = 'Choose the date the assignments take effect (YYYY-MM-DD).';
  const shifts = [];
  if (!Array.isArray(body.shifts)) errors.shifts = 'Send the list of assigned shifts (it may be empty).';
  else if (body.shifts.length > 20) errors.shifts = 'At most 20 assigned shifts.';
  else {
    const seen = new Set();
    body.shifts.forEach((raw, i) => {
      const key = (f) => `shifts.${i}.${f}`;
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        errors[`shifts.${i}`] = 'Each assigned shift must be an object.';
        return;
      }
      const unknown = Object.keys(raw).filter((k) => k !== 'shiftKey' && k !== 'days');
      if (unknown.length) errors[`shifts.${i}`] = `Unknown fields: ${unknown.join(', ')}.`;
      if (!isUuid(raw.shiftKey)) errors[key('shiftKey')] = 'Choose a shift.';
      else if (seen.has(raw.shiftKey)) errors[key('shiftKey')] = 'This shift is listed twice; choose its days once.';
      else seen.add(raw.shiftKey);
      let days = [];
      if (!Array.isArray(raw.days) || !raw.days.length) errors[key('days')] = 'Choose at least one day.';
      else if (!raw.days.every((d) => WEEKDAYS.includes(d)) || new Set(raw.days).size !== raw.days.length) errors[key('days')] = 'Days must be MON–SUN, each once.';
      else days = WEEKDAYS.filter((d) => raw.days.includes(d));
      shifts.push({ shiftKey: raw.shiftKey, days });
    });
  }
  fail(errors);
  return { effectiveFrom: body.effectiveFrom, shifts };
}

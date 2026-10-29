// Client-side checks for Manager accounts, mirroring the API's rules (backend/src/features/
// managers/managerInput.js and auth/password.js) so problems show immediately. The API validates
// again and has the final say (including email uniqueness and the branch belonging to your school).
// Password rules: features/auth/passwordRules.js.

export { passwordProblem } from '../../auth/passwordRules.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?\d(?:[ -]?\d)+$/;

export const PAGE_SIZE = 8;

export const MANAGER_FIELDS = {
  name: { label: 'Full name', min: 2, max: 120 },
  email: { label: 'Email', max: 254 },
  phone: { label: 'Phone', max: 24 },
};

/** Trimmed, with runs of whitespace collapsed (as the server stores it); email lower-case. */
export function cleanManagerValues(values, fields) {
  return Object.fromEntries(
    fields.map((field) => {
      const value = (values[field] ?? '').trim().replace(/\s+/g, ' ');
      return [field, field === 'email' ? value.toLowerCase() : value];
    }),
  );
}

function detailProblem(field, value) {
  const rule = MANAGER_FIELDS[field];
  if (!value) return `${rule.label} is required.`;
  if (value.length > rule.max) return `${rule.label} must be at most ${rule.max} characters.`;
  if (rule.min && value.length < rule.min) return `${rule.label} must be at least ${rule.min} characters.`;
  if (field === 'email' && !EMAIL_PATTERN.test(value)) return 'Enter a valid email address.';
  if (field === 'phone') {
    const digits = value.replace(/\D/g, '').length;
    if (!PHONE_PATTERN.test(value) || digits < 7 || digits > 15) return 'Enter a valid phone number, e.g. +252 61 2345678.';
  }
  return null;
}

/** { field: message } for every invalid detail field (empty when all are valid). */
export function validateManager(values, fields) {
  return Object.fromEntries(fields.map((field) => [field, detailProblem(field, values[field])]).filter(([, message]) => message));
}

/** Suspension reason: required, 3–500 characters. */
export function validateReason(reason) {
  const value = (reason ?? '').trim().replace(/\s+/g, ' ');
  if (!value) return 'Enter the reason for suspending this Manager.';
  if (value.length < 3 || value.length > 500) return 'The reason must be 3–500 characters.';
  return null;
}

/** "Branch name (CODE)" */
export const branchLabel = (branch) => `${branch.name} (${branch.code})`;

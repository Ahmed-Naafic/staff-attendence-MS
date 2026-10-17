// Client-side checks for the owner forms, mirroring the API's rules (backend/src/features/
// school-owners/ownerInput.js) so problems show immediately. The API validates again and has the
// final say (e.g. an email already in use, or a school that already has an owner).

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?\d(?:[ -]?\d)+$/;
export const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

const LABELS = { name: 'Full name', email: 'Email', phone: 'Phone' };
const MAX = { name: 120, email: 254, phone: 24 };

function problem(field, value) {
  if (field === 'schoolId') return value ? null : 'Choose a school.';
  if (field === 'password') {
    if (!value) return 'Enter an initial password.';
    if (!value.trim()) return 'The password cannot be only spaces.';
    if (value.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (value.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
    return null;
  }
  if (!value) return `${LABELS[field]} is required.`;
  if (value.length > MAX[field]) return `${LABELS[field]} must be at most ${MAX[field]} characters.`;
  if (field === 'name' && value.length < 2) return 'Full name must be at least 2 characters.';
  if (field === 'email' && !EMAIL_PATTERN.test(value)) return 'Enter a valid email address.';
  if (field === 'phone') {
    const digits = value.replace(/\D/g, '').length;
    if (!PHONE_PATTERN.test(value) || digits < 7 || digits > 15) return 'Enter a valid phone number, e.g. +252 61 2345678.';
  }
  return null;
}

/** Values ready to send: text trimmed with single spaces; the password exactly as typed. */
export function cleanOwnerValues(values, fields) {
  return Object.fromEntries(
    fields.map((field) => [field, field === 'password' || field === 'schoolId' ? (values[field] ?? '') : (values[field] ?? '').trim().replace(/\s+/g, ' ')]),
  );
}

/** { field: message } for every invalid field (empty when all are valid). */
export function validateOwner(values, fields) {
  return Object.fromEntries(fields.map((field) => [field, problem(field, values[field])]).filter(([, message]) => message));
}

/** Suspension reason: required, 3–500 characters. */
export function validateOwnerReason(reason) {
  const value = reason.trim();
  if (!value) return 'Enter the reason for suspending this owner.';
  if (value.length < 3 || value.length > 500) return 'The reason must be 3–500 characters.';
  return null;
}

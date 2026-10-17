import { badRequest } from '../../common/httpError.js';

/*
 * Validation for School Management requests (register and edit). Collects every problem so the
 * web app can show them next to the fields: 400 { code: 'VALIDATION_ERROR', details: { field: message } }.
 * The web app applies the same rules for immediate feedback; these are the ones that count.
 */

/** Uppercase letters and digits in groups joined by single hyphens, e.g. JHA-001. */
export const CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Optional +, then digits with single spaces or hyphens; 7–15 digits in total (international format).
const PHONE_PATTERN = /^\+?\d(?:[ -]?\d)+$/;

/** Contact formats, shared with School Owner accounts (../school-owners/ownerInput.js). */
export const isValidEmail = (value) => EMAIL_PATTERN.test(value);
export function isValidPhone(value) {
  const digits = value.replace(/\D/g, '').length;
  return PHONE_PATTERN.test(value) && digits >= 7 && digits <= 15;
}

const FIELDS = {
  name: { label: 'School name', required: true, max: 120 },
  code: { label: 'School code', required: true, min: 3, max: 20 },
  phone: { label: 'Phone', required: true, max: 24 },
  email: { label: 'Email', required: false, max: 254 },
  address: { label: 'Address', required: true, max: 200 },
  city: { label: 'City', required: true, max: 80 },
  description: { label: 'Description', required: false, max: 1000 },
  website: { label: 'Website', required: false, max: 200 },
};
const EDITABLE = ['name', 'phone', 'email', 'address', 'city', 'description', 'website'];

function checkFormat(field, value) {
  if (field === 'code' && !CODE_PATTERN.test(value)) return 'Use uppercase letters, digits and single hyphens, e.g. JHA-001.';
  if (field === 'email' && !isValidEmail(value)) return 'Enter a valid email address.';
  if (field === 'phone' && !isValidPhone(value)) return 'Enter a valid phone number, e.g. +252 61 2345678.';
  if (field === 'website') {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) throw new Error();
    } catch {
      return 'Enter a full web address starting with https://.';
    }
  }
  return null;
}

/** Reads and validates `fields` from a JSON body. Optional empty values become null. */
function readFields(body, fields, { partial }) {
  const unknown = Object.keys(body).filter((key) => !fields.includes(key));
  if (unknown.includes('code')) throw badRequest('The School Code cannot be changed.', { code: 'The School Code cannot be changed after registration.' });
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);

  const values = {};
  const errors = {};
  for (const field of fields) {
    if (partial && !(field in body)) continue;
    const rule = FIELDS[field];
    const raw = body[field];
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      errors[field] = `${rule.label} must be text.`;
      continue;
    }
    // Single-line fields collapse runs of whitespace; descriptions keep their line breaks.
    let value = field === 'description' ? (raw ?? '').trim() : (raw ?? '').trim().replace(/\s+/g, ' ');
    if (field === 'code') value = value.toUpperCase();
    if (!value) {
      if (rule.required) errors[field] = `${rule.label} is required.`;
      else values[field] = null;
      continue;
    }
    if (value.length > rule.max) errors[field] = `${rule.label} must be at most ${rule.max} characters.`;
    else if (rule.min && value.length < rule.min) errors[field] = `${rule.label} must be at least ${rule.min} characters.`;
    else {
      const problem = checkFormat(field, value);
      if (problem) errors[field] = problem;
      else values[field] = field === 'email' ? value.toLowerCase() : value;
    }
  }
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return values;
}

/** Registration: every field (required ones must be present). */
export const readRegistration = (body) => readFields(body, Object.keys(FIELDS), { partial: false });

/** Edit: any subset of the editable fields (never the code); at least one field. */
export function readUpdate(body) {
  const values = readFields(body, EDITABLE, { partial: true });
  if (!Object.keys(values).length) throw badRequest('Send at least one field to change.');
  return values;
}

/** Suspension reason: required, 3–500 characters. */
export function readSuspension(body) {
  const keys = Object.keys(body);
  if (keys.some((k) => k !== 'reason')) throw badRequest(`Unknown fields: ${keys.filter((k) => k !== 'reason').join(', ')}.`);
  const reason = typeof body.reason === 'string' ? body.reason.trim().replace(/\s+/g, ' ') : '';
  if (!reason) throw badRequest('A reason is required to suspend a school.', { reason: 'Enter the reason for suspending this school.' });
  if (reason.length < 3 || reason.length > 500) throw badRequest('The reason must be 3–500 characters.', { reason: 'The reason must be 3–500 characters.' });
  return reason;
}

/** The suggested code for a school name: initials (2–4 letters; first three letters for one word). */
export function codePrefix(name) {
  const words = (name ?? '')
    .normalize('NFKD')
    .replace(/[^A-Za-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const prefix = words.length === 1 ? words[0].slice(0, 3) : words.slice(0, 4).map((w) => w[0]).join('');
  const upper = prefix.toUpperCase();
  return upper.length >= 2 ? upper : 'SCH';
}

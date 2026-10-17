// Client-side checks for the school form, mirroring the API's rules (backend/src/features/schools/
// schoolInput.js) so problems show immediately. The API validates again and has the final say.

const CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?\d(?:[ -]?\d)+$/;

export const SCHOOL_FIELDS = {
  name: { label: 'School name', required: true, max: 120 },
  code: { label: 'School code', required: true, min: 3, max: 20 },
  phone: { label: 'Phone', required: true, max: 24 },
  email: { label: 'Email', required: false, max: 254 },
  address: { label: 'Address', required: true, max: 200 },
  city: { label: 'City', required: true, max: 80 },
  website: { label: 'Website', required: false, max: 200 },
  description: { label: 'Description', required: false, max: 1000 },
};

function problem(field, value) {
  const rule = SCHOOL_FIELDS[field];
  if (!value) return rule.required ? `${rule.label} is required.` : null;
  if (value.length > rule.max) return `${rule.label} must be at most ${rule.max} characters.`;
  if (rule.min && value.length < rule.min) return `${rule.label} must be at least ${rule.min} characters.`;
  if (field === 'code' && !CODE_PATTERN.test(value)) return 'Use uppercase letters, digits and single hyphens, e.g. JHA-001.';
  if (field === 'email' && !EMAIL_PATTERN.test(value)) return 'Enter a valid email address.';
  if (field === 'phone') {
    const digits = value.replace(/\D/g, '').length;
    if (!PHONE_PATTERN.test(value) || digits < 7 || digits > 15) return 'Enter a valid phone number, e.g. +252 61 2345678.';
  }
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

/** Trimmed values ready to send (the code uppercased). */
export function cleanSchoolValues(values, fields) {
  return Object.fromEntries(
    fields.map((field) => {
      const raw = values[field] ?? '';
      const value = field === 'description' ? raw.trim() : raw.trim().replace(/\s+/g, ' ');
      return [field, field === 'code' ? value.toUpperCase() : value];
    }),
  );
}

/** { field: message } for every invalid field (empty when all are valid). */
export function validateSchool(values, fields) {
  return Object.fromEntries(fields.map((field) => [field, problem(field, values[field])]).filter(([, message]) => message));
}

/** Suspension reason: required, 3–500 characters. */
export function validateReason(reason) {
  const value = reason.trim();
  if (!value) return 'Enter the reason for suspending this school.';
  if (value.length < 3 || value.length > 500) return 'The reason must be 3–500 characters.';
  return null;
}

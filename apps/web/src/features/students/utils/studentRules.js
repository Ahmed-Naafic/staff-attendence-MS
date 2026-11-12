// Student rules in the web app (immediate feedback; the API checks again).
// Rules: docs/business-rules.md → Students; Student enrollment; Academic year promotion.

export const STUDENT_STATUS = {
  pending_enrollment: { label: 'Pending enrollment', variant: 'warning' },
  enrolled: { label: 'Enrolled', variant: 'success' },
  transferred_out: { label: 'Transferred out', variant: 'neutral' },
  graduated: { label: 'Graduated', variant: 'info' },
};

export const ENROLLMENT_STATUS = {
  active: { label: 'Active', variant: 'success' },
  completed: { label: 'Completed', variant: 'neutral' },
  transferred_out: { label: 'Transferred out', variant: 'neutral' },
  graduated: { label: 'Graduated', variant: 'info' },
};
export const ENTRY = { new: 'New enrollment', promoted: 'Promoted', repeated: 'Repeating' };
export const RESULT = { passed: 'Passed', failed: 'Failed' };

export const DECISION = {
  PROMOTE: { label: 'Promote', variant: 'success' },
  REPEAT: { label: 'Repeat', variant: 'warning' },
  TRANSFER_OUT: { label: 'Transfer out', variant: 'neutral' },
  GRADUATE: { label: 'Graduate', variant: 'info' },
  PENDING: { label: 'Pending review', variant: 'error' },
};
export const ITEM_STATUS = {
  draft: { label: 'Not confirmed', variant: 'neutral' },
  waiting: { label: 'Waiting', variant: 'info' },
  done: { label: 'Done', variant: 'success' },
  failed: { label: 'Failed', variant: 'error' },
  excluded: { label: 'Excluded (review)', variant: 'warning' },
};

const PHONE = /^\+?\d[\d -]{5,20}\d$/;
const clean = (value) => (value ?? '').trim().replace(/\s+/g, ' ');
const digits = (value) => value.replace(/\D/g, '').length;

/** Today on this device, 'YYYY-MM-DD'. */
export function today(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export const EMPTY_PROFILE = {
  firstName: '',
  middleName: '',
  lastName: '',
  gender: '',
  dateOfBirth: '',
  phone: '',
  address: '',
  guardianName: '',
  guardianPhone: '',
  guardianRelationship: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
};
export const PROFILE_FIELDS = Object.keys(EMPTY_PROFILE);

/** The values the API takes: trimmed text, empty optional fields as null, gender in capitals. */
export function cleanProfile(values) {
  const out = {};
  for (const field of PROFILE_FIELDS) {
    const value = field === 'gender' ? (values.gender || '').toUpperCase() : clean(values[field]);
    out[field] = value === '' && !['firstName', 'lastName', 'gender', 'dateOfBirth', 'guardianName', 'guardianPhone'].includes(field) ? null : value;
  }
  return out;
}

/** { field: message } for a profile form. */
export function validateProfile(values, { now = today() } = {}) {
  const v = cleanProfile(values);
  const problems = {};
  const required = { firstName: 'First name', lastName: 'Last name', guardianName: 'Guardian name', guardianPhone: 'Guardian phone' };
  for (const [field, label] of Object.entries(required)) if (!v[field]) problems[field] = `${label} is required.`;
  for (const [field, max] of Object.entries({ firstName: 60, middleName: 60, lastName: 60, address: 200, guardianName: 120, guardianRelationship: 40, emergencyContactName: 120 })) {
    if (v[field] && v[field].length > max) problems[field] = `At most ${max} characters.`;
  }
  if (!['MALE', 'FEMALE'].includes(v.gender)) problems.gender = 'Choose Male or Female.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.dateOfBirth ?? '')) problems.dateOfBirth = 'Date of birth is required.';
  else if (v.dateOfBirth > now) problems.dateOfBirth = 'Date of birth cannot be in the future.';
  for (const field of ['phone', 'guardianPhone', 'emergencyContactPhone']) {
    if (v[field] && (!PHONE.test(v[field]) || digits(v[field]) < 7 || digits(v[field]) > 15)) problems[field] = 'Enter a valid phone number, e.g. +252 61 2345678.';
  }
  return problems;
}

/** The decisions a student can be given, and whether each needs a destination section. */
export const needsTarget = (decision) => decision === 'PROMOTE' || decision === 'REPEAT';

/**
 * The change for a group of review rows set to `decision`: each row takes its own suggested destination
 * (same section name in the next class, or the same class) — never another section.
 */
export function groupChange(rows, decision) {
  return rows.map((row) => ({ id: row.id, decision, targetSectionId: needsTarget(decision) ? (row.suggestions[decision] ?? null) : null }));
}

/** The sections a row may go to for a decision: later classes for PROMOTE, the same class for REPEAT. */
export function targetChoices(targets, row, decision) {
  if (decision === 'PROMOTE') return targets.filter((t) => t.classSequence > row.from.classSequence);
  if (decision === 'REPEAT') return targets.filter((t) => t.classSequence === row.from.classSequence);
  return [];
}

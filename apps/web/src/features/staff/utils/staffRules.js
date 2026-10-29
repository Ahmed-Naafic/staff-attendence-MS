// Client-side checks for staff accounts and shift assignments, mirroring the API (backend/src/
// features/staff/staffInput.js and staff.service.js) so problems show immediately. The API checks
// again and has the final say (phone and email uniqueness, the schedule on the effective date).

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+?\d(?:[ -]?\d)+$/;

export const PAGE_SIZE = 8;
export const STAFF_FIELDS = {
  name: { label: 'Full name', min: 2, max: 120, required: true },
  phone: { label: 'Phone', max: 24, required: true },
  jobTitle: { label: 'Job title', min: 2, max: 80, required: true },
  email: { label: 'Email', max: 254, required: false },
};

/** Job titles offered in the staff form; "Other" asks for the title (the API accepts any 2–80 characters). */
export const JOB_TITLES = ['Teacher', 'Accountant'];
export const OTHER_JOB_TITLE = 'other';

/** A saved job title → the form's { jobTitleChoice, jobTitleOther }; a title not in the list is "Other". */
export function jobTitleFields(title) {
  const value = (title ?? '').trim();
  const match = JOB_TITLES.find((t) => t.toLowerCase() === value.toLowerCase());
  if (match) return { jobTitleChoice: match, jobTitleOther: '' };
  return value ? { jobTitleChoice: OTHER_JOB_TITLE, jobTitleOther: value } : { jobTitleChoice: '', jobTitleOther: '' };
}

/** The form's job title fields → the job title to save ('' when none is chosen or typed). */
export const jobTitleFrom = ({ jobTitleChoice, jobTitleOther }) => (jobTitleChoice === OTHER_JOB_TITLE ? jobTitleOther ?? '' : jobTitleChoice ?? '');

/** Trimmed, with runs of whitespace collapsed (as the server stores it); email lower-case. */
export function cleanStaffValues(values, fields) {
  return Object.fromEntries(
    fields.map((field) => {
      const value = (values[field] ?? '').trim().replace(/\s+/g, ' ');
      return [field, field === 'email' ? value.toLowerCase() : value];
    }),
  );
}

function problem(field, value) {
  const rule = STAFF_FIELDS[field];
  if (!value) return rule.required ? `${rule.label} is required.` : null;
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
export function validateStaff(values, fields) {
  return Object.fromEntries(fields.map((field) => [field, problem(field, values[field])]).filter(([, message]) => message));
}

/** Suspension reason: required, 3–500 characters. */
export function validateReason(reason) {
  const value = (reason ?? '').trim().replace(/\s+/g, ' ');
  if (!value) return 'Enter the reason for suspending this staff member.';
  if (value.length < 3 || value.length > 500) return 'The reason must be 3–500 characters.';
  return null;
}

/**
 * The branch shifts that apply on an effective date: the scheduled schedule's from its start date,
 * otherwise the current one's. `branchShifts` is { current, scheduled } from the API (each
 * { effectiveFrom, shifts } or null). Returns { effectiveFrom, shifts } or null.
 */
export function shiftsOn(branchShifts, date) {
  const { current, scheduled } = branchShifts ?? {};
  if (scheduled && date >= scheduled.effectiveFrom) return scheduled;
  if (current && date >= current.effectiveFrom) return current;
  return null;
}

/** Ticked days per shift key → the request's shifts (only shifts with at least one day). */
export const toRequestAssignments = (picked) =>
  Object.entries(picked)
    .filter(([, days]) => days.length)
    .map(([shiftKey, days]) => ({ shiftKey, days }));

/** Problems for an assignment change: { effectiveFrom? }. */
export function validateAssignments({ effectiveFrom, picked, schedule }, { earliest, latest }) {
  const errors = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom ?? '')) errors.effectiveFrom = 'Choose the date the assignments take effect.';
  else if (effectiveFrom < earliest) errors.effectiveFrom = `Choose ${earliest} or later.`;
  else if (effectiveFrom > latest) errors.effectiveFrom = `Choose ${latest} or earlier (at most one year ahead).`;
  else if (!schedule && toRequestAssignments(picked).length) errors.effectiveFrom = 'Your branch has no schedule in effect on that date. Set the schedule first.';
  return errors;
}

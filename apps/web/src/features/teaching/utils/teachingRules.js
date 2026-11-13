// Subject and teaching assignment rules in the web app (feedback and which actions to offer; the
// API checks again). Rules: docs/business-rules.md → Subjects; Teaching assignments.

export const SUBJECT_NAME_MAX = 60;
export const SUBJECT_CODE_MAX = 12;
export const DESCRIPTION_MAX = 300;
export const WEEKLY_LESSONS_MAX = 40;

export const ASSIGNMENT_STATES = {
  scheduled: { label: 'Scheduled', variant: 'info' },
  active: { label: 'Teaching', variant: 'success' },
  ended: { label: 'Ended', variant: 'neutral' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
};
export const ROLE_LABELS = { subject: 'Subject teacher', class: 'Class teacher' };

export const clean = (value) => (value ?? '').trim().replace(/\s+/g, ' ');
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** { field: message } for a subject form. */
export function validateSubject({ name, code, description }) {
  const problems = {};
  const n = clean(name);
  if (!n) problems.name = 'Subject name is required, e.g. Mathematics.';
  else if (n.length > SUBJECT_NAME_MAX) problems.name = `Subject name must be at most ${SUBJECT_NAME_MAX} characters.`;
  const c = clean(code).toUpperCase();
  if (c && c.length > SUBJECT_CODE_MAX) problems.code = `Code must be at most ${SUBJECT_CODE_MAX} characters.`;
  else if (c && !/^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/.test(c)) problems.code = 'Use letters and digits, e.g. MATH or ENG-1.';
  if (clean(description).length > DESCRIPTION_MAX) problems.description = `Description must be at most ${DESCRIPTION_MAX} characters.`;
  return problems;
}

/** Lessons per week as typed → a number, null (empty) or NaN (invalid). */
export function weeklyLessons(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const n = /^\d+$/.test(text) ? Number(text) : Number.NaN;
  return n >= 1 && n <= WEEKLY_LESSONS_MAX ? n : Number.NaN;
}

/** { field: message } for a new assignment ({ role, teacher, subject, startDate, endDate } as chosen). */
export function validateAssignment({ role, teacher, subject, startDate, endDate }, { earliest, yearEnd }) {
  const problems = {};
  if (!teacher) problems.teacher = 'Choose a teacher.';
  if (role === 'subject' && !subject) problems.subject = 'Choose a subject.';
  if (!startDate) problems.startDate = 'Choose the first day.';
  else if (startDate < earliest) problems.startDate = `Teaching starts on ${earliest} at the earliest.`;
  else if (startDate > yearEnd) problems.startDate = `Choose a date in the year (up to ${yearEnd}).`;
  if (endDate && startDate && endDate < startDate) problems.endDate = 'The last day cannot be before the first.';
  else if (endDate && endDate > yearEnd) problems.endDate = `Choose a date in the year (up to ${yearEnd}).`;
  return problems;
}

/**
 * What can be done with an assignment, given the first editable day (today): days before it are fixed.
 *   cancel  it has not started (or starts today)
 *   end     it is running: set its last day (from the day before the first editable day)
 */
export function assignmentActions(a, firstEditable, { writable }) {
  if (!writable || !a.canManage || a.state === 'cancelled') return { cancel: false, end: false };
  if (a.startDate >= firstEditable) return { cancel: true, end: true };
  const ended = a.endDate && a.endDate < firstEditable;
  return { cancel: false, end: !ended };
}

/** Earliest last day that can be chosen for a running assignment. */
export const earliestLastDay = (a, firstEditable) => {
  const day = addDays(firstEditable, -1);
  return day < a.startDate ? a.startDate : day;
};

/** "2026-11-13 → 2027-06-30" or "from 2026-11-13". */
export const periodText = (a) => (a.endDate ? `${a.startDate} → ${a.endDate}` : `from ${a.startDate}`);

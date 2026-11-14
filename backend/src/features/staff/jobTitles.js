/*
 * Staff job titles (docs/business-rules.md → Staff accounts → Job title). A job title describes the
 * staff member's work; it is not a system role and grants nothing (teaching permissions come from
 * teaching assignments only).
 *
 * The staff form offers these standard titles; "Other" keeps any 2–80 character title, so titles
 * typed before the list existed stay valid. A title matching a standard one (ignoring case and
 * spacing) is saved in the standard spelling, so lists and filters group them together.
 *
 * Teaching titles (Teacher, Head Teacher, …) put a staff member on the Teaching page's teacher list.
 * Free-text titles that name teaching ("Math Teacher", Somali "Macallin" / "Bare") count too.
 * apps/web/src/features/staff/utils/staffRules.js mirrors this list.
 */

export const TEACHING_JOB_TITLES = ['Teacher', 'Head Teacher', 'Deputy Head Teacher'];
export const JOB_TITLES = [
  ...TEACHING_JOB_TITLES,
  'Accountant',
  'Cashier',
  'Secretary',
  'Administrator',
  'Librarian',
  'Lab Technician',
  'IT Officer',
  'Counselor',
  'Nurse',
  'Driver',
  'Security Guard',
  'Cleaner',
  'Cook',
];

/** Words in a free-text title that mean teaching (also matched by the database filter below). */
export const TEACHING_WORDS = ['teach', 'macallin', 'bare'];

const key = (title) => String(title ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const STANDARD = new Map(JOB_TITLES.map((t) => [key(t), t]));

/** The standard spelling of a standard title; any other title unchanged. */
export const canonicalJobTitle = (title) => STANDARD.get(key(title)) ?? title;

/** Whether a job title is a teaching one. */
export const isTeachingTitle = (title) => {
  const k = key(title);
  return Boolean(k) && TEACHING_WORDS.some((w) => k.includes(w));
};

/** Prisma filter: staff whose job title is a teaching one (the same rule as isTeachingTitle). */
export const teachingTitleWhere = () => ({ OR: TEACHING_WORDS.map((w) => ({ jobTitle: { contains: w, mode: 'insensitive' } })) });

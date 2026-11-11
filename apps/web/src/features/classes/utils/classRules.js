// Class and section rules in the web app (immediate feedback; the API checks again).
// Rules: docs/business-rules.md → Classes and sections.

export const CLASS_NAME_MAX = 60;
export const DESCRIPTION_MAX = 300;
export const SEQUENCE_MAX = 100;
export const SECTION_NAME_MAX = 20;
export const ROOM_MAX = 60;
export const CAPACITY_MAX = 1000;

export const clean = (value) => (value ?? '').trim().replace(/\s+/g, ' ');

/** A whole number from a text input, or null when empty; NaN when not a whole number. */
export function wholeNumber(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  return /^\d+$/.test(text) ? Number(text) : Number.NaN;
}

/** { field: message } for a class form ({ name, description, sequence } as typed). */
export function validateClass({ name, description, sequence }) {
  const problems = {};
  const n = clean(name);
  if (!n) problems.name = 'Class name is required, e.g. Grade 7.';
  else if (n.length > CLASS_NAME_MAX) problems.name = `Class name must be at most ${CLASS_NAME_MAX} characters.`;
  if (clean(description).length > DESCRIPTION_MAX) problems.description = `Description must be at most ${DESCRIPTION_MAX} characters.`;
  const order = wholeNumber(sequence);
  if (order === null) problems.sequence = 'Order is required: 1 for the first class, 2 for the next, and so on.';
  else if (!(order >= 1 && order <= SEQUENCE_MAX)) problems.sequence = `Order must be a whole number from 1 to ${SEQUENCE_MAX}.`;
  return problems;
}

/** { field: message } for a section form ({ name, capacity, room } as typed; classId, academicYearId, branchId when creating). */
export function validateSection({ name, capacity, room, classId, academicYearId, branchId }, { creating, needsBranch }) {
  const problems = {};
  if (creating && !classId) problems.classId = 'Choose a class.';
  if (creating && !academicYearId) problems.academicYearId = 'Choose an academic year.';
  if (creating && needsBranch && !branchId) problems.branchId = 'Choose a branch.';
  const n = clean(name);
  if (!n) problems.name = 'Section name is required, e.g. A.';
  else if (n.length > SECTION_NAME_MAX) problems.name = `Section name must be at most ${SECTION_NAME_MAX} characters.`;
  const cap = wholeNumber(capacity);
  if (cap !== null && !(cap >= 1 && cap <= CAPACITY_MAX)) problems.capacity = `Capacity must be a whole number from 1 to ${CAPACITY_MAX}, or empty.`;
  if (clean(room).length > ROOM_MAX) problems.room = `Room must be at most ${ROOM_MAX} characters.`;
  return problems;
}

/** "Grade 7" + "A" → "Grade 7A"; longer section names get a space ("Grade 7 Blue"), as the server shows them. */
export const sectionDisplayName = (className, sectionName) =>
  /^[\p{L}\p{N}]{1,2}$/u.test(sectionName) ? `${className}${sectionName}` : `${className} ${sectionName}`;

/** The academic year a page starts with: the URL's (if known), else the current one, else the newest. */
export function pickYear(years, wanted) {
  return years.find((y) => y.id === wanted) ?? years.find((y) => y.status === 'current') ?? years[0] ?? null;
}

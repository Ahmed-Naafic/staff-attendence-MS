/*
 * The steps of building a timetable, in order (School Schedule → Timetable), in five groups. Each
 * step shows one of the app's own pages or parts (or a grid made for this page); this list only
 * orders and explains them. The keys match the server's progress (GET …/timetable-builder/progress).
 * docs: EduTrack-Timetable-Guide.pdf → "Steps to build a timetable".
 */
export const TIMETABLE_STEPS = [
  { key: 'year', group: 'Calendar', label: 'Academic Year', what: 'Create the academic year and make it current. Everything below belongs to it.', who: 'School Owner' },
  { key: 'school-days', group: 'Calendar', label: 'School Days', what: 'Choose the days students come (e.g. Sat–Wed), and add holidays and closures.', who: 'School Owner; a Manager for their branch when allowed' },
  { key: 'bell-times', group: 'Calendar', label: 'Periods & Times', what: 'Make a bell schedule: the lesson periods and breaks of a school day, with their times.', who: 'Manager for their branch; School Owner for the whole school' },
  { key: 'subjects', group: 'Curriculum', label: 'Subjects', what: 'Add the subjects taught in the school (Maths, English…).', who: 'School Owner' },
  { key: 'classes', group: 'Curriculum', label: 'Classes & Sections', what: 'Add the classes (Grade 7) and their sections in this branch (7A, 7B).', who: 'School Owner (classes); Manager (their branch’s sections)' },
  { key: 'lessons', group: 'Curriculum', label: 'Lessons per Week', what: 'Type each class’s lessons a week per subject. A class’s total must equal its lesson periods.', who: 'School Owner and Managers (one list for the class in every branch)' },
  { key: 'teachers', group: 'Staff', label: 'Teachers', what: 'The teachers who can be given subjects: staff with a teacher job title. Register a teacher here if one is missing.', who: 'Manager for their branch' },
  { key: 'assign', group: 'Staff', label: 'Assign Teachers', what: 'Choose a teacher for every subject of every section.', who: 'Manager for their staff; School Owner for any staff' },
  { key: 'limits', group: 'Staff', label: 'Teacher Limits', what: 'Optional: most lessons a teacher teaches a day or week, and times they cannot teach.', who: 'Manager for their staff; School Owner for any' },
  { key: 'rules', group: 'Build', label: 'Rules', what: 'How the timetable is generated, and which bell schedule each class uses.', who: 'Manager for their branch; School Owner for any branch' },
  { key: 'fixed', group: 'Build', label: 'Fixed Lessons', what: 'Optional: lessons that must be at an exact day and period.', who: 'Manager for their branch; School Owner for any branch' },
  { key: 'readiness', group: 'Build', label: 'Readiness', what: 'Everything checked before generating. Fix each item with its buttons.', who: 'Manager for their branch; School Owner for any branch' },
  { key: 'generate', group: 'Build', label: 'Generate & Review', what: 'Generate the draft, then review it: move, lock or reassign lessons. Nobody else sees it yet.', who: 'Manager for their branch; School Owner for any branch' },
  { key: 'publish', group: 'Build', label: 'Publish', what: 'Publish the draft from a first day: every class at once, or none.', who: 'Manager for their branch; School Owner for any branch' },
  { key: 'view', group: 'Result', label: 'View & Print', what: 'Class, teacher and master timetables for any date; Excel and PDF.', who: 'School Owner and Manager' },
];

export const DEFAULT_STEP = TIMETABLE_STEPS[0].key;

/** The step for a URL value (unknown → the first), with its number and neighbours. */
export function stepOf(key) {
  const index = Math.max(0, TIMETABLE_STEPS.findIndex((s) => s.key === key));
  return { ...TIMETABLE_STEPS[index], number: index + 1, previous: TIMETABLE_STEPS[index - 1] ?? null, next: TIMETABLE_STEPS[index + 1] ?? null };
}

/** The Timetable Builder's tabs → the steps that show them (for its "Open …" links). */
export const BUILDER_TAB_STEP = { readiness: 'readiness', rules: 'rules', setup: 'rules', teachers: 'limits', fixed: 'fixed', draft: 'generate' };

/** The mark on a step's tab for its progress state. */
export const STATE_MARK = { done: '✓', attention: '!', todo: '○', optional: '·' };

/** Only the shared choices travel between steps (each page's own filters and tabs stay behind). */
export function sharedSearch(search) {
  const from = new URLSearchParams(search);
  const next = new URLSearchParams();
  for (const k of ['year', 'branch']) if (from.get(k)) next.set(k, from.get(k));
  const text = next.toString();
  return text ? `?${text}` : '';
}

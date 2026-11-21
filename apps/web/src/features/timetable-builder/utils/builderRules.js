// Pure helpers of the timetable builder and views (grids, readiness links, teacher limits).

export const DAY_SHORT = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };
export const DAY_NAMES = { MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday', SUN: 'Sunday' };
export const WEEKDAY_ORDER = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'];

/** Where each readiness problem is fixed: a page, or a tab of the builder. */
export const FIX_LINKS = {
  subjects: { to: '/subjects', label: 'Open Subjects' },
  teaching: { to: '/teaching', label: 'Open Teaching' },
  'bell-schedules': { to: '/bell-schedules', label: 'Open Bell Schedules' },
  'academic-calendar': { to: '/academic-calendar', label: 'Open Academic Calendar' },
  'academic-years': { to: '/academic-years', label: 'Open Academic Years' },
  classes: { to: '/classes', label: 'Open Classes' },
  timetables: { to: '/timetables', label: 'Open Timetables' },
  setup: { tab: 'rules', label: 'Open Rules' },
  teachers: { tab: 'teachers', label: 'Open Teachers' },
  fixed: { tab: 'fixed', label: 'Open Fixed lessons' },
};

/**
 * Every way to fix one readiness item, as its message lists them: [{ to, label } (a page) or
 * { tab, label } (a builder tab)]. A class's lessons per week are on its class page (the link opens
 * its Subjects with the editor open; the list is the class's in every branch); a class with more
 * lessons than periods can also get school days (Academic Calendar) or periods (Bell Schedules),
 * which Managers can change for their branch.
 */
export function fixLinks(item, role) {
  if (item.fix === 'class-subjects' && item.classId) {
    const name = item.className ?? 'the class';
    const links = [{ to: `/classes/${item.classId}?subjects=edit`, label: `Edit ${name}’s lessons per week` }];
    if (item.code === 'SECTION_OVERLOAD') links.push({ to: '/academic-calendar', label: 'Add school days' }, { to: '/bell-schedules', label: 'Add bell periods' });
    if (item.code === 'SECTION_UNDERFILLED') links.push({ to: '/bell-schedules', label: 'Shorten the bell schedule' });
    return links;
  }
  return FIX_LINKS[item.fix] ? [FIX_LINKS[item.fix]] : [];
}

/** The first way to fix a readiness item, or null. */
export const fixLink = (item, role) => fixLinks(item, role)[0] ?? null;

export const lessonAt = (lessons, weekday, period) => lessons.find((l) => l.weekday === weekday && l.period === period) ?? null;

/** A class's grid: rows of period numbers (times from the first day that has them) × days. */
export function classRows(periods, days) {
  const rows = new Map();
  for (const day of days) {
    for (const p of periods[day] ?? []) {
      if (p.kind && p.kind !== 'lesson') continue;
      if (!rows.has(p.number)) rows.set(p.number, { number: p.number, start: p.start, end: p.end, days: new Set() });
      rows.get(p.number).days.add(day);
    }
  }
  return [...rows.values()].sort((a, b) => a.number - b.number);
}

/** The lesson period numbers of a day across classes (master grid columns). */
export const masterColumns = (sections, day) =>
  [...new Set(sections.flatMap((s) => (s.periods[day] ?? []).filter((p) => !p.kind || p.kind === 'lesson').map((p) => p.number)))].sort((a, b) => a - b);

/** Days in the school's order (Saturday first, as the calendar shows them). */
export const orderDays = (days) => [...days].sort((a, b) => WEEKDAY_ORDER.indexOf(a) - WEEKDAY_ORDER.indexOf(b));

/** A teacher's grid: their lessons by clock time (rows) × days. */
export function teacherCells(view) {
  const cells = new Map();
  for (const l of view.lessons) cells.set(`${l.weekday}|${l.start}`, [...(cells.get(`${l.weekday}|${l.start}`) ?? []), l]);
  return cells;
}

/**
 * A clearly different hue for each subject of a timetable: subjects in name order, spaced by the
 * golden angle around the colour wheel (no two neighbours alike, however many subjects). → Map id → hue.
 */
export function subjectHues(lessons) {
  const subjects = new Map();
  for (const l of lessons ?? []) if (l.subject) subjects.set(l.subject.id, l.subject.name ?? '');
  const ordered = [...subjects.entries()].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]));
  return new Map(ordered.map(([id], i) => [id, Math.round((i * 137.508 + 200) % 360)]));
}

/** Background of a lesson cell (lightness and saturation come from the theme: index.css --subject-*). */
export const subjectStyle = (hue) => (hue == null ? undefined : { backgroundColor: `hsl(${hue} var(--subject-s) var(--subject-l))` });

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Unavailable rows [{ weekday, start, end }] → { errors: { 'n': message }, rows (clean) }. */
export function checkUnavailable(rows) {
  const errors = {};
  rows.forEach((r, i) => {
    if (!r.weekday) errors[i] = 'Choose a day.';
    else if (!TIME.test(r.start ?? '') || !TIME.test(r.end ?? '')) errors[i] = 'Times like 08:00.';
    else if (r.end <= r.start) errors[i] = 'The end must be after the start.';
  });
  return { errors, rows: rows.map((r) => ({ weekday: r.weekday, start: r.start, end: r.end })) };
}

/** A number field of the limits form: '' → null, else a whole number in range (NaN when not). */
export function limitValue(text, { min, max }) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isInteger(n) && n >= min && n <= max ? n : Number.NaN;
}

/** "12 of 30" with a tone: over capacity is an error, above 85% a warning. */
export function loadTone({ lessons, capacity }) {
  if (lessons > capacity) return 'error';
  if (capacity && lessons / capacity > 0.85) return 'warning';
  return 'success';
}

/**
 * Gaps of a published timetable on today's school days (master or class view) → null, or
 * { classes: ['Grade 7A', …], empty, offDay, offDays: ['THU'] }. Happens when a timetable was
 * published before the school days, bell schedule or lessons per week changed.
 */
export function timetableGaps(view) {
  if (!view || view.source === 'draft') return null;
  const list = view.kind === 'master' ? view.sections.map((s) => ({ name: s.displayName, gaps: s.gaps })) : view.kind === 'section' ? [{ name: view.section.displayName, gaps: view.gaps }] : [];
  const hit = list.filter((x) => x.gaps && (x.gaps.empty || x.gaps.offDay));
  if (!hit.length) return null;
  return {
    classes: hit.map((x) => x.name),
    empty: hit.reduce((n, x) => n + x.gaps.empty, 0),
    offDay: hit.reduce((n, x) => n + x.gaps.offDay, 0),
    offDays: orderDays([...new Set(hit.flatMap((x) => x.gaps.offDays ?? []))]),
  };
}

/**
 * What to say about a timetable waiting to start (view.nextStart) → null, or { kind, date }:
 * 'missing' when some classes (or the class) have no timetable on the date shown, else 'upcoming'.
 */
export function upcomingTimetable(view) {
  if (!view?.nextStart || view.source === 'draft') return null;
  const missing = view.kind === 'master' ? view.sections.some((s) => !s.lessons.length) : view.kind === 'section' ? !view.lessons.length : false;
  return { kind: missing ? 'missing' : 'upcoming', date: view.nextStart };
}

export const unplacedTotal = (draft) => (draft?.unplaced ?? []).reduce((n, u) => n + u.count, 0);

/**
 * The fixes a readiness item can get right here, in the builder (buttons that open the forms):
 * 'bell-choice' (which bell schedule the class uses), 'bell-times' (its lesson periods), 'lessons'
 * (the class's subjects and lessons per week), 'school-days', 'assign' (a teacher for a subject).
 * Who may use each is checked when it opens (and again by the API).
 */
export function fixActions(item) {
  switch (item.code) {
    case 'SECTION_OVERLOAD':
      return ['bell-choice', 'bell-times', 'lessons', 'school-days'];
    case 'SECTION_UNDERFILLED':
      return ['bell-choice', 'bell-times', 'lessons'];
    case 'SECTION_NO_BELL':
    case 'BELL_INACTIVE':
      return ['bell-choice'];
    case 'BELL_NO_TIMES':
    case 'BELL_NO_LESSONS':
      return item.sectionId ? ['bell-times', 'bell-choice'] : [];
    case 'CLASS_NO_SUBJECTS':
    case 'SUBJECT_NO_WEEKLY':
      return ['lessons'];
    case 'SUBJECT_NO_TEACHER':
      return item.sectionId ? ['assign'] : [];
    case 'NO_WEEKDAYS':
      return ['school-days'];
    default:
      return [];
  }
}

/** Lesson periods a week a bell schedule gives on the school days (bell: { lessonsByDay }). */
export const bellPeriods = (bell, weekdays = []) => weekdays.reduce((n, d) => n + (bell?.lessonsByDay?.[d] ?? 0), 0);

// ---- the Timetable page's grids ------------------------------------------------------------------

/** A class's lesson periods a week in this branch, from its sections (builder.sections): { min, max } or null. */
export function classPeriods(sections, classId) {
  const list = (sections ?? []).filter((s) => s.class.id === classId && !s.excluded && s.lessonPeriods > 0).map((s) => s.lessonPeriods);
  return list.length ? { min: Math.min(...list), max: Math.max(...list) } : null;
}

/** "35" or "30–35". */
export const periodsText = (p) => (!p ? '—' : p.min === p.max ? String(p.min) : `${p.min}–${p.max}`);

/** How a class's lessons a week compare with its periods: 'fit' | 'over' | 'under' | 'unknown', and by how many. */
export function lessonsFit(total, periods) {
  if (!periods) return { state: 'unknown', by: 0 };
  if (total > periods.max) return { state: 'over', by: total - periods.max };
  if (total < periods.min) return { state: 'under', by: periods.min - total };
  return { state: 'fit', by: 0 };
}

/**
 * The lessons grid's row → the class's list to save: cells { subjectId: '5' | '' } with `listed`
 * (subjects already on the list). A typed number puts the subject on the list; an empty cell keeps
 * a listed subject (without lessons per week) and leaves an unlisted one off. → [{ subject, weeklyLessons }]
 * or { error } for a number outside 1–40.
 */
export function lessonsRowItems(cells, listed) {
  const items = [];
  for (const [subject, raw] of Object.entries(cells)) {
    const text = String(raw ?? '').trim();
    if (!text) {
      if (listed.includes(subject)) items.push({ subject, weeklyLessons: null });
      continue;
    }
    const n = /^\d+$/.test(text) ? Number(text) : NaN;
    if (!(n >= 1 && n <= 40)) return { error: 'Lessons per week: a whole number from 1 to 40.' };
    items.push({ subject, weeklyLessons: n });
  }
  return items;
}

export const rowTotal = (cells) => Object.values(cells).reduce((n, v) => n + (/^\d+$/.test(String(v ?? '').trim()) ? Number(v) : 0), 0);

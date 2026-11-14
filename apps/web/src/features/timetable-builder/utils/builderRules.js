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
 * The link of one readiness item: { to, label } (a page) or { tab, label } (a builder tab), or null.
 * A class's lessons per week live on its class page, which only the School Owner can change.
 */
export function fixLink(item, role) {
  if (item.fix === 'class-subjects' && item.classId) {
    const name = item.className ?? 'the class';
    return { to: `/classes/${item.classId}`, label: role === 'OWNER' ? `Edit ${name}’s subjects` : `View ${name}’s subjects (School Owner edits)` };
  }
  return FIX_LINKS[item.fix] ?? null;
}

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

export const unplacedTotal = (draft) => (draft?.unplaced ?? []).reduce((n, u) => n + u.count, 0);

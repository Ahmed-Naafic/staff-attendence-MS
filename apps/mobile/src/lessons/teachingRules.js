/*
 * The teacher's classes and subjects (GET /api/teacher/teaching): their live teaching assignments,
 * grouped by class, with the lessons a week and how many are in the published timetable.
 */

const STATE_ORDER = { active: 0, scheduled: 1 };

/** [{ key, title, branch, data: assignments }] by class (then branch), class teacher first, then subjects A–Z. */
export function teachingSections(view) {
  const groups = new Map();
  for (const a of view?.items ?? []) {
    const key = `${a.academicYear?.id ?? ''}|${a.section.id}`;
    if (!groups.has(key)) groups.set(key, { key, title: a.section.displayName, branch: a.branch?.name ?? '', year: a.academicYear, data: [] });
    groups.get(key).data.push(a);
  }
  const sections = [...groups.values()];
  for (const s of sections) {
    s.data.sort((x, y) => (x.role === 'class' ? -1 : 0) - (y.role === 'class' ? -1 : 0) || (x.subject?.name ?? '').localeCompare(y.subject?.name ?? '') || (STATE_ORDER[x.state] ?? 2) - (STATE_ORDER[y.state] ?? 2));
  }
  // Current year before a planned one, then by class name (numbers in order: Grade 2 before Grade 10).
  const yearRank = (s) => (s.year?.status === 'current' ? 0 : 1);
  return sections.sort((x, y) => yearRank(x) - yearRank(y) || x.title.localeCompare(y.title, undefined, { numeric: true }) || x.branch.localeCompare(y.branch));
}

/** "Mathematics" or "Class teacher". */
export const assignmentTitle = (a) => (a.role === 'class' ? 'Class teacher' : a.subject?.name ?? 'Subject');

/** "4 lessons a week · 4 in your timetable", "… · not in the timetable yet", or '' (class teacher). */
export function lessonsText(a) {
  if (a.role === 'class') return '';
  const planned = a.weeklyLessons == null ? null : `${a.weeklyLessons} lesson${a.weeklyLessons === 1 ? '' : 's'} a week`;
  let placed = null;
  if (a.inTimetable === 0) placed = 'not in the timetable yet';
  else if (a.inTimetable != null) placed = `${a.inTimetable} in your timetable`;
  return [planned, placed].filter(Boolean).join(' · ');
}

/** "From 2026-09-01", "From 2026-09-01 to 2027-01-31", "Starts 2027-01-05" (scheduled). */
export function datesText(a) {
  const to = a.endDate ? ` to ${a.endDate}` : '';
  return a.state === 'scheduled' ? `Starts ${a.startDate}${to}` : `From ${a.startDate}${to}`;
}

/** "3 classes · 5 subjects" over the list. */
export function teachingSummary(view) {
  const items = view?.items ?? [];
  const classes = new Set(items.map((a) => a.section.id)).size;
  const subjects = items.filter((a) => a.role === 'subject').length;
  return `${classes} class${classes === 1 ? '' : 'es'} · ${subjects} subject${subjects === 1 ? '' : 's'}`;
}

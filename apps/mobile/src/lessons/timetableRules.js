/*
 * The teacher's week (GET /api/teacher/timetable): their lessons grouped by school day, in the
 * school's week order (Saturday first), today first when it is a school day.
 */
export const DAY_NAMES = { SAT: 'Saturday', SUN: 'Sunday', MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday' };
const ORDER = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'];
const JS_DAY = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** The weekday ('MON'…) of a 'YYYY-MM-DD' date. */
export const weekdayOf = (day) => JS_DAY[new Date(`${day}T00:00:00Z`).getUTCDay()];

/** [{ day, title, data: lessons by start time }] for each day of the week that has lessons or is a school day. */
export function weekSections(view, today) {
  const days = [...new Set([...(view?.days ?? []), ...(view?.lessons ?? []).map((l) => l.weekday)])].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const todayDay = today ? weekdayOf(today) : null;
  const at = days.indexOf(todayDay);
  const ordered = at > 0 ? [...days.slice(at), ...days.slice(0, at)] : days;
  return ordered.map((day) => ({
    day,
    title: `${DAY_NAMES[day]}${day === todayDay ? ' (today)' : ''}`,
    count: (view.perDay ?? {})[day] ?? 0,
    data: (view.lessons ?? []).filter((l) => l.weekday === day).sort((a, b) => a.start.localeCompare(b.start)),
  }));
}

export const weekText = (view) => `${view.total} lesson${view.total === 1 ? '' : 's'} a week`;

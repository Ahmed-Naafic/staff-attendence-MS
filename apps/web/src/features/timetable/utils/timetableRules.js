// Bell schedule and timetable rules in the web app (immediate feedback and the timetable grid; the
// API checks everything again). Rules: docs/business-rules.md → Bell schedules; Timetables.

import { WEEK, WEEKDAY_SHORT } from '../../academic-calendar/utils/calendarRules.js';

export const MAX_PERIOD_NUMBER = 20;
export const BELL_NAME_MAX = 60;
export const HALF_LABELS = { before_break: 'Before the break', after_break: 'After the break', whole_day: 'Whole day' };

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
/** 'HH:MM' → minutes, or null. */
export const toMinutes = (value) => {
  const m = TIME.exec(value ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export const toTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/**
 * A day of periods from simple settings: `lessons` lessons of `lessonMinutes` from `start`, with a
 * main break of `breakMinutes` after lesson `breakAfter` (0: none), on `days`.
 */
export function generatePeriods({ start, lessonMinutes, lessons, breakAfter, breakMinutes, days }) {
  let at = toMinutes(start);
  if (at === null || !(lessonMinutes > 0) || !(lessons > 0)) return [];
  const rows = [];
  for (let n = 1; n <= Math.min(lessons, MAX_PERIOD_NUMBER); n += 1) {
    if (at + lessonMinutes > 1440) break;
    rows.push({ kind: 'lesson', number: n, name: '', days: [...days], start: toTime(at), end: toTime(at + lessonMinutes), mainBreak: false });
    at += lessonMinutes;
    if (n === breakAfter && n < lessons && breakMinutes > 0 && at + breakMinutes <= 1440) {
      rows.push({ kind: 'break', number: null, name: 'Break', days: [...days], start: toTime(at), end: toTime(at + breakMinutes), mainBreak: true });
      at += breakMinutes;
    }
  }
  return rows;
}

const rowLabel = (r) => (r.kind === 'lesson' ? `Period ${r.number}` : r.name || 'Break');

/** { 'periods.<i>' | 'periods': message } for the rows of a bell times form. */
export function validatePeriodRows(rows) {
  const problems = {};
  const put = (i, message) => {
    if (!problems[`periods.${i}`]) problems[`periods.${i}`] = message;
  };
  if (!rows.length) problems.periods = 'Add the lessons and breaks of the day.';
  else if (!rows.some((r) => r.kind === 'lesson')) problems.periods = 'Add at least one lesson period.';
  const parsed = rows.map((r, i) => {
    const startMinute = toMinutes(r.start);
    const endMinute = toMinutes(r.end);
    if (r.kind === 'lesson' && !(Number.isInteger(r.number) && r.number >= 1 && r.number <= MAX_PERIOD_NUMBER)) put(i, `Give the lesson a period number (1–${MAX_PERIOD_NUMBER}).`);
    else if (!r.days?.length) put(i, 'Choose its days.');
    else if (startMinute === null || endMinute === null) put(i, 'Enter the start and end times.');
    else if (endMinute <= startMinute) put(i, 'The end must be after the start.');
    return { ...r, index: i, startMinute, endMinute };
  });
  for (const day of WEEK) {
    const items = parsed.filter((p) => !problems[`periods.${p.index}`] && p.days.includes(day)).sort((a, b) => a.startMinute - b.startMinute);
    const seen = new Set();
    let last = null;
    items.forEach((p, k) => {
      const prev = items[k - 1];
      if (prev && p.startMinute < prev.endMinute) put(p.index, `Overlaps ${rowLabel(prev)} on ${WEEKDAY_SHORT[day]}.`);
      if (p.kind === 'lesson') {
        if (seen.has(p.number)) put(p.index, `Period ${p.number} appears twice on ${WEEKDAY_SHORT[day]}.`);
        else if (last && p.number < last) put(p.index, `Number the periods in time order (${WEEKDAY_SHORT[day]}).`);
        seen.add(p.number);
        last = p.number;
      }
    });
    const mains = items.filter((p) => p.kind === 'break' && p.mainBreak);
    if (mains.length > 1) put(mains[1].index, `Only one main break per day (${WEEKDAY_SHORT[day]}).`);
    else if (mains.length === 1) {
      const [m] = mains;
      if (!items.some((p) => p.kind === 'lesson' && p.endMinute <= m.startMinute) || !items.some((p) => p.kind === 'lesson' && p.startMinute >= m.endMinute)) {
        put(m.index, `The main break needs lessons before and after it (${WEEKDAY_SHORT[day]}).`);
      }
    }
  }
  return problems;
}

/** Form rows → the API body's periods. */
export const periodsBody = (rows) =>
  rows.map((r) => ({
    kind: r.kind,
    ...(r.kind === 'lesson' && { number: r.number }),
    ...(r.name?.trim() && { name: r.name.trim() }),
    days: WEEK.filter((d) => r.days.includes(d)),
    start: r.start,
    end: r.end,
    ...(r.kind === 'break' && r.mainBreak && { mainBreak: true }),
  }));

/** The newest version whose effectiveFrom is on or before `day` (active versions only). */
export function versionOn(versions, day) {
  let found = null;
  for (const v of versions ?? []) if (v.state !== 'cancelled' && v.effectiveFrom <= day && (!found || v.effectiveFrom > found.effectiveFrom)) found = v;
  return found;
}

/**
 * The timetable grid for bell times (a version's periods): weekdays in display order that have
 * lessons, each with its plan (lessons and breaks in time order).
 * → [{ day, items: [{ kind, number, name, start, end, mainBreak }] }]
 */
export function gridOf(periods) {
  return WEEK.map((day) => ({
    day,
    items: (periods ?? []).filter((p) => p.days.includes(day)).sort((a, b) => a.start.localeCompare(b.start)),
  })).filter((row) => row.items.some((p) => p.kind === 'lesson'));
}

export const cellKey = (day, number) => `${day}|${number}`;

/** Lessons ([{ weekday, period, subject: { id }, teacher, room }]) → { 'MON|1': { subject, teacher, room } } with ids. */
export const lessonsToCells = (lessons) =>
  Object.fromEntries((lessons ?? []).map((l) => [cellKey(l.weekday, l.period), { subject: l.subject.id, teacher: l.teacher?.id ?? '', room: l.room ?? '' }]));

/**
 * Cells → the API body's lessons, only for periods the bell times have (`grid`). Empty subject:
 * no lesson. → { lessons, dropped } (dropped: cells whose period the chosen times do not have).
 */
export function cellsToLessons(cells, grid) {
  const valid = new Set(grid.flatMap((row) => row.items.filter((p) => p.kind === 'lesson').map((p) => cellKey(row.day, p.number))));
  const lessons = [];
  let dropped = 0;
  for (const [key, cell] of Object.entries(cells)) {
    if (!cell.subject) continue;
    if (!valid.has(key)) {
      dropped += 1;
      continue;
    }
    const [weekday, period] = key.split('|');
    lessons.push({ weekday, period: Number(period), subject: cell.subject, ...(cell.teacher && { teacher: cell.teacher }), ...(cell.room?.trim() && { room: cell.room.trim() }) });
  }
  lessons.sort((a, b) => WEEK.indexOf(a.weekday) - WEEK.indexOf(b.weekday) || a.period - b.period);
  return { lessons, dropped };
}

/** Lessons per subject id in the cells. */
export function countBySubject(cells) {
  const counts = {};
  for (const cell of Object.values(cells)) if (cell.subject) counts[cell.subject] = (counts[cell.subject] ?? 0) + 1;
  return counts;
}

/** Teachers who can be named for a subject: the section's live subject teachers of it. */
export const teachersFor = (teachers, subjectId) => (teachers ?? []).filter((t) => t.subject.id === subjectId).map((t) => t.teacher);

/** The earliest date a new version can start: the server's firstEditableDate (never before the year). */
export const VERSION_STATES = {
  current: { label: 'In effect', variant: 'success' },
  scheduled: { label: 'Scheduled', variant: 'info' },
  past: { label: 'Past', variant: 'neutral' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
};

/** "Sat–Wed: 7 lessons, 07:30–13:00 · Thu: 4 lessons, 07:30–10:30" from a version summary. */
export function summaryText(summary) {
  if (!summary) return 'No times yet';
  const groups = new Map();
  for (const day of WEEK) {
    const s = summary[day];
    if (!s) continue;
    const key = `${s.lessons} lesson${s.lessons === 1 ? '' : 's'}, ${s.start}–${s.end}${s.halves === 2 ? ', 2 halves' : ''}`;
    groups.set(key, [...(groups.get(key) ?? []), WEEKDAY_SHORT[day]]);
  }
  return [...groups.entries()].map(([text, days]) => `${days.join(', ')}: ${text}`).join(' · ') || 'No lessons';
}

// ---- the school week: school days (Academic Calendar) and staff shifts (Staff Schedule) -------------

/** When nothing is known about the school week. */
export const FALLBACK_DAYS = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU'];
const inWeekOrder = (days) => WEEK.filter((d) => days.includes(d));

/** The days new bell rows start with: the school days in effect, else FALLBACK_DAYS. */
export const defaultBellDays = (week) => (week?.schoolDays?.length ? inWeekOrder(week.schoolDays) : [...FALLBACK_DAYS]);

/** How many lessons of `lessonMinutes` fit from `start` to `end`, with a break of `breakMinutes` after lesson `breakAfter` (0: none). */
export function fitLessons({ start, end, lessonMinutes, breakAfter, breakMinutes }) {
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === null || to === null || !(lessonMinutes > 0) || to <= from) return 0;
  let n = 0;
  let at = from;
  while (n < MAX_PERIOD_NUMBER && at + lessonMinutes <= to) {
    n += 1;
    at += lessonMinutes;
    if (n === breakAfter && breakMinutes > 0) at += breakMinutes;
  }
  return n;
}

export const QUICK_FILL_DEFAULTS = { lessonMinutes: 45, breakAfter: 4, breakMinutes: 30 };

/**
 * Settings to start a bell schedule from a staff shift (a one-time copy, nothing stays linked):
 * { name, start, lessons, breakAfter, days } — the shift's school days, lessons that fit in it.
 */
export function shiftSeed(shift, schoolDays = []) {
  const days = inWeekOrder(schoolDays.length ? shift.days.filter((d) => schoolDays.includes(d)) : shift.days);
  const { lessonMinutes, breakMinutes } = QUICK_FILL_DEFAULTS;
  const lessons = fitLessons({ start: shift.start, end: shift.end, lessonMinutes, breakAfter: QUICK_FILL_DEFAULTS.breakAfter, breakMinutes });
  return { name: shift.name, start: shift.start, end: shift.end, lessons, breakAfter: lessons > QUICK_FILL_DEFAULTS.breakAfter ? QUICK_FILL_DEFAULTS.breakAfter : 0, days: days.length ? days : inWeekOrder(shift.days) };
}

/** "Morning 07:00–13:30 · Sat–Wed" (with the branch when asked). */
export const shiftLabel = (s, withBranch = false) => `${s.name} ${s.start}–${s.end} · ${inWeekOrder(s.days).map((d) => WEEKDAY_SHORT[d]).join(', ')}${withBranch && s.branch ? ` · ${s.branch.name}` : ''}`;

/**
 * Warnings for bell times (rows: { kind, number, days, start, end }) against the school week
 * (`week`: { schoolDays, shifts }). Never blocks saving:
 * - lessons on days that are not school days (they do not take place);
 * - lessons outside every staff shift on their day (staff would not be at work).
 */
export function bellWeekWarnings(rows, week) {
  if (!week) return [];
  const warnings = [];
  const schoolDays = week.schoolDays ?? [];
  const lessons = (rows ?? []).filter((r) => r.kind === 'lesson' && toMinutes(r.start) !== null && toMinutes(r.end) !== null);
  if (schoolDays.length) {
    const off = inWeekOrder([...new Set(lessons.flatMap((r) => r.days.filter((d) => !schoolDays.includes(d))))]);
    if (off.length) warnings.push(`Lessons are set on ${off.map((d) => WEEKDAY_SHORT[d]).join(', ')}, which ${off.length === 1 ? 'is' : 'are'} not a school day in the Academic Calendar; they will not take place.`);
  }
  const shifts = week.shifts ?? [];
  if (shifts.length) {
    const outside = [];
    for (const r of lessons) {
      const days = r.days.filter((d) => !schoolDays.length || schoolDays.includes(d));
      const bad = days.filter((d) => !shifts.some((s) => s.days.includes(d) && toMinutes(s.start) <= toMinutes(r.start) && toMinutes(r.end) <= toMinutes(s.end)));
      if (bad.length) outside.push(`Period ${r.number} (${r.start}–${r.end}) on ${inWeekOrder(bad).map((d) => WEEKDAY_SHORT[d]).join(', ')}`);
    }
    if (outside.length) {
      warnings.push(`${outside.slice(0, 5).join('; ')}${outside.length > 5 ? `; and ${outside.length - 5} more` : ''}: outside every staff shift (${shifts.map((s) => shiftLabel(s)).join('; ')}). Staff would not be at work then; change the times or the shifts in Staff Schedule.`);
    }
  }
  return warnings;
}

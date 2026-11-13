import { WEEKDAYS } from '../schedules/scheduleInput.js';
import { addDays, versionOn } from '../academic-calendar/schoolDays.js';

/*
 * Bell times (docs/business-rules.md → Bell schedules): pure functions over a bell schedule
 * version's periods, shared by validation, timetables, the lessons of a day and (later) attendance.
 *
 * A period: { kind: 'LESSON' | 'BREAK', number (lessons: 1–20), name, days: ['MON', …],
 * startMinute, endMinute, mainBreak }. On each weekday the periods that cover it form that day's
 * plan: no overlaps, lesson numbers unique and in time order, at most one main break with lessons
 * before and after it. The main break splits the day into two halves (Manager attendance before and
 * after the break); without one the day is a single half.
 */

export const MAX_PERIOD_NUMBER = 20;
export const HALVES = { BEFORE: 'before_break', AFTER: 'after_break', WHOLE: 'whole_day' };
const PLURAL_DAYS = { MON: 'Mondays', TUE: 'Tuesdays', WED: 'Wednesdays', THU: 'Thursdays', FRI: 'Fridays', SAT: 'Saturdays', SUN: 'Sundays' };
const DAY_LABELS = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const label = (p) => (p.kind === 'LESSON' ? `Period ${p.number}` : p.name || 'Break');

/** The weekday's plan: its periods in time order, each with its half. */
export function dayPlan(periods, weekday) {
  const items = periods.filter((p) => p.days.includes(weekday)).sort((a, b) => a.startMinute - b.startMinute);
  const main = items.find((p) => p.kind === 'BREAK' && p.mainBreak);
  return items.map((p) => ({
    kind: p.kind,
    number: p.kind === 'LESSON' ? p.number : null,
    name: p.name ?? null,
    startMinute: p.startMinute,
    endMinute: p.endMinute,
    mainBreak: Boolean(p.mainBreak),
    half: !main ? HALVES.WHOLE : p === main ? null : p.startMinute < main.startMinute ? HALVES.BEFORE : HALVES.AFTER,
  }));
}

/**
 * The halves of a day's plan: [{ half, startMinute, endMinute, lessons: [numbers] }] — one
 * ('whole_day') without a main break, two ('before_break', 'after_break') with one. Empty plan: [].
 */
export function halvesOf(plan) {
  const groups = new Map();
  for (const item of plan) {
    if (!item.half) continue;
    const g = groups.get(item.half) ?? { half: item.half, startMinute: item.startMinute, endMinute: item.endMinute, lessons: [] };
    g.startMinute = Math.min(g.startMinute, item.startMinute);
    g.endMinute = Math.max(g.endMinute, item.endMinute);
    if (item.kind === 'LESSON') g.lessons.push(item.number);
    groups.set(item.half, g);
  }
  return [HALVES.WHOLE, HALVES.BEFORE, HALVES.AFTER].filter((h) => groups.has(h)).map((h) => groups.get(h));
}

/** The lesson numbers of each weekday: { MON: [1, 2, …], … } (weekdays without lessons left out). */
export function lessonNumbersByDay(periods) {
  const result = {};
  for (const day of WEEKDAYS) {
    const numbers = periods.filter((p) => p.kind === 'LESSON' && p.days.includes(day)).map((p) => p.number).sort((a, b) => a - b);
    if (numbers.length) result[day] = numbers;
  }
  return result;
}

/**
 * Checks the periods of one version as a whole. → { field: message } (empty when valid); fields are
 * 'periods' or 'periods.<index>'.
 */
export function checkPeriods(periods) {
  const errors = {};
  const put = (index, message) => {
    const key = `periods.${index}`;
    if (!errors[key]) errors[key] = message;
  };
  if (!periods.some((p) => p.kind === 'LESSON')) errors.periods = 'Add at least one lesson period.';

  for (const day of WEEKDAYS) {
    const items = periods.map((p, index) => ({ ...p, index })).filter((p) => p.days.includes(day)).sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
    const seen = new Map();
    let lastLesson = null;
    for (let i = 0; i < items.length; i += 1) {
      const p = items[i];
      const prev = items[i - 1];
      if (prev && p.startMinute < prev.endMinute) put(p.index, `${label(p)} overlaps ${label(prev)} on ${DAY_LABELS[day]} (${hhmm(prev.startMinute)}–${hhmm(prev.endMinute)}).`);
      if (p.kind === 'LESSON') {
        if (seen.has(p.number)) put(p.index, `Period ${p.number} appears twice on ${DAY_LABELS[day]}.`);
        else if (lastLesson && p.number < lastLesson.number) put(p.index, `Period ${p.number} starts after period ${lastLesson.number} on ${DAY_LABELS[day]}; number the periods in time order.`);
        seen.set(p.number, p);
        lastLesson = p;
      }
    }
    const mains = items.filter((p) => p.kind === 'BREAK' && p.mainBreak);
    if (mains.length > 1) put(mains[1].index, `Only one main break per day (${DAY_LABELS[day]} has ${mains.length}).`);
    else if (mains.length === 1) {
      const [main] = mains;
      const before = items.some((p) => p.kind === 'LESSON' && p.endMinute <= main.startMinute);
      const after = items.some((p) => p.kind === 'LESSON' && p.startMinute >= main.endMinute);
      if (!before || !after) put(main.index, `The main break needs lessons before and after it on ${DAY_LABELS[day]}.`);
    }
  }
  return errors;
}

const overlaps = (a, b) => a.startMinute < b.endMinute && b.startMinute < a.endMinute;

/**
 * Teachers booked in two places at once. Each timetable version: { id, sectionId, sectionName,
 * bellScheduleId, from, to ('YYYY-MM-DD', inclusive), slots: [{ weekday, periodNumber, teacherId,
 * teacherName, subjectName }] }. `bellVersions`: Map bellScheduleId → [{ effectiveFrom, periods }]
 * (active versions). Every candidate is compared with the others and with each other candidate of
 * another section, for the dates both cover, under the bell times in effect on those dates.
 * → [{ teacherId, teacherName, weekday, from, a: {…}, b: {…} }] (at most `limit`).
 */
export function teacherClashes(candidates, others, bellVersions, limit = 10) {
  const clashes = [];
  const seen = new Set();
  const pool = [...candidates, ...others];
  for (let i = 0; i < candidates.length && clashes.length < limit; i += 1) {
    const c = candidates[i];
    const cTeachers = new Set(c.slots.filter((s) => s.teacherId).map((s) => s.teacherId));
    if (!cTeachers.size) continue;
    for (const o of pool) {
      if (clashes.length >= limit) break;
      if (o === c || o.sectionId === c.sectionId) continue;
      const pairKey = [c.id, o.id].sort().join('|');
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      if (!o.slots.some((s) => s.teacherId && cTeachers.has(s.teacherId))) continue;
      const from = c.from > o.from ? c.from : o.from;
      const to = c.to < o.to ? c.to : o.to;
      if (from > to) continue;

      // The dates where both bell times stay the same: split at every version start inside the range.
      const starts = new Set([from]);
      for (const id of [c.bellScheduleId, o.bellScheduleId]) {
        for (const v of bellVersions.get(id) ?? []) if (v.effectiveFrom > from && v.effectiveFrom <= to) starts.add(v.effectiveFrom);
      }
      const checked = new Set();
      for (const day of [...starts].sort()) {
        const cb = versionOn(bellVersions.get(c.bellScheduleId) ?? [], day);
        const ob = versionOn(bellVersions.get(o.bellScheduleId) ?? [], day);
        if (!cb || !ob) continue;
        const key = `${cb.effectiveFrom}|${ob.effectiveFrom}`;
        if (checked.has(key)) continue;
        checked.add(key);
        for (const cs of c.slots) {
          if (!cs.teacherId || !cTeachers.has(cs.teacherId)) continue;
          const cp = cb.periods.find((p) => p.kind === 'LESSON' && p.number === cs.periodNumber && p.days.includes(cs.weekday));
          if (!cp) continue;
          for (const os of o.slots) {
            if (os.teacherId !== cs.teacherId || os.weekday !== cs.weekday) continue;
            const op = ob.periods.find((p) => p.kind === 'LESSON' && p.number === os.periodNumber && p.days.includes(os.weekday));
            if (!op || !overlaps(cp, op)) continue;
            clashes.push({
              teacherId: cs.teacherId,
              teacherName: cs.teacherName,
              weekday: cs.weekday,
              from: day,
              a: { sectionId: c.sectionId, sectionName: c.sectionName, periodNumber: cs.periodNumber, subjectName: cs.subjectName, startMinute: cp.startMinute, endMinute: cp.endMinute },
              b: { sectionId: o.sectionId, sectionName: o.sectionName, periodNumber: os.periodNumber, subjectName: os.subjectName, startMinute: op.startMinute, endMinute: op.endMinute },
            });
            if (clashes.length >= limit) return clashes;
          }
        }
      }
    }
  }
  return clashes;
}

/** "Ahmed Ali teaches Grade 7 A (period 3) and Grade 8 B (period 2) at the same time on Mon, from 2026-11-20." */
export const describeClash = (x) =>
  `${x.teacherName} would teach ${x.a.sectionName} (period ${x.a.periodNumber}, ${hhmm(x.a.startMinute)}–${hhmm(x.a.endMinute)}) and ${x.b.sectionName} (period ${x.b.periodNumber}, ${hhmm(x.b.startMinute)}–${hhmm(x.b.endMinute)}) at the same time on ${PLURAL_DAYS[x.weekday]}, from ${x.from}.`;

/**
 * Each version's last day: the day before the next active version of the same owner starts, else
 * `end`. `rows`: [{ effectiveFrom ('YYYY-MM-DD'), … }] of one owner, active only. Returns new objects with `to`.
 */
export function withRanges(rows, end) {
  const sorted = [...rows].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return sorted.map((v, i) => ({ ...v, to: sorted[i + 1] ? addDays(sorted[i + 1].effectiveFrom, -1) : end }));
}

export { hhmm as minutesToTime };

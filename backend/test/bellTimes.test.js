/*
 * Bell times (docs/business-rules.md → Bell schedules): pure checks of a day's periods, the halves
 * split by the main break, the school-day rule with extra school days, and teacher clashes across
 * sections and bell schedules. No database.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { checkPeriods, dayPlan, halvesOf, lessonNumbersByDay, teacherClashes, withRanges } from '../src/features/timetable/bellTimes.js';
import { resolveDay } from '../src/features/academic-calendar/schoolDays.js';

const ALL = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const t = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const lesson = (number, start, end, days = ALL) => ({ kind: 'LESSON', number, name: null, days, startMinute: t(start), endMinute: t(end), mainBreak: false });
const brk = (start, end, { main = false, days = ALL } = {}) => ({ kind: 'BREAK', number: null, name: 'Break', days, startMinute: t(start), endMinute: t(end), mainBreak: main });

describe('checkPeriods', () => {
  test('a valid day with a main break has no errors', () => {
    assert.deepEqual(checkPeriods([lesson(1, '07:30', '08:15'), lesson(2, '08:15', '09:00'), brk('09:00', '09:30', { main: true }), lesson(3, '09:30', '10:15')]), {});
  });

  test('overlaps, duplicate and out-of-order numbers, misplaced main breaks, no lessons', () => {
    assert.match(checkPeriods([lesson(1, '07:30', '08:15'), lesson(2, '08:00', '08:45')])['periods.1'], /overlaps Period 1/);
    assert.match(checkPeriods([lesson(1, '07:30', '08:15'), lesson(1, '08:15', '09:00')])['periods.1'], /appears twice/);
    assert.match(checkPeriods([lesson(2, '07:30', '08:15'), lesson(1, '08:15', '09:00')])['periods.1'], /time order/);
    assert.match(checkPeriods([lesson(1, '07:30', '08:15'), brk('08:15', '08:30', { main: true })])['periods.1'], /lessons before and after/);
    assert.match(checkPeriods([lesson(1, '07:00', '07:30'), brk('07:30', '07:40', { main: true }), lesson(2, '07:40', '08:00'), brk('08:00', '08:10', { main: true }), lesson(3, '08:10', '08:30')])['periods.3'], /Only one main break/);
    assert.match(checkPeriods([brk('08:00', '08:30')]).periods, /at least one lesson/);
  });

  test('different days may number and time periods differently (a short Thursday)', () => {
    const periods = [lesson(1, '07:30', '08:15'), lesson(2, '08:15', '09:00', ['SAT', 'SUN', 'MON', 'TUE', 'WED']), lesson(2, '08:15', '08:45', ['THU'])];
    assert.deepEqual(checkPeriods(periods), {});
    assert.deepEqual(lessonNumbersByDay(periods).THU, [1, 2]);
    assert.equal(lessonNumbersByDay(periods).FRI.length, 1);
  });
});

describe('day plan and halves', () => {
  test('the main break splits the day; without one the day is a single half', () => {
    const periods = [lesson(1, '07:30', '08:15'), lesson(2, '08:15', '09:00'), brk('09:00', '09:30', { main: true }), lesson(3, '09:30', '10:15'), brk('10:15', '10:25'), lesson(4, '10:25', '11:10')];
    const halves = halvesOf(dayPlan(periods, 'MON'));
    assert.deepEqual(halves.map((h) => [h.half, h.lessons]), [['before_break', [1, 2]], ['after_break', [3, 4]]]);
    assert.equal(halves[1].endMinute, t('11:10'));
    const single = halvesOf(dayPlan([lesson(1, '07:30', '08:15'), brk('08:15', '08:30'), lesson(2, '08:30', '09:15')], 'MON'));
    assert.deepEqual(single.map((h) => [h.half, h.lessons]), [['whole_day', [1, 2]]]);
    assert.deepEqual(halvesOf(dayPlan(periods, 'XYZ')), []);
  });
});

describe('school days with extra school days', () => {
  const year = { id: 'y', name: 'Y', startDate: '2026-09-01', endDate: '2027-06-30', weekdays: { schoolVersions: [{ days: ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU'], followsSchool: false, effectiveFrom: '2026-09-01' }], branchVersions: [] } };
  const entry = (type, startDate, endDate, extra = {}) => ({ id: `${type}-${startDate}`, name: type, type, startDate, endDate, branchId: null, holidayId: null, timetableDay: null, ...extra });

  test('a Friday make-up day follows the weekday it names; the branch’s own wins over the school’s', () => {
    const friday = '2026-11-20';
    assert.equal(resolveDay(friday, { years: [year], entries: [] }).reason, 'not_a_school_day');
    const school = entry('SCHOOL_DAY', friday, friday, { timetableDay: 'MON' });
    const day = resolveDay(friday, { years: [year], entries: [school] });
    assert.equal(day.schoolDay, true);
    assert.equal(day.timetableDay, 'MON');
    assert.equal(day.extraDay.level, 'school');
    const branchOwn = entry('SCHOOL_DAY', friday, friday, { timetableDay: 'TUE', branchId: 'b' });
    assert.equal(resolveDay(friday, { years: [year], entries: [school, branchOwn] }).timetableDay, 'TUE');
  });

  test('closures and holidays still win; a normal day follows its own weekday; a swap changes it', () => {
    const wednesday = '2026-11-18';
    assert.equal(resolveDay(wednesday, { years: [year], entries: [] }).timetableDay, 'WED');
    const swap = entry('SCHOOL_DAY', wednesday, wednesday, { timetableDay: 'MON' });
    assert.equal(resolveDay(wednesday, { years: [year], entries: [swap] }).timetableDay, 'MON');
    const closed = resolveDay(wednesday, { years: [year], entries: [swap, entry('CLOSURE', wednesday, wednesday, { branchId: 'b' })] });
    assert.deepEqual([closed.schoolDay, closed.reason, closed.timetableDay], [false, 'closure', null]);
    assert.equal(resolveDay(wednesday, { years: [year], entries: [swap, entry('HOLIDAY', wednesday, wednesday)] }).reason, 'holiday');
  });
});

describe('teacher clashes', () => {
  const morning = [lesson(1, '07:30', '08:15'), lesson(2, '08:15', '09:00')];
  const afternoon = [lesson(1, '08:00', '08:40'), lesson(2, '13:00', '13:40')];
  const bells = new Map([
    ['m', [{ effectiveFrom: '2026-09-01', periods: morning }]],
    ['a', [{ effectiveFrom: '2026-09-01', periods: afternoon }]],
  ]);
  const version = (id, sectionId, bellScheduleId, slots, from = '2026-09-01', to = '2027-06-30') => ({
    id,
    sectionId,
    sectionName: sectionId,
    bellScheduleId,
    from,
    to,
    slots: slots.map(([weekday, periodNumber, teacherId]) => ({ weekday, periodNumber, teacherId, teacherName: teacherId, subjectName: 'S' })),
  });

  test('overlapping times under different bell schedules clash; other days, teachers or dates do not', () => {
    const a = version('a', 'S1', 'm', [['MON', 1, 'T']]);
    assert.equal(teacherClashes([a], [version('b', 'S2', 'a', [['MON', 1, 'T']])], bells).length, 1);
    assert.equal(teacherClashes([a], [version('b', 'S2', 'a', [['MON', 2, 'T']])], bells).length, 0);
    assert.equal(teacherClashes([a], [version('b', 'S2', 'a', [['TUE', 1, 'T']])], bells).length, 0);
    assert.equal(teacherClashes([a], [version('b', 'S2', 'a', [['MON', 1, 'U']])], bells).length, 0);
    assert.equal(teacherClashes([version('a', 'S1', 'm', [['MON', 1, 'T']], '2026-09-01', '2026-12-31')], [version('b', 'S2', 'a', [['MON', 1, 'T']], '2027-01-01')], bells).length, 0);
    // The same section never clashes with itself (its versions follow each other).
    assert.equal(teacherClashes([a], [version('c', 'S1', 'm', [['MON', 1, 'T']])], bells).length, 0);
  });

  test('a later bell time change can create a clash from its date', () => {
    const changing = new Map([...bells, ['a', [{ effectiveFrom: '2026-09-01', periods: [lesson(1, '09:00', '09:40')] }, { effectiveFrom: '2027-01-10', periods: [lesson(1, '07:45', '08:30')] }]]]);
    const [clash] = teacherClashes([version('a', 'S1', 'm', [['MON', 1, 'T']])], [version('b', 'S2', 'a', [['MON', 1, 'T']])], changing);
    assert.equal(clash.from, '2027-01-10');
  });

  test('ranges: each version ends the day before the next one starts', () => {
    const ranged = withRanges([{ id: 2, effectiveFrom: '2026-10-01' }, { id: 1, effectiveFrom: '2026-09-01' }], '2027-06-30');
    assert.deepEqual(ranged.map((v) => [v.id, v.to]), [[1, '2026-09-30'], [2, '2027-06-30']]);
  });
});

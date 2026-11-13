import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cellsToLessons, countBySubject, generatePeriods, gridOf, lessonsToCells, periodsBody, summaryText, teachersFor, validatePeriodRows, versionOn } from './timetableRules.js';

const ALL = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU'];

describe('bell times form', () => {
  test('generates a day with a main break after the chosen lesson', () => {
    const rows = generatePeriods({ start: '07:30', lessonMinutes: 45, lessons: 4, breakAfter: 2, breakMinutes: 30, days: ALL });
    assert.deepEqual(rows.map((r) => [r.kind, r.number, r.start, r.end, r.mainBreak]), [
      ['lesson', 1, '07:30', '08:15', false],
      ['lesson', 2, '08:15', '09:00', false],
      ['break', null, '09:00', '09:30', true],
      ['lesson', 3, '09:30', '10:15', false],
      ['lesson', 4, '10:15', '11:00', false],
    ]);
    assert.deepEqual(validatePeriodRows(rows), {});
    assert.equal(generatePeriods({ start: '07:30', lessonMinutes: 45, lessons: 2, breakAfter: 2, breakMinutes: 30, days: ALL }).length, 2, 'no break after the last lesson');
    assert.deepEqual(generatePeriods({ start: 'x', lessonMinutes: 45, lessons: 2, breakAfter: 0, breakMinutes: 0, days: ALL }), []);
  });

  test('flags overlaps, duplicate numbers, missing days and a main break at the end', () => {
    const lesson = (number, start, end, days = ALL) => ({ kind: 'lesson', number, name: '', days, start, end, mainBreak: false });
    assert.match(validatePeriodRows([lesson(1, '07:30', '08:15'), lesson(2, '08:00', '08:45')])['periods.1'], /Overlaps Period 1/);
    assert.match(validatePeriodRows([lesson(1, '07:30', '08:15'), lesson(1, '08:15', '09:00')])['periods.1'], /twice/);
    assert.match(validatePeriodRows([lesson(1, '07:30', '08:15', [])])['periods.0'], /days/);
    assert.match(validatePeriodRows([lesson(1, '07:30', '08:15'), { kind: 'break', name: 'Break', days: ALL, start: '08:15', end: '08:30', mainBreak: true }])['periods.1'], /before and after/);
    assert.equal(validatePeriodRows([]).periods, 'Add the lessons and breaks of the day.');
    // Different times for the same number on different days are fine (a short Thursday).
    assert.deepEqual(validatePeriodRows([lesson(1, '07:30', '08:15', ['SAT']), lesson(1, '07:30', '08:00', ['THU'])]), {});
  });

  test('body: weekdays in order, numbers only for lessons, mainBreak only when set', () => {
    const [l, b] = periodsBody([
      { kind: 'lesson', number: 1, name: ' ', days: ['MON', 'SAT'], start: '07:30', end: '08:15', mainBreak: false },
      { kind: 'break', number: null, name: 'Lunch', days: ['SAT'], start: '08:15', end: '08:45', mainBreak: true },
    ]);
    assert.deepEqual(l, { kind: 'lesson', number: 1, days: ['SAT', 'MON'], start: '07:30', end: '08:15' });
    assert.deepEqual(b, { kind: 'break', name: 'Lunch', days: ['SAT'], start: '08:15', end: '08:45', mainBreak: true });
  });
});

describe('timetable grid', () => {
  const periods = [
    { kind: 'lesson', number: 1, days: ['SAT', 'MON'], start: '07:30', end: '08:15' },
    { kind: 'break', number: null, name: 'Break', days: ['SAT', 'MON', 'FRI'], start: '08:15', end: '08:30', mainBreak: false },
    { kind: 'lesson', number: 2, days: ['SAT'], start: '08:30', end: '09:15' },
  ];

  test('rows are weekdays with lessons, in the week order; items in time order', () => {
    const grid = gridOf(periods);
    assert.deepEqual(grid.map((r) => r.day), ['SAT', 'MON']);
    assert.deepEqual(grid[0].items.map((p) => p.number ?? p.name), [1, 'Break', 2]);
  });

  test('cells ↔ lessons; periods the times do not have are dropped and counted', () => {
    const cells = lessonsToCells([{ weekday: 'SAT', period: 2, subject: { id: 's1' }, teacher: { id: 't1' }, room: 'Lab' }, { weekday: 'MON', period: 2, subject: { id: 's2' }, teacher: null }]);
    assert.deepEqual(cells['SAT|2'], { subject: 's1', teacher: 't1', room: 'Lab' });
    const { lessons, dropped } = cellsToLessons({ ...cells, 'SAT|1': { subject: '', teacher: '', room: '' } }, gridOf(periods));
    assert.deepEqual(lessons, [{ weekday: 'SAT', period: 2, subject: 's1', teacher: 't1', room: 'Lab' }]);
    assert.equal(dropped, 1);
    assert.deepEqual(countBySubject(cells), { s1: 1, s2: 1 });
  });

  test('versions, teachers of a subject, summaries', () => {
    const versions = [{ effectiveFrom: '2026-09-01', state: 'past' }, { effectiveFrom: '2026-11-20', state: 'cancelled' }, { effectiveFrom: '2026-11-10', state: 'current' }];
    assert.equal(versionOn(versions, '2026-11-25').effectiveFrom, '2026-11-10');
    assert.equal(versionOn(versions, '2026-08-01'), null);
    assert.deepEqual(teachersFor([{ subject: { id: 's1' }, teacher: { id: 't1' } }, { subject: { id: 's2' }, teacher: { id: 't2' } }], 's1'), [{ id: 't1' }]);
    assert.equal(
      summaryText({ SAT: { lessons: 7, start: '07:30', end: '13:00', halves: 2 }, SUN: { lessons: 7, start: '07:30', end: '13:00', halves: 2 }, THU: { lessons: 4, start: '07:30', end: '10:30', halves: 1 } }),
      'Sat, Sun: 7 lessons, 07:30–13:00, 2 halves · Thu: 4 lessons, 07:30–10:30',
    );
  });
});

// Academic year rules in the web app. Run with `npm run test:web`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daysBetween, suggestName, validateAcademicYear, yearProgress } from './academicYearRules.js';

test('required fields, real dates, order and length', () => {
  assert.deepEqual(validateAcademicYear({ name: '2026/2027', startDate: '2026-09-01', endDate: '2027-06-30' }), {});
  assert.deepEqual(Object.keys(validateAcademicYear({ name: ' ', startDate: '', endDate: '2027-02-30' })).sort(), ['endDate', 'name', 'startDate']);
  assert.match(validateAcademicYear({ name: 'X', startDate: '2026-09-01', endDate: '2026-09-01' }).endDate, /after/);
  assert.match(validateAcademicYear({ name: 'X', startDate: '2026-01-01', endDate: '2028-01-02' }).endDate, /731/);
  assert.ok(validateAcademicYear({ name: 'x'.repeat(41), startDate: '2026-01-01', endDate: '2026-12-31' }).name);
});

test('day counts are inclusive and names come from the years', () => {
  assert.equal(daysBetween('2026-09-01', '2027-06-30'), 303);
  assert.equal(daysBetween('2026-01-01', '2026-01-01'), 1);
  assert.equal(suggestName('2026-09-01', '2027-06-30'), '2026/2027');
  assert.equal(suggestName('2026-01-10', '2026-12-15'), '2026');
  assert.equal(suggestName('', '2026-12-15'), '');
});

test('progress through a year', () => {
  const year = { startDate: '2026-09-01', endDate: '2026-09-10' };
  assert.deepEqual(yearProgress(year, '2026-08-30'), { phase: 'upcoming', percent: 0, daysLeft: 10, total: 10, startsIn: 2 });
  assert.deepEqual(yearProgress(year, '2026-09-05'), { phase: 'running', percent: 50, daysLeft: 5, total: 10 });
  assert.deepEqual(yearProgress(year, '2026-09-11'), { phase: 'ended', percent: 100, daysLeft: 0, total: 10 });
});

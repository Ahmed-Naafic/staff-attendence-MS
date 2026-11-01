import assert from 'node:assert/strict';
import { test } from 'node:test';
import { absentAfter, earliestText, effectiveDateHint, emptyShift, lateAfter, toRequestShifts, validateSchedule } from './scheduleRules.js';

const RANGE = { earliest: '2026-11-02', latest: '2027-11-01' };
const row = (overrides = {}) => ({ name: 'Morning', days: ['TUE', 'MON'], start: '07:00', end: '13:00', graceMinutes: '10', absenceCutoffMinutes: '120', ...overrides });
const check = (rows, effectiveFrom = '2026-11-02') => validateSchedule({ effectiveFrom, rows }, RANGE);

test('a valid schedule has no problems; request shifts are normalized', () => {
  assert.deepEqual(check([row(), row({ name: 'Afternoon', start: '13:00', end: '18:00', absenceCutoffMinutes: '60' })]), {});
  assert.deepEqual(toRequestShifts([row({ name: '  Morning   shift ' })])[0], {
    name: 'Morning shift',
    days: ['MON', 'TUE'],
    start: '07:00',
    end: '13:00',
    graceMinutes: 10,
    absenceCutoffMinutes: 120,
  });
});

test('a kept shift is sent with its key; a new shift without one', () => {
  const key = '0b9d2c1e-3f4a-4b5c-8d6e-7f8091a2b3c4';
  assert.equal(toRequestShifts([{ ...row(), key }])[0].key, key);
  assert.equal('key' in toRequestShifts([row()])[0], false);
});

test('effective date: within the allowed range', () => {
  assert.ok(check([row()], '2026-11-01').effectiveFrom);
  assert.ok(check([row()], '2027-11-02').effectiveFrom);
  assert.ok(check([row()], '').effectiveFrom);
});

test('shift fields: required, same day, grace and cutoff within the shift', () => {
  const problems = check([emptyShift()]);
  for (const field of ['name', 'days', 'start', 'end', 'absenceCutoffMinutes']) assert.ok(problems[`shifts.0.${field}`], field);
  assert.match(check([row({ start: '22:00', end: '06:00' })])['shifts.0.end'], /no overnight/);
  assert.ok(check([row({ graceMinutes: '361' })])['shifts.0.graceMinutes']);
  assert.ok(check([row({ absenceCutoffMinutes: '5' })])['shifts.0.absenceCutoffMinutes']);
  assert.ok(check([row({ absenceCutoffMinutes: '361' })])['shifts.0.absenceCutoffMinutes']);
  assert.ok(check([row({ graceMinutes: '1.5' })])['shifts.0.graceMinutes']);
});

test('names are unique regardless of capitalization; shifts sharing a day cannot overlap', () => {
  assert.match(check([row(), row({ name: 'MORNING', days: ['FRI'] })])['shifts.1.name'], /already called/);
  assert.match(check([row(), row({ name: 'Late', start: '12:00', end: '15:00', absenceCutoffMinutes: '60' })])['shifts.1.start'], /Overlaps "Morning".*Mon, Tue/);
  assert.deepEqual(check([row(), row({ name: 'Friday', days: ['FRI'] })]), {}, 'same times on other days');
  assert.deepEqual(check([row(), row({ name: 'Next', start: '13:00', end: '14:00', absenceCutoffMinutes: '30' })]), {}, 'touching is fine');
  assert.ok(check([]).shifts);
});

test('late and absent times are shown from the start time', () => {
  assert.equal(lateAfter({ start: '07:00', graceMinutes: 10 }), '07:10');
  assert.equal(absentAfter({ start: '07:00', absenceCutoffMinutes: 120 }), '09:00');
});

test('effective-date hints follow the delay and the first-one rule', () => {
  assert.equal(earliestText('2026-11-02', 1), 'Tomorrow (2026-11-02)');
  assert.equal(earliestText('2026-11-04', 3), '2026-11-04 (3 days from today)');
  assert.equal(earliestText('2026-11-02'), 'Tomorrow (2026-11-02)', 'older API responses without the delay mean 1 day');
  const base = { today: '2026-11-01', delayDays: 3 };
  assert.match(effectiveDateHint({ ...base, first: true, earliest: '2026-11-01', what: 'schedule' }), /can start today \(2026-11-01\)/);
  assert.match(effectiveDateHint({ ...base, first: true, earliest: '2026-11-04', what: 'schedule' }), /^2026-11-04 \(3 days from today\) at the earliest \(the platform's effective delay\)/);
  assert.match(effectiveDateHint({ ...base, first: false, earliest: '2026-11-04', what: 'assignments' }), /today's assignments do not change/);
  assert.match(effectiveDateHint({ ...base, first: false, earliest: '2026-11-04', what: 'schedule' }), /current schedule stays in effect/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { absentAfter, applyShiftTemplate, DAY_PRESETS, earliestText, effectiveDateHint, effectiveTimeHint, effectiveTimeProblem, emptyShift, lateAfter, nextQuarter, nextShift, presetsFor, presetState, rowClockTimes, SHIFT_TEMPLATES, shiftNameOptions, togglePreset, toRequestShifts, toRow, validateSchedule, whenText } from './scheduleRules.js';

const RANGE = { earliest: '2026-11-02', latest: '2027-11-01' };
const row = (overrides = {}) => ({ name: 'Morning-Shift', days: ['TUE', 'MON'], start: '07:00', end: '13:00', graceMinutes: '10', absenceCutoffMinutes: '120', ...overrides });
const check = (rows, effectiveFrom = '2026-11-02') => validateSchedule({ effectiveFrom, rows }, RANGE);

test('a valid schedule has no problems; request shifts are normalized', () => {
  assert.deepEqual(check([row(), row({ name: 'Afternoon-Shift', start: '13:00', end: '18:00', absenceCutoffMinutes: '60' })]), {});
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
  const problems = check([{ ...emptyShift(), absenceCutoffMinutes: '' }]);
  for (const field of ['name', 'days', 'start', 'end', 'absenceCutoffMinutes']) assert.ok(problems[`shifts.0.${field}`], field);
  // A new shift: late after 30 minutes, absent after 1 hour.
  assert.deepEqual([emptyShift().graceMinutes, emptyShift().absenceCutoffMinutes], ['30', '60']);
  assert.deepEqual([nextShift([]).graceMinutes, nextShift([]).absenceCutoffMinutes], ['30', '60']);
  assert.match(check([row({ start: '22:00', end: '06:00' })])['shifts.0.end'], /no overnight/);
  assert.ok(check([row({ graceMinutes: '361' })])['shifts.0.graceMinutes']);
  assert.ok(check([row({ absenceCutoffMinutes: '5' })])['shifts.0.absenceCutoffMinutes']);
  assert.ok(check([row({ absenceCutoffMinutes: '361' })])['shifts.0.absenceCutoffMinutes']);
  assert.ok(check([row({ graceMinutes: '1.5' })])['shifts.0.graceMinutes']);
});

test('each shift once; shifts sharing a day cannot overlap', () => {
  assert.match(check([row(), row({ days: ['FRI'] })])['shifts.1.name'], /already called/);
  assert.match(check([row(), row({ name: 'Afternoon-Shift', start: '12:00', end: '15:00', absenceCutoffMinutes: '60' })])['shifts.1.start'], /Overlaps "Morning-Shift".*Mon, Tue/);
  assert.deepEqual(check([row(), row({ name: 'Night-Shift', days: ['FRI'] })]), {}, 'same times on other days');
  assert.deepEqual(check([row(), row({ name: 'Afternoon-Shift', start: '13:00', end: '14:00', absenceCutoffMinutes: '30' })]), {}, 'touching is fine');
  assert.ok(check([]).shifts);
});

test('shifts are chosen from Morning-Shift, Afternoon-Shift and Night-Shift with their usual times', () => {
  assert.deepEqual(SHIFT_TEMPLATES, [
    { name: 'Morning-Shift', start: '07:00', end: '12:20' },
    { name: 'Afternoon-Shift', start: '13:00', end: '17:00' },
    { name: 'Night-Shift', start: '18:40', end: '21:00' },
  ]);
  // Choosing a shift fills in its times and keeps the rest of the row.
  assert.deepEqual(applyShiftTemplate(row({ days: ['SAT'] }), 'Night-Shift'), row({ name: 'Night-Shift', days: ['SAT'], start: '18:40', end: '21:00' }));
  // Adding shifts: the next one not used yet; none once all three are there.
  assert.equal(nextShift([]).name, 'Morning-Shift');
  assert.deepEqual([nextShift([]).start, nextShift([]).end], ['07:00', '12:20']);
  assert.equal(nextShift([row()]).name, 'Afternoon-Shift');
  assert.equal(nextShift([row(), row({ name: 'Afternoon-Shift' })]).name, 'Night-Shift');
  assert.equal(nextShift([row(), row({ name: 'Afternoon-Shift' }), row({ name: 'Night-Shift' })]), null);
  // Any other name is refused, except a shift's own name saved earlier (kept until it is changed).
  assert.match(check([row({ name: 'Morning' })])['shifts.0.name'], /Choose Morning-Shift, Afternoon-Shift or Night-Shift/);
  const saved = toRow({ key: 'k', name: 'Old morning', days: ['MON'], start: '07:00', end: '13:00', graceMinutes: 10, absenceCutoffMinutes: 120 });
  assert.deepEqual(shiftNameOptions(saved), ['Morning-Shift', 'Afternoon-Shift', 'Night-Shift', 'Old morning']);
  assert.deepEqual(check([saved]), {});
  assert.deepEqual(shiftNameOptions(row()), ['Morning-Shift', 'Afternoon-Shift', 'Night-Shift']);
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

test('timed changes: when text, default time, time problems and hints', () => {
  assert.equal(whenText({ effectiveFrom: '2026-11-01', effectiveTime: '00:00' }), '2026-11-01');
  assert.equal(whenText({ effectiveFrom: '2026-11-01', effectiveTime: '13:30' }), '2026-11-01 13:30');
  assert.equal(whenText({ effectiveFrom: '2026-11-01' }), '2026-11-01', 'older responses without a time');
  assert.deepEqual(nextQuarter({ date: '2026-11-01', time: '13:07' }), { date: '2026-11-01', time: '13:15' });
  assert.deepEqual(nextQuarter({ date: '2026-11-01', time: '13:15' }), { date: '2026-11-01', time: '13:30' });
  assert.deepEqual(nextQuarter({ date: '2026-12-31', time: '23:50' }), { date: '2027-01-01', time: '00:00' });
  const now = { date: '2026-11-01', time: '13:07' };
  assert.equal(effectiveTimeProblem({ timed: false, date: '2026-11-01', time: '', now }), null);
  assert.equal(effectiveTimeProblem({ timed: true, date: '2026-11-01', time: '', now }), 'Choose the time it takes effect.');
  assert.match(effectiveTimeProblem({ timed: true, date: '2026-11-01', time: '13:07', now }), /after now \(13:07\)/);
  assert.match(effectiveTimeProblem({ timed: true, date: '2026-11-01', time: '09:00', now }), /cannot start in the past/);
  assert.equal(effectiveTimeProblem({ timed: true, date: '2026-11-01', time: '13:08', now }), null);
  assert.equal(effectiveTimeProblem({ timed: true, date: '2026-11-02', time: '00:00', now }), null);
  assert.match(effectiveDateHint({ first: false, today: '2026-11-01', earliest: '2026-11-01', delayDays: 1, what: 'schedule', timedChanges: true }), /^Today \(2026-11-01\) or later/);
  assert.match(effectiveTimeHint('assignments', 'Africa/Mogadishu'), /current assignments stay in effect/);
});

const WEEK = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'];
const preset = (id) => DAY_PRESETS.find((p) => p.id === id).days;

test('day presets: All days, Full-time (Sat–Wed), Part-time (Thu–Fri); labels are names only', () => {
  assert.deepEqual(DAY_PRESETS.map((p) => p.label), ['All days', 'Full-time', 'Part-time']);
  assert.deepEqual(preset('all'), WEEK);
  assert.deepEqual(preset('fulltime'), ['SAT', 'SUN', 'MON', 'TUE', 'WED']);
  assert.deepEqual(preset('parttime'), ['THU', 'FRI']);
});

test('a preset is ticked only when exactly its days are: Full-time never ticks All days', () => {
  const full = ['SAT', 'SUN', 'MON', 'TUE', 'WED'];
  assert.deepEqual(presetState(full, preset('fulltime')), { checked: true });
  assert.deepEqual(presetState(full, preset('all')), { checked: false }, 'Full-time is not All days');
  assert.deepEqual(presetState(full, preset('parttime')), { checked: false });
  assert.deepEqual(presetState(WEEK, preset('all')), { checked: true });
  assert.deepEqual(presetState(WEEK, preset('fulltime')), { checked: false }, 'All days is not Full-time');
  assert.deepEqual(presetState(['SAT', 'SUN'], preset('fulltime')), { checked: false });
  assert.deepEqual(presetState([], []), { checked: false });
});

test('ticking a preset sets exactly its days; ticking it again clears them', () => {
  assert.deepEqual(togglePreset([], preset('fulltime'), WEEK), ['SAT', 'SUN', 'MON', 'TUE', 'WED']);
  assert.deepEqual(togglePreset(['SAT', 'SUN', 'MON', 'TUE', 'WED'], preset('parttime'), WEEK), ['THU', 'FRI'], 'Part-time replaces Full-time');
  assert.deepEqual(togglePreset(['MON', 'THU'], preset('all'), WEEK), WEEK);
  assert.deepEqual(togglePreset(WEEK, preset('all'), WEEK), []);
  assert.deepEqual(togglePreset(['SAT', 'SUN', 'MON', 'TUE', 'WED'], preset('fulltime'), WEEK), []);
});

test('presets for a shift: limited to its days, empty ones left out, the same days shown once', () => {
  assert.deepEqual(presetsFor(['SAT', 'SUN', 'MON', 'TUE', 'WED']).map((p) => [p.id, p.days.join(',')]), [['all', 'SAT,SUN,MON,TUE,WED']]);
  assert.deepEqual(presetsFor(WEEK).map((p) => p.id), ['all', 'fulltime', 'parttime']);
  assert.deepEqual(presetsFor(['MON', 'THU']).map((p) => [p.id, p.days.join(',')]), [['all', 'MON,THU'], ['fulltime', 'MON'], ['parttime', 'THU']]);
});

test('the editor shows when a check-in is late and when it is absent, as clock times', () => {
  assert.deepEqual(rowClockTimes(nextShift([])), { late: '07:30', absent: '08:00' }, 'Morning-Shift with the defaults');
  assert.deepEqual(rowClockTimes(row({ start: '18:40', graceMinutes: '30', absenceCutoffMinutes: '60' })), { late: '19:10', absent: '19:40' });
  assert.deepEqual(rowClockTimes(row({ start: '', graceMinutes: '30' })), { late: null, absent: null });
  assert.deepEqual(rowClockTimes(row({ graceMinutes: 'x', absenceCutoffMinutes: '' })), { late: null, absent: null });
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { canManageEntry, daysText, earliestWeekdaysDate, entryActions, monthEnd, monthWeeks, shiftMonth, validateEntry, validateWeekdays } from './calendarRules.js';

const year = { yearStart: '2026-09-01', yearEnd: '2027-06-30' };

describe('school days', () => {
  test('shown Saturday first, whatever order they come in', () => {
    assert.equal(daysText(['MON', 'SAT', 'SUN']), 'Sat, Sun, Mon');
    assert.equal(daysText([]), 'None');
  });

  test('earliest date: today for the first days, tomorrow once days apply; never before the year', () => {
    assert.equal(earliestWeekdaysDate({ today: '2026-10-01', yearStart: '2026-09-01', appliesToday: false }), '2026-10-01');
    assert.equal(earliestWeekdaysDate({ today: '2026-10-01', yearStart: '2026-09-01', appliesToday: true }), '2026-10-02');
    assert.equal(earliestWeekdaysDate({ today: '2026-08-01', yearStart: '2026-09-01', appliesToday: false }), '2026-09-01');
  });

  test('a form needs days (unless following the school) and a date from the earliest, within the year', () => {
    const limits = { earliest: '2026-10-02', ...year };
    assert.deepEqual(Object.keys(validateWeekdays({ days: [], effectiveFrom: '' }, limits)).sort(), ['days', 'effectiveFrom']);
    assert.ok(validateWeekdays({ days: ['MON'], effectiveFrom: '2026-10-01' }, limits).effectiveFrom);
    assert.ok(validateWeekdays({ days: ['MON'], effectiveFrom: '2027-07-01' }, limits).effectiveFrom);
    assert.deepEqual(validateWeekdays({ days: [], followsSchool: true, effectiveFrom: '2026-10-02' }, limits), {});
  });
});

describe('calendar entries', () => {
  const limits = { creating: true, needsBranch: true, firstEditable: '2026-10-01', ...year };

  test('names, branches, holidays and dates are checked; a reopening may leave its name out', () => {
    const p = validateEntry({ type: 'closure', name: 'X', startDate: '2026-10-05', endDate: '2026-10-04' }, limits);
    assert.deepEqual(Object.keys(p).sort(), ['branch', 'endDate', 'name']);
    assert.ok(validateEntry({ type: 'holiday', name: 'Eid', startDate: '2026-09-30', endDate: '2026-10-02' }, limits).startDate, 'fixed past days');
    assert.ok(validateEntry({ type: 'holiday', name: 'Eid', startDate: '2027-06-30', endDate: '2027-07-02' }, limits).endDate, 'outside the year');
    assert.deepEqual(validateEntry({ type: 'reopening', name: '', branch: 'b', holiday: 'h', startDate: '2026-10-05', endDate: '2026-10-05' }, { ...limits, holidayRange: { start: '2026-10-04', end: '2026-10-06' } }), {});
    assert.ok(validateEntry({ type: 'reopening', name: '', branch: 'b', holiday: 'h', startDate: '2026-10-05', endDate: '2026-10-07' }, { ...limits, holidayRange: { start: '2026-10-04', end: '2026-10-06' } }).endDate);
  });

  test('past days are fixed: what each entry offers', () => {
    const fe = '2026-10-10';
    const entry = (startDate, endDate, status = 'active') => ({ startDate, endDate, status, type: 'holiday' });
    assert.deepEqual(entryActions(entry('2026-10-12', '2026-10-13'), fe, { canManage: true }), { edit: true, rename: true, startLocked: false, cancel: 'cancel' });
    assert.deepEqual(entryActions(entry('2026-10-08', '2026-10-13'), fe, { canManage: true }), { edit: true, rename: true, startLocked: true, cancel: 'end' });
    assert.deepEqual(entryActions(entry('2026-10-01', '2026-10-02'), fe, { canManage: true }), { edit: false, rename: true, startLocked: true, cancel: null });
    assert.equal(entryActions(entry('2026-10-12', '2026-10-13', 'cancelled'), fe, { canManage: true }).cancel, null);
    assert.equal(entryActions(entry('2026-10-12', '2026-10-13'), fe, { canManage: false }).edit, false);
    assert.equal(canManageEntry({ type: 'holiday', branch: null }, 'MANAGER'), false);
    assert.equal(canManageEntry({ type: 'closure', branch: { id: 'b' } }, 'MANAGER'), true);
    // Extra school days: a Manager manages their branch's own, not the school-wide ones.
    assert.equal(canManageEntry({ type: 'school_day', branch: null }, 'MANAGER'), false);
    assert.equal(canManageEntry({ type: 'school_day', branch: { id: 'b' } }, 'MANAGER'), true);
    assert.equal(canManageEntry({ type: 'school_day', branch: null }, 'OWNER'), true);
  });
});

describe('month view', () => {
  test('weeks start on Saturday and pad the month', () => {
    // 1 November 2026 is a Sunday: one leading blank (Saturday).
    const weeks = monthWeeks('2026-11');
    assert.equal(weeks[0][0], null);
    assert.equal(weeks[0][1], '2026-11-01');
    assert.ok(weeks.every((w) => w.length === 7));
    assert.equal(weeks.flat().filter(Boolean).length, 30);
  });

  test('months move across years', () => {
    assert.equal(shiftMonth('2026-12', 1), '2027-01');
    assert.equal(shiftMonth('2026-01', -1), '2025-12');
    assert.equal(monthEnd('2028-02'), '2028-02-29');
  });
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { destinationOptions, emptyTransfer, overlapProblems, shiftSummary, toggleDay, toggleShift, toTransferBody, validateTransfer } from './transferRules.js';

const BRANCHES = [
  { id: 'b1', name: 'Main', code: 'S-B001', status: 'active' },
  { id: 'b2', name: 'North', code: 'S-B002', status: 'active' },
  { id: 'b3', name: 'East', code: 'S-B003', status: 'suspended' },
];
const SHIFTS = [
  { key: 'm', name: 'Morning', days: ['MON', 'TUE', 'WED'], start: '07:00', end: '12:00' },
  { key: 'x', name: 'Extra', days: ['MON'], start: '11:00', end: '14:00' },
  { key: 'a', name: 'Afternoon', days: ['MON', 'TUE'], start: '12:00', end: '17:00' },
];

test('destinations: active branches of the school except the current one', () => {
  assert.deepEqual(destinationOptions(BRANCHES, 'b1'), [{ value: 'b2', label: 'North (S-B002)' }]);
});

test('validation: destination required; the date from tomorrow to a year ahead', () => {
  const limits = { earliest: '2026-11-01', latest: '2027-11-01' };
  assert.deepEqual(Object.keys(validateTransfer(emptyTransfer('2026-11-01'), limits)), ['branchId']);
  assert.match(validateTransfer({ branchId: 'b2', effectiveFrom: '2026-10-31', shifts: {} }, limits).effectiveFrom, /tomorrow/);
  assert.match(validateTransfer({ branchId: 'b2', effectiveFrom: '2027-12-01', shifts: {} }, limits).effectiveFrom, /one year/);
  assert.deepEqual(validateTransfer({ branchId: 'b2', effectiveFrom: '2026-11-03', shifts: {} }, limits), {});
});

test('shift choice: a shift with all its days, days toggled, overlaps on shared days found, body in schedule order', () => {
  let shifts = toggleShift({}, SHIFTS[2], true);
  shifts = toggleShift(shifts, SHIFTS[0], true);
  assert.deepEqual(shifts, { a: ['MON', 'TUE'], m: ['MON', 'TUE', 'WED'] });
  shifts = toggleDay(shifts, 'm', 'MON', false);
  assert.deepEqual(shifts.m, ['TUE', 'WED']);
  assert.deepEqual(toggleDay({ x: ['MON'] }, 'x', 'MON', false), {});
  const form = { branchId: 'b2', effectiveFrom: '2026-11-03', shifts: { m: ['MON'], x: ['MON'] } };
  assert.deepEqual(overlapProblems(form, SHIFTS), { x: 'Overlaps "Morning" on a shared day.' });
  assert.deepEqual(overlapProblems({ ...form, shifts: { m: ['MON'], a: ['MON'] } }, SHIFTS), {}, 'a shift may start when another ends');
  assert.deepEqual(toTransferBody({ ...form, shifts: { a: ['TUE'], m: ['MON'] } }, SHIFTS).shifts, [
    { shiftKey: 'm', days: ['MON'] },
    { shiftKey: 'a', days: ['TUE'] },
  ]);
  assert.deepEqual(shiftSummary({ shifts: { m: ['MON'] } }, SHIFTS, (d) => d.join(', ')), ['Morning 07:00–12:00 (MON)']);
});

test('the earliest transfer date follows the platform effective delay', () => {
  const limits = { earliest: '2026-11-04', latest: '2027-11-01', delayDays: 3 };
  assert.match(validateTransfer({ branchId: 'b2', effectiveFrom: '2026-11-03', shifts: {} }, limits).effectiveFrom, /on 2026-11-04 \(3 days from today\)/);
  assert.deepEqual(validateTransfer({ branchId: 'b2', effectiveFrom: '2026-11-04', shifts: {} }, limits), {});
});

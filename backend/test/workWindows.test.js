/*
 * Staff working hours compared with lesson times (pure helpers, no database): which lessons fall
 * outside a staff member's shifts, and how their shifts are described.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { insideWindows, lessonsOutside, windowsText } from '../src/features/schedules/workWindows.js';

const LABELS = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };
const windows = { MON: [{ name: 'Morning', startMinute: 420, endMinute: 780 }], TUE: [{ name: 'Morning', startMinute: 420, endMinute: 780 }] };

test('a lesson is inside when one window covers it whole', () => {
  assert.equal(insideWindows(windows.MON, 450, 495), true);
  assert.equal(insideWindows(windows.MON, 750, 795), false, 'ends after 13:00');
  assert.equal(insideWindows(undefined, 450, 495), false);
});

test('lessons outside: after the shift, and on days without a shift; each time once', () => {
  const days = {
    MON: [{ startMinute: 450, endMinute: 495 }, { startMinute: 760, endMinute: 805 }, { startMinute: 760, endMinute: 805 }],
    WED: [{ startMinute: 450, endMinute: 495 }],
  };
  assert.deepEqual(lessonsOutside(days, windows), [
    { weekday: 'MON', startMinute: 760, endMinute: 805, reason: 'outside' },
    { weekday: 'WED', startMinute: 450, endMinute: 495, reason: 'no_shift' },
  ]);
  assert.deepEqual(lessonsOutside({}, windows), []);
});

test('shifts are described by name, times and days in week order', () => {
  assert.equal(windowsText({ TUE: windows.TUE, MON: windows.MON }, LABELS, ['MON', 'TUE']), 'Morning 07:00–13:00 (Mon, Tue)');
  assert.equal(windowsText({}, LABELS), '');
});

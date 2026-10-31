import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allRead, badgeText, bellLabel, categoryOptions, digestSummary, linkTarget, minutesProblem, preferenceRows, toggledCategories, withRead } from './notificationRules.js';

test('unread badge: hidden at 0, the number up to 9, then 9+; the bell is labelled with the count', () => {
  assert.deepEqual([0, -1, NaN, 1, 9, 10, 250].map(badgeText), [null, null, null, '1', '9', '9+', '9+']);
  assert.equal(bellLabel(0), 'Notifications');
  assert.equal(bellLabel(3), 'Notifications, 3 unread');
});

test('links: late arrivals open that day’s records; setup warnings open the role’s own page; nothing else', () => {
  const late = { link: { kind: 'attendanceRecords', date: '2026-10-29' } };
  assert.equal(linkTarget(late, 'MANAGER'), '/attendance?tab=records&range=custom&from=2026-10-29&to=2026-10-29');
  assert.equal(linkTarget({ link: { kind: 'schedule' } }, 'MANAGER'), '/schedule');
  assert.equal(linkTarget({ link: { kind: 'schedule' } }, 'OWNER'), null, 'Owners have no schedule page');
  assert.equal(linkTarget({ link: { kind: 'managers' } }, 'OWNER'), '/managers');
  assert.equal(linkTarget({ link: { kind: 'managers' } }, 'MANAGER'), null);
  assert.equal(linkTarget({ link: { kind: 'digest' } }, 'OWNER'), null);
  assert.equal(linkTarget({ link: null }, 'OWNER'), null);
});

test('read state updates: one item, or all, without touching others', () => {
  const items = [
    { source: 'notification', id: 'a', readAt: null },
    { source: 'announcement', id: 'a', readAt: null },
    { source: 'notification', id: 'b', readAt: '2026-10-01T00:00:00.000Z' },
  ];
  const one = withRead(items, { source: 'announcement', id: 'a', readAt: 'X' });
  assert.deepEqual(one.map((i) => i.readAt), [null, 'X', '2026-10-01T00:00:00.000Z']);
  assert.deepEqual(allRead(items, 'Y').map((i) => i.readAt), ['Y', 'Y', '2026-10-01T00:00:00.000Z']);
});

test('preferences: mandatory categories are locked on; switching an optional one builds the list to send', () => {
  const categories = [
    { key: 'ATTENDANCE', mandatory: false, enabled: true },
    { key: 'DIGEST', mandatory: false, enabled: false },
    { key: 'STATUS', mandatory: true, enabled: true },
  ];
  assert.deepEqual(preferenceRows(categories).map((r) => [r.key, r.locked, r.label]), [
    ['ATTENDANCE', false, 'Late arrivals'],
    ['DIGEST', false, 'Daily attendance digests'],
    ['STATUS', true, 'Suspensions and reactivations'],
  ]);
  assert.deepEqual(toggledCategories(categories, 'ATTENDANCE', false), ['ATTENDANCE', 'DIGEST']);
  assert.deepEqual(toggledCategories(categories, 'DIGEST', true), []);
  assert.deepEqual(categoryOptions(categories).map((o) => o.value), ['', 'ATTENDANCE', 'DIGEST', 'STATUS']);
});

test('digest view: the day, the final day before and each branch (counts only)', () => {
  const view = digestSummary({
    date: '2026-10-29',
    day: { checkIns: 5, present: 4, late: 1, staff: 5, checkedOut: 2, open: 3, notRequired: 0 },
    previous: { date: '2026-10-28', checkIns: 4, late: 2, missing: 1 },
    branches: [{ name: 'Hodan', code: 'X-B001', day: { checkIns: 5, late: 1, open: 3 }, previous: { missing: 1 } }],
  });
  assert.deepEqual(view.day.map((r) => r.value), [5, 4, 1, 5, 2, 3, 0]);
  assert.deepEqual(view.previous.rows.map((r) => [r.label, r.value]), [['Check-ins', 4], ['Late', 2], ['No check-out', 1]]);
  assert.deepEqual(view.branches[0], { name: 'Hodan', code: 'X-B001', checkIns: 5, late: 1, open: 3, missing: 1 });
  assert.equal(digestSummary(null), null);
});

test('branch reminder minutes: empty means the platform default; otherwise within the platform limits', () => {
  const limits = { min: 0, max: 30 };
  assert.equal(minutesProblem('', limits), '');
  assert.equal(minutesProblem('15', limits), '');
  assert.match(minutesProblem('31', limits), /from 0 to 30/);
  assert.match(minutesProblem('2.5', limits), /whole number/);
});

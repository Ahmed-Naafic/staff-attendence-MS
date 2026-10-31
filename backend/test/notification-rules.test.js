/*
 * Notification rules that need no database (docs/notifications/notification-specification.md):
 * Somali templates for every type (N24), mandatory categories (N12), the three reminder levels
 * (N5, N1), schedule-change targeting (N9), generic push payloads (N21) and retry timing.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CATEGORIES,
  effectiveReminders,
  isMandatory,
  NOTIFICATION_TYPES,
  ROLE_CATEGORIES,
  wantsCategory,
} from '../src/features/notifications/notificationTypes.js';
import { latestSets, scheduleImpact } from '../src/features/notifications/scheduleImpact.js';
import { PUSH_TEXTS, render, templateTypes } from '../src/features/notifications/templates.js';
import { genericPushMessage } from '../src/features/notifications/push.js';
import { MAX_ATTEMPTS, retryDelayMs } from '../src/features/notifications/outbox.js';

const SAMPLE = {
  LATE_CHECK_IN: { staffName: 'Amina Ali', staffCode: 'X-B001-ST001', shiftName: 'Subax', shiftStart: '07:30', date: '2026-10-29', time: '07:52', timeZone: 'Africa/Mogadishu' },
  MISSING_CHECK_OUT: { date: '2026-10-27', shiftName: 'Subax', shiftStart: '07:30', shiftEnd: '13:00', checkInTime: '07:28', timeZone: 'Africa/Mogadishu' },
  ASSIGNMENT_CHANGED: { effectiveFrom: '2026-11-01', shifts: [{ name: 'Subax', days: ['SAT', 'SUN'], start: '07:30', end: '13:00' }] },
  ASSIGNMENT_CANCELLED: { effectiveFrom: '2026-11-01' },
  SCHEDULE_CHANGED: { branchName: 'Hodan', effectiveFrom: '2026-11-01', shifts: [{ name: 'Subax', days: ['MON'], start: '08:00', end: '13:00' }, { name: 'Galab', removed: true }], checkOutChanged: true, checkOutEnabled: false },
  SCHEDULE_CHANGE_CANCELLED: { branchName: 'Hodan', effectiveFrom: '2026-11-01' },
  BRANCH_NO_SCHEDULE: { branch: { name: 'Hodan', code: 'X-B001' }, date: '2026-10-30' },
  MANAGER_TRANSFERRED: { fromBranch: { name: 'Hodan', code: 'X-B001' }, toBranch: { name: 'Wadajir', code: 'X-B002' } },
  BRANCH_SUSPENDED: { branch: { name: 'Hodan', code: 'X-B001' } },
  BRANCH_REACTIVATED: { branch: { name: 'Hodan', code: 'X-B001' } },
  SCHOOL_SUSPENDED: { schoolName: 'Iftiin', reason: 'Lacag bixin la’aan' },
  SCHOOL_REACTIVATED: { schoolName: 'Iftiin' },
  BRANCH_NO_MANAGER: { branch: { name: 'Hodan', code: 'X-B001' } },
  BRANCH_DIGEST: {
    date: '2026-10-29',
    branch: { name: 'Hodan', code: 'X-B001' },
    day: { checkIns: 12, present: 9, late: 3, staff: 12, checkedOut: 4, open: 8, missing: 0, notRequired: 0 },
    previous: { date: '2026-10-28', checkIns: 11, late: 2, missing: 1 },
  },
  STAFF_TRANSFERRED: { effectiveFrom: '2026-11-02', fromBranch: { name: 'Hodan', code: 'X-B001' }, toBranch: { name: 'Wadajir', code: 'X-B002' }, shifts: [{ name: 'Subax', days: ['SAT'], start: '07:30', end: '13:00' }], audience: 'staff' },
  STAFF_TRANSFER_IN: { effectiveFrom: '2026-11-02', staffName: 'Amina Ali', staffCode: 'X-B001-ST001', toBranch: { name: 'Wadajir', code: 'X-B002' }, audience: 'manager' },
  STAFF_TRANSFER_CANCELLED: { effectiveFrom: '2026-11-02', staffName: 'Amina Ali', staffCode: 'X-B001-ST001', toBranch: { name: 'Wadajir', code: 'X-B002' }, audience: 'staff' },
  SCHOOL_DIGEST: {
    date: '2026-10-29',
    schoolName: 'Iftiin',
    day: { checkIns: 20, present: 15, late: 5, staff: 20, checkedOut: 8, open: 12, missing: 0, notRequired: 0 },
    previous: { date: '2026-10-28', checkIns: 19, late: 4, missing: 2 },
    branches: [{ name: 'Hodan', code: 'X-B001' }],
  },
};

test('every notification type has a Somali template; no English fallback and no other language', () => {
  assert.deepEqual(templateTypes('so').sort(), Object.keys(NOTIFICATION_TYPES).sort());
  for (const type of Object.keys(NOTIFICATION_TYPES)) {
    const { title, body } = render(type, SAMPLE[type], 'so');
    assert.ok(title.length > 3 && body.length > 10, type);
    // Approved Somali wording, not English labels.
    assert.doesNotMatch(`${title} ${body}`, /\b(Late|Present|Check-in|Check-out|Branch|School|Shift|Notification|Suspended)\b/, type);
  }
  assert.throws(() => render('LATE_CHECK_IN', SAMPLE.LATE_CHECK_IN, 'en'), /No notification templates for language "en"/);
  assert.throws(() => render('UNKNOWN', {}, 'so'), /No "so" template/);
});

test('template content: approved status labels, event time, absence never claimed, reason only when given', () => {
  const late = render('LATE_CHECK_IN', SAMPLE.LATE_CHECK_IN);
  assert.match(late.body, /Daahay/);
  assert.match(late.body, /2026-10-29 07:52 \(Africa\/Mogadishu\)/);
  const missing = render('MISSING_CHECK_OUT', SAMPLE.MISSING_CHECK_OUT).body;
  assert.match(missing, /Waqti dhammaad lama qiyaasin/); // no end time is invented
  const digest = render('BRANCH_DIGEST', SAMPLE.BRANCH_DIGEST).body;
  assert.match(digest, /Xadirey: 9 · Daahay: 3/);
  assert.match(digest, /Maqnaanshaha lama xisaabin/); // absence is not calculated
  assert.match(render('SCHOOL_SUSPENDED', SAMPLE.SCHOOL_SUSPENDED).body, /Sababta: /);
  assert.doesNotMatch(render('SCHOOL_SUSPENDED', { schoolName: 'Iftiin' }).body, /Sababta/);
  assert.doesNotMatch(render('BRANCH_SUSPENDED', SAMPLE.BRANCH_SUSPENDED).body, /Sababta/);
  assert.match(render('SCHEDULE_CHANGED', SAMPLE.SCHEDULE_CHANGED).body, /Galab: jadwalka kama jiro/);
  assert.match(render('ASSIGNMENT_CHANGED', SAMPLE.ASSIGNMENT_CHANGED).body, /Subax \(Sabti, Axad\) 07:30–13:00/);
  // Transfers: the staff member's notice names both branches; the Manager's never names the origin branch.
  assert.match(render('STAFF_TRANSFERRED', SAMPLE.STAFF_TRANSFERRED).body, /Laga bilaabo 2026-11-02, laantaadu waa Wadajir \(X-B002\)\. Laantii hore: Hodan \(X-B001\)/);
  assert.doesNotMatch(render('STAFF_TRANSFER_IN', SAMPLE.STAFF_TRANSFER_IN).body, /Hodan/);
  assert.match(render('STAFF_TRANSFER_CANCELLED', SAMPLE.STAFF_TRANSFER_CANCELLED).body, /Waxaad sii joogaysaa laantaada/);
  assert.match(render('STAFF_TRANSFER_CANCELLED', { ...SAMPLE.STAFF_TRANSFER_CANCELLED, audience: 'manager' }).body, /Amina Ali \(X-B001-ST001\)/);
});

test('categories: suspensions, transfers and announcements are mandatory; each role has its own list', () => {
  assert.deepEqual(CATEGORIES.filter(isMandatory), ['MANAGER_ASSIGNMENT', 'STATUS', 'ANNOUNCEMENT', 'TRANSFER']);
  assert.equal(wantsCategory('STATUS', ['STATUS']), true);
  assert.equal(wantsCategory('SCHEDULE', ['SCHEDULE']), false);
  assert.equal(wantsCategory('SCHEDULE', []), true);
  assert.ok(!ROLE_CATEGORIES.OWNER.includes('ATTENDANCE'), 'Owners never get individual late arrivals (N7)');
  assert.ok(!ROLE_CATEGORIES.OWNER.includes('MISSING_CHECK_OUT'));
  assert.ok(ROLE_CATEGORIES.STAFF.includes('MISSING_CHECK_OUT'));
  for (const type of Object.keys(NOTIFICATION_TYPES)) assert.ok(CATEGORIES.includes(NOTIFICATION_TYPES[type]));
});

test('reminders (N5): platform ∧ branch ∧ staff; minutes from staff, branch or platform, always within the platform limits', () => {
  const platform = { checkInReminderEnabled: true, checkOutReminderEnabled: true, uploadReminderEnabled: true, checkInLeadDefault: 15, checkInLeadMin: 5, checkInLeadMax: 20, checkOutLeadDefault: 10, checkOutLeadMin: 0, checkOutLeadMax: 30, staffCanAdjustTiming: true };
  const base = effectiveReminders(platform, null, null);
  assert.deepEqual([base.checkIn.enabled, base.checkIn.leadMinutes, base.checkOut.leadMinutes, base.checkIn.consented], [true, 15, 10, false]);
  assert.equal(effectiveReminders(platform, { checkInLeadMinutes: 8 }, null).checkIn.leadMinutes, 8);
  assert.equal(effectiveReminders(platform, { checkInLeadMinutes: 8 }, { checkInLeadMinutes: 12 }).checkIn.leadMinutes, 12);
  // Staff cannot go outside the platform limits, even with stored values.
  assert.equal(effectiveReminders(platform, null, { checkInLeadMinutes: 30 }).checkIn.leadMinutes, 20);
  assert.equal(effectiveReminders(platform, { checkInLeadMinutes: 1 }, null).checkIn.leadMinutes, 5);
  // The platform can stop staff timing; staff choice is then ignored.
  assert.equal(effectiveReminders({ ...platform, staffCanAdjustTiming: false }, { checkInLeadMinutes: 8 }, { checkInLeadMinutes: 12 }).checkIn.leadMinutes, 8);
  // Off at any level → off; the staff member cannot turn on what the platform or branch turned off.
  assert.equal(effectiveReminders({ ...platform, checkInReminderEnabled: false }, null, { checkInReminder: true }).checkIn.enabled, false);
  assert.equal(effectiveReminders(platform, { checkOutReminderEnabled: false }, { checkOutReminder: true }).checkOut.enabled, false);
  assert.equal(effectiveReminders(platform, null, { checkOutReminder: false }).checkOut.enabled, false);
  assert.equal(effectiveReminders(platform, null, { checkOutReminder: false }).checkOut.available, true);
  assert.equal(effectiveReminders(platform, null, { locationConsentAt: new Date() }).checkIn.consented, true);
});

const v = (checkOutEnabled, shifts) => ({ checkOutEnabled, shifts });
const s = (shiftKey, name, days, startMinute, endMinute, graceMinutes = 10, absenceCutoffMinutes = 30) => ({ shiftKey, name, days, startMinute, endMinute, graceMinutes, absenceCutoffMinutes });
const WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

test('schedule changes (N9): only staff whose assigned shifts change are affected', () => {
  const before = v(true, [s('m', 'Morning', WEEK, 480, 720), s('a', 'Afternoon', WEEK, 780, 1020)]);
  const morningStaff = { shifts: [{ shiftKey: 'm', days: WEEK }] };
  const afternoonStaff = { shifts: [{ shiftKey: 'a', days: ['MON'] }] };
  const noShifts = { shifts: [] };

  const timesChanged = v(true, [s('m', 'Morning', WEEK, 450, 720), s('a', 'Afternoon', WEEK, 780, 1020)]);
  assert.equal(scheduleImpact(before, timesChanged, morningStaff).affected, true);
  assert.deepEqual(scheduleImpact(before, timesChanged, morningStaff).shifts, [{ name: 'Morning', days: WEEK, start: '07:30', end: '12:00' }]);
  assert.equal(scheduleImpact(before, timesChanged, afternoonStaff).affected, false);
  assert.equal(scheduleImpact(before, timesChanged, noShifts).affected, false);

  // A day the staff member does not work: no effect on them.
  const tuesdayRemoved = v(true, [s('m', 'Morning', WEEK, 480, 720), s('a', 'Afternoon', ['MON', 'WED', 'THU', 'FRI'], 780, 1020)]);
  assert.equal(scheduleImpact(before, tuesdayRemoved, afternoonStaff).affected, false);
  assert.equal(scheduleImpact(before, tuesdayRemoved, { shifts: [{ shiftKey: 'a', days: ['TUE'] }] }).affected, true);

  // A removed shift; a renamed shift; grace or cutoff changes.
  assert.deepEqual(scheduleImpact(before, v(true, [s('m', 'Morning', WEEK, 480, 720)]), afternoonStaff).shifts, [{ name: 'Afternoon', removed: true }]);
  assert.equal(scheduleImpact(before, v(true, [s('m', 'Early', WEEK, 480, 720), s('a', 'Afternoon', WEEK, 780, 1020)]), morningStaff).affected, true);
  assert.equal(scheduleImpact(before, v(true, [s('m', 'Morning', WEEK, 480, 720, 5), s('a', 'Afternoon', WEEK, 780, 1020)]), morningStaff).affected, true);

  // Check-out setting: everyone who works an assigned shift, nobody else.
  const noCheckOut = v(false, before.shifts);
  assert.deepEqual(
    [scheduleImpact(before, noCheckOut, morningStaff), scheduleImpact(before, noCheckOut, noShifts)].map((r) => [r.affected, r.checkOutChanged]),
    [[true, true], [false, false]],
  );
  // Identical versions affect nobody; a cancelled change compares the cancelled version with the one that applies.
  assert.equal(scheduleImpact(before, v(true, [...before.shifts].reverse()), morningStaff).affected, false);
  assert.equal(scheduleImpact(timesChanged, before, morningStaff).affected, true);
});

test('latestSets keeps the newest set per staff member', () => {
  const sets = [{ id: 1, staffUserId: 'x' }, { id: 2, staffUserId: 'y' }, { id: 3, staffUserId: 'x' }];
  assert.deepEqual([...latestSets(sets)].map(([k, set]) => [k, set.id]), [['x', 1], ['y', 2]]);
});

test('push payloads are generic (N21): no names, times, statuses, branches, reasons or ids', () => {
  for (const category of ['ATTENDANCE', 'STATUS', 'ANNOUNCEMENT']) {
    const message = genericPushMessage('ExponentPushToken[abcdefghijklmnop]', category);
    assert.equal(message.title, 'EduTrack');
    assert.ok([PUSH_TEXTS.so.attendance, PUSH_TEXTS.so.announcement].includes(message.body));
    assert.deepEqual(message.data, { kind: 'notification' });
    assert.deepEqual(Object.keys(message).sort(), ['body', 'channelId', 'data', 'priority', 'sound', 'title', 'to']);
  }
  assert.equal(genericPushMessage('t', 'ANNOUNCEMENT').body, 'Waxaad leedahay ogeysiis cusub oo EduTrack ah.');
  assert.equal(genericPushMessage('t', 'ATTENDANCE').body, 'Waxaad leedahay ogeysiis cusub oo imaanshaha ah.');
});

test('outbox retries back off and stop after the last attempt', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 8].map((n) => retryDelayMs(n) / 60000), [1, 5, 15, 60, 180, 180]);
  assert.equal(MAX_ATTEMPTS, 8);
});

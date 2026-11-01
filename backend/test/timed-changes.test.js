/*
 * "Allow changes to take effect at their scheduled time" (Platform Settings → Scheduling &
 * Assignments; approved 2026-11-01): off by default (the effective delay applies; changes start at
 * 00:00 and a time is refused); on: schedule changes, assignment changes and transfers may start
 * today or later at a chosen time, never in the past, saved at once and pending until then; a day
 * with a change after 00:00 judges each shift by the version and set in effect at the shift's start;
 * settings changes are audited. Runs on the Neon dev branch (`npm test`). The settings row is
 * restored afterwards exactly as it was, and everything else the tests create is removed.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { zonedInstant, zonedMidnight } from '../src/common/zonedTime.js';
import { getPrisma } from '../src/config/prisma.js';
import { composeDay, localMoment, recordEvent } from '../src/features/attendance/attendance.service.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { resolveEffective, schedulingSettings } from '../src/features/platform-settings/schedulingPolicy.js';
import { platformTimeZone } from '../src/features/platform-settings/settings.service.js';
import { addDays, scheduleAt } from '../src/features/schedules/schedules.service.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Timed changes tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const phonePrefix = `+97${String(parseInt(randomBytes(3).toString('hex'), 16)).padStart(8, '0')}`;
const ALL = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const POSITION = { latitude: 2.046934, longitude: 45.318162 };
const MINUTE = 60_000;
const startedAt = new Date();
const SETTINGS = { effectiveDelayDays: true, immediateFirstSchedule: true, immediateFirstAssignment: true, timedChanges: true };
const people = {};
const schools = {};
const branches = {};
let original;
let server;
let base;
let zone;
let today;
let counter = 0;

async function call(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(method !== 'GET' && { origin: ORIGIN }), ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const as = (key, path, options = {}) => call(path, { ...options, cookie: people[key].cookie });
const forcePolicy = (data) => prisma.platformSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform', ...data }, update: data });
const resetPolicy = () => forcePolicy({ effectiveDelayDays: null, immediateFirstSchedule: null, immediateFirstAssignment: null, timedChanges: null });
/** Local 'HH:MM' of an instant in the platform zone. */
const hhmm = (instant) => {
  const m = Math.floor(localMoment(instant, zone).minutes);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
/** A local date and time a few minutes from now (rounded to the minute), as { date, time, at }. */
function soon(minutes) {
  const at = new Date(Math.ceil((Date.now() + minutes * MINUTE) / MINUTE) * MINUTE);
  return { date: localMoment(at, zone).date, time: hhmm(at), at };
}

async function webUser(key, role, extra = {}) {
  counter += 1;
  const password = `pw-${randomBytes(9).toString('base64url')}`;
  const user = await prisma.user.create({ data: { name: `Timed ${key} ${tag}`, email: `test-timed-${counter}-${lower}@test.edutrack.example`, role, passwordHash: await hashPassword(password), ...extra } });
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email: user.email, password }) });
  assert.equal(res.status, 200, `${key} sign-in`);
  people[key] = { ...user, cookie: res.headers.get('set-cookie').split(';')[0] };
  return people[key];
}

async function makeBranch(key, n) {
  const branch = await prisma.branch.create({
    data: { schoolId: schools.A.id, number: n, code: `${schools.A.code}-B00${n}`, name: `Timed ${key} ${tag}`, nameKey: `timed ${key.toLowerCase()} ${lower}`, address: 'Road', city: 'Mogadishu' },
  });
  await prisma.branchLocation.create({ data: { branchId: branch.id, ...POSITION, accuracyMeters: 8, effectiveFrom: new Date(Date.now() - 20 * 86_400_000) } });
  branches[key] = branch;
  const manager = await webUser(`M${key}`, 'MANAGER', { branchId: branch.id });
  await prisma.managerAssignment.create({ data: { managerId: manager.id, branchId: branch.id } });
  return branch;
}

async function staffOf(key, branchKey) {
  counter += 1;
  const branch = branches[branchKey];
  const phone = `${phonePrefix}${String(counter).padStart(3, '0')}`;
  people[key] = await prisma.user.create({
    data: {
      name: `Timed Staff ${key} ${tag}`,
      email: `test-timed-${counter}-${lower}@test.edutrack.example`,
      role: 'STAFF',
      branchId: branch.id,
      staffId: `${branch.code}-ST${String(counter).padStart(3, '0')}`,
      phone,
      phoneKey: phone,
      jobTitle: 'Teacher',
      passwordHash: await hashPassword(randomBytes(12).toString('base64url')),
    },
  });
  return people[key];
}

const shift = (name, start, end, extra = {}) => ({ name, days: ALL, start, end, graceMinutes: 0, absenceCutoffMinutes: 0, ...extra });

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  original = await prisma.platformSettings.findUnique({ where: { id: 'platform' }, select: SETTINGS });
  await resetPolicy();
  zone = await platformTimeZone();
  today = localMoment(new Date(), zone).date;
  await webUser('admin', 'SUPER_ADMIN');
  schools.A = await prisma.school.create({ data: { code: `TC${tag}`, name: `Timed School ${tag}`, location: 'Mogadishu' } });
  await prisma.school.update({ where: { id: schools.A.id }, data: { ownerId: (await webUser('owner', 'OWNER')).id } });
  for (const [key, n] of [['A1', 1], ['A2', 2], ['A3', 3]]) await makeBranch(key, n);
});

after(async () => {
  try {
    await cleanUp();
  } finally {
    server.close();
    await prisma.$disconnect();
  }
});

async function cleanUp() {
  if (original) await forcePolicy(original);
  else await resetPolicy();
  const schoolIds = Object.values(schools).map((s) => s.id);
  const branchIds = Object.values(branches).map((b) => b.id);
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  const transfers = (await prisma.staffTransfer.findMany({ where: { schoolId: { in: schoolIds } }, select: { id: true } })).map((t) => t.id);
  const sets = (await prisma.staffAssignment.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((s) => s.id);
  const versions = (await prisma.branchSchedule.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((v) => v.id);
  const ids = [...schoolIds, ...branchIds, ...userIds, ...transfers, ...sets, ...versions];
  await prisma.$executeRaw`DELETE FROM "NotificationEvent" WHERE "createdAt" >= ${startedAt} AND "payload"::text ~ ${ids.join('|')}`;
  await prisma.staffTransfer.deleteMany({ where: { id: { in: transfers } } });
  await prisma.attendanceEvent.deleteMany({ where: { branchId: { in: branchIds }, type: 'CHECK_OUT' } });
  await prisma.attendanceEvent.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.auditEvent.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { actorId: { in: userIds } }, { targetId: { in: ids } }] } });
  await prisma.staffAssignmentShift.deleteMany({ where: { assignmentId: { in: sets } } });
  await prisma.staffAssignment.deleteMany({ where: { id: { in: sets } } });
  await prisma.branchShift.deleteMany({ where: { scheduleId: { in: versions } } });
  await prisma.branchSchedule.deleteMany({ where: { id: { in: versions } } });
  await prisma.branchLocation.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.branchReminderSettings.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.managerAssignment.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.pushMessage.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { recipientId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds }, role: { in: ['STAFF', 'MANAGER'] } } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
  await prisma.school.updateMany({ where: { id: { in: schoolIds } }, data: { ownerId: null } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

// ---- rules (no database) -----------------------------------------------------------------

describe('the effective moment under the policy', () => {
  const off = schedulingSettings({});
  const on = schedulingSettings({ timedChanges: true });
  const base = { what: 'schedule', timeZone: 'Africa/Mogadishu', today: '2026-11-01', latest: '2027-11-01', now: new Date('2026-11-01T10:00:00Z') }; // 13:00 local

  test('off (default): 00:00 of the date, the delay applies, and a time is refused', () => {
    assert.equal(off.timedChanges, false);
    const { effectiveAt } = resolveEffective(off, { ...base, effectiveFrom: '2026-11-02', effectiveTime: null });
    assert.equal(effectiveAt.toISOString(), '2026-11-01T21:00:00.000Z', '00:00 in Mogadishu');
    assert.throws(() => resolveEffective(off, { ...base, effectiveFrom: '2026-11-01', effectiveTime: null }), (e) => /tomorrow/.test(e.details.effectiveFrom));
    assert.throws(() => resolveEffective(off, { ...base, effectiveFrom: '2026-11-02', effectiveTime: 14 * 60 }), (e) => Boolean(e.details.effectiveTime));
  });

  test('on: today at a time after now is accepted; a past time or date is refused; the delay is bypassed', () => {
    const { effectiveAt } = resolveEffective(on, { ...base, effectiveFrom: '2026-11-01', effectiveTime: 13 * 60 + 30 });
    assert.equal(effectiveAt.toISOString(), '2026-11-01T10:30:00.000Z');
    assert.throws(() => resolveEffective(on, { ...base, effectiveFrom: '2026-11-01', effectiveTime: 13 * 60 }), (e) => /after now \(13:00\)/.test(e.details.effectiveTime), 'now itself is not after now');
    assert.throws(() => resolveEffective(on, { ...base, effectiveFrom: '2026-11-01', effectiveTime: 9 * 60 }), (e) => /in the past/.test(e.details.effectiveTime));
    assert.throws(() => resolveEffective(on, { ...base, effectiveFrom: '2026-10-31', effectiveTime: 23 * 60 }), (e) => /in the past/.test(e.details.effectiveFrom));
    assert.throws(() => resolveEffective(on, { ...base, effectiveFrom: '2027-11-02', effectiveTime: 0 }), (e) => /one year/.test(e.details.effectiveFrom));
    // The delay and the "first may start today" switches do not matter.
    const strict = schedulingSettings({ timedChanges: true, effectiveDelayDays: 30, immediateFirstSchedule: false });
    assert.equal(resolveEffective(strict, { ...base, effectiveFrom: '2026-11-01', effectiveTime: 14 * 60, first: true }).effectiveAt.toISOString(), '2026-11-01T11:00:00.000Z');
  });
});

describe('a split day: each shift by the version and set in effect at its start', () => {
  const date = '2026-11-01';
  const tz = 'Africa/Mogadishu';
  const at = (h, m = 0) => zonedInstant(date, h * 60 + m, tz);
  const version = (id, effectiveAt, shifts, checkOutEnabled = true) => ({
    id,
    effectiveAt,
    timeZone: tz,
    checkOutEnabled,
    shifts: shifts.map(([shiftKey, start, end, grace = 0]) => ({ shiftKey, name: shiftKey, days: ALL, startMinute: start * 60, endMinute: end * 60, graceMinutes: grace, absenceCutoffMinutes: 0 })),
  });
  const set = (id, effectiveAt, keys) => ({ id, effectiveAt, shifts: keys.map((shiftKey) => ({ shiftKey, days: ALL })) });

  test('a change at 12:30: the 07:00 shift keeps the old version; later shifts follow the new one; sets likewise', () => {
    const v1 = version('v1', zonedMidnight('2026-10-01', tz), [['K1', 7, 12], ['K2', 13, 18]]);
    const v2 = version('v2', at(12, 30), [['K1', 7, 12, 30], ['K2', 14, 19], ['K3', 20, 22]], false);
    const s1 = set('s1', zonedMidnight('2026-10-01', tz), ['K1', 'K2']);
    const s2 = set('s2', at(19, 30), ['K1', 'K2', 'K3']);
    const { schedule, assignment } = composeDay(date, [v1, v2], [s1, s2], at(15));
    assert.deepEqual(schedule.shifts.map((s) => [s.shiftKey, s.scheduleId, s.startMinute / 60, s.graceMinutes]), [
      ['K1', 'v1', 7, 0],
      ['K2', 'v2', 14, 0],
      ['K3', 'v2', 20, 0],
    ]);
    assert.equal(schedule.id, 'v2', 'the version in effect at the event');
    assert.equal(schedule.checkOutEnabled, false);
    assert.equal(schedule.shifts[0].checkOutEnabled, true, "each shift keeps its version's check-out setting");
    assert.deepEqual(assignment.shifts.map((a) => [a.shiftKey, a.assignmentId]), [['K1', 's1'], ['K2', 's1'], ['K3', 's2']]);
  });

  test('a shift moved later the same day occurs once: the earliest occurrence', () => {
    const v1 = version('v1', zonedMidnight('2026-10-01', tz), [['K1', 7, 9]]);
    const v2 = version('v2', at(12), [['K1', 15, 17]]);
    const { schedule } = composeDay(date, [v1, v2], [set('s1', zonedMidnight('2026-10-01', tz), ['K1'])], at(16));
    assert.deepEqual(schedule.shifts.map((s) => [s.shiftKey, s.scheduleId, s.startMinute / 60]), [['K1', 'v1', 7]]);
  });

  test("a branch's first schedule starting at 13:00: no shift before then", () => {
    const v = version('v', at(13), [['K1', 8, 12], ['K2', 13, 17]]);
    const { schedule, assignment } = composeDay(date, [v], [], at(14));
    assert.deepEqual(schedule.shifts.map((s) => s.shiftKey), ['K2']);
    assert.equal(assignment, null);
  });
});

// ---- the setting --------------------------------------------------------------------------

test('only a Super Admin turns it on; off by default; each change is audited; the same value records nothing', async () => {
  const read = await as('admin', '/api/platform/settings');
  assert.equal(read.body.settings.scheduling.timedChanges, false);
  for (const key of ['owner', 'MA1']) assert.equal((await as(key, '/api/platform/settings/scheduling', { method: 'PUT', body: { timedChanges: true } })).status, 403, key);
  assert.equal((await as('admin', '/api/platform/settings/scheduling', { method: 'PUT', body: { timedChanges: 'yes' } })).status, 400);
  const on = await as('admin', '/api/platform/settings/scheduling', { method: 'PUT', body: { timedChanges: true } });
  assert.equal(on.status, 200);
  assert.equal(on.body.scheduling.timedChanges, true);
  assert.equal((await as('admin', '/api/platform/settings/scheduling', { method: 'PUT', body: { timedChanges: true } })).status, 200);
  const events = await prisma.auditEvent.findMany({ where: { action: 'SCHEDULING_SETTINGS_UPDATED', occurredAt: { gte: startedAt } } });
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].change, { field: 'Allow changes to take effect at their scheduled time', from: 'No', to: 'Yes' });
  await resetPolicy();
});

// ---- schedules, assignments, transfers ------------------------------------------------------

describe('timed changes through the API', () => {
  let day;

  test('off: a time is refused; the first schedule starts today at 00:00 as before', async () => {
    const refused = await as('MA1', '/api/manager/schedule', { method: 'POST', body: { effectiveFrom: addDays(today, 1), effectiveTime: '13:00', checkOutEnabled: true, shifts: [shift('Day', '00:00', '23:59')] } });
    assert.equal(refused.status, 400);
    assert.ok(refused.body.details.effectiveTime);
    const first = await as('MA1', '/api/manager/schedule', { method: 'POST', body: { effectiveFrom: today, checkOutEnabled: true, shifts: [shift('Day', '00:00', '23:59')] } });
    assert.equal(first.status, 200);
    assert.equal(first.body.current.effectiveTime, '00:00');
    assert.equal(first.body.timedChanges, false);
    day = first.body.current.shifts[0].key;
  });

  test('on: a change for later today is saved at once, pending until its time; past times are refused', async () => {
    await forcePolicy({ timedChanges: true });
    const page = await as('MA1', '/api/manager/schedule');
    assert.equal(page.body.timedChanges, true);
    assert.equal(page.body.earliestEffectiveDate, today);
    assert.ok(page.body.now?.time, 'the local time now, for the form');
    const past = await as('MA1', '/api/manager/schedule', { method: 'POST', body: { effectiveFrom: today, effectiveTime: hhmm(new Date(Date.now() - 2 * MINUTE)), checkOutEnabled: true, shifts: [shift('Day', '00:00', '23:59', { key: day, graceMinutes: 30, absenceCutoffMinutes: 30 })] } });
    assert.equal(past.status, 400);
    assert.match(past.body.details.effectiveTime ?? past.body.details.effectiveFrom, /past/);
    const later = soon(30);
    if (later.date !== today) return; // too close to midnight for a same-day check
    const res = await as('MA1', '/api/manager/schedule', { method: 'POST', body: { effectiveFrom: today, effectiveTime: later.time, checkOutEnabled: true, shifts: [shift('Day', '00:00', '23:59', { key: day, graceMinutes: 30, absenceCutoffMinutes: 30 })] } });
    assert.equal(res.status, 200);
    assert.equal(res.body.current.shifts[0].graceMinutes, 0, 'the current version stays in effect until then');
    assert.deepEqual([res.body.scheduled.effectiveFrom, res.body.scheduled.effectiveTime], [today, later.time]);
    assert.equal(new Date(res.body.scheduled.effectiveAt).getTime(), later.at.getTime());
    // Activation: nothing runs; from that instant the new version applies (both on the same date).
    assert.equal((await scheduleAt(branches.A1.id, new Date(later.at.getTime() - 1))).shifts[0].graceMinutes, 0);
    assert.equal((await scheduleAt(branches.A1.id, later.at)).shifts[0].graceMinutes, 30);
    const versions = await as('MA1', '/api/manager/schedule/versions');
    const current = versions.body.items.find((v) => v.state === 'current');
    assert.equal(current.effectiveUntil, today, 'the current version applies until the change that day');
    assert.equal(new Date(current.endsAt).getTime(), later.at.getTime());
    // Cancelling the pending change keeps it as cancelled.
    assert.equal((await as('MA1', '/api/manager/schedule/scheduled', { method: 'DELETE' })).body.scheduled, null);
    const audit = await prisma.auditEvent.findMany({ where: { targetId: branches.A1.id, action: { startsWith: 'BRANCH_SCHEDULE' } }, orderBy: { occurredAt: 'asc' } });
    assert.ok(audit.some((e) => e.description.includes(`${today} ${later.time}`)), 'the audit names the date and time');
  });

  test('on: assignments for later today; a transfer at a chosen time; both pending until then', async () => {
    await forcePolicy({ timedChanges: true });
    await staffOf('S1', 'A1');
    await as('MA2', '/api/manager/schedule', { method: 'POST', body: { effectiveFrom: today, effectiveTime: soon(2).time, checkOutEnabled: false, shifts: [shift('Day', '00:00', '23:59')] } });
    const later = soon(45);
    if (later.date !== today) return;
    const first = await as('MA1', `/api/manager/staff/${people.S1.id}/assignments`, { method: 'POST', body: { effectiveFrom: today, effectiveTime: soon(1).time, shifts: [{ shiftKey: day, days: ALL }] } });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const set = await as('MA1', `/api/manager/staff/${people.S1.id}/assignments`, { method: 'POST', body: { effectiveFrom: today, effectiveTime: later.time, shifts: [] } });
    assert.equal(set.status, 200);
    assert.deepEqual([set.body.staff.assignments.scheduled.effectiveFrom, set.body.staff.assignments.scheduled.effectiveTime], [today, later.time]);
    const ownerView = await as('owner', `/api/owner/staff/${people.S1.id}`);
    assert.equal(ownerView.body.staff.timedChanges, true);
    assert.equal(ownerView.body.staff.earliestTransferDate, today);
    const transferAt = soon(60);
    const transfer = await as('owner', `/api/owner/staff/${people.S1.id}/transfer`, { method: 'POST', body: { branchId: branches.A2.id, effectiveFrom: transferAt.date, effectiveTime: transferAt.time, shifts: [] } });
    assert.equal(transfer.status, 201, JSON.stringify(transfer.body));
    assert.equal(new Date(transfer.body.transfer.effectiveAt).getTime(), transferAt.at.getTime());
    assert.equal(transfer.body.transfer.effectiveTime, transferAt.time);
    // The pending assignment change starting before the transfer is kept; the user's branch is unchanged until then.
    assert.equal((await prisma.user.findUnique({ where: { id: people.S1.id } })).branchId, branches.A1.id);
    await resetPolicy();
  });
});

// ---- attendance on a split day ----------------------------------------------------------

test('a check-in after a mid-day change, for a shift that started before it, is judged by the old version', async (t) => {
  const now = new Date();
  const minutes = localMoment(now, zone).minutes;
  if (minutes < 10 || minutes > 1430) return t.skip('too close to midnight');
  // A3: "Day" 00:00–23:59 with grace 0 since long ago; a change 3 minutes ago gives it the longest grace.
  const old = await prisma.branchSchedule.create({
    data: { branchId: branches.A3.id, effectiveFrom: new Date(`${addDays(today, -10)}T00:00:00Z`), timeZone: zone, checkOutEnabled: true, shifts: { create: [{ shiftKey: randomUUID(), name: 'Day', days: ALL, startMinute: 0, endMinute: 1439, graceMinutes: 0, absenceCutoffMinutes: 0 }] } },
    include: { shifts: true },
  });
  const key = old.shifts[0].shiftKey;
  const changedAt = new Date(now.getTime() - 3 * MINUTE);
  const changed = await prisma.branchSchedule.create({
    data: { branchId: branches.A3.id, effectiveFrom: new Date(`${today}T00:00:00Z`), effectiveAt: changedAt, timeZone: zone, checkOutEnabled: true, shifts: { create: [{ shiftKey: key, name: 'Day', days: ALL, startMinute: 0, endMinute: 1439, graceMinutes: 1439, absenceCutoffMinutes: 1439 }] } },
  });
  const staff = await staffOf('S3', 'A3');
  const set = await prisma.staffAssignment.create({ data: { staffUserId: staff.id, branchId: branches.A3.id, effectiveFrom: new Date(`${addDays(today, -10)}T00:00:00Z`), timeZone: zone, shifts: { create: [{ shiftKey: key, days: ALL }] } } });
  const { event } = await recordEvent({ id: staff.id, branchId: branches.A3.id }, { clientEventId: randomUUID(), type: 'CHECK_IN', occurredAt: now, sentAt: now, position: { ...POSITION, accuracy: 10 } }, now);
  assert.equal(event.status, 'LATE', 'grace 0 of the version in effect when the shift started (00:00)');
  const stored = await prisma.attendanceEvent.findUnique({ where: { id: event.id } });
  assert.deepEqual([stored.scheduleId, stored.assignmentId], [old.id, set.id]);
  assert.notEqual(stored.scheduleId, changed.id);
  // Check-out: the check-in's own version decides (check-out on).
  const out = await recordEvent({ id: staff.id, branchId: branches.A3.id }, { clientEventId: randomUUID(), type: 'CHECK_OUT', occurredAt: new Date(now.getTime() + 1000), sentAt: new Date(now.getTime() + 1000) , position: { ...POSITION, accuracy: 10 } }, new Date(now.getTime() + 1000));
  assert.equal(out.event.checkInEventId, event.id);
});

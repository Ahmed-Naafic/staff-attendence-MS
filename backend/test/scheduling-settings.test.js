/*
 * Scheduling & Assignments settings (approved 2026-11-01; docs/business-rules.md → Scheduling &
 * Assignments settings): only a SUPER_ADMIN changes them; the effective delay is 1–30 calendar days
 * (default 1) in the platform time zone and is the earliest date for schedule changes, assignment
 * changes and staff transfers; the two switches let a first schedule / first assignment set start
 * today (default on); changes are saved at once, wait as pending (scheduled) and apply from 00:00 of
 * their date without any job; pending changes can be replaced and cancelled and are kept; settings
 * changes are audited and never re-date saved changes or recorded attendance.
 * Runs on the Neon dev branch (`npm test`). The settings row is restored afterwards exactly as it
 * was, and everything else the tests create is removed.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { earliestDateProblem, earliestEffectiveDate, readScheduling, schedulingSettings } from '../src/features/platform-settings/schedulingPolicy.js';
import { platformTimeZone } from '../src/features/platform-settings/settings.service.js';
import { addDays, localDate, scheduleOn } from '../src/features/schedules/schedules.service.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Scheduling settings tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const phonePrefix = `+96${String(parseInt(randomBytes(3).toString('hex'), 16)).padStart(8, '0')}`;
const ALL = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const startedAt = new Date();
const SETTINGS_COLUMNS = { effectiveDelayDays: true, immediateFirstSchedule: true, immediateFirstAssignment: true, timedChanges: true };
const people = {};
const schools = {};
const branches = {};
let original; // the three settings before the tests (null when the row did not exist)
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
const setPolicy = (body, key = 'admin') => as(key, '/api/platform/settings/scheduling', { method: 'PUT', body });
/** Writes the settings directly (bypassing the API and its audit) for a test's starting point. */
const forcePolicy = (data) => prisma.platformSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform', ...data }, update: data });
const resetPolicy = () => forcePolicy({ effectiveDelayDays: null, immediateFirstSchedule: null, immediateFirstAssignment: null, timedChanges: null });

async function webUser(key, role, extra = {}) {
  counter += 1;
  const password = `pw-${randomBytes(9).toString('base64url')}`;
  const user = await prisma.user.create({ data: { name: `Sched ${key} ${tag}`, email: `test-schp-${counter}-${lower}@test.edutrack.example`, role, passwordHash: await hashPassword(password), ...extra } });
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email: user.email, password }) });
  assert.equal(res.status, 200, `${key} sign-in`);
  people[key] = { ...user, cookie: res.headers.get('set-cookie').split(';')[0] };
  return people[key];
}

async function makeBranch(key, n) {
  const branch = await prisma.branch.create({
    data: { schoolId: schools.A.id, number: n, code: `${schools.A.code}-B00${n}`, name: `Sched ${key} ${tag}`, nameKey: `sched ${key.toLowerCase()} ${lower}`, address: 'Road', city: 'Mogadishu' },
  });
  branches[key] = branch;
  const manager = await webUser(`M${key}`, 'MANAGER', { branchId: branch.id });
  await prisma.managerAssignment.create({ data: { managerId: manager.id, branchId: branch.id } });
  return branch;
}

/** A staff member of a branch, with no assignment set. */
async function staffOf(key, branchKey) {
  counter += 1;
  const branch = branches[branchKey];
  const phone = `${phonePrefix}${String(counter).padStart(3, '0')}`;
  people[key] = await prisma.user.create({
    data: {
      name: `Sched Staff ${key} ${tag}`,
      email: `test-schp-${counter}-${lower}@test.edutrack.example`,
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

const shift = (name, start, end, key) => ({ ...(key && { key }), name, days: ALL, start, end, graceMinutes: 5, absenceCutoffMinutes: 30 });
const saveSchedule = (branchKey, effectiveFrom, shifts) => as(`M${branchKey}`, '/api/manager/schedule', { method: 'POST', body: { effectiveFrom, checkOutEnabled: false, shifts } });
const saveSet = (branchKey, staffKey, effectiveFrom, shiftKeys) =>
  as(`M${branchKey}`, `/api/manager/staff/${people[staffKey].id}/assignments`, { method: 'POST', body: { effectiveFrom, shifts: shiftKeys.map((shiftKey) => ({ shiftKey, days: ALL })) } });
const auditEvents = (action) => prisma.auditEvent.findMany({ where: { action, occurredAt: { gte: startedAt } }, orderBy: { occurredAt: 'asc' } });

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  original = await prisma.platformSettings.findUnique({ where: { id: 'platform' }, select: SETTINGS_COLUMNS });
  await resetPolicy();
  zone = await platformTimeZone();
  today = localDate(zone);
  await webUser('admin', 'SUPER_ADMIN');
  schools.A = await prisma.school.create({ data: { code: `SP${tag}`, name: `Sched Policy School ${tag}`, location: 'Mogadishu' } });
  await prisma.school.update({ where: { id: schools.A.id }, data: { ownerId: (await webUser('owner', 'OWNER')).id } });
  for (const [key, n] of [['A1', 1], ['A2', 2], ['A3', 3], ['A4', 4]]) await makeBranch(key, n);
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
  await prisma.attendanceEvent.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.branchLocation.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.auditEvent.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { actorId: { in: userIds } }, { targetId: { in: ids } }] } });
  await prisma.staffAssignmentShift.deleteMany({ where: { assignmentId: { in: sets } } });
  await prisma.staffAssignment.deleteMany({ where: { id: { in: sets } } });
  await prisma.branchShift.deleteMany({ where: { scheduleId: { in: versions } } });
  await prisma.branchSchedule.deleteMany({ where: { id: { in: versions } } });
  await prisma.managerAssignment.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.pushMessage.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { recipientId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds }, role: { in: ['STAFF', 'MANAGER'] } } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
  await prisma.school.updateMany({ where: { id: { in: schoolIds } }, data: { ownerId: null } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

// ---- the rules themselves (no database) ------------------------------------------------------

describe('effective dates are calendar days in the platform time zone', () => {
  test('earliest date: today + N calendar days, across month, year and leap-day boundaries', () => {
    assert.equal(earliestEffectiveDate('2026-11-01', { delayDays: 1 }), '2026-11-02');
    assert.equal(earliestEffectiveDate('2026-11-30', { delayDays: 1 }), '2026-12-01');
    assert.equal(earliestEffectiveDate('2026-12-31', { delayDays: 1 }), '2027-01-01');
    assert.equal(earliestEffectiveDate('2028-02-28', { delayDays: 1 }), '2028-02-29');
    assert.equal(earliestEffectiveDate('2026-11-01', { delayDays: 30 }), '2026-12-01');
  });

  test('a first schedule or set may start today only when its switch is on', () => {
    assert.equal(earliestEffectiveDate('2026-11-01', { delayDays: 3, first: true, immediateFirst: true }), '2026-11-01');
    assert.equal(earliestEffectiveDate('2026-11-01', { delayDays: 3, first: true, immediateFirst: false }), '2026-11-04');
    assert.equal(earliestEffectiveDate('2026-11-01', { delayDays: 3, first: false, immediateFirst: true }), '2026-11-04');
  });

  test('not 24 hours: a change at 23:59 or at 00:01 local time gets the next calendar day', () => {
    // 01 Nov 2026 23:59 and 00:01 in Mogadishu (UTC+3) are 20:59 and 21:01 UTC on different UTC
    // days around midnight; the local date decides, so each starts the next local day at 00:00.
    const late = localDate('Africa/Mogadishu', new Date('2026-11-01T20:59:00Z'));
    const early = localDate('Africa/Mogadishu', new Date('2026-11-01T21:01:00Z'));
    assert.equal(late, '2026-11-01');
    assert.equal(early, '2026-11-02');
    assert.equal(earliestEffectiveDate(late, { delayDays: 1 }), '2026-11-02'); // 1 minute later, not 24 hours
    assert.equal(earliestEffectiveDate(early, { delayDays: 1 }), '2026-11-03');
  });

  test('messages name the date: tomorrow for 1 day, the date and the number of days otherwise', () => {
    assert.match(earliestDateProblem('schedule', { today: '2026-11-01', earliest: '2026-11-02', delayDays: 1, first: false }), /tomorrow \(2026-11-02\)/);
    assert.match(earliestDateProblem('assignments', { today: '2026-11-01', earliest: '2026-11-04', delayDays: 3, first: false }), /on 2026-11-04 \(3 days from today\)/);
    assert.match(earliestDateProblem('schedule', { today: '2026-11-01', earliest: '2026-11-04', delayDays: 3, first: true }), /first schedule can start on 2026-11-04/);
    assert.match(earliestDateProblem('transfer', { today: '2026-11-01', earliest: '2026-11-02', delayDays: 1 }), /transfer can start tomorrow/);
  });

  test('defaults: an empty or invalid stored value means 1 day and both switches on', () => {
    for (const row of [null, {}, { effectiveDelayDays: 0, immediateFirstSchedule: null }, { effectiveDelayDays: 31 }]) {
      const s = schedulingSettings(row);
      assert.deepEqual([s.effectiveDelayDays, s.immediateFirstSchedule, s.immediateFirstAssignment], [1, true, true]);
    }
  });

  test('validation: whole days 1–30 and true/false; unknown or missing fields are refused', () => {
    assert.deepEqual(readScheduling({ effectiveDelayDays: 7 }), { effectiveDelayDays: 7 });
    for (const bad of [0, 31, 1.5, '2', null, -1]) assert.throws(() => readScheduling({ effectiveDelayDays: bad }), (e) => e.status === 400 && Boolean(e.details.effectiveDelayDays), String(bad));
    assert.throws(() => readScheduling({ immediateFirstSchedule: 'yes' }), (e) => e.status === 400 && Boolean(e.details.immediateFirstSchedule));
    assert.throws(() => readScheduling({}), (e) => e.status === 400);
    assert.throws(() => readScheduling({ effectiveDelayDays: 2, minutes: 5 }), (e) => e.status === 400);
  });
});

// ---- settings: access and audit ----------------------------------------------------------

test('only a Super Admin changes the settings (401 signed out, 403 for Owner and Manager); everyone saving them is checked by the server', async () => {
  assert.equal((await call('/api/platform/settings/scheduling', { method: 'PUT', body: { effectiveDelayDays: 2 } })).status, 401);
  for (const key of ['owner', 'MA1']) assert.equal((await setPolicy({ effectiveDelayDays: 2 }, key)).status, 403, key);
  assert.equal(await prisma.platformSettings.findUnique({ where: { id: 'platform' } }).then((r) => r?.effectiveDelayDays ?? null), null);
  const read = await as('admin', '/api/platform/settings');
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.settings.scheduling, { effectiveDelayDays: 1, immediateFirstSchedule: true, immediateFirstAssignment: true, timedChanges: false, limits: { minDays: 1, maxDays: 30 } });
  const bad = await setPolicy({ effectiveDelayDays: 0 });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.details.effectiveDelayDays);
});

test('each changed setting records one SCHEDULING_SETTINGS_UPDATED event with the previous and new value; the same values record nothing', async () => {
  const res = await setPolicy({ effectiveDelayDays: 3, immediateFirstSchedule: false, immediateFirstAssignment: true });
  assert.equal(res.status, 200);
  assert.deepEqual([res.body.scheduling.effectiveDelayDays, res.body.scheduling.immediateFirstSchedule, res.body.scheduling.immediateFirstAssignment], [3, false, true]);
  let events = await auditEvents('SCHEDULING_SETTINGS_UPDATED');
  assert.equal(events.length, 2, 'the delay and the first-schedule switch changed; the assignment switch did not');
  assert.deepEqual(events.map((e) => e.change), [
    { field: 'Effective delay', from: '1 day', to: '3 days' },
    { field: 'First schedule may start today', from: 'Yes', to: 'No' },
  ]);
  assert.ok(events.every((e) => e.actorId === people.admin.id && e.targetType === 'system'));
  assert.equal((await setPolicy({ effectiveDelayDays: 3, immediateFirstSchedule: false })).status, 200);
  events = await auditEvents('SCHEDULING_SETTINGS_UPDATED');
  assert.equal(events.length, 2, 'saving the values in force records nothing');
  await resetPolicy();
});

// ---- schedules -----------------------------------------------------------------------------

describe('branch schedules follow the delay', () => {
  let morningKey;

  test('default (1 day): the first schedule starts today; a change is saved at once, pending until tomorrow', async () => {
    const first = await saveSchedule('A1', today, [shift('Morning', '07:00', '13:00')]);
    assert.equal(first.status, 200);
    assert.equal(first.body.current.effectiveFrom, today);
    assert.equal(first.body.effectiveDelayDays, 1);
    assert.equal(first.body.earliestEffectiveDate, addDays(today, 1));
    morningKey = first.body.current.shifts[0].key;

    const sameDay = await saveSchedule('A1', today, [shift('Morning', '08:00', '13:00', morningKey)]);
    assert.equal(sameDay.status, 400);
    assert.match(sameDay.body.details.effectiveFrom, /tomorrow/);

    const change = await saveSchedule('A1', addDays(today, 1), [shift('Morning', '08:00', '13:00', morningKey), shift('Afternoon', '13:00', '18:00')]);
    assert.equal(change.status, 200);
    assert.equal(change.body.current.shifts[0].start, '07:00', 'today keeps the active schedule');
    assert.equal(change.body.scheduled.effectiveFrom, addDays(today, 1));
    // Activation: nothing runs; from 00:00 tomorrow the newest version whose date has arrived applies.
    assert.equal((await scheduleOn(branches.A1.id, today)).shifts.length, 1);
    assert.equal((await scheduleOn(branches.A1.id, addDays(today, 1))).shifts.length, 2);
    assert.equal((await scheduleOn(branches.A1.id, addDays(today, 40))).shifts.length, 2, 'and it stays active');
  });

  test('a 3-day delay: earlier dates are refused with the earliest date; the earliest is accepted; later dates too', async () => {
    await forcePolicy({ effectiveDelayDays: 3 });
    const page = await as('MA1', '/api/manager/schedule');
    assert.equal(page.body.effectiveDelayDays, 3);
    assert.equal(page.body.earliestEffectiveDate, addDays(today, 3));
    const tooSoon = await saveSchedule('A1', addDays(today, 2), [shift('Morning', '09:00', '13:00', morningKey)]);
    assert.equal(tooSoon.status, 400);
    assert.match(tooSoon.body.details.effectiveFrom, new RegExp(`on ${addDays(today, 3)} \\(3 days from today\\)`));
    const ok = await saveSchedule('A1', addDays(today, 3), [shift('Morning', '09:00', '13:00', morningKey)]);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.scheduled.effectiveFrom, addDays(today, 3));
    const later = await saveSchedule('A1', addDays(today, 20), [shift('Morning', '09:30', '13:00', morningKey)]);
    assert.equal(later.status, 200, 'any later date up to a year is allowed');
    await resetPolicy();
  });

  test('editing a pending change replaces it (kept as cancelled); cancelling it keeps it too; at most one pending', async () => {
    const pending = await prisma.branchSchedule.findMany({ where: { branchId: branches.A1.id, cancelledAt: null, effectiveFrom: { gt: new Date(`${today}T00:00:00Z`) } } });
    assert.equal(pending.length, 1, 'one pending change: the latest save replaced the earlier ones');
    const all = await prisma.branchSchedule.findMany({ where: { branchId: branches.A1.id } });
    assert.equal(all.filter((v) => v.cancelledAt).length, 2, 'the two replaced pending changes are kept');
    const list = await as('MA1', '/api/manager/schedule/versions');
    assert.deepEqual(list.body.items.map((v) => v.state).sort(), ['cancelled', 'cancelled', 'current', 'scheduled']);
    const cancelled = await as('MA1', '/api/manager/schedule/scheduled', { method: 'DELETE' });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.scheduled, null);
    assert.equal(await prisma.branchSchedule.count({ where: { branchId: branches.A1.id } }), 4, 'nothing is deleted');
    const audit = await prisma.auditEvent.findMany({ where: { targetId: branches.A1.id, action: { startsWith: 'BRANCH_SCHEDULE' } } });
    assert.ok(audit.some((e) => e.action === 'BRANCH_SCHEDULE_CHANGE_CANCELLED'));
    assert.ok(audit.filter((e) => e.action === 'BRANCH_SCHEDULE_CHANGED').length >= 4);
  });

  test('first schedule switch off: a new branch\'s first schedule waits for the delay too', async () => {
    await forcePolicy({ effectiveDelayDays: 2, immediateFirstSchedule: false });
    const page = await as('MA2', '/api/manager/schedule');
    assert.equal(page.body.earliestEffectiveDate, addDays(today, 2));
    const refused = await saveSchedule('A2', today, [shift('Day', '07:00', '15:00')]);
    assert.equal(refused.status, 400);
    assert.match(refused.body.details.effectiveFrom, /first schedule can start on/);
    assert.equal((await saveSchedule('A2', addDays(today, 2), [shift('Day', '07:00', '15:00')])).status, 200);
    assert.equal(await scheduleOn(branches.A2.id, today), null, 'no schedule is in effect until then');
    await resetPolicy();
  });
});

// ---- staff assignments -------------------------------------------------------------------

describe('staff assignments follow the delay', () => {
  let morning;
  let evening;

  test('the request\'s example: a shift created today and staff assigned today both start tomorrow; today stays as it was', async () => {
    // A3 has a schedule in effect today; the Manager adds a shift today and assigns a staff member to it.
    const first = await saveSchedule('A3', today, [shift('Morning', '07:00', '12:00')]);
    morning = first.body.current.shifts[0].key;
    await staffOf('S3', 'A3');
    assert.equal((await saveSet('A3', 'S3', today, [morning])).status, 200, 'first set: today, as the switch allows');
    const withNew = await saveSchedule('A3', addDays(today, 1), [shift('Morning', '07:00', '12:00', morning), shift('Evening', '14:00', '18:00')]);
    assert.equal(withNew.status, 200);
    evening = withNew.body.scheduled.shifts.find((s) => s.name === 'Evening').key;
    const tooSoon = await saveSet('A3', 'S3', today, [morning, evening]);
    assert.equal(tooSoon.status, 400);
    assert.match(tooSoon.body.details.effectiveFrom, /tomorrow/);
    const res = await saveSet('A3', 'S3', addDays(today, 1), [morning, evening]);
    assert.equal(res.status, 200);
    assert.equal(res.body.staff.assignments.current.shifts.length, 1, 'today: the active set is unchanged');
    assert.equal(res.body.staff.assignments.scheduled.effectiveFrom, addDays(today, 1));
    assert.equal(res.body.staff.assignments.scheduled.shifts.length, 2);
  });

  test('a 5-day delay applies to assignment changes; the first set switch off makes a first set wait too', async () => {
    await forcePolicy({ effectiveDelayDays: 5, immediateFirstAssignment: false });
    const detail = await as('MA3', `/api/manager/staff/${people.S3.id}`);
    assert.equal(detail.body.staff.assignments.effectiveDelayDays, 5);
    assert.equal(detail.body.staff.assignments.earliestEffectiveDate, addDays(today, 5));
    assert.equal((await saveSet('A3', 'S3', addDays(today, 4), [morning, evening])).status, 400);
    const replaced = await saveSet('A3', 'S3', addDays(today, 5), [evening]);
    assert.equal(replaced.status, 200, 'replaces the pending set');
    assert.equal(replaced.body.staff.assignments.scheduled.effectiveFrom, addDays(today, 5));
    await staffOf('S3b', 'A3');
    const firstRefused = await saveSet('A3', 'S3b', today, [morning]);
    assert.equal(firstRefused.status, 400);
    assert.match(firstRefused.body.details.effectiveFrom, /first assignments can start on/);
    assert.equal((await saveSet('A3', 'S3b', addDays(today, 5), [morning])).status, 200);
    await resetPolicy();
  });

  test('a cancelled pending set is kept; the set in effect today is never rewritten', async () => {
    const res = await as('MA3', `/api/manager/staff/${people.S3.id}/assignments/scheduled`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal(res.body.staff.assignments.scheduled, null);
    const sets = await prisma.staffAssignment.findMany({ where: { staffUserId: people.S3.id }, orderBy: { recordedAt: 'asc' } });
    assert.equal(sets.length, 3, 'today\'s set, the replaced one and the cancelled one');
    assert.equal(sets[0].cancelledAt, null);
    assert.equal(sets[0].effectiveFrom.toISOString().slice(0, 10), today);
    assert.ok(sets[1].cancelledAt && sets[2].cancelledAt);
  });
});

// ---- staff transfers (decision: the delay applies to transfers too) ----------------------

test('transfers: the earliest transfer date is today + the delay', async () => {
  await saveSchedule('A4', today, [shift('Day', '07:00', '15:00')]);
  await staffOf('S4', 'A3');
  await forcePolicy({ effectiveDelayDays: 4 });
  const page = await as('owner', `/api/owner/staff/${people.S4.id}`);
  assert.equal(page.status, 200);
  assert.equal(page.body.staff.earliestTransferDate, addDays(today, 4));
  assert.equal(page.body.staff.effectiveDelayDays, 4);
  const body = (effectiveFrom) => ({ branchId: branches.A4.id, effectiveFrom, shifts: [] });
  const early = await as('owner', `/api/owner/staff/${people.S4.id}/transfer`, { method: 'POST', body: body(addDays(today, 3)) });
  assert.equal(early.status, 400);
  assert.match(early.body.details.effectiveFrom, new RegExp(`transfer can start on ${addDays(today, 4)}`));
  const ok = await as('owner', `/api/owner/staff/${people.S4.id}/transfer`, { method: 'POST', body: body(addDays(today, 4)) });
  assert.equal(ok.status, 201);
  await resetPolicy();
  // Back to the default: tomorrow is allowed again (the scheduled one is cancelled first).
  assert.equal((await as('owner', `/api/owner/staff/${people.S4.id}/transfer/scheduled`, { method: 'DELETE' })).status, 200);
  assert.equal((await as('owner', `/api/owner/staff/${people.S4.id}/transfer`, { method: 'POST', body: body(addDays(today, 1)) })).status, 201);
});

// ---- history -----------------------------------------------------------------------------

test('changing the settings never re-dates saved changes or attendance history', async () => {
  const before = await prisma.branchSchedule.findMany({ where: { branchId: { in: Object.values(branches).map((b) => b.id) } }, orderBy: { id: 'asc' } });
  const setsBefore = await prisma.staffAssignment.findMany({ where: { branchId: { in: Object.values(branches).map((b) => b.id) } }, orderBy: { id: 'asc' } });
  // An attendance event recorded against today's version keeps its version.
  const version = await scheduleOn(branches.A3.id, today);
  const set = await prisma.staffAssignment.findFirst({ where: { staffUserId: people.S3.id, cancelledAt: null }, orderBy: { effectiveFrom: 'asc' } });
  const location = await prisma.branchLocation.create({ data: { branchId: branches.A3.id, latitude: 2.04, longitude: 45.31, accuracyMeters: 8, effectiveFrom: new Date(Date.now() - 86_400_000) } });
  const recorded = await prisma.attendanceEvent.create({
    data: {
      clientEventId: randomUUID(),
      locationId: location.id,
      sentAt: new Date(),
      staffUserId: people.S3.id,
      branchId: branches.A3.id,
      scheduleId: version.id,
      assignmentId: set.id,
      shiftKey: version.shifts[0].shiftKey,
      workDate: new Date(`${today}T00:00:00Z`),
      type: 'CHECK_IN',
      status: 'PRESENT',
      occurredAt: new Date(),
      receivedAt: new Date(),
      latitude: 2.04,
      longitude: 45.31,
      accuracyMeters: 10,
      distanceMeters: 5,
    },
  });
  assert.equal((await setPolicy({ effectiveDelayDays: 10, immediateFirstSchedule: false, immediateFirstAssignment: false })).status, 200);
  const after = await prisma.branchSchedule.findMany({ where: { id: { in: before.map((v) => v.id) } }, orderBy: { id: 'asc' } });
  const setsAfter = await prisma.staffAssignment.findMany({ where: { id: { in: setsBefore.map((s) => s.id) } }, orderBy: { id: 'asc' } });
  assert.deepEqual(after, before, 'schedule versions are unchanged');
  assert.deepEqual(setsAfter, setsBefore, 'assignment sets are unchanged');
  const still = await prisma.attendanceEvent.findUnique({ where: { id: recorded.id } });
  assert.equal(still.scheduleId, version.id, "the event keeps the version it was judged against");
  assert.equal(still.assignmentId, set.id);
  assert.equal(still.workDate.toISOString().slice(0, 10), today);
  await resetPolicy();
});

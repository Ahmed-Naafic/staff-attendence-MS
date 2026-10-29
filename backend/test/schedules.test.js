/*
 * Branch schedule tests (approved rules: docs/business-rules.md → Branch schedules and shifts).
 * Managers manage their own branch's schedule only; versions are effective from a branch-local date
 * (first schedule today, changes from tomorrow, at most a year ahead, no backdating), with one
 * scheduled version that can be replaced or cancelled and is kept; several same-day shifts that do
 * not overlap on a shared day; check-out per version; read only while the branch or school is
 * suspended; audit events with each change. Runs on the Neon dev branch (`npm test`); everything it
 * creates is removed afterwards.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { platformTimeZone } from '../src/features/platform-settings/settings.service.js';
import { addDays, localDate, scheduleOn } from '../src/features/schedules/schedules.service.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Schedule tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const cookies = {};
const accounts = {};
const schools = {};
const branches = {};
let server;
let base;
let today;
let timeZone;

async function call(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(method !== 'GET' && { origin: ORIGIN }), ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const as = (who) => (path, options = {}) => call(path, { ...options, cookie: cookies[who] });
const mA = as('MANAGER_A');
const mB = as('MANAGER_B');

const MORNING = { name: 'Morning', days: ['MON', 'TUE', 'WED', 'THU', 'SAT'], start: '07:00', end: '13:00', graceMinutes: 10, absenceCutoffMinutes: 120 };
const AFTERNOON = { name: 'Afternoon', days: ['MON', 'TUE', 'WED', 'THU', 'SAT'], start: '13:00', end: '18:00', graceMinutes: 5, absenceCutoffMinutes: 60 };
const FRIDAY = { name: 'Friday', days: ['FRI'], start: '08:00', end: '12:00', graceMinutes: 0, absenceCutoffMinutes: 30 };
const change = (effectiveFrom, overrides = {}) => ({ effectiveFrom, checkOutEnabled: false, shifts: [MORNING], ...overrides });
const save = (who, body) => who('/api/manager/schedule', { method: 'POST', body });
const versions = (branchKey) => prisma.branchSchedule.findMany({ where: { branchId: branches[branchKey].id }, orderBy: { recordedAt: 'asc' } });
const events = (branchKey) =>
  prisma.auditEvent.findMany({ where: { targetId: branches[branchKey].id, action: { startsWith: 'BRANCH_SCHEDULE' } }, orderBy: { occurredAt: 'asc' } });

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  timeZone = await platformTimeZone();
  today = localDate(timeZone);
  for (const key of ['A', 'B']) {
    schools[key] = await prisma.school.create({ data: { code: `S${tag}-${key}`, name: `Schedule School ${key} ${tag}`, location: 'Mogadishu' } });
  }
  for (const [key, school, number] of [['A1', 'A', 1], ['A2', 'A', 2], ['B1', 'B', 1]]) {
    branches[key] = await prisma.branch.create({
      data: { schoolId: schools[school].id, number, code: `${schools[school].code}-B00${number}`, name: `Branch ${key}`, nameKey: `branch ${key.toLowerCase()}`, address: 'Road 1', city: 'Mogadishu' },
    });
  }
  const people = [
    ['SUPER_ADMIN', 'SUPER_ADMIN'],
    ['OWNER_A', 'OWNER', { school: 'A' }],
    ['STAFF', 'STAFF'],
    ['MANAGER_A', 'MANAGER', { branch: 'A1' }],
    ['MANAGER_A2', 'MANAGER', { branch: 'A2' }],
    ['MANAGER_B', 'MANAGER', { branch: 'B1' }],
    ['MANAGER_TEMP', 'MANAGER', { branch: 'A1', mustChangePassword: true }],
  ];
  for (const [key, role, extra = {}] of people) {
    const password = randomBytes(12).toString('base64url');
    const email = `test-sch-${key.toLowerCase().replace('_', '-')}-${lower}@test.edutrack.example`;
    const user = await prisma.user.create({
      data: {
        name: `Test ${key} ${tag}`,
        email,
        role,
        passwordHash: await hashPassword(password),
        ...(extra.branch && { branchId: branches[extra.branch].id }),
        ...(extra.mustChangePassword && { mustChangePassword: true }),
        ...(role === 'STAFF' && (await branchFor('STAFF'))),
      },
    });
    if (extra.branch) await prisma.managerAssignment.create({ data: { managerId: user.id, branchId: branches[extra.branch].id } });
    if (extra.school) await prisma.school.update({ where: { id: schools[extra.school].id }, data: { ownerId: user.id } });
    accounts[key] = user;
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, password }) });
    assert.equal(res.status, 200, `${key} sign-in`);
    cookies[key] = res.headers.get('set-cookie').split(';')[0];
  }
});

after(async () => {
  const schoolIds = Object.values(schools).map((s) => s.id);
  const branchIds = Object.values(branches).map((b) => b.id);
  const userIds = Object.values(accounts).map((u) => u.id);
  await prisma.auditEvent.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { actorId: { in: userIds } }, { targetId: { in: [...userIds, ...branchIds] } }] } });
  const scheduleIds = (await prisma.branchSchedule.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((s) => s.id);
  await prisma.branchShift.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
  await prisma.branchSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
  await prisma.managerAssignment.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds }, role: 'MANAGER' } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
  await prisma.school.updateMany({ where: { id: { in: schoolIds } }, data: { ownerId: null } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await removeTestBranches();
  server.close();
  await prisma.$disconnect();
});

describe('access: the branch Manager only', () => {
  const endpoints = () => [
    ['GET', '/api/manager/schedule'],
    ['GET', '/api/manager/schedule/versions'],
    ['POST', '/api/manager/schedule', change(today)],
    ['DELETE', '/api/manager/schedule/scheduled'],
  ];

  test('signed out → 401; Super Admin, owner and staff → 403; nothing is written', async () => {
    for (const [method, path, body] of endpoints()) assert.equal((await call(path, { method, body })).status, 401, `${method} ${path}`);
    for (const who of ['SUPER_ADMIN', 'OWNER_A', 'STAFF']) {
      for (const [method, path, body] of endpoints()) assert.equal((await as(who)(path, { method, body })).status, 403, `${who} ${method} ${path}`);
    }
    assert.equal((await versions('A1')).length, 0);
  });

  test('a Manager with a temporary password must change it first', async () => {
    for (const [method, path, body] of endpoints()) {
      const res = await as('MANAGER_TEMP')(path, { method, body });
      assert.equal(res.status, 403);
      assert.equal(res.body.code, 'PASSWORD_CHANGE_REQUIRED');
    }
  });

  test('the branch and school cannot be chosen in the request', async () => {
    for (const extra of [{ branchId: branches.B1.id }, { schoolId: schools.B.id }, { timeZone: 'UTC' }, { other: 1 }]) {
      assert.equal((await save(mA, { ...change(today), ...extra })).status, 400, JSON.stringify(extra));
    }
    assert.equal((await versions('B1')).length, 0);
  });
});

describe('validation', () => {
  const problems = async (body) => {
    const res = await save(mA, body);
    assert.equal(res.status, 400);
    return res.body.details ?? {};
  };

  test('effective date, check-out and shifts are required and checked', async () => {
    assert.deepEqual(Object.keys(await problems({})).sort(), ['checkOutEnabled', 'effectiveFrom', 'shifts']);
    for (const effectiveFrom of ['2026-02-30', '26-01-01', 'tomorrow', 20260101]) assert.ok((await problems(change(effectiveFrom))).effectiveFrom, String(effectiveFrom));
    assert.ok((await problems(change(today, { checkOutEnabled: 'yes' }))).checkOutEnabled);
    assert.ok((await problems(change(today, { shifts: [] }))).shifts);
    assert.match((await problems(change(today, { shifts: Array.from({ length: 21 }, (_, i) => ({ ...FRIDAY, name: `S${i}` })) }))).shifts, /at most 20/);
  });

  test('shift fields: name, days, same-day times, grace and cutoff within the shift', async () => {
    const cases = [
      [{ name: '' }, 'name'],
      [{ name: 'x'.repeat(61) }, 'name'],
      [{ days: [] }, 'days'],
      [{ days: ['MON', 'MON'] }, 'days'],
      [{ days: ['MONDAY'] }, 'days'],
      [{ start: '7:00' }, 'start'],
      [{ start: '24:00' }, 'start'],
      [{ end: '13:60' }, 'end'],
      [{ start: '13:00', end: '13:00' }, 'end'],
      [{ start: '22:00', end: '06:00' }, 'end'], // overnight
      [{ graceMinutes: -1 }, 'graceMinutes'],
      [{ graceMinutes: 1.5 }, 'graceMinutes'],
      [{ graceMinutes: 361 }, 'graceMinutes'], // longer than the 6-hour shift
      [{ absenceCutoffMinutes: 5 }, 'absenceCutoffMinutes'], // before the end of grace (10)
      [{ absenceCutoffMinutes: 361 }, 'absenceCutoffMinutes'], // after the shift ends
    ];
    for (const [overrides, field] of cases) {
      const details = await problems(change(today, { shifts: [{ ...MORNING, ...overrides }] }));
      assert.ok(details[`shifts.0.${field}`], `${JSON.stringify(overrides)} → ${JSON.stringify(details)}`);
    }
    assert.ok((await problems(change(today, { shifts: [{ ...MORNING, extra: true }] })))['shifts.0']);
    assert.equal((await versions('A1')).length, 0);
  });

  test('shift names are unique regardless of capitalization', async () => {
    const details = await problems(change(today, { shifts: [MORNING, { ...FRIDAY, name: 'MORNING' }] }));
    assert.match(details['shifts.1.name'], /already called/);
  });

  test('shifts sharing a day cannot overlap; touching shifts and other days are fine', async () => {
    const overlap = await problems(change(today, { shifts: [MORNING, { ...AFTERNOON, start: '12:59' }] }));
    assert.match(overlap['shifts.1.start'], /Overlaps "Morning".*Mon, Tue, Wed, Thu, Sat/);
    const partial = await problems(change(today, { shifts: [MORNING, { ...AFTERNOON, name: 'Sat late', days: ['SAT'], start: '10:00' }] }));
    assert.match(partial['shifts.1.start'], /on Sat\./);
    assert.equal((await versions('A1')).length, 0);
  });
});

describe('effective dates and history', () => {
  test('the first schedule can start today; it records the platform time zone and an audit event', async () => {
    const initial = await mA('/api/manager/schedule');
    assert.equal(initial.status, 200);
    assert.equal(initial.body.current, null);
    assert.equal(initial.body.earliestEffectiveDate, today);
    assert.equal(initial.body.timeZone, timeZone);
    assert.equal(initial.body.canChange, true);

    const res = await save(mA, change(today, { checkOutEnabled: true, shifts: [MORNING, AFTERNOON, FRIDAY] }));
    assert.equal(res.status, 200);
    assert.equal(res.body.current.effectiveFrom, today);
    assert.equal(res.body.current.timeZone, timeZone);
    assert.equal(res.body.current.checkOutEnabled, true);
    assert.deepEqual(res.body.current.shifts.map((s) => [s.name, s.start, s.end]), [['Morning', '07:00', '13:00'], ['Friday', '08:00', '12:00'], ['Afternoon', '13:00', '18:00']]);
    assert.equal(res.body.earliestEffectiveDate, addDays(today, 1));
    const [event] = await events('A1');
    assert.equal(event.action, 'BRANCH_SCHEDULE_CHANGED');
    assert.equal(event.actorId, accounts.MANAGER_A.id);
    assert.equal(event.schoolId, schools.A.id);
    assert.deepEqual(event.change.fields.find((f) => f.field === 'Check-out'), { field: 'Check-out', from: null, to: 'On' });
  });

  test('later changes start tomorrow at the earliest and at most a year ahead (no backdating)', async () => {
    const before = (await versions('A1')).length;
    for (const date of [today, addDays(today, -1), addDays(today, 366)]) {
      const res = await save(mA, change(date));
      assert.equal(res.status, 400, date);
      assert.ok(res.body.details.effectiveFrom);
    }
    assert.equal((await versions('A1')).length, before);
  });

  test('a change from tomorrow is scheduled; the current version keeps applying today', async () => {
    const res = await save(mA, change(addDays(today, 1), { shifts: [MORNING] }));
    assert.equal(res.status, 200);
    assert.equal(res.body.current.effectiveFrom, today);
    assert.equal(res.body.scheduled.effectiveFrom, addDays(today, 1));
    assert.equal(res.body.scheduled.checkOutEnabled, false);
    assert.equal((await scheduleOn(branches.A1.id, today)).shifts.length, 3);
    assert.equal((await scheduleOn(branches.A1.id, addDays(today, 1))).shifts.length, 1);
    const history = await mA('/api/manager/schedule/versions');
    assert.deepEqual(history.body.items.map((v) => v.state), ['scheduled', 'current']);
    assert.equal(history.body.items[1].effectiveUntil, today);
  });

  test('saving another scheduled change replaces it; the replaced one is kept as cancelled and never applies', async () => {
    const res = await save(mA, change(addDays(today, 3), { shifts: [FRIDAY] }));
    assert.equal(res.status, 200);
    assert.equal(res.body.scheduled.effectiveFrom, addDays(today, 3));
    const history = (await mA('/api/manager/schedule/versions')).body.items;
    assert.deepEqual(history.map((v) => v.state), ['scheduled', 'cancelled', 'current']);
    assert.equal((await scheduleOn(branches.A1.id, addDays(today, 1))).effectiveFrom.toISOString().slice(0, 10), today);
    const last = (await events('A1')).at(-1);
    assert.deepEqual(last.change.fields[0], { field: 'Scheduled change', from: `From ${addDays(today, 1)}`, to: 'Replaced' });
  });

  test('the scheduled change can be cancelled once; then there is nothing to cancel', async () => {
    const res = await mA('/api/manager/schedule/scheduled', { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal(res.body.scheduled, null);
    assert.equal((await mA('/api/manager/schedule/scheduled', { method: 'DELETE' })).status, 404);
    assert.equal((await events('A1')).at(-1).action, 'BRANCH_SCHEDULE_CHANGE_CANCELLED');
    assert.equal((await versions('A1')).length, 3, 'nothing deleted');
  });

  test('saving the schedule in effect changes nothing; with a change scheduled, it only cancels it', async () => {
    // The same shifts (with their keys, as the web app sends them) in a different order.
    const inEffect = (await mA('/api/manager/schedule')).body.current;
    const current = { checkOutEnabled: true, shifts: [...inEffect.shifts].reverse().map(({ id, ...shift }) => shift) };
    const count = (await versions('A1')).length;
    const eventCount = (await events('A1')).length;
    assert.equal((await save(mA, { effectiveFrom: addDays(today, 2), ...current })).status, 200);
    assert.equal((await versions('A1')).length, count);
    assert.equal((await events('A1')).length, eventCount);

    await save(mA, change(addDays(today, 2)));
    const res = await save(mA, { effectiveFrom: addDays(today, 5), ...current });
    assert.equal(res.body.scheduled, null);
    assert.equal((await events('A1')).at(-1).action, 'BRANCH_SCHEDULE_CHANGE_CANCELLED');
  });

  test('a shift keeps its key when it is edited; added shifts take the key of an earlier shift with that name, else a new one; unknown or repeated keys are refused', async () => {
    const inEffect = (await mA('/api/manager/schedule')).body.current;
    const morning = inEffect.shifts.find((x) => x.name === 'Morning');
    const { id: _id, ...kept } = morning;
    const NIGHT = { name: `Night ${tag}`, days: ['MON'], start: '19:00', end: '22:00', graceMinutes: 5, absenceCutoffMinutes: 30 };
    const res = await save(mA, change(addDays(today, 2), { shifts: [{ ...kept, name: 'Early', start: '06:30' }, { ...FRIDAY, name: 'friday' }, { ...MORNING, start: '13:00', end: '18:00' }, NIGHT] }));
    assert.equal(res.status, 200);
    const [early, friday, renamedAway, night] = ['Early', 'friday', 'Morning', NIGHT.name].map((n) => res.body.scheduled.shifts.find((x) => x.name === n));
    assert.equal(early.key, morning.key);
    assert.equal(friday.key, inEffect.shifts.find((x) => x.name === 'Friday').key, 'an added shift with an earlier name (any capitalization) is that shift again');
    assert.notEqual(renamedAway.key, morning.key, 'the earlier "Morning" is kept here under another name, so an added "Morning" is a new shift');
    assert.ok(!inEffect.shifts.some((x) => x.key === night.key), 'a shift with a name the branch never had is new');

    // Cancelling a scheduled change and typing the shift in again keeps its identity (staff assignments follow it).
    await mA('/api/manager/schedule/scheduled', { method: 'DELETE' });
    const again = await save(mA, change(addDays(today, 2), { shifts: [{ ...kept }, { ...NIGHT, start: '20:00' }] }));
    assert.equal(again.status, 200);
    assert.equal(again.body.scheduled.shifts.find((x) => x.name === NIGHT.name).key, night.key);
    const other = (await prisma.branchShift.findFirst({ where: { schedule: { branchId: branches.B1.id } } }))?.shiftKey ?? '00000000-0000-4000-8000-000000000000';
    for (const key of [other, '00000000-0000-4000-8000-000000000000']) {
      const bad = await save(mA, change(addDays(today, 2), { shifts: [{ ...MORNING, key }] }));
      assert.equal(bad.status, 400);
      assert.ok(bad.body.details['shifts.0.key']);
    }
    const twice = await save(mA, change(addDays(today, 2), { shifts: [{ ...MORNING, key: morning.key }, { ...FRIDAY, key: morning.key }] }));
    assert.equal(twice.body.details['shifts.1.key'], 'This shift is listed twice.');
    await mA('/api/manager/schedule/scheduled', { method: 'DELETE' });
  });

  test('two simultaneous changes leave exactly one scheduled version', async () => {
    const results = await Promise.all([save(mA, change(addDays(today, 4))), save(mA, change(addDays(today, 6), { shifts: [FRIDAY] }))]);
    assert.deepEqual(results.map((r) => r.status), [200, 200]);
    const pending = (await versions('A1')).filter((v) => !v.cancelledAt && v.effectiveFrom.toISOString().slice(0, 10) > today);
    assert.equal(pending.length, 1);
    await mA('/api/manager/schedule/scheduled', { method: 'DELETE' });
  });
});

describe('branch isolation', () => {
  test('each Manager sees and changes only their own branch', async () => {
    const b = await mB('/api/manager/schedule');
    assert.equal(b.body.current, null);
    assert.equal((await save(mB, change(today, { shifts: [FRIDAY] }))).status, 200);
    assert.equal((await scheduleOn(branches.A1.id, today)).shifts.length, 3);
    assert.equal((await scheduleOn(branches.B1.id, today)).shifts.length, 1);
    const a2 = await as('MANAGER_A2')('/api/manager/schedule');
    assert.equal(a2.body.current, null, 'another branch of the same school has its own schedule');
  });
});

describe('suspension: read only', () => {
  test('a suspended branch: the Manager can read but not change; nothing is written', async () => {
    await prisma.branch.update({ where: { id: branches.A1.id }, data: { status: 'SUSPENDED' } });
    try {
      const read = await mA('/api/manager/schedule');
      assert.equal(read.status, 200);
      assert.equal(read.body.canChange, false);
      assert.deepEqual(read.body.notOperatingReasons, ['branch_suspended']);
      assert.equal((await mA('/api/manager/schedule/versions')).status, 200);
      const count = (await versions('A1')).length;
      const res = await save(mA, change(addDays(today, 2)));
      assert.equal(res.status, 409);
      assert.equal(res.body.code, 'BRANCH_NOT_OPERATING');
      assert.equal((await mA('/api/manager/schedule/scheduled', { method: 'DELETE' })).status, 409);
      assert.equal((await versions('A1')).length, count);
    } finally {
      await prisma.branch.update({ where: { id: branches.A1.id }, data: { status: 'ACTIVE' } });
    }
  });

  test('a suspended school: read only for every branch', async () => {
    await prisma.school.update({ where: { id: schools.A.id }, data: { status: 'SUSPENDED' } });
    try {
      const read = await as('MANAGER_A2')('/api/manager/schedule');
      assert.deepEqual(read.body.notOperatingReasons, ['school_suspended']);
      const res = await save(as('MANAGER_A2'), change(today));
      assert.equal(res.status, 409);
      assert.match(res.body.error, /school is suspended/);
      assert.equal((await versions('A2')).length, 0);
    } finally {
      await prisma.school.update({ where: { id: schools.A.id }, data: { status: 'ACTIVE' } });
    }
  });
});

describe('database constraints', () => {
  test('shift times, days and one version per date are enforced by the database', async () => {
    const version = (await versions('B1'))[0];
    const shift = { scheduleId: version.id, name: 'Bad', days: ['MON'], startMinute: 600, endMinute: 660, graceMinutes: 0, absenceCutoffMinutes: 0 };
    await assert.rejects(prisma.branchShift.create({ data: { ...shift, endMinute: 600 } }));
    await assert.rejects(prisma.branchShift.create({ data: { ...shift, endMinute: 1440 } }));
    await assert.rejects(prisma.branchShift.create({ data: { ...shift, absenceCutoffMinutes: 61 } }));
    await assert.rejects(prisma.branchShift.create({ data: { ...shift, days: [] } }));
    await assert.rejects(prisma.$executeRaw`INSERT INTO "BranchShift" ("id", "scheduleId", "name", "days", "startMinute", "endMinute", "graceMinutes", "absenceCutoffMinutes") VALUES (gen_random_uuid()::text, ${version.id}, 'Null days', NULL, 600, 660, 0, 0)`);
    await assert.rejects(prisma.branchSchedule.create({ data: { branchId: branches.B1.id, effectiveFrom: version.effectiveFrom, timeZone, checkOutEnabled: false } }));
  });
});

describe('audit visibility', () => {
  test('the owner sees schedule changes in the branch history; Super Admins in the audit log; not on the dashboard', async () => {
    const owner = await as('OWNER_A')(`/api/owner/audit-logs?branch=${branches.A1.id}&pageSize=100`);
    assert.ok(owner.body.items.some((e) => e.action === 'BRANCH_SCHEDULE_CHANGED' && e.actor.role === 'MANAGER'));
    const admin = await as('SUPER_ADMIN')(`/api/platform/audit-logs?action=BRANCH_SCHEDULE_CHANGED&school=${schools.A.id}&pageSize=100`);
    assert.ok(admin.body.total > 0);
    const dashboard = await as('SUPER_ADMIN')('/api/platform/dashboard');
    assert.ok(dashboard.body.recentActivity.every((e) => !e.type.startsWith('BRANCH_SCHEDULE')));
  });
});

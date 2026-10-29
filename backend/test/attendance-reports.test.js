/*
 * Attendance reports, Phase 1 (approved: docs/reports/). Owners read every branch of their own
 * school (combined or one branch), Managers their current branch only; rows are accepted check-ins
 * with their check-out, shown with the status stored at check-in and the shift, time zone and
 * check-out setting of the event's own schedule version. Fixtures are written directly (past dates
 * and older schedule versions cannot be produced through the 24-hour check-in API); every expected
 * count below is the count of the events created here. Runs on the Neon dev branch (`npm test`);
 * everything it creates is removed afterwards.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { localMoment } from '../src/features/attendance/attendance.service.js';
import { attendanceRecords, attendanceSummary, checkOutState, lastClosedWorkDate } from '../src/features/attendance/attendanceReports.service.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { platformTimeZone } from '../src/features/platform-settings/settings.service.js';
import { addDays } from '../src/features/schedules/schedules.service.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Attendance report tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const phonePrefix = `+96${String(parseInt(randomBytes(3).toString('hex'), 16)).padStart(8, '0')}`;
const PASSWORD = 'report-password-123';
const OLD_ZONE = 'Asia/Dubai'; // a historical schedule version saved in another zone (UTC+4, no DST)
const ALL_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const POS = { latitude: 2.046934, longitude: 45.318162 };
const MIN = 60 * 1000;
const schools = {};
const branches = {};
const people = {};
const versions = {};
const ev = {};
let server;
let base;
let zone;
let D; // today in the platform time zone
let counter = 0;

async function call(path, { method = 'GET', cookie, body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(cookie && { cookie, origin: ORIGIN }), ...(body !== undefined && { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, setCookie: response.headers.get('set-cookie') };
}
const qs = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined)).toString();
const get = (who, path, params = {}) => call(`${path}?${qs(params)}`, { cookie: people[who].cookie });

/** The instant of a local date and time (seconds after midnight) in a time zone without DST. */
function zoned(date, seconds, timeZone) {
  const guess = new Date(Date.parse(`${date}T00:00:00Z`) + seconds * 1000);
  const local = localMoment(guess, timeZone);
  const localMs = Date.parse(`${local.date}T00:00:00Z`) + Math.round(local.minutes * 60) * 1000;
  return new Date(guess.getTime() - (localMs - guess.getTime()));
}
const at = (hh, mm, ss = 0) => hh * 3600 + mm * 60 + ss;

async function account(role, extra = {}) {
  counter += 1;
  const user = await prisma.user.create({
    data: { name: `Report ${role} ${counter} ${tag}`, email: `test-rep-${counter}-${lower}@test.edutrack.example`, role, passwordHash: await hashPassword(PASSWORD), ...extra },
  });
  const login = await call('/api/auth/login', { method: 'POST', body: { email: user.email, password: PASSWORD } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  return { ...user, cookie: login.setCookie.split(';')[0] };
}

async function staff(branchKey, name, shiftKeys, extra = {}) {
  counter += 1;
  const branch = branches[branchKey];
  const phone = `${phonePrefix}${String(counter).padStart(3, '0')}`;
  const user = await prisma.user.create({
    data: {
      name: `${name} ${tag}`,
      email: `test-rep-${counter}-${lower}@test.edutrack.example`,
      role: 'STAFF',
      branchId: branch.id,
      staffId: `${branch.code}-ST${String(counter).padStart(3, '0')}`,
      phone,
      phoneKey: phone,
      jobTitle: 'Teacher',
      ...extra,
    },
  });
  user.assignment = await prisma.staffAssignment.create({
    data: { staffUserId: user.id, branchId: branch.id, effectiveFrom: new Date(`${addDays(D, -30)}T00:00:00Z`), timeZone: zone, shifts: { create: shiftKeys.map((shiftKey) => ({ shiftKey, days: ALL_DAYS })) } },
  });
  return user;
}

/** An accepted check-in as the server stores it (status decided here as the server would have). */
async function checkIn(who, version, shiftKey, workDate, seconds, status, { delayMs = 1000, distance = 20.04, accuracy = 9.96 } = {}) {
  const occurredAt = zoned(workDate, seconds, version.timeZone);
  return prisma.attendanceEvent.create({
    data: {
      staffUserId: who.id,
      branchId: version.branchId,
      type: 'CHECK_IN',
      clientEventId: randomUUID(),
      occurredAt,
      sentAt: new Date(occurredAt.getTime() + delayMs),
      receivedAt: new Date(occurredAt.getTime() + delayMs),
      workDate: new Date(`${workDate}T00:00:00Z`),
      shiftKey,
      scheduleId: version.id,
      assignmentId: who.assignment.id,
      locationId: branches[version.key].location.id,
      ...POS,
      accuracyMeters: accuracy,
      distanceMeters: distance,
      status,
    },
  });
}

async function checkOut(who, inEvent, version, seconds) {
  const occurredAt = zoned(inEvent.workDate.toISOString().slice(0, 10), seconds, version.timeZone);
  return prisma.attendanceEvent.create({
    data: {
      staffUserId: who.id,
      branchId: inEvent.branchId,
      type: 'CHECK_OUT',
      clientEventId: randomUUID(),
      occurredAt,
      sentAt: occurredAt,
      receivedAt: new Date(occurredAt.getTime() + 2000),
      workDate: inEvent.workDate,
      shiftKey: inEvent.shiftKey,
      scheduleId: inEvent.scheduleId,
      assignmentId: inEvent.assignmentId,
      locationId: inEvent.locationId,
      ...POS,
      accuracyMeters: 8,
      distanceMeters: 31,
      checkInEventId: inEvent.id,
    },
  });
}

const shift = (key, name, start, end, grace = 10) => ({ shiftKey: key, name, days: ALL_DAYS, startMinute: start, endMinute: end, graceMinutes: grace, absenceCutoffMinutes: grace + 30 });
async function version(key, effectiveFrom, timeZone, checkOutEnabled, shifts) {
  const v = await prisma.branchSchedule.create({
    data: { branchId: branches[key].id, effectiveFrom: new Date(`${effectiveFrom}T00:00:00Z`), timeZone, checkOutEnabled, shifts: { create: shifts } },
    include: { shifts: true },
  });
  return { ...v, key };
}

const KM = randomUUID(); // A1 Morning ("Early" from V2)
const KA = randomUUID(); // A1 Afternoon
const KD = randomUUID(); // A2 Day
const KB = randomUUID(); // B1

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  zone = await platformTimeZone();
  D = localMoment(new Date(), zone).date;

  const school = (key) => prisma.school.create({ data: { code: `R${tag}-${key}`, name: `Report School ${key} ${tag}`, location: 'Mogadishu' } });
  schools.A = await school('A');
  schools.B = await school('B');
  const branch = async (key, schoolKey, n, extra = {}) => {
    const b = await prisma.branch.create({
      data: { schoolId: schools[schoolKey].id, number: n, code: `R${tag}-${schoolKey}-B00${n}`, name: `Rep ${key}`, nameKey: `rep ${key.toLowerCase()}`, address: 'Road', city: 'Mogadishu', ...extra },
    });
    b.location = await prisma.branchLocation.create({ data: { branchId: b.id, ...POS, accuracyMeters: 8, effectiveFrom: new Date(Date.now() - 40 * 24 * 60 * MIN) } });
    return b;
  };
  branches.A1 = await branch('A1', 'A', 1);
  branches.A2 = await branch('A2', 'A', 2);
  branches.A3 = await branch('A3', 'A', 3, { status: 'SUSPENDED', suspensionReason: 'Test', suspendedAt: new Date() });
  await prisma.suspensionPeriod.create({ data: { branchId: branches.A3.id, startedAt: new Date(Date.now() - 60 * MIN), reason: 'Test' } });
  branches.B1 = await branch('B1', 'B', 1);

  // A1: V1 (older zone, check-out ON) then V2 from D-5 (platform zone, check-out OFF, Morning renamed and moved).
  versions.A1v1 = await version('A1', addDays(D, -20), OLD_ZONE, true, [shift(KM, 'Morning', 480, 840), shift(KA, 'Afternoon', 840, 1080)]);
  versions.A1v2 = await version('A1', addDays(D, -5), zone, false, [shift(KM, 'Early', 450, 810), shift(KA, 'Afternoon', 840, 1080)]);
  versions.A2 = await version('A2', addDays(D, -20), zone, true, [shift(KD, 'Day', 420, 900)]);
  versions.B1 = await version('B1', addDays(D, -20), zone, true, [shift(KB, 'Day', 420, 900)]);

  people.ownerA = await account('OWNER');
  people.ownerB = await account('OWNER');
  await prisma.school.update({ where: { id: schools.A.id }, data: { ownerId: people.ownerA.id } });
  await prisma.school.update({ where: { id: schools.B.id }, data: { ownerId: people.ownerB.id } });
  people.m1 = await account('MANAGER', { branchId: branches.A1.id });
  people.m3 = await account('MANAGER', { branchId: branches.A2.id });
  for (const m of [people.m1, people.m3]) await prisma.managerAssignment.create({ data: { managerId: m.id, branchId: m.branchId } });
  people.admin = await account('SUPER_ADMIN');

  people.s1 = await staff('A1', 'Amina Report', [KM, KA]);
  people.s2 = await staff('A1', 'Bashir Report', [KM], { status: 'SUSPENDED', suspensionReason: 'Test', suspendedAt: new Date() });
  people.s3 = await staff('A2', 'Cawo Report', [KD]);
  people.sb = await staff('B1', 'Other School Staff', [KB]);

  // A1, V1 (Asia/Dubai): e1 PRESENT 08:05 with check-out 14:10; e2 LATE 14:20:30, no check-out.
  ev.e1 = await checkIn(people.s1, versions.A1v1, KM, addDays(D, -10), at(8, 5), 'PRESENT');
  ev.e1out = await checkOut(people.s1, ev.e1, versions.A1v1, at(14, 10));
  ev.e2 = await checkIn(people.s1, versions.A1v1, KA, addDays(D, -10), at(14, 20, 30), 'LATE');
  // e3: exactly start + grace (PRESENT), received 5 min + 1 s later; e4: a second later (LATE), received exactly 5 min later.
  ev.e3 = await checkIn(people.s2, versions.A1v1, KM, addDays(D, -9), at(8, 10), 'PRESENT', { delayMs: 5 * MIN + 1000 });
  ev.e4 = await checkIn(people.s2, versions.A1v1, KM, addDays(D, -8), at(8, 10, 1), 'LATE', { delayMs: 5 * MIN });
  // e5: V2 (check-out OFF) → check-out not required.
  ev.e5 = await checkIn(people.s1, versions.A1v2, KM, addDays(D, -3), at(7, 31), 'PRESENT');
  // A2: e6 yesterday without check-out (still open), e7 LATE with check-out.
  ev.e6 = await checkIn(people.s3, versions.A2, KD, addDays(D, -1), at(7, 5), 'PRESENT');
  ev.e7 = await checkIn(people.s3, versions.A2, KD, addDays(D, -2), at(7, 30), 'LATE');
  ev.e7out = await checkOut(people.s3, ev.e7, versions.A2, at(15, 0));
  // School B: must never appear in School A's reports.
  ev.eb = await checkIn(people.sb, versions.B1, KB, addDays(D, -1), at(7, 0), 'PRESENT');
});

after(async () => {
  const branchIds = Object.values(branches).map((b) => b.id);
  const schoolIds = Object.values(schools).map((s) => s.id);
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  await prisma.attendanceEvent.deleteMany({ where: { branchId: { in: branchIds }, type: 'CHECK_OUT' } });
  await prisma.attendanceEvent.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.suspensionPeriod.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { branchId: { in: branchIds } }] } });
  await prisma.auditEvent.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { actorId: { in: userIds } }, { targetId: { in: [...userIds, ...branchIds] } }] } });
  const sets = (await prisma.staffAssignment.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((s) => s.id);
  await prisma.staffAssignmentShift.deleteMany({ where: { assignmentId: { in: sets } } });
  await prisma.staffAssignment.deleteMany({ where: { id: { in: sets } } });
  const versionIds = (await prisma.branchSchedule.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((v) => v.id);
  await prisma.branchShift.deleteMany({ where: { scheduleId: { in: versionIds } } });
  await prisma.branchSchedule.deleteMany({ where: { id: { in: versionIds } } });
  await prisma.branchLocation.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.managerAssignment.deleteMany({ where: { OR: [{ managerId: { in: userIds } }, { branchId: { in: branchIds } }] } });
  await prisma.user.deleteMany({ where: { id: { in: userIds }, role: { in: ['STAFF', 'MANAGER'] } } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
  await prisma.school.updateMany({ where: { id: { in: schoolIds } }, data: { ownerId: null } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  server.close();
  await prisma.$disconnect();
});

const RANGE = () => ({ from: addDays(D, -20), to: D });
const OWNER = '/api/owner/attendance';
const MANAGER = '/api/manager/attendance';
const ids = (res) => res.body.items.map((r) => r.id).sort();
const of = (...events) => events.map((e) => e.id).sort();

describe('scope: owner school, manager current branch', () => {
  test('owner, combined: every branch of the school, never another school; counts equal the events', async () => {
    const records = await get('ownerA', `${OWNER}/records`, { ...RANGE(), pageSize: 100 });
    assert.equal(records.status, 200, JSON.stringify(records.body));
    assert.deepEqual(ids(records), of(ev.e1, ev.e2, ev.e3, ev.e4, ev.e5, ev.e6, ev.e7));
    assert.ok(records.body.items.every((r) => r.branch && [branches.A1.id, branches.A2.id].includes(r.branch.id)));

    const summary = await get('ownerA', `${OWNER}/summary`, RANGE());
    assert.equal(summary.status, 200);
    assert.deepEqual(summary.body.totals, { checkIns: 7, present: 4, late: 3, checkedOut: 2, checkOutOpen: 1, checkOutMissing: 3, checkOutNotRequired: 1, staffCheckedIn: 3 });
    assert.deepEqual(summary.body.absence, { available: false, reason: 'NOT_APPROVED' });
    assert.ok(!('absent' in summary.body.totals));
    // Every branch of school A (the suspended one with no events too), none of school B.
    const byBranch = Object.fromEntries(summary.body.byBranch.map((b) => [b.branch.id, b]));
    assert.deepEqual(Object.keys(byBranch).sort(), [branches.A1.id, branches.A2.id, branches.A3.id].sort());
    assert.deepEqual(
      { ...byBranch[branches.A1.id], branch: undefined },
      { branch: undefined, checkIns: 5, present: 3, late: 2, checkedOut: 1, checkOutOpen: 0, checkOutMissing: 3, checkOutNotRequired: 1, staffCheckedIn: 2 },
    );
    assert.equal(byBranch[branches.A2.id].checkIns, 2);
    assert.equal(byBranch[branches.A3.id].checkIns, 0);
    assert.equal(byBranch[branches.A3.id].branch.status, 'suspended');
    // Invariants: one row per check-in, every check-in in exactly one status and one check-out state.
    const t = summary.body.totals;
    assert.equal(t.checkIns, t.present + t.late);
    assert.equal(t.checkIns, t.checkedOut + t.checkOutOpen + t.checkOutMissing + t.checkOutNotRequired);
    for (const field of Object.keys(t)) {
      if (field !== 'staffCheckedIn') assert.equal(summary.body.byBranch.reduce((sum, b) => sum + b[field], 0), t[field], field);
    }
    assert.equal(records.body.total, t.checkIns);
  });

  test('owner, one branch: only that branch; another school’s branch or staff is not found', async () => {
    const a2 = await get('ownerA', `${OWNER}/records`, { ...RANGE(), branch: branches.A2.id });
    assert.deepEqual(ids(a2), of(ev.e6, ev.e7));
    const summary = await get('ownerA', `${OWNER}/summary`, { ...RANGE(), branch: branches.A2.id });
    assert.equal(summary.body.totals.checkIns, 2);
    assert.equal(summary.body.byBranch, null);

    for (const params of [{ branch: branches.B1.id }, { branch: randomUUID() }]) {
      const res = await get('ownerA', `${OWNER}/records`, { ...RANGE(), ...params });
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, { error: 'Branch not found.', code: 'NOT_FOUND' });
    }
    const otherStaff = await get('ownerA', `${OWNER}/summary`, { ...RANGE(), staff: people.sb.id });
    assert.equal(otherStaff.status, 404);
    assert.equal(otherStaff.body.code, 'NOT_FOUND');
    // School B's owner sees only school B.
    const b = await get('ownerB', `${OWNER}/records`, RANGE());
    assert.deepEqual(ids(b), of(ev.eb));
  });

  test('manager: the current branch only; a branch in the request is refused; other branches’ staff not found', async () => {
    const res = await get('m1', `${MANAGER}/records`, { ...RANGE(), pageSize: 100 });
    assert.equal(res.status, 200);
    assert.deepEqual(ids(res), of(ev.e1, ev.e2, ev.e3, ev.e4, ev.e5));
    assert.ok(res.body.items.every((r) => !('branch' in r)));
    const summary = await get('m1', `${MANAGER}/summary`, RANGE());
    assert.equal(summary.body.totals.checkIns, 5);
    assert.ok(!('byBranch' in summary.body) || summary.body.byBranch === null);

    for (const path of ['records', 'summary', 'options']) {
      const withBranch = await get('m1', `${MANAGER}/${path}`, { ...RANGE(), branch: branches.A1.id });
      assert.equal(withBranch.status, 400, path);
    }
    const otherBranchStaff = await get('m1', `${MANAGER}/records`, { ...RANGE(), staff: people.s3.id });
    assert.equal(otherBranchStaff.status, 404);
    const sortByBranch = await get('m1', `${MANAGER}/records`, { ...RANGE(), sort: 'branch' });
    assert.equal(sortByBranch.status, 400);
  });

  test('manager transfer: the next request shows only the new branch, nothing of the previous one', async () => {
    const before = await get('m3', `${MANAGER}/records`, RANGE());
    assert.deepEqual(ids(before), of(ev.e6, ev.e7));
    const transfer = await call(`/api/owner/managers/${people.m3.id}/transfer`, { method: 'POST', cookie: people.ownerA.cookie, body: { branchId: branches.A1.id } });
    assert.equal(transfer.status, 200, JSON.stringify(transfer.body));
    const afterTransfer = await get('m3', `${MANAGER}/records`, { ...RANGE(), pageSize: 100 });
    assert.deepEqual(ids(afterTransfer), of(ev.e1, ev.e2, ev.e3, ev.e4, ev.e5));
    const oldStaff = await get('m3', `${MANAGER}/records`, { ...RANGE(), staff: people.s3.id });
    assert.equal(oldStaff.status, 404);
    const options = await get('m3', `${MANAGER}/options`, RANGE());
    assert.ok(options.body.staff.every((s) => s.branchCode === branches.A1.code));
  });

  test('roles: other roles 403, no session 401, POST not routed', async () => {
    for (const path of ['summary', 'records', 'options']) {
      assert.equal((await get('m1', `${OWNER}/${path}`)).status, 403);
      assert.equal((await get('ownerA', `${MANAGER}/${path}`)).status, 403);
      assert.equal((await get('admin', `${OWNER}/${path}`)).status, 403);
      assert.equal((await get('admin', `${MANAGER}/${path}`)).status, 403);
      assert.equal((await call(`${OWNER}/${path}`)).status, 401);
      assert.equal((await call(`${MANAGER}/${path}`)).status, 401);
    }
    const post = await call(`${OWNER}/records`, { method: 'POST', cookie: people.ownerA.cookie, body: {} });
    assert.equal(post.status, 404);
  });

  test('suspended school and branch: reports stay readable and unchanged', async () => {
    const before = await get('ownerA', `${OWNER}/summary`, RANGE());
    await prisma.school.update({ where: { id: schools.A.id }, data: { status: 'SUSPENDED', suspensionReason: 'Test', suspendedAt: new Date() } });
    const period = await prisma.suspensionPeriod.create({ data: { schoolId: schools.A.id, startedAt: new Date(), reason: 'Test' } });
    try {
      const owner = await get('ownerA', `${OWNER}/summary`, RANGE());
      assert.equal(owner.status, 200);
      assert.deepEqual(owner.body.totals, before.body.totals);
      const manager = await get('m1', `${MANAGER}/records`, RANGE());
      assert.equal(manager.status, 200);
      assert.equal(manager.body.total, 5);
      // The suspended branch A3 can be chosen and is simply empty.
      const a3 = await get('ownerA', `${OWNER}/records`, { ...RANGE(), branch: branches.A3.id });
      assert.equal(a3.status, 200);
      assert.equal(a3.body.total, 0);
    } finally {
      await prisma.suspensionPeriod.delete({ where: { id: period.id } });
      await prisma.school.update({ where: { id: schools.A.id }, data: { status: 'ACTIVE', suspensionReason: null, suspendedAt: null } });
    }
  });
});

describe('record contents', () => {
  const row = async (event, who = 'ownerA') => {
    const res = await get(who, `${OWNER}/records`, { ...RANGE(), pageSize: 100 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    return res.body.items.find((r) => r.id === event.id);
  };

  test('historical schedule version: its time zone, shift name and times, check-out setting; the stored status', async () => {
    const e1 = await row(ev.e1);
    assert.equal(e1.timeZone, OLD_ZONE);
    assert.equal(e1.checkIn.time, '08:05:00');
    assert.equal(e1.checkIn.date, addDays(D, -10));
    assert.deepEqual(e1.shift, { key: KM, name: 'Morning', start: '08:00', end: '14:00', graceMinutes: 10 });
    assert.equal(e1.checkOutEnabled, true);
    assert.equal(e1.status, 'PRESENT');
    // The same shift today (V2): renamed, other times, platform zone, check-out OFF.
    const e5 = await row(ev.e5);
    assert.equal(e5.timeZone, zone);
    assert.equal(e5.checkIn.time, '07:31:00');
    assert.deepEqual(e5.shift, { key: KM, name: 'Early', start: '07:30', end: '13:30', graceMinutes: 10 });
    assert.equal(e5.checkOutEnabled, false);
    // Late boundary as stored: 08:10:00 PRESENT, 08:10:01 LATE (both show 08:10 as HH:MM).
    const [e3, e4] = [await row(ev.e3), await row(ev.e4)];
    assert.equal(e3.status, 'PRESENT');
    assert.equal(e4.status, 'LATE');
    assert.equal(e3.checkIn.time.slice(0, 5), e4.checkIn.time.slice(0, 5));
  });

  test('check-out states, worked time and the five-minute "uploaded later" indicator', async () => {
    const e1 = await row(ev.e1);
    assert.equal(e1.checkOutState, 'recorded');
    assert.equal(e1.checkOut.time, '14:10:00');
    assert.equal(e1.workedMinutes, 6 * 60 + 5);
    assert.equal((await row(ev.e7)).workedMinutes, 7 * 60 + 30);
    for (const e of [ev.e2, ev.e3, ev.e4]) {
      const r = await row(e);
      assert.equal(r.checkOutState, 'missing');
      assert.equal(r.checkOut, null);
      assert.equal(r.workedMinutes, null);
    }
    assert.equal((await row(ev.e5)).checkOutState, 'not_required');
    assert.equal((await row(ev.e6)).checkOutState, 'open');
    // Received 5 min + 1 s after the event: uploaded later; exactly 5 min: not.
    assert.equal((await row(ev.e3)).checkIn.uploadedLater, true);
    assert.equal((await row(ev.e4)).checkIn.uploadedLater, false);
    assert.equal(e1.checkIn.uploadedLater, false);
    // Received time is reported (instant and branch-local).
    assert.equal(e1.checkIn.receivedAt, ev.e1.receivedAt.toISOString());
    assert.equal(e1.checkIn.received.time, '08:05:01');
  });

  test('suspended staff are included and labelled; identity is limited to name, Staff ID, job title, status', async () => {
    const e3 = await row(ev.e3);
    assert.deepEqual(e3.staff, { id: people.s2.id, staffId: people.s2.staffId, name: people.s2.name, jobTitle: 'Teacher', status: 'suspended' });
    const options = await get('ownerA', `${OWNER}/options`, { ...RANGE(), staffQuery: 'Bashir' });
    assert.deepEqual(options.body.staff.map((s) => s.status), ['suspended']);
    assert.deepEqual(Object.keys(options.body.staff[0]).sort(), ['branchCode', 'id', 'jobTitle', 'name', 'staffId', 'status']);
  });

  test('location: distance and accuracy (rounded) only; coordinates are never returned', async () => {
    const e1 = await row(ev.e1);
    assert.equal(e1.checkIn.distanceMeters, 20);
    assert.equal(e1.checkIn.accuracyMeters, 10);
    for (const res of [
      await get('ownerA', `${OWNER}/records`, { ...RANGE(), pageSize: 100 }),
      await get('m1', `${MANAGER}/records`, { ...RANGE(), pageSize: 100 }),
      await get('ownerA', `${OWNER}/summary`, RANGE()),
      await get('ownerA', `${OWNER}/options`, { ...RANGE(), branch: branches.A1.id }),
    ]) {
      const text = JSON.stringify(res.body);
      for (const forbidden of ['latitude', 'longitude', String(POS.latitude), String(POS.longitude)]) assert.ok(!text.includes(forbidden), forbidden);
    }
  });
});

describe('check-out deadline (24 hours after the work day ends)', () => {
  test('missing exactly at the deadline, open a millisecond before', async () => {
    const workDate = addDays(D, -1);
    const deadline = new Date(zoned(addDays(workDate, 1), 0, zone).getTime() + 24 * 60 * MIN);
    const state = (now) => checkOutState({ hasCheckOut: false, checkOutEnabled: true, workDate, timeZone: zone }, now);
    assert.equal(state(deadline), 'missing');
    assert.equal(state(new Date(deadline.getTime() - 1)), 'open');
    assert.equal(lastClosedWorkDate(zone, deadline), workDate);
    // The database filter agrees with the row state at both instants (e6 is that day's open check-in).
    const scope = { schoolId: schools.A.id, branchId: branches.A2.id };
    const filters = { from: workDate, to: workDate, page: 1, pageSize: 20, sort: 'date', order: 'desc' };
    for (const [now, expected] of [
      [deadline, 'missing'],
      [new Date(deadline.getTime() - 1), 'open'],
    ]) {
      const page = await attendanceRecords(scope, { ...filters, checkOut: expected }, { now });
      assert.deepEqual(page.items.map((r) => [r.id, r.checkOutState]), [[ev.e6.id, expected]]);
      const summary = await attendanceSummary(scope, { from: workDate, to: workDate }, { now });
      assert.equal(summary.totals[expected === 'missing' ? 'checkOutMissing' : 'checkOutOpen'], 1);
    }
  });
});

describe('dates', () => {
  test('defaults to today; one date alone is a single day; inclusive at both ends', async () => {
    const res = await get('ownerA', `${OWNER}/records`);
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.filters.from, res.body.filters.to], [D, D]);
    assert.equal(res.body.today, D);
    const one = await get('ownerA', `${OWNER}/records`, { from: addDays(D, -10) });
    assert.deepEqual([one.body.filters.from, one.body.filters.to], [addDays(D, -10), addDays(D, -10)]);
    assert.deepEqual(ids(one), of(ev.e1, ev.e2));
    const edges = await get('ownerA', `${OWNER}/records`, { from: addDays(D, -10), to: addDays(D, -8) });
    assert.deepEqual(ids(edges), of(ev.e1, ev.e2, ev.e3, ev.e4));
    const inner = await get('ownerA', `${OWNER}/records`, { from: addDays(D, -9), to: addDays(D, -9) });
    assert.deepEqual(ids(inner), of(ev.e3));
  });

  test('at most 62 days; not reversed; not after today; strict dates; given once', async () => {
    const ok = await get('ownerA', `${OWNER}/summary`, { from: addDays(D, -61), to: D });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.byDay.length, 62);
    const bad = [
      { from: addDays(D, -62), to: D },
      { from: D, to: addDays(D, -1) },
      { from: D, to: addDays(D, 1) },
      { from: '2026-2-1' },
      { from: '2026-02-30' },
      { to: '20260201' },
    ];
    for (const params of bad) {
      for (const path of [`${OWNER}/summary`, `${OWNER}/records`, `${OWNER}/options`]) {
        const res = await get('ownerA', path, params);
        assert.equal(res.status, 400, `${path} ${JSON.stringify(params)}`);
        assert.equal(res.body.code, 'VALIDATION_ERROR');
      }
    }
    const repeated = await call(`${OWNER}/records?from=${D}&from=${D}`, { cookie: people.ownerA.cookie });
    assert.equal(repeated.status, 400);
    const tooLong = await get('m1', `${MANAGER}/records`, { from: addDays(D, -62), to: D });
    assert.equal(tooLong.status, 400);
    assert.match(tooLong.body.details.from, /62 days/);
  });

  test('by day: every date of the range, zero-filled; the same totals as the records', async () => {
    const res = await get('ownerA', `${OWNER}/summary`, RANGE());
    assert.equal(res.body.byDay.length, 21);
    assert.equal(res.body.byDay[0].date, addDays(D, -20));
    assert.equal(res.body.byDay.reduce((s, d) => s + d.present, 0), 4);
    assert.equal(res.body.byDay.reduce((s, d) => s + d.late, 0), 3);
    assert.deepEqual(res.body.byDay.find((d) => d.date === addDays(D, -10)), { date: addDays(D, -10), present: 1, late: 1 });
    assert.deepEqual(res.body.timeZones, [OLD_ZONE, zone].sort());
  });
});

describe('filters, search, sorting, pagination', () => {
  test('status, check-out state, staff, shift and search', async () => {
    const r = (params) => get('ownerA', `${OWNER}/records`, { ...RANGE(), pageSize: 100, ...params });
    assert.deepEqual(ids(await r({ status: 'late' })), of(ev.e2, ev.e4, ev.e7));
    assert.deepEqual(ids(await r({ status: 'present' })), of(ev.e1, ev.e3, ev.e5, ev.e6));
    assert.deepEqual(ids(await r({ checkOut: 'missing' })), of(ev.e2, ev.e3, ev.e4));
    assert.deepEqual(ids(await r({ checkOut: 'recorded' })), of(ev.e1, ev.e7));
    assert.deepEqual(ids(await r({ checkOut: 'not_required' })), of(ev.e5));
    assert.deepEqual(ids(await r({ checkOut: 'open' })), of(ev.e6));
    assert.deepEqual(ids(await r({ staff: people.s3.id })), of(ev.e6, ev.e7));
    assert.deepEqual(ids(await r({ q: people.s2.staffId.toLowerCase() })), of(ev.e3, ev.e4));
    assert.deepEqual(ids(await r({ q: 'amina' })), of(ev.e1, ev.e2, ev.e5));
    assert.deepEqual(ids(await r({ branch: branches.A1.id, shift: KA })), of(ev.e2));
    assert.deepEqual(ids(await r({ status: 'late', checkOut: 'missing', branch: branches.A1.id })), of(ev.e2, ev.e4));
    // Shift: only with a branch (owner), and only a shift of that branch.
    assert.equal((await r({ shift: KA })).status, 400);
    assert.equal((await r({ branch: branches.A2.id, shift: KA })).status, 400);
    assert.equal((await r({ status: 'absent' })).status, 400);
    assert.equal((await get('ownerA', `${OWNER}/summary`, { ...RANGE(), status: 'late' })).status, 400);
    // Manager shift filter.
    assert.deepEqual(ids(await get('m1', `${MANAGER}/records`, { ...RANGE(), shift: KM, pageSize: 100 })), of(ev.e1, ev.e3, ev.e4, ev.e5));
  });

  test('every sort, both directions, walks all pages without repeats or gaps', async () => {
    const all = of(ev.e1, ev.e2, ev.e3, ev.e4, ev.e5, ev.e6, ev.e7);
    for (const sort of ['date', 'checkIn', 'staffName', 'staffId', 'branch', 'status']) {
      for (const order of ['asc', 'desc']) {
        const seen = [];
        for (let page = 1; page <= 3; page += 1) {
          const res = await get('ownerA', `${OWNER}/records`, { ...RANGE(), sort, order, page, pageSize: 3 });
          assert.equal(res.status, 200);
          assert.equal(res.body.pageCount, 3);
          seen.push(...res.body.items.map((i) => i.id));
        }
        assert.equal(seen.length, 7, `${sort} ${order}`);
        assert.deepEqual([...seen].sort(), all, `${sort} ${order}`);
      }
    }
    const byDate = await get('ownerA', `${OWNER}/records`, { ...RANGE(), pageSize: 100 });
    const dates = byDate.body.items.map((i) => i.workDate);
    assert.deepEqual(dates, [...dates].sort().reverse());
    const byName = await get('ownerA', `${OWNER}/records`, { ...RANGE(), sort: 'staffName', order: 'asc', pageSize: 100 });
    const names = byName.body.items.map((i) => i.staff.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  });

  test('page size limits, clamped pages and empty results', async () => {
    for (const pageSize of [0, 101, 'x']) assert.equal((await get('ownerA', `${OWNER}/records`, { ...RANGE(), pageSize })).status, 400);
    const past = await get('ownerA', `${OWNER}/records`, { ...RANGE(), page: 50, pageSize: 5 });
    assert.equal(past.body.page, 2);
    assert.equal(past.body.items.length, 2);
    const empty = await get('ownerA', `${OWNER}/records`, { from: addDays(D, -19), to: addDays(D, -19) });
    assert.deepEqual([empty.status, empty.body.items, empty.body.total, empty.body.pageCount], [200, [], 0, 1]);
    const emptySummary = await get('ownerA', `${OWNER}/summary`, { from: addDays(D, -19), to: addDays(D, -19) });
    assert.equal(emptySummary.body.totals.checkIns, 0);
  });

  test('options: the school’s branches, the shifts in effect in the range (latest name), staff in scope', async () => {
    const owner = await get('ownerA', `${OWNER}/options`, RANGE());
    assert.deepEqual(owner.body.branches.map((b) => b.id), [branches.A1.id, branches.A2.id, branches.A3.id]);
    assert.deepEqual(owner.body.shifts, []);
    assert.ok(owner.body.staff.every((s) => s.branchCode.startsWith(`R${tag}-A-`)));
    assert.equal(owner.body.staff.length, 3);
    const recent = await get('ownerA', `${OWNER}/options`, { ...RANGE(), branch: branches.A1.id });
    assert.deepEqual(recent.body.shifts.map((s) => s.name), ['Early', 'Afternoon']);
    const old = await get('ownerA', `${OWNER}/options`, { from: addDays(D, -20), to: addDays(D, -10), branch: branches.A1.id });
    assert.deepEqual(old.body.shifts.map((s) => `${s.name} ${s.start}`), ['Morning 08:00', 'Afternoon 14:00']);
    const manager = await get('m1', `${MANAGER}/options`, RANGE());
    assert.equal(manager.body.branches, null);
    assert.deepEqual(manager.body.staff.map((s) => s.id).sort(), [people.s1.id, people.s2.id].sort());
    assert.equal((await get('ownerA', `${OWNER}/options`, { branch: branches.B1.id })).status, 404);
  });

  test('reports are read only: nothing is written', async () => {
    const counts = () => Promise.all([prisma.attendanceEvent.count(), prisma.auditEvent.count({ where: { schoolId: { in: [schools.A.id, schools.B.id] } } })]);
    const before = await counts();
    for (const path of ['summary', 'records', 'options']) {
      await get('ownerA', `${OWNER}/${path}`, RANGE());
      await get('m1', `${MANAGER}/${path}`, RANGE());
    }
    assert.deepEqual(await counts(), before);
  });
});

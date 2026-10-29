/*
 * Attendance tests (approved rules: docs/business-rules.md → Attendance check-in and check-out,
 * ATT-001 to ATT-005). Staff check in and out through the API with a mobile bearer session; the
 * server applies the 5-minute clock rule at upload, the 24-hour delay, the shift windows (from 30
 * minutes before start until the end), the check-out setting, suspension at the event time and the
 * geofence against the branch location in effect at the event time; retries are idempotent and
 * simultaneous submissions cannot create duplicates; suspension intervals are recorded exactly.
 * Boundary times are tested through the service with a fixed received time. Runs on the Neon dev
 * branch (`npm test`); everything it creates is removed afterwards.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { localMoment, recordEvent, shiftsWithWindows } from '../src/features/attendance/attendance.service.js';
import { mergeIntervals, suspendedAt, suspendedOverlap } from '../src/features/attendance/suspensions.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { platformTimeZone } from '../src/features/platform-settings/settings.service.js';
import { addDays } from '../src/features/schedules/schedules.service.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Attendance tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const phonePrefix = `+97${String(parseInt(randomBytes(3).toString('hex'), 16)).padStart(8, '0')}`;
let counter = 0;
const M_PER_DEG = (6_371_008.8 * Math.PI) / 180;
const north = (p, metres) => ({ latitude: p.latitude + metres / M_PER_DEG, longitude: p.longitude });
const P_A = { latitude: 2.046934, longitude: 45.318162 };
const P_OLD = { latitude: 2.1, longitude: 45.4 };
const P_NEW = north(P_OLD, 1000);
const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;
const schools = {};
const branches = {};
const people = {};
let server;
let base;
let zone;
let today;

async function call(path, { method = 'GET', body, token, cookie } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(token && { authorization: `Bearer ${token}` }),
      ...(cookie && { cookie, origin: ORIGIN }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, setCookie: response.headers.get('set-cookie') };
}

/** The instant of a local date and minute (with seconds) in a time zone (no DST in the test zones). */
function zoned(date, minutes) {
  const guess = new Date(Date.parse(`${date}T00:00:00Z`) + Math.round(minutes * 60) * 1000);
  const local = localMoment(guess, zone);
  const localMs = Date.parse(`${local.date}T00:00:00Z`) + Math.round(local.minutes * 60) * 1000;
  return new Date(guess.getTime() - (localMs - guess.getTime()));
}

const ALL_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
async function makeSchedule(branch, { checkOutEnabled = true, shifts, effectiveFrom = addDays(today, -10) }) {
  return prisma.branchSchedule.create({
    data: { branchId: branch.id, effectiveFrom: new Date(`${effectiveFrom}T00:00:00Z`), timeZone: zone, checkOutEnabled, shifts: { create: shifts } },
    include: { shifts: true },
  });
}
const shift = (name, startMinute, endMinute, extra = {}) => ({ shiftKey: randomUUID(), name, days: ALL_DAYS, startMinute, endMinute, graceMinutes: 10, absenceCutoffMinutes: 30, ...extra });

/** A STAFF account in a branch, assigned to `shiftKeys` (all days) from 10 days ago, signed in on the mobile app. */
async function makeStaff(branchKey, shiftKeys = []) {
  counter += 1;
  const branch = branches[branchKey];
  const password = randomBytes(12).toString('base64url');
  const phone = `${phonePrefix}${String(counter).padStart(3, '0')}`;
  const user = await prisma.user.create({
    data: {
      name: `Attendance Staff ${counter} ${tag}`,
      email: `test-att-${counter}-${lower}@test.edutrack.example`,
      role: 'STAFF',
      branchId: branch.id,
      staffId: `${branch.code}-ST${String(counter).padStart(3, '0')}`,
      phone,
      phoneKey: phone,
      jobTitle: 'Teacher',
      passwordHash: await hashPassword(password),
    },
  });
  if (shiftKeys.length) {
    await prisma.staffAssignment.create({
      data: {
        staffUserId: user.id,
        branchId: branch.id,
        effectiveFrom: new Date(`${addDays(today, -10)}T00:00:00Z`),
        timeZone: zone,
        shifts: { create: shiftKeys.map((shiftKey) => ({ shiftKey, days: ALL_DAYS })) },
      },
    });
  }
  const res = await call('/api/auth/login', { method: 'POST', body: { identifier: phone, password, client: 'mobile' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return { ...user, token: res.body.token, password, branch };
}

const position = (p, accuracy = 10) => ({ latitude: p.latitude, longitude: p.longitude, accuracy });
const eventBody = ({ type = 'CHECK_IN', occurredAt = new Date(Date.now() - 1000), sentAt = new Date(), at = P_A, accuracy = 10, id = randomUUID() } = {}) => ({
  clientEventId: id,
  type,
  occurredAt: occurredAt.toISOString(),
  sentAt: sentAt.toISOString(),
  position: position(at, accuracy),
});
const post = (staff, body) => call('/api/attendance/events', { method: 'POST', body, token: staff.token });
/** The service with a fixed received time (for exact boundaries). */
const direct = (staff, { type = 'CHECK_IN', occurredAt, receivedAt, sentAt = receivedAt, at = P_A, accuracy = 10 }) =>
  recordEvent({ id: staff.id, branchId: staff.branch.id }, { clientEventId: randomUUID(), type, occurredAt, sentAt, position: position(at, accuracy) }, receivedAt);
const codeOf = async (promise) => {
  try {
    await promise;
    return 'accepted';
  } catch (error) {
    return error.code ?? error.message;
  }
};

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  zone = await platformTimeZone();
  today = localMoment(new Date(), zone).date;
  schools.A = await prisma.school.create({ data: { code: `A${tag}-S`, name: `Attendance School ${tag}`, location: 'Mogadishu' } });
  const mk = (key, n, extra = {}) =>
    prisma.branch.create({ data: { schoolId: schools.A.id, number: n, code: `A${tag}-S-B00${n}`, name: `Att ${key}`, nameKey: `att ${key.toLowerCase()}`, address: 'Road', city: 'Mogadishu', ...extra } });
  branches.A = await mk('A', 1);
  branches.NOOUT = await mk('NOOUT', 2);
  branches.HIST = await mk('HIST', 3);
  branches.SUSP = await mk('SUSP', 4);
  const tenDaysAgo = new Date(Date.now() - 10 * 24 * HOUR - HOUR);
  for (const key of ['A', 'NOOUT', 'SUSP']) {
    await prisma.branchLocation.create({ data: { branchId: branches[key].id, ...P_A, accuracyMeters: 8, effectiveFrom: tenDaysAgo } });
  }
  await prisma.branchLocation.create({ data: { branchId: branches.HIST.id, ...P_OLD, accuracyMeters: 8, effectiveFrom: tenDaysAgo } });
  await prisma.branchLocation.create({ data: { branchId: branches.HIST.id, ...P_NEW, accuracyMeters: 8, effectiveFrom: new Date(Date.now() - 2 * HOUR) } });
  // An all-day shift (00:00–23:59) everywhere, plus windowed shifts in branch A.
  const allDay = (branch, checkOutEnabled = true, extra = []) => makeSchedule(branch, { checkOutEnabled, shifts: [shift('All day', 0, 1439), ...extra] });
  branches.A.schedule = await allDay(branches.A, true, []);
  branches.NOOUT.schedule = await allDay(branches.NOOUT, false);
  branches.HIST.schedule = await allDay(branches.HIST);
  branches.SUSP.schedule = await allDay(branches.SUSP);
  branches.W = await mk('W', 5);
  await prisma.branchLocation.create({ data: { branchId: branches.W.id, ...P_A, accuracyMeters: 8, effectiveFrom: tenDaysAgo } });
  branches.W.schedule = await makeSchedule(branches.W, { shifts: [shift('Morning', 480, 720), shift('Late', 720, 900)] });
  const owner = await prisma.user.create({ data: { name: `Att Owner ${tag}`, email: `test-att-owner-${lower}@test.edutrack.example`, role: 'OWNER', passwordHash: await hashPassword('owner-password-123') } });
  await prisma.school.update({ where: { id: schools.A.id }, data: { ownerId: owner.id } });
  const ownerLogin = await call('/api/auth/login', { method: 'POST', body: { email: owner.email, password: 'owner-password-123' } });
  people.owner = { ...owner, cookie: ownerLogin.setCookie.split(';')[0] };
});

after(async () => {
  const branchIds = Object.values(branches).map((b) => b.id);
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  await prisma.attendanceEvent.deleteMany({ where: { branchId: { in: branchIds }, type: 'CHECK_OUT' } });
  await prisma.attendanceEvent.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.suspensionPeriod.deleteMany({ where: { OR: [{ schoolId: schools.A.id }, { branchId: { in: branchIds } }] } });
  await prisma.auditEvent.deleteMany({ where: { OR: [{ schoolId: schools.A.id }, { actorId: { in: userIds } }, { targetId: { in: [...userIds, ...branchIds] } }] } });
  const sets = (await prisma.staffAssignment.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((s) => s.id);
  await prisma.staffAssignmentShift.deleteMany({ where: { assignmentId: { in: sets } } });
  await prisma.staffAssignment.deleteMany({ where: { id: { in: sets } } });
  const versions = (await prisma.branchSchedule.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((v) => v.id);
  await prisma.branchShift.deleteMany({ where: { scheduleId: { in: versions } } });
  await prisma.branchSchedule.deleteMany({ where: { id: { in: versions } } });
  await prisma.branchLocation.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds }, role: 'STAFF' } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
  await prisma.school.update({ where: { id: schools.A.id }, data: { ownerId: null } });
  await prisma.school.delete({ where: { id: schools.A.id } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  server.close();
  await prisma.$disconnect();
});

const allDayKey = (key) => branches[key].schedule.shifts[0].shiftKey;

describe('mobile sessions', () => {
  test('staff get the session as a bearer token (no cookie); it works like the web session and signs out', async () => {
    const staff = await makeStaff('A', [allDayKey('A')]);
    const session = await call('/api/auth/session', { token: staff.token });
    assert.equal(session.body.user.id, staff.id);
    const login = await call('/api/auth/login', { method: 'POST', body: { identifier: staff.phone, password: staff.password, client: 'mobile' } });
    assert.equal(login.setCookie, null, 'no cookie for the mobile app');
    assert.match(login.body.token, /^[\w-]{40,}$/);
    assert.equal((await call('/api/auth/logout', { method: 'POST', token: login.body.token })).status, 204);
    assert.equal((await call('/api/auth/session', { token: login.body.token })).body.user, null);
    assert.equal((await call('/api/auth/session', { token: 'not-a-real-token-but-long-enough-0000' })).body.user, null);
    const event = await prisma.auditEvent.findFirst({ where: { actorId: staff.id, action: 'SIGN_IN', result: 'SUCCESS' } });
    assert.equal(event.targetName, 'EduTrack mobile app');
  });

  test('only STAFF and MANAGER accounts can use the mobile app; an invalid client is refused', async () => {
    const res = await call('/api/auth/login', { method: 'POST', body: { email: people.owner.email, password: 'owner-password-123', client: 'mobile' } });
    assert.equal(res.status, 403);
    assert.equal(res.body.token, undefined);
    assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: people.owner.email, password: 'owner-password-123', client: 'tv' } })).status, 400);
  });

  test('attendance is for STAFF only', async () => {
    assert.equal((await call('/api/attendance/today')).status, 401);
    assert.equal((await call('/api/attendance/today', { cookie: people.owner.cookie })).status, 403);
  });
});

describe('check-in and check-out', () => {
  test('a valid check-in and check-out are recorded with the shift, version, location and distance', async () => {
    const staff = await makeStaff('A', [allDayKey('A')]);
    const inRes = await post(staff, eventBody({ at: north(P_A, 40) }));
    assert.equal(inRes.status, 201, JSON.stringify(inRes.body));
    assert.equal(inRes.body.event.type, 'CHECK_IN');
    assert.ok(['PRESENT', 'LATE'].includes(inRes.body.event.status));
    assert.equal(inRes.body.event.shift.name, 'All day');
    assert.ok(Math.abs(inRes.body.event.distanceMeters - 40) < 0.2);
    const row = await prisma.attendanceEvent.findUnique({ where: { id: inRes.body.event.id } });
    assert.equal(row.scheduleId, branches.A.schedule.id);
    assert.ok(row.receivedAt >= row.occurredAt);
    const outRes = await post(staff, eventBody({ type: 'CHECK_OUT' }));
    assert.equal(outRes.status, 201, JSON.stringify(outRes.body));
    assert.equal(outRes.body.event.checkInEventId, inRes.body.event.id);
    const todayRes = await call('/api/attendance/today', { token: staff.token });
    assert.deepEqual(todayRes.body.events.map((e) => e.type), ['CHECK_IN', 'CHECK_OUT']);
    assert.equal(todayRes.body.shifts[0].name, 'All day');
  });

  test('GPS: 50 m accuracy and 100 m distance are accepted; worse is refused and nothing is recorded', async () => {
    const ok = await makeStaff('A', [allDayKey('A')]);
    assert.equal((await post(ok, eventBody({ accuracy: 50, at: north(P_A, 99.99) }))).status, 201);
    const refused = await makeStaff('A', [allDayKey('A')]);
    for (const [body, reason] of [
      [eventBody({ accuracy: 50.1 }), 'accuracy_too_low'],
      [eventBody({ at: north(P_A, 100.01) }), 'outside_geofence'],
      [{ ...eventBody(), position: null }, 'no_position'],
      [eventBody({ at: { latitude: 0, longitude: 0 } }), 'invalid_position'],
    ]) {
      const res = await post(refused, body);
      assert.equal(res.status, 422);
      assert.equal(res.body.code, 'LOCATION_REFUSED');
      assert.equal(res.body.details.reason, reason);
    }
    assert.equal(await prisma.attendanceEvent.count({ where: { staffUserId: refused.id } }), 0);
  });

  test('check-out has the same GPS rules', async () => {
    const staff = await makeStaff('A', [allDayKey('A')]);
    await post(staff, eventBody());
    const res = await post(staff, eventBody({ type: 'CHECK_OUT', at: north(P_A, 150) }));
    assert.equal(res.body.code, 'LOCATION_REFUSED');
  });

  test('the branch location in effect at the event time is used (an offline event before a move)', async () => {
    const before = await makeStaff('HIST', [allDayKey('HIST')]);
    const old = await post(before, eventBody({ at: P_OLD, occurredAt: new Date(Date.now() - 3 * HOUR) }));
    assert.equal(old.status, 201, JSON.stringify(old.body));
    const now = await makeStaff('HIST', [allDayKey('HIST')]);
    assert.equal((await post(now, eventBody({ at: P_OLD }))).body.details?.reason, 'outside_geofence');
    assert.equal((await post(now, eventBody({ at: P_NEW }))).status, 201);
  });

  test('wrong branch or no assignment: refused', async () => {
    const unassigned = await makeStaff('A');
    assert.equal((await post(unassigned, eventBody())).body.code, 'NO_SHIFT');
    const elsewhere = await makeStaff('HIST', [allDayKey('HIST')]);
    assert.equal((await post(elsewhere, eventBody({ at: P_A }))).body.details?.reason, 'outside_geofence', 'at another branch');
  });

  test('check-out: refused when disabled, without an open check-in, and twice', async () => {
    const noOut = await makeStaff('NOOUT', [allDayKey('NOOUT')]);
    await post(noOut, eventBody());
    assert.equal((await post(noOut, eventBody({ type: 'CHECK_OUT' }))).body.code, 'CHECK_OUT_DISABLED');
    const staff = await makeStaff('A', [allDayKey('A')]);
    assert.equal((await post(staff, eventBody({ type: 'CHECK_OUT' }))).body.code, 'NO_OPEN_CHECK_IN');
    await post(staff, eventBody());
    assert.equal((await post(staff, eventBody({ type: 'CHECK_OUT' }))).status, 201);
    assert.equal((await post(staff, eventBody({ type: 'CHECK_OUT' }))).body.code, 'NO_OPEN_CHECK_IN');
  });

  test('the request cannot choose the staff member, branch, shift or status', async () => {
    const staff = await makeStaff('A', [allDayKey('A')]);
    for (const extra of [{ branchId: branches.HIST.id }, { staffId: randomUUID() }, { shiftKey: allDayKey('A') }, { status: 'PRESENT' }, { other: 1 }]) {
      assert.equal((await post(staff, { ...eventBody(), ...extra })).status, 400, JSON.stringify(extra));
    }
  });
});

describe('duplicates, retries and simultaneous submissions', () => {
  test('the same event again returns the recorded one; the same id with other content is refused', async () => {
    const staff = await makeStaff('A', [allDayKey('A')]);
    const body = eventBody();
    const first = await post(staff, body);
    const again = await post(staff, body);
    assert.deepEqual([first.status, again.status], [201, 200]);
    assert.equal(again.body.event.id, first.body.event.id);
    const changed = await post(staff, { ...body, position: position(north(P_A, 5)) });
    assert.equal(changed.status, 409);
    assert.equal(changed.body.code, 'IDEMPOTENCY_CONFLICT');
    assert.equal(await prisma.attendanceEvent.count({ where: { staffUserId: staff.id } }), 1);
  });

  test('a retry is accepted even after the 24-hour limit (the event is already recorded)', async () => {
    const staff = await makeStaff('A', [allDayKey('A')]);
    const body = eventBody({ occurredAt: new Date(Date.now() - 23 * HOUR) });
    assert.equal((await post(staff, body)).status, 201);
    const res = await recordEvent({ id: staff.id, branchId: branches.A.id }, { ...body, occurredAt: new Date(body.occurredAt), sentAt: new Date(Date.now() + 2 * HOUR), position: body.position }, new Date(Date.now() + 2 * HOUR));
    assert.equal(res.created, false);
  });

  test('simultaneous deliveries of one event record it once; simultaneous different check-ins record one', async () => {
    const staff = await makeStaff('A', [allDayKey('A')]);
    const body = eventBody();
    const same = await Promise.all([post(staff, body), post(staff, body), post(staff, body)]);
    assert.deepEqual(same.map((r) => r.status).sort(), [200, 200, 201]);
    const other = await makeStaff('A', [allDayKey('A')]);
    const two = await Promise.all([post(other, eventBody()), post(other, eventBody())]);
    assert.deepEqual(two.map((r) => r.status).sort(), [201, 409]);
    assert.ok(two.some((r) => r.body.code === 'ALREADY_CHECKED_IN'));
    assert.equal(await prisma.attendanceEvent.count({ where: { staffUserId: other.id } }), 1);
    const outs = await Promise.all([post(other, eventBody({ type: 'CHECK_OUT' })), post(other, eventBody({ type: 'CHECK_OUT' }))]);
    assert.deepEqual(outs.filter((r) => r.status === 201).length, 1);
    assert.equal(await prisma.attendanceEvent.count({ where: { staffUserId: other.id, type: 'CHECK_OUT' } }), 1);
  });
});

describe('event time, offline delay and device clock', () => {
  test('received within 24 hours: exactly 24 h is accepted, a second more is refused', async () => {
    const staff = await makeStaff('A', [allDayKey('A')]);
    const received = new Date();
    assert.equal(await codeOf(direct(staff, { occurredAt: new Date(received - 24 * HOUR - 1000), receivedAt: received })), 'EVENT_TOO_OLD');
    assert.equal(await codeOf(direct(staff, { occurredAt: new Date(received - 24 * HOUR), receivedAt: received })), 'accepted');
  });

  test('device clock within 5 minutes when uploaded (both directions); exactly 5 minutes is accepted', async () => {
    const staff = await makeStaff('A', [allDayKey('A')]);
    const received = new Date();
    const occurredAt = new Date(received - 30 * MIN);
    for (const offset of [5 * MIN + 1000, -(5 * MIN + 1000)]) {
      assert.equal(await codeOf(direct(staff, { occurredAt, receivedAt: received, sentAt: new Date(received.getTime() + offset) })), 'CLOCK_SKEW');
    }
    assert.equal(await codeOf(direct(staff, { occurredAt, receivedAt: received, sentAt: new Date(received.getTime() - 5 * MIN) })), 'accepted');
  });

  test('an old offline event is judged by the clock at upload, not by its age', async () => {
    const staff = await makeStaff('A', [allDayKey('A')]);
    const res = await post(staff, eventBody({ occurredAt: new Date(Date.now() - 20 * HOUR) }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const skewed = await makeStaff('A', [allDayKey('A')]);
    const bad = await post(skewed, eventBody({ sentAt: new Date(Date.now() + 6 * MIN), occurredAt: new Date(Date.now() - MIN) }));
    assert.equal(bad.body.code, 'CLOCK_SKEW');
  });

  test('an event later than its sending is refused', async () => {
    const staff = await makeStaff('A', [allDayKey('A')]);
    const sentAt = new Date();
    assert.equal((await post(staff, eventBody({ sentAt, occurredAt: new Date(sentAt.getTime() + 1000) }))).body.code, 'EVENT_IN_FUTURE');
  });
});

describe('shift windows and status', () => {
  const day = (n) => addDays(today, -n);

  test('windows open 30 minutes early, but not before an earlier shift ends; they close at the shift end', () => {
    const schedule = { shifts: [{ shiftKey: 'm', days: ['MON'], startMinute: 420, endMinute: 780 }, { shiftKey: 'a', days: ['MON'], startMinute: 780, endMinute: 1080 }, { shiftKey: 'e', days: ['MON'], startMinute: 1090, endMinute: 1200 }, { shiftKey: 'x', days: ['MON'], startMinute: 10, endMinute: 60 }] };
    const assignment = { shifts: ['m', 'a', 'e', 'x'].map((shiftKey) => ({ shiftKey, days: ['MON'] })) };
    const windows = shiftsWithWindows(assignment, schedule, 'MON').map((w) => [w.shift.shiftKey, w.opensAt, w.closesAt]);
    assert.deepEqual(windows, [['x', 0, 60], ['m', 390, 780], ['a', 780, 1080], ['e', 1080, 1200]]);
    assert.deepEqual(shiftsWithWindows({ shifts: [{ shiftKey: 'm', days: ['TUE'] }] }, schedule, 'MON'), [], 'not assigned that day');
  });

  test('check-in window edges (Morning 08:00–12:00): 07:30:00 opens, 07:29:59 and 12:00:00 are outside', async () => {
    const [morning] = branches.W.schedule.shifts.filter((s) => s.name === 'Morning');
    const staff = await makeStaff('W', [morning.shiftKey]);
    const at = (n, minutes) => zoned(day(n), minutes);
    const received = (t) => new Date(Math.max(t.getTime() + MIN, Date.now() - 23 * HOUR));
    const tryAt = (n, minutes) => {
      const occurredAt = at(n, minutes);
      return codeOf(direct(staff, { occurredAt, receivedAt: received(occurredAt) }));
    };
    assert.equal(await tryAt(1, 450 - 1 / 60), 'OUTSIDE_SHIFT_WINDOW');
    assert.equal(await tryAt(1, 720), 'OUTSIDE_SHIFT_WINDOW');
    assert.equal(await tryAt(1, 450), 'accepted');
  });

  test('status: PRESENT at exactly start + grace, LATE a second later', async () => {
    const staff = await makeStaff('A', [allDayKey('A')]);
    const check = async (n, minutes) => {
      const occurredAt = zoned(day(n), minutes);
      const res = await direct(staff, { occurredAt, receivedAt: new Date(occurredAt.getTime() + MIN) });
      return res.event.status;
    };
    assert.equal(await check(1, 10), 'PRESENT');
    assert.equal(await check(2, 10 + 1 / 60), 'LATE');
  });
});

describe('suspension intervals', () => {
  test('suspending and reactivating a branch records the exact interval; repeated changes do not overlap', async () => {
    const branch = branches.SUSP;
    const path = (action) => `/api/owner/branches/${branch.id}/${action}`;
    for (let i = 0; i < 2; i += 1) {
      assert.equal((await call(path('suspend'), { method: 'POST', body: { reason: `Holiday ${i}` }, cookie: people.owner.cookie })).status, 200);
      assert.equal((await call(path('reactivate'), { method: 'POST', cookie: people.owner.cookie })).status, 200);
    }
    const periods = await prisma.suspensionPeriod.findMany({ where: { branchId: branch.id }, orderBy: { startedAt: 'asc' } });
    assert.equal(periods.length, 2);
    assert.ok(periods.every((p) => p.endedAt && p.endedAt >= p.startedAt && p.startedById === people.owner.id && p.endedById === people.owner.id));
    assert.ok(periods[1].startedAt >= periods[0].endedAt, 'no overlap');
    assert.equal(periods[0].reason, 'Holiday 0');
    await assert.rejects(prisma.suspensionPeriod.createMany({ data: [{ branchId: branch.id, startedAt: new Date(), reason: 'a' }, { branchId: branch.id, startedAt: new Date(), reason: 'b' }] }), 'one open period');
    await assert.rejects(prisma.suspensionPeriod.create({ data: { branchId: branch.id, schoolId: schools.A.id, startedAt: new Date(), reason: 'both' } }));
    await prisma.suspensionPeriod.deleteMany({ where: { branchId: branch.id } });
  });

  test('a check-in is refused when the branch was suspended at the event time: the start is inside, the end is outside', async () => {
    const start = new Date(Date.now() - 2 * HOUR);
    const end = new Date(Date.now() - HOUR);
    const period = await prisma.suspensionPeriod.create({ data: { branchId: branches.SUSP.id, startedAt: start, endedAt: end, reason: 'Test' } });
    try {
      const atStart = await makeStaff('SUSP', [allDayKey('SUSP')]);
      assert.equal(await codeOf(direct(atStart, { occurredAt: start, receivedAt: new Date() })), 'BRANCH_SUSPENDED');
      assert.equal((await post(atStart, eventBody({ occurredAt: new Date(start.getTime() + 30 * MIN) }))).body.code, 'BRANCH_SUSPENDED');
      assert.equal(await codeOf(direct(atStart, { occurredAt: end, receivedAt: new Date() })), 'accepted');
      const before = await makeStaff('SUSP', [allDayKey('SUSP')]);
      assert.equal(await codeOf(direct(before, { occurredAt: new Date(start - 1000), receivedAt: new Date() })), 'accepted');
    } finally {
      await prisma.suspensionPeriod.delete({ where: { id: period.id } });
    }
  });

  test('a school suspension also refuses check-ins; a check-out during a suspension is allowed', async () => {
    const staff = await makeStaff('SUSP', [allDayKey('SUSP')]);
    assert.equal((await post(staff, eventBody({ occurredAt: new Date(Date.now() - 10 * MIN) }))).status, 201);
    const period = await prisma.suspensionPeriod.create({ data: { schoolId: schools.A.id, startedAt: new Date(Date.now() - 5 * MIN), reason: 'Test' } });
    try {
      assert.equal((await post(staff, eventBody({ type: 'CHECK_OUT' }))).status, 201, 'checked in before the suspension');
      const other = await makeStaff('SUSP', [allDayKey('SUSP')]);
      const res = await post(other, eventBody());
      assert.equal(res.body.code, 'BRANCH_SUSPENDED');
      assert.deepEqual(res.body.details.reasons, ['school_suspended']);
    } finally {
      await prisma.suspensionPeriod.delete({ where: { id: period.id } });
    }
  });

  test('overlap with a shift: only the suspended part, merged and clipped', async () => {
    // Date.UTC drops fractional hours, so build the times from milliseconds.
    const t = (h) => new Date(Date.UTC(2026, 0, 5) + h * HOUR);
    const periods = await Promise.all([
      prisma.suspensionPeriod.create({ data: { branchId: branches.W.id, startedAt: t(9), endedAt: t(10), reason: 'a' } }),
      prisma.suspensionPeriod.create({ data: { schoolId: schools.A.id, startedAt: t(9.5), endedAt: t(11), reason: 'b' } }),
      prisma.suspensionPeriod.create({ data: { branchId: branches.W.id, startedAt: t(15), endedAt: t(16), reason: 'c' } }),
    ]);
    try {
      const where = { branchId: branches.W.id, schoolId: schools.A.id };
      assert.deepEqual(await suspendedOverlap(where, t(8), t(14)), [{ start: t(9), end: t(11) }]);
      assert.deepEqual(await suspendedOverlap(where, t(10.5), t(15.5)), [{ start: t(10.5), end: t(11) }, { start: t(15), end: t(15.5) }]);
      assert.deepEqual(await suspendedOverlap(where, t(11), t(15)), [], 'touching ends do not overlap');
      assert.deepEqual((await suspendedAt(where, t(10))).reasons, ['school_suspended']);
      assert.equal((await suspendedAt(where, t(11))).suspended, false);
      assert.deepEqual(mergeIntervals([{ start: t(1), end: t(2) }, { start: t(2), end: t(3) }]), [{ start: t(1), end: t(3) }]);
    } finally {
      await prisma.suspensionPeriod.deleteMany({ where: { id: { in: periods.map((p) => p.id) } } });
    }
  });
});

describe('history and integrity', () => {
  test('events cannot break the approved limits or link wrongly, even written directly', async () => {
    const staff = await makeStaff('A', [allDayKey('A')]);
    const res = await post(staff, eventBody());
    const row = await prisma.attendanceEvent.findUnique({ where: { id: res.body.event.id } });
    const { id, checkInEventId, ...copy } = row;
    const fresh = { ...copy, clientEventId: randomUUID(), workDate: new Date(`${addDays(today, -5)}T00:00:00Z`) };
    await assert.rejects(prisma.attendanceEvent.create({ data: { ...fresh, accuracyMeters: 51 } }));
    await assert.rejects(prisma.attendanceEvent.create({ data: { ...fresh, distanceMeters: 101 } }));
    await assert.rejects(prisma.attendanceEvent.create({ data: { ...fresh, status: null } }));
    await assert.rejects(prisma.attendanceEvent.create({ data: { ...fresh, receivedAt: new Date(fresh.occurredAt.getTime() + 25 * HOUR) } }));
    await assert.rejects(prisma.attendanceEvent.create({ data: { ...fresh, type: 'CHECK_OUT', status: null } }), 'a check-out needs its check-in');
    await assert.rejects(prisma.attendanceEvent.create({ data: { ...fresh, workDate: row.workDate } }), 'one check-in per shift and day');
  });

  test('no audit event is written per attendance event, and positions are not in the audit log', async () => {
    const staff = await makeStaff('A', [allDayKey('A')]);
    await post(staff, eventBody());
    const events = await prisma.auditEvent.findMany({ where: { actorId: staff.id } });
    assert.ok(events.every((e) => e.action === 'SIGN_IN'));
    assert.ok(!JSON.stringify(events).includes(String(P_A.latitude)));
  });
});

describe('staff app reads: profile, history, branch location', () => {
  test('the profile is the signed-in staff member’s own, read only', async () => {
    const staff = await makeStaff('A', [allDayKey('A')]);
    const res = await call('/api/attendance/profile', { token: staff.token });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      name: staff.name,
      staffId: staff.staffId,
      phone: staff.phone,
      jobTitle: 'Teacher',
      email: staff.email,
      branch: { code: branches.A.code, name: branches.A.name },
      school: { code: schools.A.code, name: schools.A.name },
    });
    assert.equal((await call('/api/attendance/profile', { cookie: people.owner.cookie })).status, 403);
    assert.equal((await call('/api/attendance/profile')).status, 401);
  });

  test('history: own events in the date range, newest first; ranges are checked', async () => {
    const staff = await makeStaff('A', [allDayKey('A')]);
    const other = await makeStaff('A', [allDayKey('A')]);
    const res = await post(staff, eventBody());
    await post(other, eventBody());
    const row = await prisma.attendanceEvent.findUnique({ where: { id: res.body.event.id } });
    const { id, checkInEventId, ...copy } = row;
    const pastDay = (days) => ({ ...copy, clientEventId: randomUUID(), workDate: new Date(`${addDays(today, -days)}T00:00:00Z`) });
    await prisma.attendanceEvent.create({ data: pastDay(3) });
    await prisma.attendanceEvent.create({ data: pastDay(40) });

    const week = await call(`/api/attendance/history?from=${addDays(today, -6)}&to=${today}`, { token: staff.token });
    assert.equal(week.status, 200, JSON.stringify(week.body));
    assert.deepEqual(week.body.events.map((e) => e.workDate), [today, addDays(today, -3)]);
    assert.equal(week.body.events[0].shift.name, 'All day');
    assert.equal(week.body.events[0].latitude, undefined, 'no coordinates are returned');
    const byDefault = await call('/api/attendance/history', { token: staff.token });
    assert.deepEqual(byDefault.body, week.body, 'the last 7 days by default');
    const wide = await call(`/api/attendance/history?from=${addDays(today, -61)}&to=${today}`, { token: staff.token });
    assert.equal(wide.body.events.length, 3);

    for (const query of [`from=${addDays(today, -62)}&to=${today}`, `from=${today}&to=${addDays(today, -1)}`, 'from=2026-02-30&to=2026-03-01', 'from=yesterday', `from=${today}&from=${today}`]) {
      assert.equal((await call(`/api/attendance/history?${query}`, { token: staff.token })).status, 400, query);
    }
  });

  test('today includes the branch location in effect and a scheduled change, for the app’s check', async () => {
    const staff = await makeStaff('NOOUT', [allDayKey('NOOUT')]);
    let res = await call('/api/attendance/today', { token: staff.token });
    assert.deepEqual({ ...res.body.branchLocation, effectiveFrom: undefined }, { ...P_A, effectiveFrom: undefined });
    assert.equal(res.body.scheduledBranchLocation, null);
    const later = new Date(Date.now() + 48 * HOUR);
    await prisma.branchLocation.create({ data: { branchId: branches.NOOUT.id, ...P_OLD, accuracyMeters: 8, effectiveFrom: later } });
    res = await call('/api/attendance/today', { token: staff.token });
    assert.deepEqual(res.body.scheduledBranchLocation, { ...P_OLD, effectiveFrom: later.toISOString() });
  });
});

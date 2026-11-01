/*
 * Notification module tests (approved decisions N1–N24; docs/notifications/notification-test-plan.md).
 * Everything goes through the real API and services against the Neon dev branch: recipients of every
 * event, school and branch isolation, Manager transfers (N10), late check-ins and offline uploads
 * (N6), missing check-outs (N8), digests (N6–N8), schedule targeting (N9), suspensions (N11),
 * preferences (N12), settings (N5, N13), announcements (N17, N19), read state, retention (N18),
 * suspended accounts (N15), push (N2, N21), the outbox (retries, duplicates) and audit (N22).
 * Job tasks are run limited to this file's schools, so no other data on the dev branch is touched.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { getPrisma } from '../src/config/prisma.js';
import { localMoment, recordEvent } from '../src/features/attendance/attendance.service.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { listNotifications, notificationViewer } from '../src/features/notifications/feed.service.js';
import { createDigests, notifyBranchesWithoutSchedule, notifyMissingCheckOuts, purgeExpired } from '../src/features/notifications/jobs.js';
import { createNotifications } from '../src/features/notifications/notify.js';
import { RETENTION_MS } from '../src/features/notifications/notificationTypes.js';
import { enqueue, MAX_ATTEMPTS, processEvent } from '../src/features/notifications/outbox.js';
import { sendPendingPush } from '../src/features/notifications/push.js';
import { platformTimeZone } from '../src/features/platform-settings/settings.service.js';
import { addDays } from '../src/features/schedules/schedules.service.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Notification tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const phonePrefix = `+96${String(parseInt(randomBytes(3).toString('hex'), 16)).padStart(8, '0')}`;
const P = { latitude: 2.046934, longitude: 45.318162 };
const ALL = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const startedAt = new Date();
const schools = {};
const branches = {};
const people = {};
const stub = { messages: [] };
let server;
let stubServer;
let base;
let zone;
let today;
let counter = 0;
let savedPlatformSettings;
const savedEnv = { expoPushUrl: env.expoPushUrl, cronSecret: env.cronSecret };

async function call(path, { method = 'GET', body, token, cookie, headers = {} } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(token && { authorization: `Bearer ${token}` }),
      ...(cookie && { cookie, origin: ORIGIN }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, setCookie: response.headers.get('set-cookie') };
}
/** Sends as the person: their web cookie or mobile token. */
const as = (person, path, options = {}) => call(path, { ...options, cookie: person.cookie, token: person.token });

function zoned(date, minutes) {
  const guess = new Date(Date.parse(`${date}T00:00:00Z`) + Math.round(minutes * 60) * 1000);
  const local = localMoment(guess, zone);
  const localMs = Date.parse(`${local.date}T00:00:00Z`) + Math.round(local.minutes * 60) * 1000;
  return new Date(guess.getTime() - (localMs - guess.getTime()));
}

async function webUser(key, role, extra = {}) {
  counter += 1;
  const password = `pw-${randomBytes(9).toString('base64url')}`;
  const user = await prisma.user.create({
    data: { name: `Notif ${key} ${tag}`, email: `test-notif-${counter}-${lower}@test.edutrack.example`, role, passwordHash: await hashPassword(password), ...extra },
  });
  const login = await call('/api/auth/login', { method: 'POST', body: { email: user.email, password } });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  people[key] = { ...user, password, cookie: login.setCookie.split(';')[0] };
  return people[key];
}

async function manager(key, branchKey) {
  const m = await webUser(key, 'MANAGER', { branchId: branches[branchKey].id, phone: '+252610000000' });
  await prisma.managerAssignment.create({ data: { managerId: m.id, branchId: branches[branchKey].id } });
  m.branch = branches[branchKey];
  return m;
}

async function staffLogin(person) {
  const res = await call('/api/auth/login', { method: 'POST', body: { identifier: person.phone, password: person.password, client: 'mobile' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  person.token = res.body.token;
  return person;
}

async function staff(key, branchKey, shiftNames) {
  counter += 1;
  const branch = branches[branchKey];
  const password = randomBytes(12).toString('base64url');
  const phone = `${phonePrefix}${String(counter).padStart(3, '0')}`;
  const user = await prisma.user.create({
    data: {
      name: `Notif Staff ${key} ${tag}`,
      email: `test-notif-${counter}-${lower}@test.edutrack.example`,
      role: 'STAFF',
      branchId: branch.id,
      staffId: `${branch.code}-ST${String(counter).padStart(3, '0')}`,
      phone,
      phoneKey: phone,
      jobTitle: 'Teacher',
      passwordHash: await hashPassword(password),
    },
  });
  const set = await prisma.staffAssignment.create({
    data: {
      staffUserId: user.id,
      branchId: branch.id,
      effectiveFrom: new Date(`${addDays(today, -10)}T00:00:00Z`),
      timeZone: zone,
      shifts: { create: shiftNames.map((n) => ({ shiftKey: branch.keys[n], days: ALL })) },
    },
  });
  people[key] = await staffLogin({ ...user, password, branch, assignmentId: set.id });
  return people[key];
}

async function makeBranch(key, schoolKey, n, { checkOutEnabled = true, schedule = true } = {}) {
  const school = schools[schoolKey];
  const branch = await prisma.branch.create({
    data: { schoolId: school.id, number: n, code: `${school.code}-B00${n}`, name: `Notif ${key} ${tag}`, nameKey: `notif ${key.toLowerCase()} ${lower}`, address: 'Road', city: 'Mogadishu' },
  });
  const location = await prisma.branchLocation.create({ data: { branchId: branch.id, ...P, accuracyMeters: 8, effectiveFrom: new Date(Date.now() - 11 * DAY) } });
  branch.locationId = location.id;
  if (schedule) {
    // Two shifts covering the day, grace 0: a check-in after a shift's first minute is LATE.
    branch.schedule = await prisma.branchSchedule.create({
      data: {
        branchId: branch.id,
        effectiveFrom: new Date(`${addDays(today, -10)}T00:00:00Z`),
        timeZone: zone,
        checkOutEnabled,
        shifts: {
          create: [
            { shiftKey: randomUUID(), name: 'Early', days: ALL, startMinute: 0, endMinute: 600, graceMinutes: 0, absenceCutoffMinutes: 0 },
            { shiftKey: randomUUID(), name: 'Later', days: ALL, startMinute: 600, endMinute: 1439, graceMinutes: 0, absenceCutoffMinutes: 0 },
          ],
        },
      },
      include: { shifts: true },
    });
    branch.keys = Object.fromEntries(branch.schedule.shifts.map((s) => [s.name, s.shiftKey]));
  }
  branches[key] = branch;
  return branch;
}

/** A recorded event written directly (for past work dates the API's 24-hour rule would refuse). */
function insertEvent(person, { date, minute, status = 'PRESENT', type = 'CHECK_IN', checkIn = null, receivedAt }) {
  const occurredAt = zoned(date, minute);
  const branch = person.branch;
  return prisma.attendanceEvent.create({
    data: {
      staffUserId: person.id,
      branchId: branch.id,
      type,
      clientEventId: randomUUID(),
      occurredAt,
      sentAt: receivedAt ?? occurredAt,
      receivedAt: receivedAt ?? occurredAt,
      workDate: new Date(`${date}T00:00:00Z`),
      shiftKey: checkIn?.shiftKey ?? (minute < 600 ? branch.keys.Early : branch.keys.Later),
      scheduleId: branch.schedule.id,
      assignmentId: person.assignmentId,
      locationId: branch.locationId,
      ...P,
      accuracyMeters: 10,
      distanceMeters: 1,
      status: type === 'CHECK_IN' ? status : null,
      checkInEventId: checkIn?.id ?? null,
    },
  });
}

const feed = async (person, query = 'pageSize=50') => {
  const res = await as(person, `/api/notifications?${query}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
};
const itemsOf = async (person, type) => (await feed(person)).items.filter((i) => !type || i.type === type);
const rowsFor = (person, type) => prisma.notification.findMany({ where: { recipientId: person.id, ...(type && { type }) } });
const auditCount = (where) => prisma.auditEvent.count({ where: { occurredAt: { gte: startedAt }, ...where } });

before(async () => {
  stubServer = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const messages = JSON.parse(raw || '[]');
      stub.messages.push(...messages);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ data: messages.map(() => ({ status: 'ok', id: randomUUID() })) }));
    });
  });
  stubServer.listen(0);
  await new Promise((resolve) => stubServer.once('listening', resolve));
  // No real push service is called by these tests.
  env.expoPushUrl = `http://127.0.0.1:${stubServer.address().port}/push`;

  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  zone = await platformTimeZone();
  today = localMoment(new Date(), zone).date;
  savedPlatformSettings = await prisma.notificationSettings.findUnique({ where: { id: 'platform' } });

  await webUser('admin', 'SUPER_ADMIN');
  // Branches created through the API are numbered after the ones made directly here.
  schools.A = await prisma.school.create({ data: { code: `NA${tag}`, name: `Notif School A ${tag}`, location: 'Mogadishu', branchSequence: 10 } });
  schools.B = await prisma.school.create({ data: { code: `NB${tag}`, name: `Notif School B ${tag}`, location: 'Hargeisa' } });
  for (const k of ['A', 'B']) {
    const owner = await webUser(`O${k}`, 'OWNER');
    await prisma.school.update({ where: { id: schools[k].id }, data: { ownerId: owner.id } });
  }
  await makeBranch('A1', 'A', 1);
  await makeBranch('A2', 'A', 2, { checkOutEnabled: false });
  await makeBranch('B1', 'B', 1);
  await manager('MA1', 'A1');
  await manager('MA2', 'A2');
  await manager('MB1', 'B1');
  await staff('S1', 'A1', ['Early', 'Later']);
  await staff('S2', 'A1', ['Later']);
  await staff('S4', 'A1', ['Early']);
  await staff('S3', 'A2', ['Early', 'Later']);
  await staff('SB', 'B1', ['Early', 'Later']);
});

after(async () => {
  env.expoPushUrl = savedEnv.expoPushUrl;
  env.cronSecret = savedEnv.cronSecret;
  const schoolIds = Object.values(schools).map((s) => s.id);
  const branchIds = Object.values(branches).map((b) => b.id);
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  const related = await Promise.all([
    prisma.attendanceEvent.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } }),
    prisma.staffAssignment.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } }),
    prisma.branchSchedule.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } }),
    prisma.managerAssignment.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } }),
    prisma.suspensionPeriod.findMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { branchId: { in: branchIds } }] }, select: { id: true } }),
  ]);
  const ids = [...schoolIds, ...branchIds, ...userIds, ...related.flat().map((r) => r.id)];
  await prisma.announcement.deleteMany({ where: { createdById: { in: userIds } } });
  await prisma.$executeRaw`DELETE FROM "NotificationEvent" WHERE "createdAt" >= ${startedAt} AND ("dedupeKey" LIKE ${`%${tag}%`} OR "payload"::text ~ ${ids.join('|')})`;
  await prisma.attendanceEvent.deleteMany({ where: { branchId: { in: branchIds }, type: 'CHECK_OUT' } });
  await prisma.attendanceEvent.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.suspensionPeriod.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { branchId: { in: branchIds } }] } });
  await prisma.auditEvent.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { actorId: { in: userIds } }, { targetId: { in: ids } }] } });
  const sets = (await prisma.staffAssignment.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((s) => s.id);
  await prisma.staffAssignmentShift.deleteMany({ where: { assignmentId: { in: sets } } });
  await prisma.staffAssignment.deleteMany({ where: { id: { in: sets } } });
  const versions = (await prisma.branchSchedule.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((v) => v.id);
  await prisma.branchShift.deleteMany({ where: { scheduleId: { in: versions } } });
  await prisma.branchSchedule.deleteMany({ where: { id: { in: versions } } });
  await prisma.branchLocation.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.managerAssignment.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.pushMessage.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds }, role: { in: ['STAFF', 'MANAGER'] } } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
  await prisma.school.updateMany({ where: { id: { in: schoolIds } }, data: { ownerId: null } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  // Platform notification settings as they were before this file.
  if (savedPlatformSettings) {
    const { id, updatedAt, ...values } = savedPlatformSettings;
    await prisma.notificationSettings.update({ where: { id }, data: values });
  } else await prisma.notificationSettings.deleteMany({ where: { id: 'platform' } });
  server.close();
  stubServer.close();
  await prisma.$disconnect();
});

// ---- attendance -----------------------------------------------------------------------------

test('late check-in during the work day → the branch Managers only (N6, N7); a re-upload creates nothing new', async (t) => {
  const minute = localMoment(new Date(), zone).minutes;
  if (minute >= 1438) return t.skip('no check-in window in the last minutes of the day');
  const occurredAt = new Date(Date.now() - 1000);
  const body = { clientEventId: randomUUID(), type: 'CHECK_IN', occurredAt: occurredAt.toISOString(), sentAt: new Date().toISOString(), position: { ...P, accuracy: 10 } };
  const res = await as(people.S1, '/api/attendance/events', { method: 'POST', body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.event.status, 'LATE');
  const eventId = res.body.event.id;

  const [late] = (await itemsOf(people.MA1, 'LATE_CHECK_IN')).filter((i) => i.body.includes(people.S1.staffId));
  assert.ok(late, 'the Manager of the branch is notified');
  assert.equal(late.category, 'ATTENDANCE');
  assert.match(late.title, /Imaansho daahay/);
  const local = localMoment(occurredAt, zone);
  const hhmm = `${String(Math.floor(local.minutes / 60)).padStart(2, '0')}:${String(Math.floor(local.minutes % 60)).padStart(2, '0')}`;
  assert.ok(late.body.includes(`${local.date} ${hhmm}`), 'the event time, in the schedule time zone');
  for (const other of ['MA2', 'MB1', 'OA', 'OB', 'S1']) assert.equal((await rowsFor(people[other], 'LATE_CHECK_IN')).length, 0, other);

  const again = await as(people.S1, '/api/attendance/events', { method: 'POST', body });
  assert.equal(again.status, 200);
  assert.equal(await prisma.notification.count({ where: { subjectId: eventId } }), 1);
  assert.equal(await prisma.notificationEvent.count({ where: { dedupeKey: `late-check-in:${eventId}` } }), 1);
});

test('an offline late check-in uploaded after its work day gets no individual notification (N6)', async () => {
  const yesterday = addDays(today, -1);
  const occurredAt = zoned(yesterday, 300); // 05:00, Early shift, LATE
  const receivedAt = new Date(occurredAt.getTime() + 20 * HOUR); // the next local day, within 24 hours
  const { event } = await recordEvent(
    { id: people.S4.id, branchId: branches.A1.id },
    { clientEventId: randomUUID(), type: 'CHECK_IN', occurredAt, sentAt: receivedAt, position: { ...P, accuracy: 10 } },
    receivedAt,
  );
  assert.equal(event.status, 'LATE');
  assert.equal(event.workDate, yesterday);
  assert.equal(await prisma.notification.count({ where: { subjectId: event.id } }), 0);
  people.S4.offlineLate = event;
});

test('missing check-out → the staff member only; attendance unchanged; no duplicates (N8)', async () => {
  const twoDaysAgo = addDays(today, -2);
  const missing = await insertEvent(people.S1, { date: twoDaysAgo, minute: 120 });
  const closedIn = await insertEvent(people.S4, { date: twoDaysAgo, minute: 60 });
  await insertEvent(people.S4, { date: twoDaysAgo, minute: 500, type: 'CHECK_OUT', checkIn: closedIn });
  await insertEvent(people.S3, { date: twoDaysAgo, minute: 60 }); // A2: check-out not required
  await insertEvent(people.S2, { date: addDays(today, -1), minute: 700 }); // yesterday: not closed yet
  await insertEvent(people.S3, { date: addDays(today, -1), minute: 700 });

  const scope = { schoolIds: [schools.A.id, schools.B.id] };
  await notifyMissingCheckOuts(scope);
  await notifyMissingCheckOuts(scope);
  const rows = await prisma.notification.findMany({ where: { type: 'MISSING_CHECK_OUT', schoolId: schools.A.id } });
  assert.deepEqual(rows.map((r) => [r.recipientId, r.subjectId]), [[people.S1.id, missing.id]]);
  const [item] = await itemsOf(people.S1, 'MISSING_CHECK_OUT');
  assert.match(item.body, new RegExp(twoDaysAgo));
  assert.match(item.body, /Waqti dhammaad lama qiyaasin/);
  for (const other of ['MA1', 'OA', 'S2', 'S3', 'S4']) assert.equal((await rowsFor(people[other], 'MISSING_CHECK_OUT')).length, 0, other);
  const after = await prisma.attendanceEvent.findUnique({ where: { id: missing.id }, include: { checkOut: true } });
  assert.equal(after.checkOut, null);
  assert.equal(after.status, 'PRESENT');
});

test('daily digests: branch Managers and the Owner (all branches); offline late uploads and missing check-outs included; preferences respected (N6–N8)', async () => {
  const off = await as(people.MA2, '/api/notifications/preferences', { method: 'PUT', body: { disabledCategories: ['DIGEST'] } });
  assert.equal(off.status, 200, JSON.stringify(off.body));
  const { digestHour } = (await prisma.notificationSettings.findUnique({ where: { id: 'platform' } })) ?? { digestHour: 6 };
  const now = zoned(today, digestHour * 60 + 5);
  const scope = { now, schoolIds: [schools.A.id, schools.B.id] };
  await createDigests(scope);
  await createDigests(scope);
  const yesterday = addDays(today, -1);

  const branchDigests = (await rowsFor(people.MA1, 'BRANCH_DIGEST')).filter((n) => n.params.date === yesterday);
  assert.equal(branchDigests.length, 1);
  const { day, previous } = branchDigests[0].params;
  // Yesterday in A1: S2 (present, not checked out yet) and S4's offline late check-in.
  assert.deepEqual([day.checkIns, day.present, day.late, day.staff, day.open], [2, 1, 1, 2, 2]);
  // The day before, now final: S1's missing check-out and S4's recorded one.
  assert.deepEqual([previous.checkIns, previous.missing], [2, 1]);

  assert.equal((await rowsFor(people.MA2, 'BRANCH_DIGEST')).length, 0, 'the Manager turned digests off');
  const [school] = (await rowsFor(people.OA, 'SCHOOL_DIGEST')).filter((n) => n.params.date === yesterday);
  assert.ok(school, 'the Owner gets the school-wide digest');
  assert.equal(school.params.day.checkIns, 3);
  assert.deepEqual(school.params.branches.map((b) => b.code).sort(), [branches.A1.code, branches.A2.code].sort());
  assert.equal(school.branchId, null);
  assert.equal((await rowsFor(people.OB, 'SCHOOL_DIGEST')).length, 0, 'no activity in school B');
  assert.equal((await rowsFor(people.OA, 'LATE_CHECK_IN')).length, 0);
  const [view] = (await itemsOf(people.OA, 'SCHOOL_DIGEST')).filter((i) => i.data.date === yesterday);
  assert.equal(view.link.kind, 'digest');
  assert.match(view.body, /Maqnaanshaha lama xisaabin/);
});

// ---- staff and schedules ----------------------------------------------------------------------

test('assignment changed and cancelled → the staff member only (N3)', async () => {
  const tomorrow = addDays(today, 1);
  const save = await as(people.MA1, `/api/manager/staff/${people.S4.id}/assignments`, {
    method: 'POST',
    body: { effectiveFrom: tomorrow, shifts: [{ shiftKey: branches.A1.keys.Early, days: ALL }, { shiftKey: branches.A1.keys.Later, days: ['MON'] }] },
  });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  const [changed] = await itemsOf(people.S4, 'ASSIGNMENT_CHANGED');
  assert.match(changed.body, new RegExp(`Laga bilaabo ${tomorrow}`));
  assert.match(changed.body, /Later \(Isniin\)/);
  const cancel = await as(people.MA1, `/api/manager/staff/${people.S4.id}/assignments/scheduled`, { method: 'DELETE' });
  assert.equal(cancel.status, 200);
  assert.equal((await itemsOf(people.S4, 'ASSIGNMENT_CANCELLED')).length, 1);
  for (const other of ['S1', 'S2', 'MA1']) assert.equal((await rowsFor(people[other])).filter((n) => n.type.startsWith('ASSIGNMENT')).length, 0, other);
});

test('schedule change → only staff whose assigned shifts change; a cancelled change → the same staff (N9)', async () => {
  const tomorrow = addDays(today, 1);
  const shiftBody = (name, start, end) => ({ key: branches.A1.keys[name], name, days: ALL, start, end, graceMinutes: 0, absenceCutoffMinutes: 0 });
  const save = await as(people.MA1, '/api/manager/schedule', {
    method: 'POST',
    body: { effectiveFrom: tomorrow, checkOutEnabled: true, shifts: [shiftBody('Early', '00:00', '10:00'), shiftBody('Later', '10:00', '23:00')] },
  });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  const changed = await prisma.notification.findMany({ where: { type: 'SCHEDULE_CHANGED', branchId: branches.A1.id } });
  assert.deepEqual(changed.map((n) => n.recipientId).sort(), [people.S1.id, people.S2.id].sort(), 'S4 works only the unchanged Early shift');
  const [item] = await itemsOf(people.S2, 'SCHEDULE_CHANGED');
  assert.match(item.body, /Later \(.*\) 10:00–23:00/);

  const cancel = await as(people.MA1, '/api/manager/schedule/scheduled', { method: 'DELETE' });
  assert.equal(cancel.status, 200);
  const cancelled = await prisma.notification.findMany({ where: { type: 'SCHEDULE_CHANGE_CANCELLED', branchId: branches.A1.id } });
  assert.deepEqual(cancelled.map((n) => n.recipientId).sort(), [people.S1.id, people.S2.id].sort());
  for (const other of ['S3', 'S4', 'SB', 'MA1']) assert.equal((await rowsFor(people[other])).filter((n) => n.category === 'SCHEDULE').length, 0, other);
});

test('a branch with no schedule in effect → its Managers, once (N3-6)', async () => {
  await makeBranch('A3', 'A', 3, { schedule: false });
  await manager('MA3', 'A3');
  await notifyBranchesWithoutSchedule({ schoolIds: [schools.A.id] });
  await notifyBranchesWithoutSchedule({ schoolIds: [schools.A.id] });
  assert.equal((await rowsFor(people.MA3, 'BRANCH_NO_SCHEDULE')).length, 1);
  assert.equal((await rowsFor(people.MA1, 'BRANCH_NO_SCHEDULE')).length, 0);
  assert.equal((await itemsOf(people.MA3, 'BRANCH_NO_SCHEDULE'))[0].link.kind, 'schedule');
});

// ---- suspensions ----------------------------------------------------------------------------

test('branch suspension and reactivation → its Managers and staff, without the reason; nobody else (N11)', async () => {
  const res = await as(people.OA, `/api/owner/branches/${branches.A1.id}/suspend`, { method: 'POST', body: { reason: `Hidden reason ${tag}` } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const recipients = async (type) => (await prisma.notification.findMany({ where: { type, branchId: branches.A1.id } })).map((n) => n.recipientId).sort();
  const expected = [people.MA1.id, people.S1.id, people.S2.id, people.S4.id].sort();
  assert.deepEqual(await recipients('BRANCH_SUSPENDED'), expected);
  const [notice] = await itemsOf(people.S1, 'BRANCH_SUSPENDED');
  assert.ok(!JSON.stringify(notice).includes('Hidden reason'), 'no reason for Managers and staff');
  // While suspended, the staff app gets no geofence reminders (N1).
  assert.equal((await as(people.S1, '/api/notifications/preferences')).body.branchOperating, false);

  assert.equal((await as(people.OA, `/api/owner/branches/${branches.A1.id}/reactivate`, { method: 'POST', body: {} })).status, 200);
  assert.deepEqual(await recipients('BRANCH_REACTIVATED'), expected);
  for (const other of ['OA', 'MA2', 'S3', 'SB']) assert.equal((await rowsFor(people[other])).filter((n) => n.category === 'STATUS').length, 0, other);
  assert.equal((await as(people.S1, '/api/notifications/preferences')).body.branchOperating, true);
});

test('school suspension → the Owner with the reason; every Manager and staff member without it; other schools nothing (N11)', async () => {
  const res = await as(people.admin, `/api/platform/schools/${schools.B.id}/suspend`, { method: 'POST', body: { reason: `Contract review ${tag}` } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const [ownerNotice] = await itemsOf(people.OB, 'SCHOOL_SUSPENDED');
  assert.match(ownerNotice.body, new RegExp(`Sababta: Contract review ${tag}`));
  for (const key of ['MB1', 'SB']) {
    const [n] = await itemsOf(people[key], 'SCHOOL_SUSPENDED');
    assert.ok(n, key);
    assert.ok(!JSON.stringify(n).includes('Contract review'), key);
  }
  assert.equal((await as(people.admin, `/api/platform/schools/${schools.B.id}/reactivate`, { method: 'POST', body: {} })).status, 200);
  for (const key of ['OB', 'MB1', 'SB']) assert.equal((await rowsFor(people[key], 'SCHOOL_REACTIVATED')).length, 1, key);
  for (const key of ['OA', 'MA1', 'S1']) assert.equal((await rowsFor(people[key])).filter((n) => ['SCHOOL_SUSPENDED', 'SCHOOL_REACTIVATED'].includes(n.type)).length, 0, key);
});

// ---- Manager transfer (N10) -------------------------------------------------------------------

test('after a transfer the previous branch’s notifications disappear at once (kept in the database); the Owner learns the branch has no active Manager', async (t) => {
  const minute = localMoment(new Date(), zone).minutes;
  if (minute >= 1438) return t.skip('no check-in window in the last minutes of the day');
  const late = await as(people.S3, '/api/attendance/events', {
    method: 'POST',
    body: { clientEventId: randomUUID(), type: 'CHECK_IN', occurredAt: new Date(Date.now() - 1000).toISOString(), sentAt: new Date().toISOString(), position: { ...P, accuracy: 10 } },
  });
  assert.equal(late.status, 201, JSON.stringify(late.body));
  const [before] = await itemsOf(people.MA2, 'LATE_CHECK_IN');
  assert.ok(before, 'visible while the Manager works in the branch');
  const unreadBefore = (await feed(people.MA2)).unreadCount;

  const move = await as(people.OA, `/api/owner/managers/${people.MA2.id}/transfer`, { method: 'POST', body: { branchId: branches.A3.id } });
  assert.equal(move.status, 200, JSON.stringify(move.body));
  const list = await feed(people.MA2);
  assert.equal(list.items.filter((i) => i.type === 'LATE_CHECK_IN').length, 0);
  assert.equal((await as(people.MA2, `/api/notifications/notification/${before.id}`)).status, 404);
  assert.equal((await as(people.MA2, `/api/notifications/notification/${before.id}/read`, { method: 'POST' })).status, 404);
  assert.ok(list.unreadCount < unreadBefore + 2, 'the hidden notice is not counted');
  assert.ok(await prisma.notification.findUnique({ where: { id: before.id } }), 'not deleted');
  const [moved] = list.items.filter((i) => i.type === 'MANAGER_TRANSFERRED');
  assert.ok(moved.body.includes(branches.A3.code) && moved.body.includes(branches.A2.code));
  assert.equal(list.items.filter((i) => i.type === 'BRANCH_NO_SCHEDULE').length, 1, 'the new branch has no schedule');
  const [noManager] = await itemsOf(people.OA, 'BRANCH_NO_MANAGER');
  assert.ok(noManager.body.includes(branches.A2.code));
  assert.equal(noManager.link.kind, 'managers');
});

test('the Owner is told when a branch is created (no Manager yet) and when suspending its last active Manager (N7)', async () => {
  const created = await as(people.OA, '/api/owner/branches', {
    method: 'POST',
    body: { name: `Notif Created ${tag}`, address: 'Road 1', city: 'Mogadishu', location: { latitude: 2.05, longitude: 45.32, accuracy: 10, confirmed: true } },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  branches.CREATED = { id: created.body.branch.id };
  const notices = await prisma.notification.findMany({ where: { recipientId: people.OA.id, type: 'BRANCH_NO_MANAGER', branchId: created.body.branch.id } });
  assert.equal(notices.length, 1);
  const suspend = await as(people.OA, `/api/owner/managers/${people.MB1.id}/suspend`, { method: 'POST', body: { reason: 'Not in school A' } });
  assert.equal(suspend.status, 404, 'another school’s Manager is not found');
  const own = await as(people.OA, `/api/owner/managers/${people.MA3.id}/suspend`, { method: 'POST', body: { reason: 'Leave of absence' } });
  assert.equal(own.status, 200, JSON.stringify(own.body));
  // A3 still has MA2 (transferred there), so no notice for A3.
  assert.equal(await prisma.notification.count({ where: { recipientId: people.OA.id, type: 'BRANCH_NO_MANAGER', branchId: branches.A3.id } }), 0);
  assert.equal((await as(people.OA, `/api/owner/managers/${people.MA3.id}/reactivate`, { method: 'POST', body: {} })).status, 200);
  people.MA3.cookie = (await call('/api/auth/login', { method: 'POST', body: { email: people.MA3.email, password: people.MA3.password } })).setCookie.split(';')[0];
});

// ---- isolation ------------------------------------------------------------------------------

test('isolation: nobody reads another user’s, branch’s or school’s notifications; Super Admins have no notification centre', async () => {
  const [ob] = await rowsFor(people.OB, 'SCHOOL_SUSPENDED');
  const [ma1] = await rowsFor(people.MA1, 'BRANCH_SUSPENDED');
  assert.equal((await as(people.OA, `/api/notifications/notification/${ob.id}`)).status, 404);
  assert.equal((await as(people.S1, `/api/notifications/notification/${ma1.id}`)).status, 404);
  assert.equal((await as(people.S1, `/api/notifications/notification/${ma1.id}/read`, { method: 'POST' })).status, 404);
  assert.equal((await as(people.MB1, `/api/notifications/notification/${ma1.id}`)).status, 404);
  assert.equal((await as(people.OA, '/api/notifications/notification/not-an-id')).status, 404);
  assert.equal((await as(people.admin, '/api/notifications')).status, 403);
  assert.equal((await call('/api/notifications')).status, 401);
  assert.equal((await as(people.S1, '/api/platform/announcements')).status, 403);
  // A query cannot widen the scope.
  const own = await feed(people.S1, `pageSize=50&recipientId=${people.MA1.id}&branch=${branches.B1.id}`);
  assert.ok(own.items.every((i) => i.source === 'announcement' || i.type !== 'LATE_CHECK_IN'));
  assert.equal(await prisma.notification.count({ where: { id: { in: own.items.filter((i) => i.source === 'notification').map((i) => i.id) }, recipientId: { not: people.S1.id } } }), 0);
});

// ---- preferences and settings ---------------------------------------------------------------

test('preferences: mandatory notices cannot be turned off; an optional one turned off is not created; changes are audited once (N12, N22)', async () => {
  const mandatory = await as(people.S1, '/api/notifications/preferences', { method: 'PUT', body: { disabledCategories: ['STATUS'] } });
  assert.equal(mandatory.status, 400);
  assert.equal((await as(people.MA1, '/api/notifications/preferences', { method: 'PUT', body: { disabledCategories: ['MISSING_CHECK_OUT'] } })).status, 400);
  assert.equal((await as(people.OA, '/api/notifications/preferences', { method: 'PUT', body: { pushEnabled: false } })).status, 400, 'push is a Staff app setting');
  const before = await auditCount({ action: 'NOTIFICATION_PREFERENCES_UPDATED', actorId: people.S1.id });
  const ok = await as(people.S1, '/api/notifications/preferences', { method: 'PUT', body: { disabledCategories: ['SCHEDULE'] } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.categories.find((c) => c.key === 'SCHEDULE'), { key: 'SCHEDULE', mandatory: false, enabled: false });
  assert.deepEqual(ok.body.categories.find((c) => c.key === 'STATUS'), { key: 'STATUS', mandatory: true, enabled: true });
  await as(people.S1, '/api/notifications/preferences', { method: 'PUT', body: { disabledCategories: ['SCHEDULE'] } });
  assert.equal(await auditCount({ action: 'NOTIFICATION_PREFERENCES_UPDATED', actorId: people.S1.id }), before + 1);
  const event = await prisma.auditEvent.findFirst({ where: { action: 'NOTIFICATION_PREFERENCES_UPDATED', actorId: people.S1.id }, orderBy: { occurredAt: 'desc' } });
  assert.deepEqual(event.change.fields, [{ field: 'Turned-off categories', from: 'None', to: 'SCHEDULE' }]);
  assert.equal(event.schoolId, schools.A.id);

  const made = await createNotifications([
    { type: 'SCHEDULE_CHANGE_CANCELLED', recipientId: people.S1.id, params: { branchName: 'x', effectiveFrom: today }, dedupeKey: `t-pref-1-${tag}` },
    { type: 'BRANCH_SUSPENDED', recipientId: people.S1.id, params: { branch: { name: 'x', code: 'y' } }, dedupeKey: `t-pref-2-${tag}` },
  ]);
  assert.deepEqual(made.map((n) => n.category), ['STATUS']);
  await as(people.S1, '/api/notifications/preferences', { method: 'PUT', body: { disabledCategories: [] } });
});

test('platform and branch reminder settings: limits enforced, audited with old and new values; Owners configure nothing (N5, N13, N22)', async () => {
  const get = await as(people.admin, '/api/platform/settings/notifications');
  assert.equal(get.status, 200);
  assert.equal(get.body.limits.checkInLead.max, 30);
  assert.equal((await as(people.admin, '/api/platform/settings/notifications', { method: 'PUT', body: { checkInLeadMax: 40 } })).status, 400);
  assert.equal((await as(people.admin, '/api/platform/settings/notifications', { method: 'PUT', body: { checkInLeadMin: 25, checkInLeadMax: 20 } })).status, 400);
  assert.equal((await as(people.admin, '/api/platform/settings/notifications', { method: 'PUT', body: { unknown: 1 } })).status, 400);
  assert.equal((await as(people.OA, '/api/platform/settings/notifications', { method: 'PUT', body: { checkInLeadMax: 20 } })).status, 403);
  const base = { checkInLeadMin: 0, checkInLeadMax: 20, checkInLeadDefault: 15, checkOutReminderEnabled: true, staffCanAdjustTiming: true, pushEnabled: true };
  await as(people.admin, '/api/platform/settings/notifications', { method: 'PUT', body: { ...base, checkInLeadMax: 30 } });
  const before = await auditCount({ action: 'NOTIFICATION_SETTINGS_UPDATED', actorId: people.admin.id });
  const put = await as(people.admin, '/api/platform/settings/notifications', { method: 'PUT', body: base });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  await as(people.admin, '/api/platform/settings/notifications', { method: 'PUT', body: base });
  assert.equal(await auditCount({ action: 'NOTIFICATION_SETTINGS_UPDATED', actorId: people.admin.id }), before + 1);
  const audit = await prisma.auditEvent.findFirst({ where: { action: 'NOTIFICATION_SETTINGS_UPDATED', actorId: people.admin.id }, orderBy: { occurredAt: 'desc' } });
  assert.deepEqual(audit.change.fields, [{ field: 'Check-in reminder maximum (minutes)', from: '30', to: '20' }]);

  assert.equal((await as(people.MA1, '/api/manager/notification-settings', { method: 'PUT', body: { checkInLeadMinutes: 25 } })).status, 400, 'above the platform maximum');
  const branch = await as(people.MA1, '/api/manager/notification-settings', { method: 'PUT', body: { checkInLeadMinutes: 10, checkOutReminderEnabled: false } });
  assert.equal(branch.status, 200, JSON.stringify(branch.body));
  assert.equal(branch.body.effective.checkIn.leadMinutes, 10);
  const branchAudit = await prisma.auditEvent.findFirst({ where: { action: 'BRANCH_REMINDER_SETTINGS_UPDATED', actorId: people.MA1.id } });
  assert.equal(branchAudit.schoolId, schools.A.id);
  assert.equal(branchAudit.targetId, branches.A1.id);
  const prefs = (await as(people.S1, '/api/notifications/preferences')).body;
  assert.equal(prefs.reminders.checkIn.leadMinutes, 10);
  assert.deepEqual([prefs.reminders.checkOut.available, prefs.reminders.checkOut.enabled], [false, false]);
  assert.equal((await as(people.S3, '/api/notifications/preferences')).body.reminders.checkIn.leadMinutes, 15, 'another branch keeps the platform default');
  assert.equal((await as(people.OA, '/api/owner/notification-settings')).status, 404, 'no Owner defaults (N13)');
  assert.equal((await as(people.S1, '/api/manager/notification-settings')).status, 403);
});

test('staff reminders: consent to background location is recorded and audited; timing within the limits (N1, N5)', async () => {
  const agreed = await as(people.S1, '/api/notifications/preferences', { method: 'PUT', body: { locationConsent: true, checkInLeadMinutes: 12 } });
  assert.equal(agreed.status, 200, JSON.stringify(agreed.body));
  assert.ok(agreed.body.locationConsentAt);
  assert.deepEqual([agreed.body.reminders.checkIn.consented, agreed.body.reminders.checkIn.leadMinutes], [true, 12]);
  const audit = await prisma.auditEvent.findFirst({ where: { action: 'NOTIFICATION_PREFERENCES_UPDATED', actorId: people.S1.id }, orderBy: { occurredAt: 'desc' } });
  assert.ok(audit.change.fields.some((f) => f.field === 'Background location for reminders' && f.to === 'Agreed'));
  assert.ok(!JSON.stringify(audit).match(/latitude|longitude/), 'no location in the audit log');
  assert.equal((await as(people.S1, '/api/notifications/preferences', { method: 'PUT', body: { checkInLeadMinutes: 25 } })).status, 400);
  const withdrawn = await as(people.S1, '/api/notifications/preferences', { method: 'PUT', body: { locationConsent: false } });
  assert.deepEqual([withdrawn.body.locationConsentAt, withdrawn.body.reminders.checkIn.consented], [null, false]);
  assert.equal((await as(people.MA1, '/api/notifications/preferences', { method: 'PUT', body: { locationConsent: true } })).status, 400, 'staff only');
});

// ---- announcements --------------------------------------------------------------------------

test('announcements: audience by role and school, scheduling, expiry, drafts, edits, withdrawal, validation and audit (N17, N19, N22)', async () => {
  const create = (body) => as(people.admin, '/api/platform/announcements', { method: 'POST', body });
  const week = new Date(Date.now() + 7 * DAY).toISOString();
  const managers = await create({ kind: 'FEATURE', title: `Astaan cusub ${tag}`, body: 'Warbixinno maalinle ah ayaa la heli karaa.', roles: ['MANAGER'], allSchools: true, expiresAt: week, action: 'publish' });
  assert.equal(managers.status, 201, JSON.stringify(managers.body));
  assert.equal(managers.body.announcement.status, 'published');
  const schoolB = await create({ kind: 'SEASONAL', title: `Ramadan Kariim ${tag}`, body: 'Bil wanaagsan.', roles: ['STAFF', 'OWNER'], allSchools: false, schoolIds: [schools.B.id], linkUrl: 'https://example.com/guide', expiresAt: week, action: 'publish' });
  assert.equal(schoolB.status, 201, JSON.stringify(schoolB.body));
  const has = async (person, id) => (await feed(person, 'pageSize=50&category=ANNOUNCEMENT')).items.some((i) => i.id === id);
  const m = managers.body.announcement.id;
  const b = schoolB.body.announcement.id;
  assert.deepEqual(await Promise.all(['MA1', 'MB1', 'S1', 'OA'].map((k) => has(people[k], m))), [true, true, false, false]);
  assert.deepEqual(await Promise.all(['SB', 'OB', 'S1', 'OA', 'MB1'].map((k) => has(people[k], b))), [true, true, false, false, false]);
  assert.equal((await as(people.S1, `/api/notifications/announcement/${b}`)).status, 404);
  const detail = await as(people.SB, `/api/notifications/announcement/${b}`);
  assert.equal(detail.body.item.linkUrl, 'https://example.com/guide');

  const scheduled = await create({ kind: 'MAINTENANCE', title: `Dayactir ${tag}`, body: 'Nidaamku wuu xirnaan doonaa.', roles: ['MANAGER'], allSchools: true, publishAt: new Date(Date.now() + HOUR).toISOString(), expiresAt: week, action: 'schedule' });
  assert.equal(scheduled.body.announcement.status, 'scheduled');
  const s = scheduled.body.announcement.id;
  assert.equal(await has(people.MA1, s), false, 'not before its publish time');
  const viewer = await notificationViewer(people.MA1);
  const at = async (ms) => (await listNotifications(viewer, { category: 'ANNOUNCEMENT', pageSize: 50 }, new Date(Date.now() + ms))).items.map((i) => i.id);
  assert.ok((await at(2 * HOUR)).includes(s), 'visible once published');
  assert.ok(!(await at(8 * DAY)).includes(m), 'not after it expires');

  const draft = await create({ kind: 'GUIDE', title: `Hagaha ${tag}`, body: 'Sida loo isticmaalo.', roles: ['MANAGER'], allSchools: true, expiresAt: week, action: 'draft' });
  const d = draft.body.announcement.id;
  assert.equal(await has(people.MA1, d), false);
  const edit = await as(people.admin, `/api/platform/announcements/${d}`, { method: 'PATCH', body: { title: `Hagaha cusub ${tag}` } });
  assert.equal(edit.status, 200);
  assert.equal((await as(people.admin, `/api/platform/announcements/${d}/publish`, { method: 'POST', body: {} })).status, 200);
  assert.equal(await has(people.MA1, d), true);
  assert.equal((await as(people.admin, `/api/platform/announcements/${d}/publish`, { method: 'POST', body: {} })).status, 409);
  assert.equal((await as(people.admin, `/api/platform/announcements/${d}/withdraw`, { method: 'POST', body: {} })).status, 200);
  assert.equal(await has(people.MA1, d), false);
  assert.equal((await as(people.admin, `/api/platform/announcements/${d}`, { method: 'PATCH', body: { title: 'x y z' } })).status, 409);

  for (const bad of [
    { expiresAt: new Date(Date.now() + 100 * DAY).toISOString() },
    { linkUrl: 'http://example.com' },
    { imageUrl: 'javascript:alert(1)' },
    { roles: ['SUPER_ADMIN'] },
    { roles: [] },
    { allSchools: false, schoolIds: [randomUUID()] },
    { allSchools: false, schoolIds: [] },
    { action: 'schedule' },
    { publishAt: new Date(Date.now() - DAY).toISOString(), action: 'schedule' },
    { title: '' },
    { unknown: true },
  ]) {
    const res = await create({ kind: 'UPDATE', title: 'Cusboonaysiin', body: 'Qoraal', roles: ['OWNER'], allSchools: true, expiresAt: week, action: 'publish', ...bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
  assert.equal((await as(people.OA, '/api/platform/announcements', { method: 'POST', body: {} })).status, 403);
  const list = await as(people.admin, `/api/platform/announcements?status=scheduled&q=${tag}`);
  assert.deepEqual(list.body.items.map((a) => a.id), [s]);

  const actions = (id) => prisma.auditEvent.findMany({ where: { targetId: id }, orderBy: { occurredAt: 'asc' }, select: { action: true, change: true } });
  assert.deepEqual((await actions(m)).map((a) => a.action), ['ANNOUNCEMENT_CREATED', 'ANNOUNCEMENT_PUBLISHED']);
  assert.deepEqual((await actions(s)).map((a) => a.action), ['ANNOUNCEMENT_CREATED', 'ANNOUNCEMENT_SCHEDULED']);
  const draftAudit = await actions(d);
  assert.deepEqual(draftAudit.map((a) => a.action), ['ANNOUNCEMENT_CREATED', 'ANNOUNCEMENT_UPDATED', 'ANNOUNCEMENT_PUBLISHED', 'ANNOUNCEMENT_WITHDRAWN']);
  assert.deepEqual(draftAudit[1].change.fields, [{ field: 'Title', from: `Hagaha ${tag}`, to: `Hagaha cusub ${tag}` }]);
  people.MA1.announcement = m;
});

test('read state: mark one read, read all, unread counts; reading is never audited (N4, N22)', async () => {
  const audits = await auditCount({ actorId: people.MA1.id });
  const start = await feed(people.MA1);
  assert.ok(start.unreadCount >= 2);
  const read = await as(people.MA1, `/api/notifications/announcement/${people.MA1.announcement}/read`, { method: 'POST' });
  assert.equal(read.status, 200);
  assert.ok(read.body.item.readAt);
  await as(people.MA1, `/api/notifications/announcement/${people.MA1.announcement}/read`, { method: 'POST' });
  assert.equal((await as(people.MA1, '/api/notifications/unread-count')).body.unreadCount, start.unreadCount - 1);
  const unreadOnly = await feed(people.MA1, 'pageSize=50&unread=true');
  assert.ok(unreadOnly.items.every((i) => i.readAt === null));
  const all = await as(people.MA1, '/api/notifications/read-all', { method: 'POST' });
  assert.deepEqual(all.body, { unreadCount: 0 });
  assert.equal((await feed(people.MA1, 'pageSize=50&unread=true')).total, 0);
  assert.equal((await feed(people.MB1)).items.find((i) => i.id === people.MA1.announcement).readAt, null, 'read state is per user');
  assert.equal(await auditCount({ actorId: people.MA1.id }), audits);
});

// ---- retention, suspended accounts, push --------------------------------------------------

test('retention: notifications expire after 90 days, are hidden at once and purged; users cannot delete history (N18)', async () => {
  const [fresh] = await rowsFor(people.S1, 'MISSING_CHECK_OUT');
  assert.equal(fresh.expiresAt.getTime() - fresh.createdAt.getTime(), RETENTION_MS);
  const old = await prisma.notification.create({
    data: { type: 'BRANCH_REACTIVATED', category: 'STATUS', recipientId: people.S1.id, params: { branch: { name: 'Old', code: 'OLD' } }, dedupeKey: `t-old-${tag}`, createdAt: new Date(Date.now() - 91 * DAY), expiresAt: new Date(Date.now() - DAY) },
  });
  assert.ok(!(await feed(people.S1)).items.some((i) => i.id === old.id));
  assert.equal((await as(people.S1, `/api/notifications/notification/${old.id}`)).status, 404);
  assert.equal((await as(people.S1, `/api/notifications/notification/${fresh.id}`, { method: 'DELETE' })).status, 404, 'no delete route');
  const purged = await purgeExpired();
  assert.ok(purged.notifications >= 1);
  assert.equal(await prisma.notification.count({ where: { id: old.id } }), 0);
  assert.equal(await prisma.notification.count({ where: { id: fresh.id } }), 1);
});

test('suspended accounts keep in-app notifications without push, and see them after reactivation (N15)', async () => {
  await as(people.S2, '/api/notifications/devices', { method: 'POST', body: { token: `ExponentPushToken[s2-${lower}-device]`, platform: 'android' } });
  assert.equal((await as(people.MA1, `/api/manager/staff/${people.S2.id}/suspend`, { method: 'POST', body: { reason: 'Temporary leave' } })).status, 200);
  assert.equal(await prisma.pushDevice.count({ where: { userId: people.S2.id } }), 0, 'the sessions and their device end');
  const [made] = await createNotifications([{ type: 'BRANCH_SUSPENDED', recipientId: people.S2.id, params: { branch: { name: 'x', code: 'y' } }, dedupeKey: `t-susp-${tag}` }]);
  assert.ok(made, 'kept in-app');
  assert.equal(await prisma.pushMessage.count({ where: { sourceKey: `notification:${made.id}` } }), 0, 'no push for a suspended account');
  assert.equal((await as(people.S2, '/api/notifications')).status, 401);
  assert.equal((await as(people.MA1, `/api/manager/staff/${people.S2.id}/reactivate`, { method: 'POST', body: {} })).status, 200);
  await staffLogin(people.S2);
  assert.ok((await feed(people.S2)).items.some((i) => i.id === made.id));
});

test('push: one token per session, generic payloads, retries, dead tokens removed, nothing after sign-out (N2, N21)', async () => {
  const token = `ExponentPushToken[s1-${lower}-device]`;
  assert.equal((await as(people.S1, '/api/notifications/devices', { method: 'POST', body: { token: 'not-a-token', platform: 'android' } })).status, 400);
  assert.equal((await as(people.MA1, '/api/notifications/devices', { method: 'POST', body: { token, platform: 'android' } })).status, 403);
  assert.equal((await as(people.S1, '/api/notifications/devices', { method: 'POST', body: { token, platform: 'android' } })).status, 201);
  assert.equal((await as(people.S1, '/api/notifications/devices', { method: 'POST', body: { token, platform: 'android' } })).status, 201, 'registering again replaces');
  assert.equal(await prisma.pushDevice.count({ where: { token } }), 1);

  const [n] = await createNotifications([{ type: 'ASSIGNMENT_CANCELLED', recipientId: people.S1.id, params: { effectiveFrom: today }, dedupeKey: `t-push-${tag}` }]);
  const message = await prisma.pushMessage.findUnique({ where: { userId_sourceKey: { userId: people.S1.id, sourceKey: `notification:${n.id}` } } });
  assert.equal(message.status, 'PENDING');

  const failing = async () => {
    throw Object.assign(new Error('Push service answered 503.'), { retryable: true });
  };
  const now = new Date();
  await sendPendingPush({ now, send: failing });
  const retried = await prisma.pushMessage.findUnique({ where: { id: message.id } });
  assert.deepEqual([retried.status, retried.attempts], ['PENDING', 1]);
  assert.ok(retried.nextAttemptAt > now && retried.lastError.includes('503'));

  const sent = [];
  await sendPendingPush({ now: new Date(Date.now() + HOUR), send: async (batch) => (sent.push(...batch), batch.map(() => ({ status: 'ok' }))) });
  assert.equal((await prisma.pushMessage.findUnique({ where: { id: message.id } })).status, 'SUBMITTED');
  // Every waiting push of S1 (also from earlier tests) goes to the device, each one generic.
  const mine = sent.filter((m) => m.to === token);
  assert.ok(mine.length >= 1);
  for (const m of mine) {
    const { data, ...shown } = m;
    assert.deepEqual(shown, { to: token, title: 'EduTrack', body: 'Waxaad leedahay ogeysiis cusub oo imaanshaha ah.', sound: 'default', priority: 'high', channelId: 'default' });
    assert.deepEqual(Object.keys(data).sort(), ['id', 'kind', 'source'], 'only an opaque reference for the tap');
  }
  assert.ok(!JSON.stringify(mine).includes(people.S1.name) && !JSON.stringify(mine).includes(today), 'nothing personal on the lock screen');

  // An announcement for staff of school B: queued for SB's device only.
  await as(people.SB, '/api/notifications/devices', { method: 'POST', body: { token: `ExponentPushToken[sb-${lower}-device]`, platform: 'ios' } });
  const ann = await as(people.admin, '/api/platform/announcements', {
    method: 'POST',
    body: { kind: 'UPDATE', title: `Cusboonaysiin ${tag}`, body: 'Nooc cusub.', roles: ['STAFF'], allSchools: false, schoolIds: [schools.B.id], expiresAt: new Date(Date.now() + DAY).toISOString(), action: 'publish' },
  });
  const queued = await prisma.pushMessage.findMany({ where: { sourceKey: `announcement:${ann.body.announcement.id}` } });
  assert.deepEqual(queued.map((q) => q.userId), [people.SB.id]);

  // A token the push service no longer knows is removed.
  const [n2] = await createNotifications([{ type: 'ASSIGNMENT_CANCELLED', recipientId: people.S1.id, params: { effectiveFrom: today }, dedupeKey: `t-push-2-${tag}` }]);
  await sendPendingPush({ now: new Date(Date.now() + HOUR), send: async (batch) => batch.map((m) => (m.to === token ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' })) });
  assert.equal(await prisma.pushDevice.count({ where: { token } }), 0);
  assert.equal((await prisma.pushMessage.findFirst({ where: { sourceKey: `notification:${n2.id}` } })).status, 'FAILED');

  // Signing out removes the session's token.
  await as(people.S1, '/api/notifications/devices', { method: 'POST', body: { token, platform: 'android' } });
  assert.equal((await as(people.S1, '/api/auth/logout', { method: 'POST' })).status, 204);
  assert.equal(await prisma.pushDevice.count({ where: { token } }), 0);
  await staffLogin(people.S1);
});

// ---- outbox and the job ---------------------------------------------------------------------

test('outbox: the same business event is queued once; a failing event is retried with backoff, then marked failed', async () => {
  const key = `t-outbox-${tag}`;
  const sink = [];
  await prisma.$transaction(async (tx) => {
    await enqueue(tx, 'NO_SUCH_TYPE', { tag }, key, sink);
    await enqueue(tx, 'NO_SUCH_TYPE', { tag }, key, sink);
  });
  assert.equal(sink.length, 1);
  assert.equal(await prisma.notificationEvent.count({ where: { dedupeKey: key } }), 1);
  const now = new Date();
  assert.equal(await processEvent(sink[0], { now }), 'retry');
  let row = await prisma.notificationEvent.findUnique({ where: { id: sink[0] } });
  assert.deepEqual([row.status, row.attempts], ['PENDING', 1]);
  assert.match(row.lastError, /Unknown notification event type/);
  assert.equal(row.nextAttemptAt.getTime(), now.getTime() + 60_000);
  assert.equal(await processEvent(sink[0], { now }), 'skipped', 'not due yet');
  await prisma.notificationEvent.update({ where: { id: sink[0] }, data: { attempts: MAX_ATTEMPTS - 1, nextAttemptAt: now } });
  assert.equal(await processEvent(sink[0], { now }), 'failed');
  row = await prisma.notificationEvent.findUnique({ where: { id: sink[0] } });
  assert.equal(row.status, 'FAILED');
});

test('the job endpoint runs only with the cron secret', async () => {
  env.cronSecret = undefined;
  assert.equal((await call('/api/internal/jobs/notifications')).status, 503);
  env.cronSecret = randomBytes(24).toString('hex');
  assert.equal((await call('/api/internal/jobs/notifications')).status, 401);
  assert.equal((await call('/api/internal/jobs/notifications', { headers: { authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await call('/api/internal/jobs/notifications', { method: 'POST', headers: { authorization: `Bearer ${env.cronSecret}x` } })).status, 401);
});

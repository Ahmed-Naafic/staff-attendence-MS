/*
 * Staff transfers between branches (approved decisions T1–T12; docs/business-rules.md → Staff
 * transfers): Owner-only scheduling within the school, validation, concurrency, taking effect,
 * attendance history kept at the original branch, events judged against the branch of their own
 * time (offline uploads), the destination schedule and reminder settings, notifications, audit, and
 * Managers' access before and after. Runs on the Neon dev branch; everything it creates is removed.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { localMoment, recordEvent } from '../src/features/attendance/attendance.service.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { processEvent } from '../src/features/notifications/outbox.js';
import { platformTimeZone } from '../src/features/platform-settings/settings.service.js';
import { addDays } from '../src/features/schedules/schedules.service.js';
import { settleDueTransfers, staffBranchAt, zonedMidnight } from '../src/features/staff/transfers.service.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Transfer tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const phonePrefix = `+95${String(parseInt(randomBytes(3).toString('hex'), 16)).padStart(8, '0')}`;
const M_PER_DEG = (6_371_008.8 * Math.PI) / 180;
const P1 = { latitude: 2.046934, longitude: 45.318162 };
const P2 = { latitude: P1.latitude + 1000 / M_PER_DEG, longitude: P1.longitude }; // 1 km north
const ALL = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const startedAt = new Date();
const schools = {};
const branches = {};
const people = {};
let server;
let base;
let zone;
let today;
let counter = 0;

async function call(path, { method = 'GET', body, token, cookie } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }), ...(cookie && { cookie, origin: ORIGIN }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const as = (person, path, options = {}) => call(path, { ...options, cookie: person.cookie, token: person.token });

async function webUser(key, role, extra = {}) {
  counter += 1;
  const password = `pw-${randomBytes(9).toString('base64url')}`;
  const user = await prisma.user.create({ data: { name: `Transfer ${key} ${tag}`, email: `test-xfer-${counter}-${lower}@test.edutrack.example`, role, passwordHash: await hashPassword(password), ...extra } });
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: user.email, password }) });
  assert.equal(res.status, 200);
  people[key] = { ...user, cookie: res.headers.get('set-cookie').split(';')[0] };
  return people[key];
}

async function makeBranch(key, schoolKey, n, { position = P1, status = 'ACTIVE', shifts }) {
  const school = schools[schoolKey];
  const branch = await prisma.branch.create({
    data: { schoolId: school.id, number: n, code: `${school.code}-B00${n}`, name: `Xfer ${key} ${tag}`, nameKey: `xfer ${key.toLowerCase()} ${lower}`, address: 'Road', city: 'Mogadishu', status },
  });
  branch.location = await prisma.branchLocation.create({ data: { branchId: branch.id, ...position, accuracyMeters: 8, effectiveFrom: new Date(Date.now() - 11 * DAY) } });
  branch.position = position;
  branch.schedule = await prisma.branchSchedule.create({
    data: {
      branchId: branch.id,
      effectiveFrom: new Date(`${addDays(today, -10)}T00:00:00Z`),
      timeZone: zone,
      checkOutEnabled: true,
      shifts: { create: shifts.map(([name, start, end]) => ({ shiftKey: randomUUID(), name, days: ALL, startMinute: start, endMinute: end, graceMinutes: 0, absenceCutoffMinutes: 0 })) },
    },
    include: { shifts: true },
  });
  branch.keys = Object.fromEntries(branch.schedule.shifts.map((s) => [s.name, s.shiftKey]));
  branches[key] = branch;
  return branch;
}

async function staff(key, branchKey, shiftNames) {
  counter += 1;
  const branch = branches[branchKey];
  const password = randomBytes(12).toString('base64url');
  const phone = `${phonePrefix}${String(counter).padStart(3, '0')}`;
  const user = await prisma.user.create({
    data: { name: `Xfer Staff ${key} ${tag}`, email: `test-xfer-${counter}-${lower}@test.edutrack.example`, role: 'STAFF', branchId: branch.id, staffId: `${branch.code}-ST${String(counter).padStart(3, '0')}`, phone, phoneKey: phone, jobTitle: 'Teacher', passwordHash: await hashPassword(password) },
  });
  const set = await prisma.staffAssignment.create({
    data: { staffUserId: user.id, branchId: branch.id, effectiveFrom: new Date(`${addDays(today, -10)}T00:00:00Z`), timeZone: zone, shifts: { create: shiftNames.map((n) => ({ shiftKey: branch.keys[n], days: ALL })) } },
  });
  const login = await call('/api/auth/login', { method: 'POST', body: { identifier: phone, password, client: 'mobile' } });
  assert.equal(login.status, 200);
  people[key] = { ...user, token: login.body.token, branch, assignmentId: set.id };
  return people[key];
}

const event = (type, occurredAt, at, sentAt = new Date()) => ({ clientEventId: randomUUID(), type, occurredAt: occurredAt.toISOString(), sentAt: sentAt.toISOString(), position: { ...at, accuracy: 10 } });
const transferBody = (branchKey, shiftNames = [], effectiveFrom = addDays(today, 1)) => ({
  branchId: branches[branchKey].id,
  effectiveFrom,
  shifts: shiftNames.map((n) => ({ shiftKey: branches[branchKey].keys[n], days: ALL })),
});
/** Moves a scheduled transfer's start into the past (as if its day had come), with its destination set. */
async function bringForward(transferId, effectiveAt) {
  const t = await prisma.staffTransfer.update({ where: { id: transferId }, data: { effectiveAt, effectiveFrom: new Date(`${today}T00:00:00Z`) } });
  await prisma.staffAssignment.update({ where: { id: t.assignmentId }, data: { effectiveFrom: new Date(`${today}T00:00:00Z`) } });
}
const lastMinutes = () => localMoment(new Date(), zone).minutes >= 1436;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  zone = await platformTimeZone();
  today = localMoment(new Date(), zone).date;
  await webUser('admin', 'SUPER_ADMIN');
  schools.A = await prisma.school.create({ data: { code: `XA${tag}`, name: `Xfer School A ${tag}`, location: 'Mogadishu' } });
  schools.B = await prisma.school.create({ data: { code: `XB${tag}`, name: `Xfer School B ${tag}`, location: 'Hargeisa' } });
  for (const k of ['A', 'B']) await prisma.school.update({ where: { id: schools[k].id }, data: { ownerId: (await webUser(`O${k}`, 'OWNER')).id } });
  await makeBranch('A1', 'A', 1, { shifts: [['Early', 0, 600], ['Later', 600, 1439]] });
  await makeBranch('A2', 'A', 2, { position: P2, shifts: [['Day', 0, 1439]] });
  await makeBranch('A3', 'A', 3, { status: 'SUSPENDED', shifts: [['Day', 0, 1439]] });
  await makeBranch('B1', 'B', 1, { shifts: [['Day', 0, 1439]] });
  for (const [key, branchKey] of [['MA1', 'A1'], ['MA2', 'A2'], ['MB1', 'B1']]) {
    const m = await webUser(key, 'MANAGER', { branchId: branches[branchKey].id, phone: '+252610000000' });
    await prisma.managerAssignment.create({ data: { managerId: m.id, branchId: branches[branchKey].id } });
  }
  await staff('S1', 'A1', ['Early', 'Later']);
  await staff('S2', 'A1', ['Early', 'Later']);
  await staff('S3', 'A1', ['Later']);
  await staff('SB', 'B1', ['Day']);
});

after(async () => {
  const schoolIds = Object.values(schools).map((s) => s.id);
  const branchIds = Object.values(branches).map((b) => b.id);
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  const transfers = (await prisma.staffTransfer.findMany({ where: { schoolId: { in: schoolIds } }, select: { id: true } })).map((t) => t.id);
  const related = await Promise.all([
    prisma.attendanceEvent.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } }),
    prisma.staffAssignment.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } }),
    prisma.branchSchedule.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } }),
  ]);
  const ids = [...schoolIds, ...branchIds, ...userIds, ...transfers, ...related.flat().map((r) => r.id)];
  await prisma.$executeRaw`DELETE FROM "NotificationEvent" WHERE "createdAt" >= ${startedAt} AND "payload"::text ~ ${ids.join('|')}`;
  await prisma.staffTransfer.deleteMany({ where: { id: { in: transfers } } });
  await prisma.attendanceEvent.deleteMany({ where: { branchId: { in: branchIds }, type: 'CHECK_OUT' } });
  await prisma.attendanceEvent.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.auditEvent.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { actorId: { in: userIds } }, { targetId: { in: ids } }] } });
  const sets = related[1].map((s) => s.id);
  await prisma.staffAssignmentShift.deleteMany({ where: { assignmentId: { in: sets } } });
  await prisma.staffAssignment.deleteMany({ where: { id: { in: sets } } });
  const versions = related[2].map((v) => v.id);
  await prisma.branchShift.deleteMany({ where: { scheduleId: { in: versions } } });
  await prisma.branchSchedule.deleteMany({ where: { id: { in: versions } } });
  await prisma.branchReminderSettings.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.branchLocation.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.managerAssignment.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.pushMessage.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds }, role: { in: ['STAFF', 'MANAGER'] } } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
  await prisma.school.updateMany({ where: { id: { in: schoolIds } }, data: { ownerId: null } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  server.close();
  await prisma.$disconnect();
});

// ---- authorization and validation -----------------------------------------------------------

test('only the School Owner transfers (T1, T11): Managers, staff and Super Admins are refused; signed out → 401', async () => {
  const body = transferBody('A2', ['Day']);
  for (const key of ['MA1', 'S1', 'admin']) assert.equal((await as(people[key], `/api/owner/staff/${people.S1.id}/transfer`, { method: 'POST', body })).status, 403, key);
  assert.equal((await call(`/api/owner/staff/${people.S1.id}/transfer`, { method: 'POST', body })).status, 401);
  assert.equal((await as(people.MA1, `/api/manager/staff/${people.S1.id}/transfer`, { method: 'POST', body })).status, 404, 'no Manager transfer route');
  assert.equal(await prisma.staffTransfer.count({ where: { staffUserId: people.S1.id } }), 0);
});

test('cross-school: another school’s staff member or branch is never accepted, and nothing is readable across schools', async () => {
  assert.equal((await as(people.OA, `/api/owner/staff/${people.SB.id}/transfer`, { method: 'POST', body: transferBody('A2') })).status, 404);
  const toOtherSchool = await as(people.OA, `/api/owner/staff/${people.S2.id}/transfer`, { method: 'POST', body: transferBody('B1') });
  assert.equal(toOtherSchool.status, 400);
  assert.match(toOtherSchool.body.details.branchId, /branch of your school/);
  assert.equal((await as(people.OB, `/api/owner/staff/${people.S1.id}`)).status, 404);
  assert.equal((await as(people.OB, `/api/owner/branches/${branches.A2.id}/shifts?date=${today}`)).status, 404);
  const list = await as(people.OA, '/api/owner/staff?pageSize=100');
  assert.ok(list.body.items.every((s) => s.branch.code.startsWith(schools.A.code)));
  assert.ok(!JSON.stringify(list.body).match(/phone|email|password/i), 'no contact or account data');
});

test('validation: suspended destination, the current branch, a non-staff account, dates and destination shifts', async () => {
  const post = (body, id = people.S2.id) => as(people.OA, `/api/owner/staff/${id}/transfer`, { method: 'POST', body });
  assert.match((await post(transferBody('A3'))).body.details.branchId, /suspended/);
  assert.match((await post(transferBody('A1'))).body.details.branchId, /already works at this branch/);
  assert.equal((await post(transferBody('A2'), people.MA1.id)).status, 404, 'a Manager is not a staff member');
  assert.match((await post(transferBody('A2', [], today))).body.details.effectiveFrom, /tomorrow/, 'never today (T3)');
  assert.ok((await post(transferBody('A2', [], addDays(today, 400)))).body.details.effectiveFrom);
  const wrongShift = await post({ ...transferBody('A2'), shifts: [{ shiftKey: branches.A1.keys.Early, days: ALL }] });
  assert.match(wrongShift.body.details['shifts.0.shiftKey'], /destination branch/);
  assert.equal((await post({ effectiveFrom: addDays(today, 1), shifts: [] })).status, 400, 'destination required');
  assert.equal(await prisma.staffTransfer.count({ where: { staffUserId: people.S2.id } }), 0);
});

// ---- scheduling, notifications, audit --------------------------------------------------------

test('a transfer is scheduled for tomorrow: the staff member stays at the old branch until then; notices to the staff member and the destination Managers; audit with old and new values', async () => {
  const res = await as(people.OA, `/api/owner/staff/${people.S1.id}/transfer`, { method: 'POST', body: transferBody('A2', ['Day']) });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const t = res.body.transfer;
  assert.deepEqual([t.status, t.fromBranch.code, t.toBranch.code, t.effectiveFrom], ['scheduled', branches.A1.code, branches.A2.code, addDays(today, 1)]);
  assert.equal(t.effectiveAt, zonedMidnight(addDays(today, 1), zone).toISOString());
  assert.deepEqual(t.shifts.map((s) => s.name), ['Day']);
  people.S1.transferId = t.id;
  assert.equal((await prisma.user.findUnique({ where: { id: people.S1.id } })).branchId, branches.A1.id, 'not moved before its day');
  assert.equal(await staffBranchAt(people.S1.id, new Date()), branches.A1.id);

  const staffNotice = await prisma.notification.findFirst({ where: { recipientId: people.S1.id, type: 'STAFF_TRANSFERRED' } });
  assert.equal(staffNotice.category, 'TRANSFER');
  const item = (await as(people.S1, `/api/notifications/notification/${staffNotice.id}`)).body.item;
  assert.match(item.title, /Waxaa laguu wareejiyay laan kale/);
  assert.ok(item.body.includes(branches.A2.code) && item.body.includes(addDays(today, 1)) && item.body.includes('Day'));
  const managerNotice = await prisma.notification.findFirst({ where: { recipientId: people.MA2.id, type: 'STAFF_TRANSFER_IN' } });
  assert.ok(managerNotice, 'the destination Manager is told');
  // The Staff ID is kept (T2) and still carries the code it was created with; the origin branch itself is not named.
  assert.ok(!JSON.stringify(managerNotice.params).includes(branches.A1.name) && !('fromBranch' in managerNotice.params), 'the origin branch is not named to the destination Manager');
  assert.equal(await prisma.notification.count({ where: { recipientId: { in: [people.MA1.id, people.OA.id] }, category: 'TRANSFER' } }), 0);
  // Processing the event again creates nothing new.
  const outboxEvent = await prisma.notificationEvent.findUnique({ where: { dedupeKey: `staff-transfer:${t.id}:scheduled` } });
  await prisma.notificationEvent.update({ where: { id: outboxEvent.id }, data: { status: 'PENDING', nextAttemptAt: new Date(0) } });
  await processEvent(outboxEvent.id);
  assert.equal(await prisma.notification.count({ where: { subjectId: t.id } }), 2);

  const audit = await prisma.auditEvent.findFirst({ where: { action: 'STAFF_TRANSFER_SCHEDULED', targetId: people.S1.id } });
  assert.equal(audit.actorId, people.OA.id);
  assert.equal(audit.schoolId, schools.A.id);
  assert.deepEqual(audit.change.fields.slice(0, 2), [
    { field: 'Branch', from: `${branches.A1.name} (${branches.A1.code})`, to: `${branches.A2.name} (${branches.A2.code})` },
    { field: 'Effective from', from: null, to: `${addDays(today, 1)} 00:00 (${zone})` },
  ]);
  const detail = (await as(people.OA, `/api/owner/staff/${people.S1.id}`)).body.staff;
  assert.equal(detail.scheduledTransfer.toBranch.code, branches.A2.code);
  assert.equal(detail.transfers.length, 1);
  assert.deepEqual((await as(people.S1, '/api/attendance/profile')).body.upcomingTransfer, { effectiveFrom: addDays(today, 1), branch: { code: branches.A2.code, name: branches.A2.name } });
});

test('one scheduled transfer per staff member (409); simultaneous requests: exactly one succeeds', async () => {
  const again = await as(people.OA, `/api/owner/staff/${people.S1.id}/transfer`, { method: 'POST', body: transferBody('A2', ['Day'], addDays(today, 2)) });
  assert.equal(again.status, 409);
  assert.equal(again.body.code, 'TRANSFER_SCHEDULED');
  const results = await Promise.all([0, 1, 2].map(() => as(people.OA, `/api/owner/staff/${people.S3.id}/transfer`, { method: 'POST', body: transferBody('A2', ['Day']) })));
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
  assert.equal(await prisma.staffTransfer.count({ where: { staffUserId: people.S3.id, status: 'SCHEDULED' } }), 1);
  assert.equal(await prisma.staffAssignment.count({ where: { staffUserId: people.S3.id, branchId: branches.A2.id, cancelledAt: null } }), 1, 'one destination set');
});

test('before the transfer: the old Manager sees only the date; assignments there must end before it; an open check-in can still be checked out that day (T4)', async (t) => {
  const detail = (await as(people.MA1, `/api/manager/staff/${people.S1.id}`)).body.staff;
  assert.deepEqual(detail.transfer.scheduledOut, { effectiveFrom: addDays(today, 1) });
  assert.ok(!JSON.stringify(detail).includes(branches.A2.code), 'the destination branch is not named to the old Manager');
  const late = await as(people.MA1, `/api/manager/staff/${people.S1.id}/assignments`, { method: 'POST', body: { effectiveFrom: addDays(today, 1), shifts: [{ shiftKey: branches.A1.keys.Early, days: ALL }] } });
  assert.equal(late.status, 400);
  assert.match(late.body.details.effectiveFrom, /moves to another branch/);
  assert.equal((await as(people.MA2, `/api/manager/staff/${people.S1.id}`)).status, 404, 'not the destination Manager’s yet');
  // The destination set is the destination's: the old Manager cannot cancel or replace it.
  assert.equal((await as(people.MA1, `/api/manager/staff/${people.S1.id}/assignments/scheduled`, { method: 'DELETE' })).status, 404);

  if (lastMinutes()) return t.skip('no check-in window in the last minutes of the day');
  const checkIn = await as(people.S1, '/api/attendance/events', { method: 'POST', body: event('CHECK_IN', new Date(Date.now() - 60_000), P1) });
  assert.equal(checkIn.status, 201, JSON.stringify(checkIn.body));
  const checkOut = await as(people.S1, '/api/attendance/events', { method: 'POST', body: event('CHECK_OUT', new Date(Date.now() - 1000), P1) });
  assert.equal(checkOut.status, 201, JSON.stringify(checkOut.body));
  people.S1.liveEvents = [checkIn.body.event.id, checkOut.body.event.id];
});

test('cancelling a scheduled transfer: its destination set is cancelled; notices and audit; the staff member stays', async () => {
  const res = await as(people.OA, `/api/owner/staff/${people.S3.id}/transfer/scheduled`, { method: 'DELETE' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.staff.scheduledTransfer, null);
  const t = await prisma.staffTransfer.findFirst({ where: { staffUserId: people.S3.id } });
  assert.equal(t.status, 'CANCELLED');
  assert.ok((await prisma.staffAssignment.findUnique({ where: { id: t.assignmentId } })).cancelledAt);
  assert.equal(await prisma.notification.count({ where: { type: 'STAFF_TRANSFER_CANCELLED', recipientId: { in: [people.S3.id, people.MA2.id] } } }), 2);
  assert.match((await prisma.notification.findFirst({ where: { type: 'STAFF_TRANSFER_CANCELLED', recipientId: people.S3.id } })).params.audience, /staff/);
  assert.ok(await prisma.auditEvent.findFirst({ where: { action: 'STAFF_TRANSFER_CANCELLED', targetId: people.S3.id, actorId: people.OA.id } }));
  assert.equal((await as(people.OA, `/api/owner/staff/${people.S3.id}/transfer/scheduled`, { method: 'DELETE' })).status, 404);
  assert.equal((await prisma.user.findUnique({ where: { id: people.S3.id } })).branchId, branches.A1.id);
});

// ---- taking effect --------------------------------------------------------------------------

test('taking effect: the branch changes; past attendance stays at the old branch unchanged; events are judged against the branch of their own time (offline uploads, T5)', async (t) => {
  // History at the old branch: two past days.
  const past = [];
  for (const d of [3, 2]) {
    const date = addDays(today, -d);
    const occurredAt = new Date(zonedMidnight(date, zone).getTime() + 8 * HOUR);
    past.push(
      await prisma.attendanceEvent.create({
        data: {
          staffUserId: people.S1.id, branchId: branches.A1.id, type: 'CHECK_IN', clientEventId: randomUUID(), occurredAt, sentAt: occurredAt, receivedAt: occurredAt,
          workDate: new Date(`${date}T00:00:00Z`), shiftKey: branches.A1.keys.Early, scheduleId: branches.A1.schedule.id, assignmentId: people.S1.assignmentId,
          locationId: branches.A1.location.id, ...P1, accuracyMeters: 9, distanceMeters: 3, status: 'LATE',
        },
      }),
    );
  }
  const snapshot = await prisma.attendanceEvent.findMany({ where: { staffUserId: people.S1.id }, orderBy: { id: 'asc' } });

  // The transfer's day has come: it took effect at 00:00 today.
  const effectiveAt = zonedMidnight(today, zone);
  await bringForward(people.S1.transferId, effectiveAt);
  assert.equal(await settleDueTransfers(), 1);
  assert.equal(await settleDueTransfers(), 0, 'applied once');
  assert.equal((await prisma.user.findUnique({ where: { id: people.S1.id } })).branchId, branches.A2.id);
  assert.equal((await prisma.staffTransfer.findUnique({ where: { id: people.S1.transferId } })).status, 'COMPLETED');
  const done = await prisma.auditEvent.findFirst({ where: { action: 'STAFF_TRANSFERRED', targetId: people.S1.id } });
  assert.equal(done.actorId, null, 'by the system');
  assert.equal(done.change.to, `${branches.A2.name} (${branches.A2.code})`);

  // Nothing recorded before was moved, edited or removed (T8).
  assert.deepEqual(await prisma.attendanceEvent.findMany({ where: { staffUserId: people.S1.id }, orderBy: { id: 'asc' } }), snapshot);
  assert.ok(snapshot.every((e) => e.branchId === branches.A1.id));
  assert.equal(await staffBranchAt(people.S1.id, new Date(effectiveAt.getTime() - 1)), branches.A1.id);
  assert.equal(await staffBranchAt(people.S1.id, new Date(effectiveAt.getTime() + 1)), branches.A2.id);

  if (lastMinutes()) return t.skip('no check-in window in the last minutes of the day');
  // An event saved offline yesterday at the old branch (before the transfer), uploaded now within the
  // 24 hours: judged against the old branch, its schedule and its assignment.
  const offlineAt = new Date(Math.max(Date.now() - 23 * HOUR, effectiveAt.getTime() - 23.5 * HOUR));
  if (offlineAt.getTime() < effectiveAt.getTime() - 60_000) {
    const offline = await recordEvent(
      { id: people.S1.id, branchId: branches.A2.id },
      { clientEventId: randomUUID(), type: 'CHECK_IN', occurredAt: offlineAt, sentAt: new Date(), position: { ...P1, accuracy: 10 } },
      new Date(),
    );
    const stored = await prisma.attendanceEvent.findUnique({ where: { id: offline.event.id } });
    assert.deepEqual([stored.branchId, stored.scheduleId], [branches.A1.id, branches.A1.schedule.id], 'kept at the branch of its time');
    // The same event at the new branch's position is refused: it is judged at the old branch.
    const wrong = await recordEvent(
      { id: people.S1.id, branchId: branches.A2.id },
      { clientEventId: randomUUID(), type: 'CHECK_OUT', occurredAt: new Date(offlineAt.getTime() + 60_000), sentAt: new Date(), position: { ...P2, accuracy: 10 } },
      new Date(),
    ).catch((error) => error);
    assert.equal(wrong.code, 'LOCATION_REFUSED');
  }
  // A live event now belongs to the new branch: the old branch's position is refused, the new one's accepted.
  const atOld = await as(people.S1, '/api/attendance/events', { method: 'POST', body: event('CHECK_IN', new Date(Date.now() - 1000), P1) });
  assert.equal(atOld.status, 422);
  assert.equal(atOld.body.code, 'LOCATION_REFUSED');
  const atNew = await as(people.S1, '/api/attendance/events', { method: 'POST', body: event('CHECK_IN', new Date(Date.now() - 1000), P2) });
  assert.equal(atNew.status, 201, JSON.stringify(atNew.body));
  assert.equal(atNew.body.event.shift.name, 'Day', 'the destination schedule and shifts apply');
  assert.equal((await prisma.attendanceEvent.findUnique({ where: { id: atNew.body.event.id } })).branchId, branches.A2.id);
});

test('after the transfer the app gets the new branch context: today (schedule, location), profile, reminder settings', async () => {
  await as(people.MA2, '/api/manager/notification-settings', { method: 'PUT', body: { checkInLeadMinutes: 7 } });
  const day = (await as(people.S1, '/api/attendance/today')).body;
  assert.deepEqual(day.shifts.map((s) => s.name), ['Day']);
  assert.ok(Math.abs(day.branchLocation.latitude - P2.latitude) < 1e-6, 'the geofence centre is the new branch');
  const profile = (await as(people.S1, '/api/attendance/profile')).body;
  assert.deepEqual([profile.branch.code, profile.upcomingTransfer], [branches.A2.code, null]);
  const prefs = (await as(people.S1, '/api/notifications/preferences')).body;
  assert.equal(prefs.reminders.checkIn.leadMinutes, 7, 'the destination branch’s reminder settings');
  assert.equal(prefs.branchOperating, true);
  // History shows both branches (the staff member's own records).
  const history = (await as(people.S1, `/api/attendance/history?from=${addDays(today, -6)}&to=${today}`)).body;
  assert.ok(history.events.length >= 3);
});

test('Manager access after the transfer (T8, T12): the old Manager loses the staff member but keeps the records of their branch; the new Manager sees only the new branch', async () => {
  assert.equal((await as(people.MA1, `/api/manager/staff/${people.S1.id}`)).status, 404);
  assert.ok(!(await as(people.MA1, '/api/manager/staff?pageSize=100')).body.items.some((s) => s.id === people.S1.id));
  const oldRecords = await as(people.MA1, `/api/manager/attendance/records?range=custom&from=${addDays(today, -6)}&to=${today}&pageSize=100`);
  assert.equal(oldRecords.status, 200, JSON.stringify(oldRecords.body));
  assert.ok(oldRecords.body.items.filter((r) => r.staff.id === people.S1.id).length >= 2, 'the old branch keeps its records');

  const detail = (await as(people.MA2, `/api/manager/staff/${people.S1.id}`)).body.staff;
  assert.deepEqual(detail.transfer, { scheduledOut: null, history: [{ effectiveFrom: today, direction: 'in' }] });
  assert.ok(!JSON.stringify(detail).includes(branches.A1.name), 'the old branch is not named to the new Manager');
  assert.deepEqual(detail.assignments.current.shifts.map((s) => s.name), ['Day']);
  const sets = (await as(people.MA2, `/api/manager/staff/${people.S1.id}/assignments`)).body.items;
  assert.ok(sets.length && sets.every((s) => s.shifts.every((x) => x.name === 'Day')), 'only the new branch’s assignment sets');
  const newRecords = await as(people.MA2, `/api/manager/attendance/records?range=custom&from=${addDays(today, -6)}&to=${today}&pageSize=100`);
  assert.ok(newRecords.body.items.every((r) => r.workDate >= today || r.staff.id !== people.S1.id), 'none of the old branch’s records');
  // The old branch's schedule changes no longer concern the transferred staff member.
  const save = await as(people.MA1, '/api/manager/schedule', {
    method: 'POST',
    body: {
      effectiveFrom: addDays(today, 1),
      checkOutEnabled: true,
      shifts: [
        { key: branches.A1.keys.Early, name: 'Early', days: ALL, start: '00:00', end: '10:00', graceMinutes: 0, absenceCutoffMinutes: 0 },
        { key: branches.A1.keys.Later, name: 'Later', days: ALL, start: '10:00', end: '23:00', graceMinutes: 0, absenceCutoffMinutes: 0 },
      ],
    },
  });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  const notified = (await prisma.notification.findMany({ where: { type: 'SCHEDULE_CHANGED', branchId: branches.A1.id } })).map((n) => n.recipientId);
  assert.ok(notified.includes(people.S2.id) && !notified.includes(people.S1.id));
});

test('a transfer that has taken effect cannot be cancelled; the Owner sees the completed history', async () => {
  assert.equal((await as(people.OA, `/api/owner/staff/${people.S1.id}/transfer/scheduled`, { method: 'DELETE' })).status, 404);
  const detail = (await as(people.OA, `/api/owner/staff/${people.S1.id}`)).body.staff;
  assert.equal(detail.branch.code, branches.A2.code);
  assert.deepEqual(detail.transfers.map((x) => [x.status, x.fromBranch.code, x.toBranch.code]), [['completed', branches.A1.code, branches.A2.code]]);
  // A scheduled one past its time cannot be cancelled either (it is in effect even before it is settled).
  const s2 = await as(people.OA, `/api/owner/staff/${people.S2.id}/transfer`, { method: 'POST', body: transferBody('A2', []) });
  assert.equal(s2.status, 201, JSON.stringify(s2.body));
  await prisma.staffTransfer.update({ where: { id: s2.body.transfer.id }, data: { effectiveAt: new Date(Date.now() - 1000) } });
  const late = await as(people.OA, `/api/owner/staff/${people.S2.id}/transfer/scheduled`, { method: 'DELETE' });
  assert.ok([404, 409].includes(late.status), String(late.status));
});

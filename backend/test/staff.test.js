/*
 * Staff account and shift assignment tests (approved rules: docs/business-rules.md → Staff accounts
 * and shift assignments). Managers create (directly active), edit, suspend, reactivate and reset
 * staff of their own branch only; Staff IDs are generated per branch, unique and never reused, also
 * under concurrent creation; staff sign in with their phone number and must change the temporary
 * password; assignment sets reference shifts of the branch schedule, allow several shifts and days,
 * are effective-dated and kept; suspended branches are read only; rejected requests record nothing.
 * Runs on the Neon dev branch (`npm test`); everything it creates is removed afterwards.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { hashPassword, verifyPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { platformTimeZone } from '../src/features/platform-settings/settings.service.js';
import { addDays, localDate } from '../src/features/schedules/schedules.service.js';
import { assignmentOn } from '../src/features/staff/staff.service.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Staff tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
// A unique phone prefix per run, so runs never collide on the platform-wide staff phone index.
const prefix = `+99${String(parseInt(randomBytes(3).toString('hex'), 16)).padStart(8, '0')}`;
let phones = 0;
let savedTimedChanges;
const nextPhone = () => `${prefix}${String((phones += 1)).padStart(3, '0')}`;
const cookies = {};
const accounts = {};
const schools = {};
const branches = {};
const shifts = {};
let server;
let base;
let today;

async function call(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(method !== 'GET' && { origin: ORIGIN }), ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const as = (who) => (path, options = {}) => call(path, { ...options, cookie: cookies[who] });
const withCookie = (cookie) => (path, options = {}) => call(path, { ...options, cookie });
const mA1 = as('MANAGER_A1');
const mA2 = as('MANAGER_A2');
const mB1 = as('MANAGER_B1');
const signIn = (identifier, password) => call('/api/auth/login', { method: 'POST', body: { identifier, password } });
const temp = () => `Temp-${randomBytes(9).toString('base64url')}`;
const valid = (overrides = {}) => ({ name: `Staff Member ${tag}`, phone: nextPhone(), jobTitle: 'Teacher', password: temp(), ...overrides });
async function create(who = mA1, overrides = {}) {
  const body = valid(overrides);
  const res = await who('/api/manager/staff', { method: 'POST', body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { staff: res.body.staff, password: body.password, phone: body.phone };
}
const assign = (who, id, body) => who(`/api/manager/staff/${id}/assignments`, { method: 'POST', body });
const staffEvents = (id) => prisma.auditEvent.findMany({ where: { targetId: id }, orderBy: { occurredAt: 'asc' } });

const MORNING = { name: 'Morning', days: ['MON', 'TUE', 'WED', 'THU', 'SAT'], start: '07:00', end: '13:00', graceMinutes: 10, absenceCutoffMinutes: 120 };
const AFTERNOON = { name: 'Afternoon', days: ['MON', 'TUE', 'WED', 'THU', 'SAT'], start: '13:00', end: '18:00', graceMinutes: 5, absenceCutoffMinutes: 60 };
const FRIDAY = { name: 'Friday', days: ['FRI'], start: '08:00', end: '12:00', graceMinutes: 0, absenceCutoffMinutes: 30 };

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  today = localDate(await platformTimeZone());
  for (const key of ['A', 'B']) {
    schools[key] = await prisma.school.create({ data: { code: `T${tag}-${key}`, name: `Staff School ${key} ${tag}`, location: 'Mogadishu' } });
  }
  for (const [key, school, number] of [['A1', 'A', 1], ['A2', 'A', 2], ['B1', 'B', 1]]) {
    branches[key] = await prisma.branch.create({
      data: { schoolId: schools[school].id, number, code: `${schools[school].code}-B00${number}`, name: `Branch ${key}`, nameKey: `branch ${key.toLowerCase()}`, address: 'Road 1', city: 'Mogadishu' },
    });
  }
  const people = [
    ['SUPER_ADMIN', 'SUPER_ADMIN'],
    ['OWNER_A', 'OWNER', { school: 'A' }],
    ['MANAGER_A1', 'MANAGER', { branch: 'A1' }],
    ['MANAGER_A2', 'MANAGER', { branch: 'A2' }],
    ['MANAGER_B1', 'MANAGER', { branch: 'B1' }],
    ['MANAGER_TEMP', 'MANAGER', { branch: 'A1', mustChangePassword: true }],
  ];
  for (const [key, role, extra = {}] of people) {
    const password = randomBytes(12).toString('base64url');
    const email = `test-stf-${key.toLowerCase().replace('_', '-')}-${lower}@test.edutrack.example`;
    const user = await prisma.user.create({
      data: {
        name: `Test ${key} ${tag}`,
        email,
        role,
        passwordHash: await hashPassword(password),
        ...(extra.branch && { branchId: branches[extra.branch].id }),
        ...(extra.mustChangePassword && { mustChangePassword: true }),
      },
    });
    if (extra.branch) await prisma.managerAssignment.create({ data: { managerId: user.id, branchId: branches[extra.branch].id } });
    if (extra.school) await prisma.school.update({ where: { id: schools[extra.school].id }, data: { ownerId: user.id } });
    accounts[key] = { ...user, password };
    const res = await signIn(email, password);
    assert.equal(res.status, 200, `${key} sign-in`);
    cookies[key] = res.cookie;
  }
  // These tests save changes from a date (no time of day): switch timed changes off for the run and
  // put back whatever the dev system had (see after()).
  savedTimedChanges = (await prisma.platformSettings.findUnique({ where: { id: 'platform' }, select: { timedChanges: true } }))?.timedChanges;
  if (savedTimedChanges) await prisma.platformSettings.update({ where: { id: 'platform' }, data: { timedChanges: false } });
  // Branch A1 and B1 schedules from today (A2 has none).
  for (const [who, list] of [[mA1, [MORNING, AFTERNOON, FRIDAY]], [mB1, [MORNING]]]) {
    const res = await who('/api/manager/schedule', { method: 'POST', body: { effectiveFrom: today, checkOutEnabled: false, shifts: list } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }
  for (const s of (await mA1('/api/manager/schedule')).body.current.shifts) shifts[s.name] = s;
  shifts.B1 = (await mB1('/api/manager/schedule')).body.current.shifts[0];
});

after(async () => {
  if (savedTimedChanges) await prisma.platformSettings.update({ where: { id: 'platform' }, data: { timedChanges: savedTimedChanges } });
  const schoolIds = Object.values(schools).map((s) => s.id);
  const branchIds = Object.values(branches).map((b) => b.id);
  const staffIds = (await prisma.user.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((u) => u.id);
  const userIds = [...Object.values(accounts).map((u) => u.id), ...staffIds];
  await prisma.auditEvent.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { actorId: { in: userIds } }, { targetId: { in: [...userIds, ...branchIds] } }] } });
  const setIds = (await prisma.staffAssignment.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((s) => s.id);
  await prisma.staffAssignmentShift.deleteMany({ where: { assignmentId: { in: setIds } } });
  await prisma.staffAssignment.deleteMany({ where: { id: { in: setIds } } });
  const scheduleIds = (await prisma.branchSchedule.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })).map((s) => s.id);
  await prisma.branchShift.deleteMany({ where: { scheduleId: { in: scheduleIds } } });
  await prisma.branchSchedule.deleteMany({ where: { id: { in: scheduleIds } } });
  await prisma.managerAssignment.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.user.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
  await prisma.school.updateMany({ where: { id: { in: schoolIds } }, data: { ownerId: null } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  server.close();
  await prisma.$disconnect();
});

describe('access: the branch Manager only', () => {
  const id = randomUUID();
  const endpoints = () => [
    ['GET', '/api/manager/staff'],
    ['GET', `/api/manager/staff/${id}`],
    ['POST', '/api/manager/staff', valid()],
    ['PATCH', `/api/manager/staff/${id}`, { name: 'Changed Name' }],
    ['POST', `/api/manager/staff/${id}/suspend`, { reason: 'Testing access' }],
    ['POST', `/api/manager/staff/${id}/reactivate`],
    ['POST', `/api/manager/staff/${id}/password`, { password: temp() }],
    ['GET', `/api/manager/staff/${id}/assignments`],
    ['POST', `/api/manager/staff/${id}/assignments`, { effectiveFrom: today, shifts: [] }],
    ['DELETE', `/api/manager/staff/${id}/assignments/scheduled`],
  ];

  test('signed out → 401; Super Admin and owner → 403; a Manager with a temporary password must change it first', async () => {
    const before = await prisma.user.count({ where: { role: 'STAFF' } });
    for (const [method, path, body] of endpoints()) assert.equal((await call(path, { method, body })).status, 401, `${method} ${path}`);
    for (const who of ['SUPER_ADMIN', 'OWNER_A']) {
      for (const [method, path, body] of endpoints()) assert.equal((await as(who)(path, { method, body })).status, 403, `${who} ${method} ${path}`);
    }
    for (const [method, path, body] of endpoints()) assert.equal((await as('MANAGER_TEMP')(path, { method, body })).body.code, 'PASSWORD_CHANGE_REQUIRED');
    assert.equal(await prisma.user.count({ where: { role: 'STAFF' } }), before);
  });

  test('staff cannot manage staff', async () => {
    const { phone, password } = await create();
    const login = await signIn(phone, password);
    const chosen = `Chosen-${randomBytes(9).toString('base64url')}`;
    await withCookie(login.cookie)('/api/auth/password', { method: 'POST', body: { currentPassword: password, newPassword: chosen } });
    for (const [method, path, body] of endpoints()) assert.equal((await withCookie(login.cookie)(path, { method, body })).status, 403, `${method} ${path}`);
  });
});

describe('creating staff', () => {
  test('direct activation: ACTIVE at once, Staff ID from the branch code, temporary password only hashed', async () => {
    const before = await prisma.branch.findUnique({ where: { id: branches.A1.id }, select: { staffSequence: true } });
    const body = valid({ name: `  Asha   Ali ${tag} `, email: `Asha-${lower}@Test.EduTrack.Example` });
    const res = await mA1('/api/manager/staff', { method: 'POST', body });
    assert.equal(res.status, 201);
    const s = res.body.staff;
    assert.equal(s.staffId, `${branches.A1.code}-ST${String(before.staffSequence + 1).padStart(3, '0')}`);
    assert.match(s.staffId, /^T[0-9A-F]{6}-A-B001-ST\d{3}$/);
    assert.equal(s.status, 'active');
    assert.equal(s.passwordChangePending, true);
    assert.equal(s.name, `Asha Ali ${tag}`);
    assert.equal(s.email, `asha-${lower}@test.edutrack.example`);
    assert.equal(s.jobTitle, 'Teacher');
    assert.ok(!res.text.includes(body.password) && !res.text.includes('scrypt'));
    const row = await prisma.user.findUnique({ where: { id: s.id } });
    assert.equal(row.role, 'STAFF');
    assert.equal(row.branchId, branches.A1.id);
    assert.equal(row.phoneKey, body.phone);
    assert.ok(await verifyPassword(body.password, row.passwordHash));
    const events = await staffEvents(s.id);
    assert.deepEqual(events.map((e) => e.action), ['STAFF_CREATED']);
    assert.equal(events[0].schoolId, schools.A.id);
    assert.equal(events[0].actorId, accounts.MANAGER_A1.id);
    assert.ok(!JSON.stringify(events[0]).includes(body.password));
  });

  test('required fields and formats; refused fields; nothing created or recorded', async () => {
    const before = await prisma.user.count({ where: { role: 'STAFF', branchId: branches.A1.id } });
    const res = await mA1('/api/manager/staff', { method: 'POST', body: { name: 'X', phone: '12', jobTitle: '', email: 'nope', password: 'short' } });
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(res.body.details).sort(), ['email', 'jobTitle', 'name', 'password', 'phone']);
    for (const extra of [{ staffId: 'X-ST999' }, { branchId: branches.A2.id }, { schoolId: schools.B.id }, { role: 'MANAGER' }, { status: 'SUSPENDED' }, { other: 1 }]) {
      assert.equal((await mA1('/api/manager/staff', { method: 'POST', body: valid(extra) })).status, 400, JSON.stringify(extra));
    }
    assert.equal(await prisma.user.count({ where: { role: 'STAFF', branchId: branches.A1.id } }), before);
  });

  test('a phone number belongs to one staff account on the platform, compared by its digits; emails are unique', async () => {
    const { phone } = await create();
    const spaced = `${phone.slice(0, 4)} ${phone.slice(4, 8)}-${phone.slice(8)}`;
    for (const who of [mA1, mB1]) {
      const res = await who('/api/manager/staff', { method: 'POST', body: valid({ phone: spaced }) });
      assert.equal(res.status, 409);
      assert.equal(res.body.code, 'PHONE_TAKEN');
    }
    const email = await mA1('/api/manager/staff', { method: 'POST', body: valid({ email: accounts.OWNER_A.email.toUpperCase() }) });
    assert.equal(email.body.code, 'EMAIL_TAKEN');
  });

  test('simultaneous creation gives consecutive, unique Staff IDs', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => mA1('/api/manager/staff', { method: 'POST', body: valid() })));
    assert.deepEqual(results.map((r) => r.status), Array(6).fill(201));
    const numbers = results.map((r) => Number(r.body.staff.staffId.slice(-3))).sort((a, b) => a - b);
    assert.equal(new Set(numbers).size, 6);
    assert.equal(numbers.at(-1) - numbers[0], 5, 'consecutive');
  });

  test('numbers are per branch; Staff IDs are never reused', async () => {
    const b = await create(mB1);
    assert.equal(b.staff.staffId, `${branches.B1.code}-ST001`);
    const a = await create();
    await mA1(`/api/manager/staff/${a.staff.id}/suspend`, { method: 'POST', body: { reason: 'Leaving soon' } });
    const next = await create();
    assert.equal(Number(next.staff.staffId.slice(-3)), Number(a.staff.staffId.slice(-3)) + 1);
  });
});

describe('branch isolation', () => {
  test('another branch\'s staff is not found for any action; lists are limited to the Manager\'s branch', async () => {
    const { staff } = await create();
    const attempts = [
      ['GET', `/api/manager/staff/${staff.id}`],
      ['PATCH', `/api/manager/staff/${staff.id}`, { name: 'Taken Over' }],
      ['POST', `/api/manager/staff/${staff.id}/suspend`, { reason: 'Not mine' }],
      ['POST', `/api/manager/staff/${staff.id}/reactivate`],
      ['POST', `/api/manager/staff/${staff.id}/password`, { password: temp() }],
      ['GET', `/api/manager/staff/${staff.id}/assignments`],
      ['POST', `/api/manager/staff/${staff.id}/assignments`, { effectiveFrom: addDays(today, 1), shifts: [] }],
      ['DELETE', `/api/manager/staff/${staff.id}/assignments/scheduled`],
    ];
    const before = (await staffEvents(staff.id)).length;
    for (const who of [mA2, mB1]) {
      for (const [method, path, body] of attempts) assert.equal((await who(path, { method, body })).status, 404, `${method} ${path}`);
    }
    assert.equal((await staffEvents(staff.id)).length, before);
    const list = await mA2('/api/manager/staff?pageSize=100');
    assert.equal(list.body.total, 0);
    for (const id of ['abc', accounts.MANAGER_A1.id]) assert.equal((await mA1(`/api/manager/staff/${id}`)).status, 404);
  });
});

describe('phone sign-in and the temporary password', () => {
  test('staff sign in with their phone (any formatting) and must change the temporary password first', async () => {
    const { staff, phone, password } = await create(mA1, { email: undefined });
    const formatted = `${phone.slice(0, 4)} ${phone.slice(4)}`;
    const login = await signIn(formatted, password);
    assert.equal(login.status, 200);
    assert.equal(login.body.user.role, 'STAFF');
    assert.equal(login.body.user.mustChangePassword, true);
    assert.equal((await withCookie(login.cookie)('/api/manager/branch')).body.code, 'PASSWORD_CHANGE_REQUIRED');
    const chosen = `Chosen-${randomBytes(9).toString('base64url')}`;
    const change = await withCookie(login.cookie)('/api/auth/password', { method: 'POST', body: { currentPassword: password, newPassword: chosen } });
    assert.equal(change.status, 200);
    assert.equal((await signIn(phone, password)).status, 401);
    assert.equal((await signIn(phone, chosen)).status, 200);
    const event = await prisma.auditEvent.findFirst({ where: { action: 'SIGN_IN', actorId: staff.id, result: 'SUCCESS' } });
    assert.equal(event.schoolId, schools.A.id);
  });

  test('unknown phones and other roles\' phones do not sign in', async () => {
    assert.equal((await signIn(`${prefix}999`, 'whatever-password')).status, 401);
    const before = await prisma.user.findUnique({ where: { id: accounts.MANAGER_A1.id } });
    await prisma.user.update({ where: { id: accounts.MANAGER_A1.id }, data: { phone: `${prefix}998`, phoneKey: null } });
    assert.equal((await signIn(`${prefix}998`, accounts.MANAGER_A1.password)).status, 401, 'Managers sign in with their email');
    await prisma.user.update({ where: { id: accounts.MANAGER_A1.id }, data: { phone: before.phone } });
    resetLimiter();
  });
});

describe('editing, suspension and reset', () => {
  test('edits are recorded by field name; a phone change moves the sign-in identifier; protected fields are refused', async () => {
    const { staff, password } = await create();
    const phone = nextPhone();
    const res = await mA1(`/api/manager/staff/${staff.id}`, { method: 'PATCH', body: { phone, jobTitle: 'Head Teacher', email: '' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.staff.jobTitle, 'Head Teacher');
    assert.equal(res.body.staff.staffId, staff.staffId);
    const login = await signIn(phone, password);
    assert.equal(login.status, 200);
    const event = (await staffEvents(staff.id)).at(-1);
    assert.equal(event.action, 'STAFF_UPDATED');
    assert.equal(event.description, 'Staff details updated: Phone, Job title.');
    for (const body of [{ staffId: 'X' }, { password: temp() }, { branchId: branches.A2.id }, {}]) {
      assert.equal((await mA1(`/api/manager/staff/${staff.id}`, { method: 'PATCH', body })).status, 400, JSON.stringify(body));
    }
    const count = (await staffEvents(staff.id)).length;
    await mA1(`/api/manager/staff/${staff.id}`, { method: 'PATCH', body: { jobTitle: 'Head Teacher' } });
    assert.equal((await staffEvents(staff.id)).length, count, 'no change, no event');
    await mA1(`/api/manager/staff/${staff.id}`, { method: 'PATCH', body: { jobTitle: '  head   TEACHER ' } });
    assert.equal((await staffEvents(staff.id)).length, count, 'a standard title in other spelling is the same title: no change');
  });

  test('job titles: standard titles are saved in their standard spelling; other titles are kept as typed', async () => {
    const created = await mA1('/api/manager/staff', { method: 'POST', body: valid({ jobTitle: 'security GUARD' }) });
    assert.equal(created.status, 201);
    assert.equal(created.body.staff.jobTitle, 'Security Guard');
    const other = await mA1(`/api/manager/staff/${created.body.staff.id}`, { method: 'PATCH', body: { jobTitle: 'Gardener' } });
    assert.equal(other.body.staff.jobTitle, 'Gardener');
  });

  test('suspension ends sessions and blocks sign-in; reactivation keeps earlier sessions ended', async () => {
    const { staff, phone, password } = await create();
    const login = await signIn(phone, password);
    assert.equal((await mA1(`/api/manager/staff/${staff.id}/suspend`, { method: 'POST', body: {} })).status, 400);
    const res = await mA1(`/api/manager/staff/${staff.id}/suspend`, { method: 'POST', body: { reason: 'On leave' } });
    assert.equal(res.body.staff.status, 'suspended');
    assert.equal((await withCookie(login.cookie)('/api/auth/session')).body.user, null);
    assert.equal((await signIn(phone, password)).status, 401);
    assert.equal((await mA1(`/api/manager/staff/${staff.id}/suspend`, { method: 'POST', body: { reason: 'Again' } })).status, 409);
    assert.equal((await mA1(`/api/manager/staff/${staff.id}/reactivate`, { method: 'POST' })).body.staff.status, 'active');
    assert.equal((await withCookie(login.cookie)('/api/auth/session')).body.user, null);
    assert.equal((await signIn(phone, password)).status, 200);
    assert.deepEqual((await staffEvents(staff.id)).map((e) => e.action).filter((a) => a.startsWith('STAFF_')), ['STAFF_CREATED', 'STAFF_SUSPENDED', 'STAFF_REACTIVATED']);
    resetLimiter();
  });

  test('a new temporary password ends sessions and requires a change; the event never contains it', async () => {
    const { staff, phone, password } = await create();
    const login = await signIn(phone, password);
    const fresh = temp();
    const res = await mA1(`/api/manager/staff/${staff.id}/password`, { method: 'POST', body: { password: fresh } });
    assert.equal(res.status, 200);
    assert.ok(!res.text.includes(fresh));
    assert.equal((await withCookie(login.cookie)('/api/auth/session')).body.user, null);
    const again = await signIn(phone, fresh);
    assert.equal(again.body.user.mustChangePassword, true);
    const event = (await staffEvents(staff.id)).find((e) => e.action === 'STAFF_PASSWORD_RESET');
    assert.ok(event && !JSON.stringify(event).includes(fresh));
  });
});

describe('shift assignments', () => {
  let staff;
  before(async () => {
    ({ staff } = await create());
  });
  const set = (effectiveFrom, list) => ({ effectiveFrom, shifts: list });

  test('several shifts with chosen days, including two shifts on the same day; names come from the schedule', async () => {
    const res = await assign(mA1, staff.id, set(today, [
      { shiftKey: shifts.Morning.key, days: ['TUE', 'MON'] },
      { shiftKey: shifts.Afternoon.key, days: ['MON'] },
      { shiftKey: shifts.Friday.key, days: ['FRI'] },
    ]));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const current = res.body.staff.assignments.current;
    assert.equal(current.effectiveFrom, today);
    assert.deepEqual(current.shifts.map((s) => [s.name, s.days.join()]).sort(), [['Afternoon', 'MON'], ['Friday', 'FRI'], ['Morning', 'MON,TUE']]);
    assert.equal((await assignmentOn(staff.id, today)).shifts.length, 3);
    const event = (await staffEvents(staff.id)).at(-1);
    assert.equal(event.action, 'STAFF_ASSIGNMENT_CHANGED');
    assert.match(event.description, /Morning: Mon, Tue/);
  });

  test('invalid assignments are refused and record nothing', async () => {
    const count = (await staffEvents(staff.id)).length;
    const cases = [
      [set(addDays(today, 1), [{ shiftKey: shifts.Morning.key, days: ['SUN'] }]), 'shifts.0.days'],
      [set(addDays(today, 1), [{ shiftKey: shifts.B1.key, days: ['MON'] }]), 'shifts.0.shiftKey'],
      [set(addDays(today, 1), [{ shiftKey: randomUUID(), days: ['MON'] }]), 'shifts.0.shiftKey'],
      [set(addDays(today, 1), [{ shiftKey: shifts.Morning.key, days: ['MON'] }, { shiftKey: shifts.Morning.key, days: ['TUE'] }]), 'shifts.1.shiftKey'],
      [set(addDays(today, 1), [{ shiftKey: shifts.Morning.key, days: [] }]), 'shifts.0.days'],
      [set(today, []), 'effectiveFrom'],
      [set(addDays(today, -1), []), 'effectiveFrom'],
      [set(addDays(today, 366), []), 'effectiveFrom'],
    ];
    for (const [body, field] of cases) {
      const res = await assign(mA1, staff.id, body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.ok(res.body.details[field], `${field}: ${JSON.stringify(res.body.details)}`);
    }
    assert.equal((await assign(mA1, staff.id, { ...set(addDays(today, 1), []), branchId: branches.B1.id })).status, 400);
    assert.equal((await staffEvents(staff.id)).length, count);
  });

  test('changes are dated: scheduled, replaced (kept as cancelled), cancelled; history is never rewritten', async () => {
    const first = await assign(mA1, staff.id, set(addDays(today, 1), [{ shiftKey: shifts.Friday.key, days: ['FRI'] }]));
    assert.equal(first.body.staff.assignments.scheduled.effectiveFrom, addDays(today, 1));
    const second = await assign(mA1, staff.id, set(addDays(today, 2), []));
    assert.equal(second.body.staff.assignments.scheduled.effectiveFrom, addDays(today, 2));
    assert.deepEqual(second.body.staff.assignments.scheduled.shifts, []);
    const history = (await mA1(`/api/manager/staff/${staff.id}/assignments`)).body.items;
    assert.deepEqual(history.map((h) => h.state), ['scheduled', 'cancelled', 'current']);
    assert.equal(history[2].effectiveUntil, addDays(today, 1));
    assert.equal((await assignmentOn(staff.id, addDays(today, 1))).shifts.length, 3, 'the replaced set never applies');
    assert.equal((await mA1(`/api/manager/staff/${staff.id}/assignments/scheduled`, { method: 'DELETE' })).status, 200);
    assert.equal((await mA1(`/api/manager/staff/${staff.id}/assignments/scheduled`, { method: 'DELETE' })).status, 404);
    assert.equal(await prisma.staffAssignment.count({ where: { staffUserId: staff.id } }), 3, 'nothing deleted');
  });

  test('saving the set in effect changes nothing', async () => {
    const count = await prisma.staffAssignment.count({ where: { staffUserId: staff.id } });
    const current = (await mA1(`/api/manager/staff/${staff.id}`)).body.staff.assignments.current;
    const res = await assign(mA1, staff.id, set(addDays(today, 3), current.shifts.map(({ shiftKey, days }) => ({ shiftKey, days })).reverse()));
    assert.equal(res.status, 200);
    assert.equal(await prisma.staffAssignment.count({ where: { staffUserId: staff.id } }), count);
  });

  test('assignments follow the schedule in effect on their date: an edited shift keeps its key, a removed shift cannot be assigned', async () => {
    // Schedule change from the day after tomorrow: Morning kept (renamed, earlier start), Afternoon removed.
    const { id: _id, ...morning } = shifts.Morning;
    const change = await mA1('/api/manager/schedule', {
      method: 'POST',
      body: { effectiveFrom: addDays(today, 2), checkOutEnabled: false, shifts: [{ ...morning, name: 'Early', start: '06:30' }, (({ id, ...f }) => f)(shifts.Friday)] },
    });
    assert.equal(change.status, 200, JSON.stringify(change.body));
    const later = await assign(mA1, staff.id, set(addDays(today, 3), [{ shiftKey: shifts.Afternoon.key, days: ['MON'] }]));
    assert.equal(later.status, 400);
    assert.match(later.body.details['shifts.0.shiftKey'], /not in your branch's schedule/);
    const kept = await assign(mA1, staff.id, set(addDays(today, 3), [{ shiftKey: shifts.Morning.key, days: ['MON'] }]));
    assert.equal(kept.status, 200);
    assert.equal(kept.body.staff.assignments.scheduled.shifts[0].name, 'Early');
    await mA1('/api/manager/staff/' + staff.id + '/assignments/scheduled', { method: 'DELETE' });
    await mA1('/api/manager/schedule/scheduled', { method: 'DELETE' });
  });

  test('a branch with no schedule can only give an empty set', async () => {
    const { staff: other } = await create(mA2);
    const res = await assign(mA2, other.id, set(today, [{ shiftKey: shifts.Morning.key, days: ['MON'] }]));
    assert.equal(res.status, 400);
    assert.match(res.body.details.effectiveFrom, /no schedule in effect/);
    assert.equal((await assign(mA2, other.id, set(today, []))).status, 200);
  });
});

describe('suspended branch or school: read only', () => {
  test('reads work; every change is refused (409) and nothing is written', async () => {
    const { staff } = await create();
    await prisma.branch.update({ where: { id: branches.A1.id }, data: { status: 'SUSPENDED' } });
    try {
      assert.equal((await mA1('/api/manager/staff')).status, 200);
      assert.equal((await mA1(`/api/manager/staff/${staff.id}`)).status, 200);
      const count = await prisma.user.count({ where: { branchId: branches.A1.id } });
      const writes = [
        ['POST', '/api/manager/staff', valid()],
        ['PATCH', `/api/manager/staff/${staff.id}`, { jobTitle: 'Changed While Suspended' }],
        ['POST', `/api/manager/staff/${staff.id}/suspend`, { reason: 'Branch suspended' }],
        ['POST', `/api/manager/staff/${staff.id}/password`, { password: temp() }],
        ['POST', `/api/manager/staff/${staff.id}/assignments`, { effectiveFrom: addDays(today, 1), shifts: [] }],
      ];
      for (const [method, path, body] of writes) {
        const res = await mA1(path, { method, body });
        assert.equal(res.status, 409, `${method} ${path}`);
        assert.equal(res.body.code, 'BRANCH_NOT_OPERATING');
      }
      assert.equal(await prisma.user.count({ where: { branchId: branches.A1.id } }), count);
      assert.deepEqual((await staffEvents(staff.id)).map((e) => e.action), ['STAFF_CREATED']);
    } finally {
      await prisma.branch.update({ where: { id: branches.A1.id }, data: { status: 'ACTIVE' } });
    }
  });
});

describe('database constraints', () => {
  test('Staff IDs, phone keys, branches and assignment days are enforced by the database', async () => {
    const base = { name: 'Db Test', role: 'STAFF', branchId: branches.A1.id, jobTitle: 'Teacher' };
    await assert.rejects(prisma.user.create({ data: { ...base, phoneKey: nextPhone() } }), 'STAFF needs a Staff ID');
    await assert.rejects(prisma.user.create({ data: { ...base, staffId: `X${tag}-ST001` } }), 'STAFF needs a phone key');
    await assert.rejects(prisma.user.create({ data: { ...base, branchId: null, staffId: `X${tag}-ST002`, phoneKey: nextPhone() } }), 'STAFF needs a branch');
    const { staff } = await create();
    const row = await prisma.user.findUnique({ where: { id: staff.id } });
    await assert.rejects(prisma.user.create({ data: { ...base, staffId: `X${tag}-ST003`, phoneKey: row.phoneKey } }), 'one staff account per phone');
    await assert.rejects(prisma.user.create({ data: { ...base, staffId: staff.staffId, phoneKey: nextPhone() } }), 'unique Staff ID');
    await assert.rejects(prisma.user.create({ data: { name: 'Owner', role: 'OWNER', staffId: `X${tag}-ST004` } }), 'only STAFF has a Staff ID');
    const setRow = await prisma.staffAssignment.create({ data: { staffUserId: staff.id, branchId: branches.A1.id, effectiveFrom: new Date(`${addDays(today, 30)}T00:00:00Z`), timeZone: 'UTC' } });
    await assert.rejects(prisma.staffAssignmentShift.create({ data: { assignmentId: setRow.id, shiftKey: shifts.Morning.key, days: [] } }));
    await assert.rejects(prisma.staffAssignment.create({ data: { staffUserId: staff.id, branchId: branches.A1.id, effectiveFrom: setRow.effectiveFrom, timeZone: 'UTC' } }));
  });
});

describe('audit visibility', () => {
  test('Super Admins see staff events with the school; owners and the dashboard do not', async () => {
    const res = await as('SUPER_ADMIN')(`/api/platform/audit-logs?action=STAFF_CREATED&school=${schools.A.id}&pageSize=100`);
    assert.equal(res.status, 200);
    assert.ok(res.body.total > 0);
    assert.equal(res.body.items[0].target.type, 'staff');
    assert.equal(res.body.items[0].target.schoolName, schools.A.name);
    const owner = await as('OWNER_A')('/api/owner/audit-logs?pageSize=100');
    assert.ok(owner.body.items.every((e) => !e.action.startsWith('STAFF_')));
    const dashboard = await as('SUPER_ADMIN')('/api/platform/dashboard');
    assert.ok(dashboard.body.recentActivity.every((e) => !e.type.startsWith('STAFF_')));
  });
});

describe('sample staff (test systems)', () => {
  test('a Manager adds 20 sample staff (15 teachers) to their branch once; a second run adds nothing', async () => {
    const status = await mA1('/api/manager/staff/sample');
    assert.equal(status.status, 200);
    assert.deepEqual(status.body, { enabled: true, total: 20, existing: 0, teachers: 15 });

    assert.equal((await mA1('/api/manager/staff/sample', { method: 'POST', body: { password: 'x' } })).status, 400, 'the temporary password is checked');
    const first = await mA1('/api/manager/staff/sample', { method: 'POST', body: { password: 'Sample-pass-2026' } });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.created.length, 20);
    assert.equal(first.body.created.filter((s) => s.jobTitle === 'Teacher').length, 15);
    assert.deepEqual(first.body.created.filter((s) => s.jobTitle !== 'Teacher').map((s) => s.jobTitle).sort(), ['Accountant', 'Cleaner', 'Librarian', 'Secretary', 'Security Guard']);
    assert.equal(new Set(first.body.created.map((s) => s.staffId)).size, 20, 'each its own Staff ID');
    assert.ok(first.body.created.every((s) => s.status === 'active' && s.branch?.id !== branches.A2.id));
    assert.deepEqual(first.body.status, { enabled: true, total: 20, existing: 20, teachers: 15 });

    // Created like any staff member: in the branch, must change the password, audited.
    const rows = await prisma.user.findMany({ where: { id: { in: first.body.created.map((s) => s.id) } } });
    assert.ok(rows.every((u) => u.branchId === branches.A1.id && u.role === 'STAFF' && u.mustChangePassword));
    assert.equal(await prisma.auditEvent.count({ where: { action: 'STAFF_CREATED', targetId: { in: rows.map((u) => u.id) } } }), 20);

    const again = await mA1('/api/manager/staff/sample', { method: 'POST', body: { password: 'Sample-pass-2026' } });
    assert.equal(again.status, 201);
    assert.equal(again.body.created.length, 0);
    assert.equal(again.body.skipped, 20);
    // Another branch has its own sample staff.
    assert.equal((await mA2('/api/manager/staff/sample')).body.existing, 0);
  });
});

describe('shifts for many staff at once', () => {
  test('chosen staff get the same shifts; staff who already have shifts are skipped unless asked; each answered on its own', async () => {
    const made = [];
    for (let i = 0; i < 3; i += 1) made.push((await mA1('/api/manager/staff', { method: 'POST', body: valid({ name: `Bulk ${i} ${tag}` }) })).body.staff);
    const ctx = await mA1('/api/manager/staff/assignments/bulk');
    assert.equal(ctx.status, 200, JSON.stringify(ctx.body));
    assert.ok(made.every((m) => ctx.body.staff.some((s) => s.id === m.id && s.hasShifts === false)));
    assert.ok(ctx.body.branchShifts.current.shifts.some((s) => s.key === shifts.Morning.key));
    const from = ctx.body.earliestEffectiveDate;
    const body = (extra) => ({ effectiveFrom: from, shifts: [{ shiftKey: shifts.Morning.key, days: ['SAT', 'MON'] }], ...extra });

    // The first one gets shifts by itself; then all three with "only staff without shifts".
    assert.equal((await mA1(`/api/manager/staff/${made[0].id}/assignments`, { method: 'POST', body: { effectiveFrom: from, shifts: [{ shiftKey: shifts.Afternoon.key, days: ['MON'] }] } })).status, 200);
    const ids = made.map((m) => m.id);
    const unknown = randomUUID();
    const res = await mA1('/api/manager/staff/assignments/bulk', { method: 'POST', body: body({ staff: [...ids, unknown] }) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual([res.body.saved, res.body.skipped, res.body.failed], [2, 1, 1]);
    assert.equal(res.body.results.find((r) => r.staff.id === made[0].id).result, 'skipped');
    assert.equal(res.body.results.find((r) => r.staff.id === unknown).result, 'failed');
    for (const m of made.slice(1)) {
      const set = await prisma.staffAssignment.findFirst({ where: { staffUserId: m.id, cancelledAt: null }, include: { shifts: true } });
      assert.deepEqual(set.shifts.map((s) => [s.shiftKey, s.days.join(',')]), [[shifts.Morning.key, 'MON,SAT']]);
    }
    // Audited like one by one.
    assert.equal(await prisma.auditEvent.count({ where: { action: 'STAFF_ASSIGNMENT_CHANGED', targetId: { in: ids.slice(1) } } }), 2);

    // Without "only staff without shifts" the first one's are replaced too.
    const all = await mA1('/api/manager/staff/assignments/bulk', { method: 'POST', body: body({ staff: [made[0].id], onlyUnassigned: false }) });
    assert.deepEqual([all.body.saved, all.body.skipped, all.body.failed], [1, 0, 0]);

    // A day the shift does not have is refused for each staff member, with the reason.
    const bad = await mA1('/api/manager/staff/assignments/bulk', { method: 'POST', body: body({ staff: [made[1].id], onlyUnassigned: false, shifts: [{ shiftKey: shifts.Morning.key, days: ['FRI'] }] }) });
    assert.equal(bad.body.failed, 1);
    assert.ok(bad.body.results[0].message);

    // The request is checked first.
    for (const wrong of [{ staff: [] }, { staff: 'everyone' }, { staff: ['x'] }, { staff: ids, onlyUnassigned: 'yes' }]) {
      assert.equal((await mA1('/api/manager/staff/assignments/bulk', { method: 'POST', body: body(wrong) })).status, 400, JSON.stringify(wrong));
    }
    // Another branch's Manager cannot touch these staff.
    const other = await mA2('/api/manager/staff/assignments/bulk', { method: 'POST', body: body({ staff: [made[2].id] }) });
    assert.equal(other.body.failed, 1);
  });
});

/*
 * Manager account tests (approved rules: docs/business-rules.md → Manager accounts). School Owners
 * create, edit, transfer, suspend, reactivate and reset Managers of their own school only; every
 * Manager has a branch of that school (several per branch allowed); transfers keep history and
 * apply at once; suspension and resets end sessions; a temporary password must be changed before
 * anything else, enforced by the API; passwords never appear in responses or audit events; failed
 * requests record nothing. Runs on the Neon dev branch (`npm test`); everything it creates is
 * removed afterwards.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { hashPassword, verifyPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Manager tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const accounts = {};
const cookies = {};
const schools = {};
const branches = {};
let server;
let base;

async function call(path, { method = 'GET', body, cookie, origin = ORIGIN } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(method !== 'GET' && { origin }),
      ...(cookie && { cookie }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const as = (who) => (path, options = {}) => call(path, { ...options, cookie: cookies[who] });
const ownerA = as('OWNER_A');
const ownerB = as('OWNER_B');
const ownerC = as('OWNER_C');
const admin = as('SUPER_ADMIN');
const withCookie = (cookie) => (path, options = {}) => call(path, { ...options, cookie });

const email = (name) => `test-mgr-${name}-${lower}@test.edutrack.example`;
const tempPassword = () => `Temp-${randomBytes(9).toString('base64url')}`;
const newPassword = () => `Chosen-${randomBytes(9).toString('base64url')}`;
const valid = (name, branchId, overrides = {}) => ({
  name: `Manager ${name} ${tag}`,
  email: email(name),
  phone: '+252 61 7654321',
  branchId,
  password: tempPassword(),
  ...overrides,
});
const managerEvents = (id) => prisma.auditEvent.findMany({ where: { targetId: id }, orderBy: { occurredAt: 'asc' } });
const schoolEventCount = (school) => prisma.auditEvent.count({ where: { schoolId: school.id } });
const signIn = (address, password) => call('/api/auth/login', { method: 'POST', body: { email: address, password } });

/** Creates a Manager through the API (owner A by default) → { manager, password }. */
async function createManager(name, branchKey, who = ownerA, overrides = {}) {
  const body = valid(name, branches[branchKey].id, overrides);
  const res = await who('/api/owner/managers', { method: 'POST', body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { manager: res.body.manager, password: body.password, email: body.email };
}

/** A Manager who has signed in and replaced the temporary password → { manager, password, email, cookie }. */
async function readyManager(name, branchKey, who = ownerA) {
  const created = await createManager(name, branchKey, who);
  const login = await signIn(created.email, created.password);
  assert.equal(login.status, 200);
  const chosen = newPassword();
  const change = await withCookie(login.cookie)('/api/auth/password', {
    method: 'POST',
    body: { currentPassword: created.password, newPassword: chosen },
  });
  assert.equal(change.status, 200, JSON.stringify(change.body));
  return { ...created, password: chosen, cookie: login.cookie };
}

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  for (const key of ['A', 'B', 'C']) {
    schools[key] = await prisma.school.create({
      data: { code: `M${tag}-${key}`, name: `Manager Test School ${key} ${tag}`, location: 'Mogadishu', phone: '+252 61 1234567', address: 'Test Road 1' },
    });
  }
  const branchRows = [
    ['A1', 'A', 1],
    ['A2', 'A', 2],
    ['A3', 'A', 3, 'SUSPENDED'],
    ['B1', 'B', 1],
    ['C1', 'C', 1],
  ];
  for (const [key, school, number, status = 'ACTIVE'] of branchRows) {
    branches[key] = await prisma.branch.create({
      data: {
        schoolId: schools[school].id,
        number,
        code: `${schools[school].code}-B00${number}`,
        name: `Branch ${key}`,
        nameKey: `branch ${key.toLowerCase()}`,
        address: 'Test Road 2',
        city: 'Mogadishu',
        status,
      },
    });
  }
  const people = [
    ['SUPER_ADMIN', 'SUPER_ADMIN'],
    ['OWNER_A', 'OWNER', 'A'],
    ['OWNER_B', 'OWNER', 'B'],
    ['OWNER_C', 'OWNER', 'C'],
    ['STAFF', 'STAFF'],
  ];
  for (const [key, role, school] of people) {
    const password = randomBytes(12).toString('base64url');
    const address = email(key.toLowerCase().replace('_', '-'));
    const user = await prisma.user.create({ data: { name: `Test ${key} ${tag}`, email: address, role, ...(await branchFor(role)), passwordHash: await hashPassword(password) } });
    if (school) await prisma.school.update({ where: { id: schools[school].id }, data: { ownerId: user.id } });
    accounts[key] = { id: user.id, name: user.name, role, email: address, password };
    const res = await signIn(address, password);
    assert.equal(res.status, 200, `${key} sign-in`);
    cookies[key] = res.cookie;
  }
});

after(async () => {
  const schoolIds = (await prisma.school.findMany({ where: { code: { startsWith: `M${tag}` } }, select: { id: true } })).map((s) => s.id);
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  const branchIds = (await prisma.branch.findMany({ where: { schoolId: { in: schoolIds } }, select: { id: true } })).map((b) => b.id);
  await prisma.auditEvent.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { actorId: { in: userIds } }, { targetId: { in: userIds } }] } });
  await prisma.managerAssignment.deleteMany({ where: { OR: [{ managerId: { in: userIds } }, { branchId: { in: branchIds } }] } });
  await prisma.user.deleteMany({ where: { id: { in: userIds }, role: 'MANAGER' } });
  await prisma.suspensionPeriod.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { branchId: { in: branchIds } }] } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
  await prisma.school.updateMany({ where: { id: { in: schoolIds } }, data: { ownerId: null } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await removeTestBranches();
  server.close();
  await prisma.$disconnect();
});

describe('access: School Owners only', () => {
  const id = randomUUID();
  const endpoints = () => [
    ['GET', '/api/owner/managers'],
    ['GET', `/api/owner/managers/${id}`],
    ['POST', '/api/owner/managers', valid('access', branches.A1.id)],
    ['PATCH', `/api/owner/managers/${id}`, { name: 'Changed Name' }],
    ['POST', `/api/owner/managers/${id}/transfer`, { branchId: branches.A2.id }],
    ['POST', `/api/owner/managers/${id}/suspend`, { reason: 'Testing access' }],
    ['POST', `/api/owner/managers/${id}/reactivate`],
    ['POST', `/api/owner/managers/${id}/password`, { password: tempPassword() }],
    ['GET', `/api/owner/audit-logs?manager=${id}`],
  ];

  test('signed out → 401', async () => {
    for (const [method, path, body] of endpoints()) assert.equal((await call(path, { method, body })).status, 401, `${method} ${path}`);
  });

  test('Super Admin, Staff and Managers → 403; nothing is created', async () => {
    const manager = await readyManager('access-mgr', 'A1');
    const before = await prisma.user.count({ where: { role: 'MANAGER' } });
    for (const who of [admin, as('STAFF'), withCookie(manager.cookie)]) {
      for (const [method, path, body] of endpoints()) assert.equal((await who(path, { method, body })).status, 403, `${method} ${path}`);
    }
    // A Manager cannot act on themselves either.
    const self = withCookie(manager.cookie);
    assert.equal((await self(`/api/owner/managers/${manager.manager.id}/transfer`, { method: 'POST', body: { branchId: branches.A2.id } })).status, 403);
    assert.equal((await self(`/api/owner/managers/${manager.manager.id}/reactivate`, { method: 'POST' })).status, 403);
    assert.equal(await prisma.user.count({ where: { role: 'MANAGER' } }), before);
  });

  test('requests from another origin are refused', async () => {
    const res = await call('/api/owner/managers', { method: 'POST', body: valid('origin', branches.A1.id), cookie: cookies.OWNER_A, origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    assert.equal(await prisma.user.count({ where: { email: email('origin') } }), 0);
  });
});

describe('creating Managers', () => {
  test('an owner creates a Manager in a branch of their school; the temporary password is only hashed', async () => {
    const body = valid('create', branches.A1.id);
    const res = await ownerA('/api/owner/managers', { method: 'POST', body });
    assert.equal(res.status, 201);
    const m = res.body.manager;
    assert.equal(m.name, body.name);
    assert.equal(m.email, body.email);
    assert.equal(m.status, 'active');
    assert.equal(m.passwordChangePending, true);
    assert.deepEqual(m.branch, { id: branches.A1.id, code: branches.A1.code, name: branches.A1.name, status: 'active' });
    assert.equal(m.assignments.length, 1);
    assert.equal(m.assignments[0].endedAt, null);
    // Never in the response…
    assert.ok(!res.text.includes(body.password));
    assert.ok(!res.text.includes('scrypt'));
    assert.equal(m.passwordHash, undefined);
    // …stored only as a hash.
    const row = await prisma.user.findUnique({ where: { id: m.id } });
    assert.equal(row.role, 'MANAGER');
    assert.equal(row.branchId, branches.A1.id);
    assert.equal(row.mustChangePassword, true);
    assert.match(row.passwordHash, /^scrypt\$/);
    assert.ok(await verifyPassword(body.password, row.passwordHash));
    // One event, without the password.
    const events = await managerEvents(m.id);
    assert.deepEqual(events.map((e) => e.action), ['MANAGER_CREATED']);
    assert.equal(events[0].schoolId, schools.A.id);
    assert.equal(events[0].actorId, accounts.OWNER_A.id);
    assert.equal(events[0].targetType, 'manager');
    assert.ok(!JSON.stringify(events[0]).includes(body.password));
    assert.deepEqual(events[0].change.fields.find((f) => f.field === 'Branch'), { field: 'Branch', from: null, to: `${branches.A1.name} (${branches.A1.code})` });
  });

  test('several Managers can share one branch, including a suspended branch', async () => {
    await createManager('share-1', 'A2');
    await createManager('share-2', 'A2');
    const res = await ownerA(`/api/owner/managers?branch=${branches.A2.id}&pageSize=100`);
    assert.equal(res.status, 200);
    assert.ok(res.body.items.filter((m) => m.email.startsWith('test-mgr-share-')).length === 2);
    assert.ok(res.body.items.every((m) => m.branch.id === branches.A2.id));
    const suspendedBranch = await createManager('suspended-branch', 'A3');
    assert.equal(suspendedBranch.manager.branch.status, 'suspended');
  });

  test('a branch of another school is refused like one that does not exist; nothing is created or recorded', async () => {
    const before = await schoolEventCount(schools.A);
    const beforeB = await schoolEventCount(schools.B);
    for (const branchId of [branches.B1.id, randomUUID()]) {
      const res = await ownerA('/api/owner/managers', { method: 'POST', body: valid('cross', branchId) });
      assert.equal(res.status, 400);
      assert.equal(res.body.details.branchId, 'Choose a branch of your school.');
    }
    assert.equal(await prisma.user.count({ where: { email: email('cross') } }), 0);
    assert.equal(await schoolEventCount(schools.A), before);
    assert.equal(await schoolEventCount(schools.B), beforeB);
  });

  test('field validation: every problem is reported; nothing is created', async () => {
    const res = await ownerA('/api/owner/managers', {
      method: 'POST',
      body: { name: 'X', email: 'not-an-email', phone: '12', branchId: 'nope', password: 'short' },
    });
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(res.body.details).sort(), ['branchId', 'email', 'name', 'password', 'phone']);
    assert.match(res.body.details.password, /at least 12/);
    const empty = await ownerA('/api/owner/managers', { method: 'POST', body: {} });
    assert.equal(empty.body.details.password, 'Enter a temporary password.');
    assert.equal(empty.body.details.branchId, 'Choose a branch.');
    const spaces = await ownerA('/api/owner/managers', { method: 'POST', body: valid('spaces', branches.A1.id, { password: ' '.repeat(14) }) });
    assert.equal(spaces.body.details.password, 'The password cannot be only spaces.');
    const long = await ownerA('/api/owner/managers', { method: 'POST', body: valid('long', branches.A1.id, { password: 'x'.repeat(129) }) });
    assert.match(long.body.details.password, /at most 128/);
    assert.equal(await prisma.user.count({ where: { email: { in: [email('spaces'), email('long')] } } }), 0);
  });

  test('role, school, status and other fields cannot be set (no privilege escalation)', async () => {
    for (const extra of [{ role: 'OWNER' }, { schoolId: schools.B.id }, { status: 'ACTIVE' }, { mustChangePassword: false }, { isAdmin: true }]) {
      const res = await ownerA('/api/owner/managers', { method: 'POST', body: valid('extra', branches.A1.id, extra) });
      assert.equal(res.status, 400, JSON.stringify(extra));
    }
    assert.equal(await prisma.user.count({ where: { email: email('extra') } }), 0);
  });

  test('an email already used by any account is refused (any capitalization) → 409', async () => {
    const res = await ownerA('/api/owner/managers', { method: 'POST', body: valid('dup', branches.A1.id, { email: accounts.OWNER_B.email.toUpperCase() }) });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'EMAIL_TAKEN');
  });

  test('the database requires a branch for every Manager, none for other roles, and one open assignment per Manager', async () => {
    await assert.rejects(prisma.user.create({ data: { name: 'No Branch', email: email('db-none'), role: 'MANAGER' } }));
    await assert.rejects(prisma.user.create({ data: { name: 'Owner Branch', email: email('db-owner'), role: 'OWNER', branchId: branches.A1.id } }));
    const { manager } = await createManager('db-open', 'A1');
    await assert.rejects(prisma.managerAssignment.create({ data: { managerId: manager.id, branchId: branches.A2.id } }));
  });
});

describe('school isolation', () => {
  test('another school\'s Manager is not found for any action; lists are limited to the owner\'s school', async () => {
    const { manager } = await createManager('isolated', 'A1');
    const id = manager.id;
    const before = (await managerEvents(id)).length;
    const attempts = [
      ['GET', `/api/owner/managers/${id}`],
      ['PATCH', `/api/owner/managers/${id}`, { name: 'Taken Over' }],
      ['POST', `/api/owner/managers/${id}/transfer`, { branchId: branches.B1.id }],
      ['POST', `/api/owner/managers/${id}/suspend`, { reason: 'Not mine' }],
      ['POST', `/api/owner/managers/${id}/reactivate`],
      ['POST', `/api/owner/managers/${id}/password`, { password: tempPassword() }],
    ];
    for (const [method, path, body] of attempts) assert.equal((await ownerB(path, { method, body })).status, 404, `${method} ${path}`);
    assert.equal((await managerEvents(id)).length, before);
    const row = await prisma.user.findUnique({ where: { id } });
    assert.equal(row.branchId, branches.A1.id);
    assert.equal(row.status, 'ACTIVE');

    const listB = await ownerB('/api/owner/managers?pageSize=100');
    assert.ok(listB.body.items.every((m) => m.branch.id === branches.B1.id));
    assert.deepEqual(listB.body.branches.map((b) => b.id), [branches.B1.id]);
    const audit = await ownerB(`/api/owner/audit-logs?manager=${id}`);
    assert.equal(audit.body.total, 0);
  });

  test('invalid ids → 404 (or 400 in filters)', async () => {
    for (const id of ['abc', '1 OR 1=1', accounts.OWNER_A.id, accounts.STAFF.id]) assert.equal((await ownerA(`/api/owner/managers/${encodeURIComponent(id)}`)).status, 404);
    assert.equal((await ownerA('/api/owner/managers?branch=nope')).status, 400);
    assert.equal((await ownerA('/api/owner/audit-logs?manager=nope')).status, 400);
  });
});

describe('first sign-in: the temporary password must be changed (server-side)', () => {
  let created;
  let temp;
  before(async () => {
    created = await createManager('first', 'A1');
    temp = await signIn(created.email, created.password);
  });

  test('sign-in succeeds and says a change is required', () => {
    assert.equal(temp.status, 200);
    assert.equal(temp.body.user.mustChangePassword, true);
    assert.equal(temp.body.user.role, 'MANAGER');
  });

  test('every other API request is refused with PASSWORD_CHANGE_REQUIRED; the session check and sign-out still work', async () => {
    const session = withCookie(temp.cookie);
    for (const path of ['/api/manager/branch', '/api/owner/managers', '/api/owner/branches', '/api/platform/schools']) {
      const res = await session(path);
      assert.equal(res.status, 403, path);
      assert.equal(res.body.code, 'PASSWORD_CHANGE_REQUIRED', path);
    }
    const check = await session('/api/auth/session');
    assert.equal(check.status, 200);
    assert.equal(check.body.user.mustChangePassword, true);
  });

  test('invalid changes are refused and record nothing', async () => {
    const session = withCookie(temp.cookie);
    const cases = [
      [{ currentPassword: 'wrong-password-123', newPassword: newPassword() }, 'currentPassword'],
      [{ currentPassword: created.password, newPassword: created.password }, 'newPassword'],
      [{ currentPassword: created.password, newPassword: 'short' }, 'newPassword'],
      [{ currentPassword: '', newPassword: newPassword() }, 'currentPassword'],
    ];
    for (const [body, field] of cases) {
      const res = await session('/api/auth/password', { method: 'POST', body });
      assert.equal(res.status, 400);
      assert.ok(res.body.details[field], field);
    }
    assert.equal((await session('/api/auth/password', { method: 'POST', body: { currentPassword: created.password, newPassword: newPassword(), role: 'OWNER' } })).status, 400);
    assert.equal(await prisma.auditEvent.count({ where: { action: 'PASSWORD_CHANGED', actorId: created.manager.id } }), 0);
    assert.equal((await prisma.user.findUnique({ where: { id: created.manager.id } })).mustChangePassword, true);
    resetLimiter();
  });

  test('the change works once: other sessions end, this one continues, the old password stops working', async () => {
    const second = await signIn(created.email, created.password);
    assert.equal(second.status, 200);
    const chosen = newPassword();
    const res = await withCookie(temp.cookie)('/api/auth/password', { method: 'POST', body: { currentPassword: created.password, newPassword: chosen } });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.mustChangePassword, false);
    assert.ok(!res.text.includes(chosen) && !res.text.includes(created.password));

    const branch = await withCookie(temp.cookie)('/api/manager/branch');
    assert.equal(branch.status, 200);
    assert.equal(branch.body.branch.id, branches.A1.id);
    assert.equal(branch.body.school.id, schools.A.id);
    assert.equal(branch.body.branch.operating, true);
    assert.equal((await withCookie(second.cookie)('/api/manager/branch')).status, 401);

    assert.equal((await signIn(created.email, created.password)).status, 401);
    const fresh = await signIn(created.email, chosen);
    assert.equal(fresh.status, 200);
    assert.equal(fresh.body.user.mustChangePassword, false);

    const events = await prisma.auditEvent.findMany({ where: { action: 'PASSWORD_CHANGED', actorId: created.manager.id } });
    assert.equal(events.length, 1);
    assert.equal(events[0].schoolId, schools.A.id);
    assert.ok(!JSON.stringify(events[0]).includes(chosen));
    // Not a general password change: once done, it is refused.
    const again = await withCookie(temp.cookie)('/api/auth/password', { method: 'POST', body: { currentPassword: chosen, newPassword: newPassword() } });
    assert.equal(again.status, 403);
  });

  test('accounts that do not have to change their password cannot use it', async () => {
    const res = await ownerA('/api/auth/password', { method: 'POST', body: { currentPassword: accounts.OWNER_A.password, newPassword: newPassword() } });
    assert.equal(res.status, 403);
    assert.equal((await call('/api/auth/password', { method: 'POST', body: {} })).status, 401);
  });

  test('wrong current passwords count towards the sign-in limiter', async () => {
    const { email: address, password } = await createManager('limit', 'A1');
    const login = await signIn(address, password);
    const session = withCookie(login.cookie);
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      statuses.push((await session('/api/auth/password', { method: 'POST', body: { currentPassword: `wrong-${i}-password`, newPassword: newPassword() } })).status);
    }
    assert.deepEqual(statuses, [400, 400, 400, 400, 400, 429]);
    resetLimiter();
  });
});

describe('transfers', () => {
  let ready;
  before(async () => {
    ready = await readyManager('transfer', 'A1');
  });

  test('moves the Manager within the school, keeps history and applies to the Manager\'s open session at once', async () => {
    const res = await ownerA(`/api/owner/managers/${ready.manager.id}/transfer`, { method: 'POST', body: { branchId: branches.A2.id } });
    assert.equal(res.status, 200);
    assert.equal(res.body.manager.branch.id, branches.A2.id);
    const [current, previous] = res.body.manager.assignments;
    assert.equal(current.branch.id, branches.A2.id);
    assert.equal(current.endedAt, null);
    assert.equal(previous.branch.id, branches.A1.id);
    assert.equal(previous.endedAt, current.startedAt);
    const events = await prisma.auditEvent.findMany({ where: { targetId: ready.manager.id, action: 'MANAGER_TRANSFERRED' } });
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].change, { field: 'Branch', from: `${branches.A1.name} (${branches.A1.code})`, to: `${branches.A2.name} (${branches.A2.code})` });
    const branch = await withCookie(ready.cookie)('/api/manager/branch');
    assert.equal(branch.status, 200);
    assert.equal(branch.body.branch.id, branches.A2.id);
  });

  test('the current branch, another school\'s branch and an unknown branch are refused; nothing changes', async () => {
    const before = await prisma.managerAssignment.count({ where: { managerId: ready.manager.id } });
    const eventsBefore = (await managerEvents(ready.manager.id)).length;
    const same = await ownerA(`/api/owner/managers/${ready.manager.id}/transfer`, { method: 'POST', body: { branchId: branches.A2.id } });
    assert.equal(same.status, 400);
    assert.match(same.body.details.branchId, /already assigned/);
    for (const branchId of [branches.B1.id, randomUUID()]) {
      const res = await ownerA(`/api/owner/managers/${ready.manager.id}/transfer`, { method: 'POST', body: { branchId } });
      assert.equal(res.status, 400);
      assert.equal(res.body.details.branchId, 'Choose a branch of your school.');
    }
    assert.equal((await ownerA(`/api/owner/managers/${ready.manager.id}/transfer`, { method: 'POST', body: { branchId: branches.A1.id, schoolId: schools.B.id } })).status, 400);
    assert.equal(await prisma.managerAssignment.count({ where: { managerId: ready.manager.id } }), before);
    assert.equal((await managerEvents(ready.manager.id)).length, eventsBefore);
    assert.equal((await prisma.user.findUnique({ where: { id: ready.manager.id } })).branchId, branches.A2.id);
  });

  test('editing cannot change the branch or password', async () => {
    for (const body of [{ branchId: branches.A1.id }, { password: tempPassword() }, { role: 'OWNER' }]) {
      const res = await ownerA(`/api/owner/managers/${ready.manager.id}`, { method: 'PATCH', body });
      assert.equal(res.status, 400, JSON.stringify(body));
    }
  });
});

describe('editing', () => {
  test('changed fields only, recorded by name; unchanged values record nothing; a taken email → 409', async () => {
    const { manager } = await createManager('edit', 'A1');
    const res = await ownerA(`/api/owner/managers/${manager.id}`, { method: 'PATCH', body: { name: `Renamed ${tag}`, phone: manager.phone } });
    assert.equal(res.status, 200);
    assert.equal(res.body.manager.name, `Renamed ${tag}`);
    let events = await prisma.auditEvent.findMany({ where: { targetId: manager.id, action: 'MANAGER_UPDATED' } });
    assert.equal(events.length, 1);
    assert.equal(events[0].description, 'Manager details updated: Full name.');
    await ownerA(`/api/owner/managers/${manager.id}`, { method: 'PATCH', body: { name: `Renamed ${tag}` } });
    events = await prisma.auditEvent.findMany({ where: { targetId: manager.id, action: 'MANAGER_UPDATED' } });
    assert.equal(events.length, 1);
    const taken = await ownerA(`/api/owner/managers/${manager.id}`, { method: 'PATCH', body: { email: accounts.STAFF.email } });
    assert.equal(taken.status, 409);
    assert.equal((await ownerA(`/api/owner/managers/${manager.id}`, { method: 'PATCH', body: {} })).status, 400);
  });
});

describe('suspension and reactivation', () => {
  let ready;
  before(async () => {
    ready = await readyManager('suspend', 'A1');
  });

  test('a reason is required; nothing changes without one', async () => {
    for (const body of [{}, { reason: '' }, { reason: 'no' }, { reason: 'x'.repeat(501) }]) {
      assert.equal((await ownerA(`/api/owner/managers/${ready.manager.id}/suspend`, { method: 'POST', body })).status, 400);
    }
    assert.equal((await prisma.user.findUnique({ where: { id: ready.manager.id } })).status, 'ACTIVE');
  });

  test('suspension ends sessions, blocks sign-in and Manager operations, and keeps the account and history', async () => {
    const reason = 'Left the branch for a month';
    const [first, second] = await Promise.all([
      ownerA(`/api/owner/managers/${ready.manager.id}/suspend`, { method: 'POST', body: { reason } }),
      ownerA(`/api/owner/managers/${ready.manager.id}/suspend`, { method: 'POST', body: { reason } }),
    ]);
    assert.deepEqual([first.status, second.status].sort(), [200, 409]);
    const ok = first.status === 200 ? first : second;
    assert.equal(ok.body.manager.status, 'suspended');
    assert.equal(ok.body.manager.suspensionReason, reason);

    assert.equal(await prisma.session.count({ where: { userId: ready.manager.id } }), 0);
    assert.equal((await withCookie(ready.cookie)('/api/manager/branch')).status, 401);
    assert.equal((await withCookie(ready.cookie)('/api/auth/session')).body.user, null);
    assert.equal((await signIn(ready.email, ready.password)).status, 401);

    const row = await prisma.user.findUnique({ where: { id: ready.manager.id } });
    assert.equal(row.branchId, branches.A1.id);
    assert.equal(await prisma.managerAssignment.count({ where: { managerId: ready.manager.id } }), 1);
    const events = await prisma.auditEvent.findMany({ where: { targetId: ready.manager.id, action: 'MANAGER_SUSPENDED' } });
    assert.equal(events.length, 1);
    assert.equal(events[0].change.reason, reason);
    assert.equal(await prisma.auditEvent.count({ where: { targetId: ready.manager.id, action: 'MANAGER_CREATED' } }), 1);
  });

  test('a session created before the suspension cannot be reused after reactivation; a new sign-in works', async () => {
    const res = await ownerA(`/api/owner/managers/${ready.manager.id}/reactivate`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal(res.body.manager.status, 'active');
    assert.equal(res.body.manager.suspensionReason, null);
    assert.equal((await withCookie(ready.cookie)('/api/manager/branch')).status, 401);
    const again = await signIn(ready.email, ready.password);
    assert.equal(again.status, 200);
    assert.equal((await withCookie(again.cookie)('/api/manager/branch')).status, 200);
    assert.equal((await ownerA(`/api/owner/managers/${ready.manager.id}/reactivate`, { method: 'POST' })).status, 409);
    assert.equal(await prisma.auditEvent.count({ where: { targetId: ready.manager.id, action: 'MANAGER_REACTIVATED' } }), 1);
  });

  test('a suspended Manager can be transferred and stays suspended', async () => {
    const { manager } = await createManager('suspended-move', 'A1');
    await ownerA(`/api/owner/managers/${manager.id}/suspend`, { method: 'POST', body: { reason: 'On leave' } });
    const res = await ownerA(`/api/owner/managers/${manager.id}/transfer`, { method: 'POST', body: { branchId: branches.A2.id } });
    assert.equal(res.status, 200);
    assert.equal(res.body.manager.status, 'suspended');
  });
});

describe('new temporary password (reset)', () => {
  test('ends sessions, requires a change at next sign-in, and records a security event without the password', async () => {
    const ready = await readyManager('reset', 'A1');
    const fresh = tempPassword();
    const short = await ownerA(`/api/owner/managers/${ready.manager.id}/password`, { method: 'POST', body: { password: 'short' } });
    assert.equal(short.status, 400);
    assert.equal(await prisma.auditEvent.count({ where: { targetId: ready.manager.id, action: 'MANAGER_PASSWORD_RESET' } }), 0);

    const res = await ownerA(`/api/owner/managers/${ready.manager.id}/password`, { method: 'POST', body: { password: fresh } });
    assert.equal(res.status, 200);
    assert.equal(res.body.manager.passwordChangePending, true);
    assert.ok(!res.text.includes(fresh));
    assert.equal((await withCookie(ready.cookie)('/api/manager/branch')).status, 401);
    assert.equal((await signIn(ready.email, ready.password)).status, 401);
    const login = await signIn(ready.email, fresh);
    assert.equal(login.status, 200);
    assert.equal(login.body.user.mustChangePassword, true);
    assert.equal((await withCookie(login.cookie)('/api/manager/branch')).body.code, 'PASSWORD_CHANGE_REQUIRED');

    const events = await prisma.auditEvent.findMany({ where: { targetId: ready.manager.id, action: 'MANAGER_PASSWORD_RESET' } });
    assert.equal(events.length, 1);
    assert.ok(!JSON.stringify(events[0]).includes(fresh));
    const summary = await admin(`/api/platform/audit-logs?action=MANAGER_PASSWORD_RESET&school=${schools.A.id}`);
    assert.equal(summary.status, 200);
    assert.ok(summary.body.total >= 1);
  });

  test('a suspended Manager can be given one and stays suspended', async () => {
    const { manager } = await createManager('reset-suspended', 'A1');
    await ownerA(`/api/owner/managers/${manager.id}/suspend`, { method: 'POST', body: { reason: 'On leave' } });
    const res = await ownerA(`/api/owner/managers/${manager.id}/password`, { method: 'POST', body: { password: tempPassword() } });
    assert.equal(res.status, 200);
    assert.equal(res.body.manager.status, 'suspended');
  });
});

describe('suspended school: read only', () => {
  test('the owner can read Managers but every change is refused (409) and nothing is recorded', async () => {
    const { manager } = await createManager('school-c', 'C1', ownerC);
    await prisma.school.update({ where: { id: schools.C.id }, data: { status: 'SUSPENDED' } });
    try {
      const before = await schoolEventCount(schools.C);
      assert.equal((await ownerC('/api/owner/managers')).status, 200);
      assert.equal((await ownerC(`/api/owner/managers/${manager.id}`)).status, 200);
      const writes = [
        ['POST', '/api/owner/managers', valid('school-c-2', branches.C1.id)],
        ['PATCH', `/api/owner/managers/${manager.id}`, { name: 'Changed While Suspended' }],
        ['POST', `/api/owner/managers/${manager.id}/suspend`, { reason: 'School suspended' }],
        ['POST', `/api/owner/managers/${manager.id}/reactivate`],
        ['POST', `/api/owner/managers/${manager.id}/password`, { password: tempPassword() }],
      ];
      for (const [method, path, body] of writes) {
        const res = await ownerC(path, { method, body });
        assert.equal(res.status, 409, `${method} ${path}`);
        assert.equal(res.body.code, 'SCHOOL_SUSPENDED');
      }
      assert.equal(await schoolEventCount(schools.C), before);
      assert.equal(await prisma.user.count({ where: { email: email('school-c-2') } }), 0);
    } finally {
      await prisma.school.update({ where: { id: schools.C.id }, data: { status: 'ACTIVE' } });
    }
  });
});

describe('Manager API', () => {
  test('a Manager reads their own branch, shown as not operating when the branch is suspended', async () => {
    const ready = await readyManager('api', 'A3');
    const res = await withCookie(ready.cookie)('/api/manager/branch');
    assert.equal(res.status, 200);
    assert.equal(res.body.branch.code, branches.A3.code);
    assert.equal(res.body.branch.operating, false);
    assert.deepEqual(res.body.branch.notOperatingReasons, ['branch_suspended']);
  });

  test('other roles cannot use it', async () => {
    for (const who of ['OWNER_A', 'SUPER_ADMIN', 'STAFF']) assert.equal((await as(who)('/api/manager/branch')).status, 403, who);
    assert.equal((await call('/api/manager/branch')).status, 401);
  });
});

describe('audit access', () => {
  test('owners see their own Managers\' events without network or browser details', async () => {
    const { manager } = await createManager('audit', 'A1');
    await ownerA(`/api/owner/managers/${manager.id}/transfer`, { method: 'POST', body: { branchId: branches.A2.id } });
    const res = await ownerA(`/api/owner/audit-logs?manager=${manager.id}&pageSize=100`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items.map((e) => e.action), ['MANAGER_TRANSFERRED', 'MANAGER_CREATED']);
    for (const event of res.body.items) {
      assert.equal(event.ipAddress, undefined);
      assert.equal(event.target.id, manager.id);
    }
    assert.equal((await ownerA(`/api/owner/audit-logs?manager=${manager.id}&branch=${branches.A1.id}`)).status, 400);
    // Branch events stay separate.
    const branchEvents = await ownerA('/api/owner/audit-logs?pageSize=100');
    assert.ok(branchEvents.body.items.every((e) => e.action.startsWith('BRANCH_')));
  });

  test('Super Admins see Manager events (with the school); the dashboard leaves them out', async () => {
    const res = await admin(`/api/platform/audit-logs?action=MANAGER_CREATED&school=${schools.A.id}&pageSize=100`);
    assert.equal(res.status, 200);
    assert.ok(res.body.total > 0);
    assert.equal(res.body.items[0].target.type, 'manager');
    assert.equal(res.body.items[0].target.schoolName, schools.A.name);
    const dashboard = await admin('/api/platform/dashboard');
    assert.ok(dashboard.body.recentActivity.every((e) => !e.type.startsWith('MANAGER_') && e.type !== 'PASSWORD_CHANGED'));
  });

  test('Manager sign-ins are linked to their school', async () => {
    const event = await prisma.auditEvent.findFirst({ where: { action: 'SIGN_IN', actorRole: 'MANAGER', schoolId: schools.A.id } });
    assert.ok(event);
  });
});

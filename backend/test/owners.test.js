/*
 * School Owner Management tests (approved rules): add, edit, suspend, reactivate — SUPER_ADMIN
 * only; one school ↔ one owner; owner accounts ACTIVE ⇄ SUSPENDED; the school and role cannot be
 * changed by editing; suspension ends the owner's sessions; no deletion, transfer or approval;
 * audit events only after successful changes. Runs on the Neon dev branch (`npm test`); every
 * school, account, session and audit event it creates is removed afterwards.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Owner tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const accounts = {};
const cookies = {};
const schools = {};
let server;
let base;

async function call(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(method !== 'GET' && { origin: ORIGIN }),
      ...(cookie && { cookie }),
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const admin = (path, options = {}) => call(path, { ...options, cookie: cookies.SUPER_ADMIN });
const signIn = (email, password) => call('/api/auth/login', { method: 'POST', body: { email, password } });

const PASSWORD = `Initial-${randomBytes(9).toString('base64url')}`;
const emailFor = (name) => `test-om-${name}-${lower}@test.edutrack.example`;
const validOwner = (schoolId, overrides = {}) => ({
  name: `Test Owner ${tag}`,
  email: emailFor('owner'),
  phone: '+252 61 7654321',
  schoolId,
  password: PASSWORD,
  ...overrides,
});
const ownersByEmail = (email) => prisma.user.findMany({ where: { email: email.toLowerCase() } });
const auditOf = (ownerId) => prisma.auditEvent.findMany({ where: { targetType: 'owner', targetId: ownerId }, orderBy: { occurredAt: 'asc' } });
const newSchool = (key) =>
  prisma.school.create({ data: { code: `T${tag}-${key}`, name: `Owner Test School ${key} ${tag}`, location: 'Hargeisa', phone: '+252 63 1234567', address: 'Test Road 1' } });

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  for (const role of ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'STAFF']) {
    const password = randomBytes(12).toString('base64url');
    const email = emailFor(`role-${role.toLowerCase()}`);
    const user = await prisma.user.create({ data: { name: `Test ${role} ${tag}`, email, role, ...(await branchFor(role)), passwordHash: await hashPassword(password) } });
    accounts[role] = { id: user.id, email };
    const res = await signIn(email, password);
    assert.equal(res.status, 200, `${role} sign-in`);
    cookies[role] = res.cookie;
  }
  for (const key of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) schools[key] = await newSchool(key);
});

after(async () => {
  const schoolRows = await prisma.school.findMany({ where: { code: { startsWith: `T${tag}` } }, select: { id: true } });
  const schoolIds = schoolRows.map((s) => s.id);
  const users = await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  await prisma.auditEvent.deleteMany({
    where: { OR: [{ schoolId: { in: schoolIds } }, { actorId: { in: userIds } }, { targetId: { in: userIds } }] },
  });
  await prisma.suspensionPeriod.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }] } });
  await prisma.school.updateMany({ where: { id: { in: schoolIds } }, data: { ownerId: null } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await removeTestBranches();
  server.close();
  await prisma.$disconnect();
});

describe('authorization on every Owner Management endpoint', () => {
  const id = randomUUID();
  const endpoints = [
    ['GET', '/api/platform/owners'],
    ['GET', `/api/platform/owners/${id}`],
    ['POST', '/api/platform/owners', {}],
    ['PATCH', `/api/platform/owners/${id}`, { name: 'Changed' }],
    ['POST', `/api/platform/owners/${id}/suspend`, { reason: 'Testing access' }],
    ['POST', `/api/platform/owners/${id}/reactivate`, {}],
  ];

  test('unauthenticated → 401', async () => {
    for (const [method, path, body] of endpoints) assert.equal((await call(path, { method, body })).status, 401, `${method} ${path}`);
  });

  for (const role of ['OWNER', 'MANAGER', 'STAFF']) {
    test(`${role} → 403`, async () => {
      for (const [method, path, body] of endpoints) {
        const res = await call(path, { method, body, cookie: cookies[role] });
        assert.equal(res.status, 403, `${role} ${method} ${path}`);
        assert.equal(res.body.code, 'FORBIDDEN');
      }
    });
  }

  test('SUPER_ADMIN → allowed (validated; unknown ids → 404)', async () => {
    const statuses = [];
    for (const [method, path, body] of endpoints) statuses.push((await admin(path, { method, body })).status);
    // list 200; unknown id 404; empty body 400 (validation); unknown id 404 for edit, suspend, reactivate
    assert.deepEqual(statuses, [200, 404, 400, 404, 404, 404]);
  });

  test('a denied request changes nothing (an owner cannot add an owner)', async () => {
    const email = emailFor('denied');
    for (const role of ['OWNER', 'MANAGER', 'STAFF']) {
      const res = await call('/api/platform/owners', { method: 'POST', body: validOwner(schools.G.id, { email }), cookie: cookies[role] });
      assert.equal(res.status, 403);
    }
    assert.equal((await ownersByEmail(email)).length, 0);
    assert.equal((await prisma.school.findUnique({ where: { id: schools.G.id } })).ownerId, null);
  });
});

describe('Add Owner', () => {
  test('valid creation: ACTIVE OWNER account assigned to the school; password only stored as a hash', async () => {
    const res = await admin('/api/platform/owners', { method: 'POST', body: validOwner(schools.A.id, { email: emailFor('Alpha').toUpperCase(), name: '  Amina   Test  ' }) });
    assert.equal(res.status, 201);
    const owner = res.body.owner;
    assert.equal(owner.name, 'Amina Test', 'whitespace is collapsed');
    assert.equal(owner.email, emailFor('alpha'), 'email is stored lower-case');
    assert.equal(owner.status, 'active');
    assert.deepEqual([owner.school.id, owner.school.code, owner.school.location], [schools.A.id, schools.A.code, 'Hargeisa']);
    assert.ok(!JSON.stringify(res.body).includes(PASSWORD) && !/passwordHash|scrypt/.test(JSON.stringify(res.body)), 'no password in the response');

    const user = await prisma.user.findUnique({ where: { id: owner.id } });
    assert.equal(user.role, 'OWNER');
    assert.ok(user.passwordHash.startsWith('scrypt$') && !user.passwordHash.includes(PASSWORD));
    assert.equal((await prisma.school.findUnique({ where: { id: schools.A.id } })).ownerId, owner.id);

    const [event] = await auditOf(owner.id);
    assert.equal(event.action, 'OWNER_CREATED');
    assert.equal(event.schoolId, schools.A.id);
    assert.equal(event.actorId, accounts.SUPER_ADMIN.id);
    assert.ok(!JSON.stringify(event).includes(PASSWORD));
  });

  test('the new owner signs in with the initial password (OWNER scope: no platform access)', async () => {
    const res = await signIn(emailFor('alpha'), PASSWORD);
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'OWNER');
    assert.equal((await call('/api/platform/owners', { cookie: res.cookie })).status, 403);
  });

  test('missing fields → 400 with a message for each', async () => {
    const res = await admin('/api/platform/owners', { method: 'POST', body: {} });
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(res.body.details).sort(), ['email', 'name', 'password', 'phone', 'schoolId']);
    const blanks = await admin('/api/platform/owners', { method: 'POST', body: { name: '   ', email: ' ', phone: '\t', schoolId: '', password: '' } });
    assert.deepEqual(Object.keys(blanks.body.details).sort(), ['email', 'name', 'password', 'phone', 'schoolId']);
  });

  test('invalid fields → 400; nothing is created', async () => {
    const cases = [
      [{ email: 'not-an-email' }, 'email'],
      [{ phone: '12ab' }, 'phone'],
      [{ phone: '+252 61' }, 'phone'],
      [{ name: 'A' }, 'name'],
      [{ name: 'x'.repeat(121) }, 'name'],
      [{ email: `${'a'.repeat(250)}@x.so` }, 'email'],
      [{ password: 'short' }, 'password'],
      [{ password: ' '.repeat(14) }, 'password'],
      [{ password: 'x'.repeat(129) }, 'password'],
      [{ schoolId: 'school-1' }, 'schoolId'],
      [{ schoolId: "1' OR '1'='1" }, 'schoolId'],
      [{ name: 42 }, 'name'],
      [{ role: 'SUPER_ADMIN' }, 'role'],
      [{ status: 'SUSPENDED' }, 'status'],
    ];
    for (const [override, field] of cases) {
      const res = await admin('/api/platform/owners', { method: 'POST', body: validOwner(schools.B.id, { email: emailFor('invalid'), ...override }) });
      assert.equal(res.status, 400, JSON.stringify(override));
      assert.ok(res.body.details?.[field], `${field} reported for ${JSON.stringify(override)}`);
    }
    assert.equal((await admin('/api/platform/owners', { method: 'POST', body: validOwner(schools.B.id, { email: emailFor('invalid'), isAdmin: true }) })).status, 400, 'unknown fields');
    assert.equal((await admin('/api/platform/owners', { method: 'POST', body: '{"name":' })).status, 400, 'malformed JSON');
    assert.equal((await ownersByEmail(emailFor('invalid'))).length, 0);
    assert.equal((await prisma.school.findUnique({ where: { id: schools.B.id } })).ownerId, null);
  });

  test('a school that does not exist → 400; no account is created', async () => {
    const res = await admin('/api/platform/owners', { method: 'POST', body: validOwner(randomUUID(), { email: emailFor('ghost') }) });
    assert.equal(res.status, 400);
    assert.ok(res.body.details.schoolId);
    assert.equal((await ownersByEmail(emailFor('ghost'))).length, 0);
  });

  test('a school that already has an owner → 409 SCHOOL_HAS_OWNER; the owner is not replaced', async () => {
    const before = await prisma.school.findUnique({ where: { id: schools.A.id } });
    const res = await admin('/api/platform/owners', { method: 'POST', body: validOwner(schools.A.id, { email: emailFor('second') }) });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'SCHOOL_HAS_OWNER');
    assert.ok(res.body.details.schoolId);
    assert.equal((await prisma.school.findUnique({ where: { id: schools.A.id } })).ownerId, before.ownerId);
    assert.equal((await ownersByEmail(emailFor('second'))).length, 0, 'no orphaned account');
  });

  test('an email already in use (any account, any case) → 409 EMAIL_TAKEN; the school stays without an owner', async () => {
    for (const email of [emailFor('alpha'), emailFor('alpha').toUpperCase(), accounts.SUPER_ADMIN.email]) {
      const res = await admin('/api/platform/owners', { method: 'POST', body: validOwner(schools.B.id, { email }) });
      assert.equal(res.status, 409, email);
      assert.equal(res.body.code, 'EMAIL_TAKEN');
      assert.ok(res.body.details.email);
    }
    assert.equal((await prisma.school.findUnique({ where: { id: schools.B.id } })).ownerId, null);
  });

  test('transactional: simultaneous requests for one school → exactly one owner, no orphaned accounts', async () => {
    const emails = [1, 2, 3].map((n) => emailFor(`race${n}`));
    const results = await Promise.all(emails.map((email) => admin('/api/platform/owners', { method: 'POST', body: validOwner(schools.C.id, { email }) })));
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
    const created = await prisma.user.findMany({ where: { email: { in: emails } } });
    assert.equal(created.length, 1, 'the losing requests left no account behind');
    assert.equal((await prisma.school.findUnique({ where: { id: schools.C.id } })).ownerId, created[0].id);
    const events = await prisma.auditEvent.findMany({ where: { action: 'OWNER_CREATED', schoolId: schools.C.id } });
    assert.equal(events.length, 1, 'one audit event, for the success only');
  });

  test('transactional: one email for two schools at once → one account; the other school stays without an owner', async () => {
    const email = emailFor('twice');
    const results = await Promise.all([schools.D, schools.E].map((s) => admin('/api/platform/owners', { method: 'POST', body: validOwner(s.id, { email }) })));
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
    const owned = await prisma.school.findMany({ where: { id: { in: [schools.D.id, schools.E.id] }, ownerId: { not: null } } });
    assert.equal(owned.length, 1);
    assert.equal((await ownersByEmail(email)).length, 1);
  });

  test('schools without an owner can be listed for the form (owner=none)', async () => {
    const res = await admin(`/api/platform/schools?owner=none&q=${encodeURIComponent(`Owner Test School`)}&pageSize=100`);
    const codes = res.body.items.filter((s) => s.code.startsWith(`T${tag}`)).map((s) => s.code);
    assert.ok(codes.includes(schools.B.code) && !codes.includes(schools.A.code) && !codes.includes(schools.C.code));
    assert.ok(res.body.items.every((s) => s.ownerId === null));
  });
});

describe('Edit Owner', () => {
  let owner;
  before(async () => {
    owner = (await admin('/api/platform/owners', { method: 'POST', body: validOwner(schools.F.id, { email: emailFor('edit') }) })).body.owner;
  });

  test('valid edit: name, email and phone; audit lists field names only', async () => {
    const res = await admin(`/api/platform/owners/${owner.id}`, { method: 'PATCH', body: { name: 'Edited Owner', email: emailFor('edited'), phone: '+252 61 1112223' } });
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.owner.name, res.body.owner.email, res.body.owner.phone], ['Edited Owner', emailFor('edited'), '+252 61 1112223']);
    assert.equal(res.body.owner.school.id, schools.F.id, 'the school is unchanged');
    const event = (await auditOf(owner.id)).at(-1);
    assert.equal(event.action, 'OWNER_UPDATED');
    assert.equal(event.description, 'School owner details updated: name, email, phone.');
    assert.ok(!JSON.stringify(event).includes('1112223'), 'values are not copied into the audit log');
    assert.equal((await signIn(emailFor('edited'), PASSWORD)).status, 200, 'the owner signs in with the new email');
  });

  test('no change → 200 and no audit event', async () => {
    const count = (await auditOf(owner.id)).length;
    assert.equal((await admin(`/api/platform/owners/${owner.id}`, { method: 'PATCH', body: { name: 'Edited Owner' } })).status, 200);
    assert.equal((await auditOf(owner.id)).length, count);
  });

  test('invalid edit → 400; nothing changes', async () => {
    for (const body of [{}, { name: '' }, { email: 'nope' }, { phone: 'call me' }, { name: null }]) {
      assert.equal((await admin(`/api/platform/owners/${owner.id}`, { method: 'PATCH', body })).status, 400, JSON.stringify(body));
    }
    assert.equal((await prisma.user.findUnique({ where: { id: owner.id } })).name, 'Edited Owner');
  });

  test('an email used by another account → 409 EMAIL_TAKEN', async () => {
    const res = await admin(`/api/platform/owners/${owner.id}`, { method: 'PATCH', body: { email: emailFor('alpha') } });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'EMAIL_TAKEN');
  });

  test('the school, role, status and password cannot be changed by editing', async () => {
    for (const [field, value] of [['schoolId', schools.G.id], ['role', 'SUPER_ADMIN'], ['status', 'ACTIVE'], ['password', 'A-new-password-123']]) {
      const res = await admin(`/api/platform/owners/${owner.id}`, { method: 'PATCH', body: { name: 'Edited Owner', [field]: value } });
      assert.equal(res.status, 400, field);
      assert.ok(res.body.details[field], field);
    }
    const user = await prisma.user.findUnique({ where: { id: owner.id }, include: { ownedSchool: true } });
    assert.deepEqual([user.role, user.ownedSchool.id], ['OWNER', schools.F.id]);
    assert.equal((await prisma.school.findUnique({ where: { id: schools.G.id } })).ownerId, null);
    for (const path of [`/api/platform/owners/${owner.id}/school`, `/api/platform/owners/${owner.id}/transfer`]) {
      assert.equal((await admin(path, { method: path.endsWith('school') ? 'PATCH' : 'POST', body: { schoolId: schools.G.id } })).status, 404, path);
    }
  });

  test('unknown or non-owner ids → 404 (IDOR): nothing changes', async () => {
    for (const id of [randomUUID(), 'abc', '1 OR 1=1', accounts.SUPER_ADMIN.id, accounts.MANAGER.id, schools.F.id]) {
      for (const [method, suffix, body] of [['GET', ''], ['PATCH', '', { name: 'Hijacked' }], ['POST', '/suspend', { reason: 'Hijack attempt' }], ['POST', '/reactivate', {}]]) {
        assert.equal((await admin(`/api/platform/owners/${encodeURIComponent(id)}${suffix}`, { method, body })).status, 404, `${method} ${id}${suffix}`);
      }
    }
    const adminUser = await prisma.user.findUnique({ where: { id: accounts.SUPER_ADMIN.id } });
    assert.deepEqual([adminUser.name, adminUser.status, adminUser.role], [`Test SUPER_ADMIN ${tag}`, 'ACTIVE', 'SUPER_ADMIN']);
  });
});

describe('Suspend and Reactivate Owner', () => {
  let owner;
  let session;
  before(async () => {
    resetLimiter();
    owner = (await admin('/api/platform/owners', { method: 'POST', body: validOwner(schools.G.id, { email: emailFor('status') }) })).body.owner;
    session = (await signIn(emailFor('status'), PASSWORD)).cookie;
    assert.equal((await call('/api/auth/session', { cookie: session })).body.user.id, owner.id);
  });

  test('a reason is required (3–500 characters)', async () => {
    for (const body of [{}, { reason: '' }, { reason: '    ' }, { reason: 'no' }, { reason: 'x'.repeat(501) }, { reason: 5 }]) {
      const res = await admin(`/api/platform/owners/${owner.id}/suspend`, { method: 'POST', body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.ok(res.body.details?.reason);
    }
    assert.equal((await admin(`/api/platform/owners/${owner.id}/suspend`, { method: 'POST', body: { reason: 'Fine', until: 'never' } })).status, 400, 'unknown fields');
    assert.equal((await prisma.user.findUnique({ where: { id: owner.id } })).status, 'ACTIVE');
  });

  test('an active owner cannot be reactivated → 409 INVALID_STATUS', async () => {
    const res = await admin(`/api/platform/owners/${owner.id}/reactivate`, { method: 'POST' });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'INVALID_STATUS');
  });

  test('suspend: SUSPENDED with the reason; sessions end; sign-in refused; the school is unchanged', async () => {
    const res = await admin(`/api/platform/owners/${owner.id}/suspend`, { method: 'POST', body: { reason: '  Unpaid   subscription  ' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.owner.status, 'suspended');
    assert.equal(res.body.owner.suspensionReason, 'Unpaid subscription');
    assert.ok(res.body.owner.suspendedAt);
    assert.equal(res.body.owner.school.status, 'active', 'the school keeps its status');

    assert.equal((await call('/api/auth/session', { cookie: session })).body.user, null, 'the existing session no longer works');
    assert.equal(await prisma.session.count({ where: { userId: owner.id } }), 0);
    assert.equal((await signIn(emailFor('status'), PASSWORD)).status, 401, 'a suspended owner cannot sign in');
    assert.equal((await prisma.school.findUnique({ where: { id: schools.G.id } })).status, 'ACTIVE');

    const event = (await auditOf(owner.id)).at(-1);
    assert.equal(event.action, 'OWNER_SUSPENDED');
    assert.equal(event.description, 'School owner account suspended. Reason: Unpaid subscription');
    assert.deepEqual(event.change, { field: 'Status', from: 'Active', to: 'Suspended' });
    assert.equal(event.schoolId, schools.G.id);
  });

  test('already suspended → 409 INVALID_STATUS; no extra audit event', async () => {
    const count = (await auditOf(owner.id)).length;
    const res = await admin(`/api/platform/owners/${owner.id}/suspend`, { method: 'POST', body: { reason: 'Again' } });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'INVALID_STATUS');
    assert.equal((await auditOf(owner.id)).length, count);
  });

  test('reactivate: ACTIVE again, reason cleared; the old session stays ended; sign-in works', async () => {
    const res = await admin(`/api/platform/owners/${owner.id}/reactivate`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal(res.body.owner.status, 'active');
    assert.equal(res.body.owner.suspensionReason, null);
    assert.equal(res.body.owner.suspendedAt, null);
    assert.equal((await call('/api/auth/session', { cookie: session })).body.user, null, 'a session from before the suspension is not revived');
    const again = await signIn(emailFor('status'), PASSWORD);
    assert.equal(again.status, 200);
    assert.equal((await call('/api/auth/session', { cookie: again.cookie })).body.user.id, owner.id);
    const event = (await auditOf(owner.id)).at(-1);
    assert.equal(event.action, 'OWNER_REACTIVATED');
    assert.deepEqual(event.change, { field: 'Status', from: 'Suspended', to: 'Active' });
  });

  test('simultaneous suspensions → exactly one succeeds', async () => {
    const results = await Promise.all([1, 2, 3].map((n) => admin(`/api/platform/owners/${owner.id}/suspend`, { method: 'POST', body: { reason: `Race ${n}` } })));
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409]);
    assert.equal((await prisma.auditEvent.findMany({ where: { action: 'OWNER_SUSPENDED', targetId: owner.id } })).length, 2);
    await admin(`/api/platform/owners/${owner.id}/reactivate`, { method: 'POST' });
  });

  test('school and owner statuses are separate: suspending the school leaves the owner active', async () => {
    assert.equal((await admin(`/api/platform/schools/${schools.G.id}/suspend`, { method: 'POST', body: { reason: 'Separate lifecycle test' } })).status, 200);
    assert.equal((await prisma.user.findUnique({ where: { id: owner.id } })).status, 'ACTIVE');
    assert.equal((await admin(`/api/platform/owners/${owner.id}/suspend`, { method: 'POST', body: { reason: 'Separate lifecycle test' } })).status, 200);
    assert.equal((await admin(`/api/platform/schools/${schools.G.id}/reactivate`, { method: 'POST' })).status, 200);
    assert.equal((await prisma.user.findUnique({ where: { id: owner.id } })).status, 'SUSPENDED', 'reactivating the school does not reactivate the owner');
  });
});

describe('no deletion; audit safety; counts', () => {
  test('no delete, transfer, approval or rejection endpoint', async () => {
    const owner = (await prisma.user.findFirst({ where: { email: emailFor('alpha') } })).id;
    for (const [method, path] of [
      ['DELETE', `/api/platform/owners/${owner}`],
      ['POST', `/api/platform/owners/${owner}/delete`],
      ['POST', `/api/platform/owners/${owner}/approve`],
      ['POST', `/api/platform/owners/${owner}/reject`],
      ['POST', `/api/platform/owners/${owner}/transfer`],
      ['PUT', `/api/platform/owners/${owner}`],
    ]) {
      assert.equal((await admin(path, { method, body: {} })).status, 404, `${method} ${path}`);
    }
    assert.ok(await prisma.user.findUnique({ where: { id: owner } }), 'the owner still exists');
  });

  test('audit events of these tests contain no passwords, hashes, tokens or secrets', async () => {
    const owners = await prisma.user.findMany({ where: { role: 'OWNER', email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } });
    const events = await prisma.auditEvent.findMany({ where: { targetId: { in: owners.map((o) => o.id) } } });
    assert.ok(events.length >= 8);
    assert.ok(events.every((e) => e.result === 'SUCCESS' && e.targetType === 'owner'));
    const text = JSON.stringify(events);
    assert.ok(!text.includes(PASSWORD) && !/scrypt\$|tokenHash|passwordHash|edutrack_session|DATABASE_URL|postgres(ql)?:\/\//.test(text));
  });

  test('summary: total, active and suspended owners from the database (no pending)', async () => {
    const { summary } = (await admin('/api/platform/owners')).body;
    const [active, suspended] = await Promise.all(['ACTIVE', 'SUSPENDED'].map((status) => prisma.user.count({ where: { role: 'OWNER', status } })));
    assert.deepEqual(summary, { total: active + suspended, active, suspended });
    const filtered = (await admin(`/api/platform/owners?status=suspended&q=${lower}`)).body;
    assert.ok(filtered.items.length >= 1 && filtered.items.every((o) => o.status === 'suspended'));
  });
});

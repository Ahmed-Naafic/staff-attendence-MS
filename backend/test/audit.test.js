/*
 * Audit logging tests (approved rules): every School and Owner Management action records one
 * SUCCESS event with the signed-in actor (from the session, never the request), the action, the
 * target, the change and a server timestamp; failed requests record nothing; if the audit write
 * fails, the action is rolled back (no success without its event); audit records cannot be
 * changed or deleted through the API; only SUPER_ADMIN can read them; no credentials are stored
 * or returned. Runs on the Neon dev branch (`npm test`); everything it creates is removed.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { suspendOwner } from '../src/features/school-owners/owners.service.js';
import { registerSchool } from '../src/features/schools/schools.service.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Audit tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const accounts = {};
const cookies = {};
const OWNER_PASSWORD = `Initial-${randomBytes(9).toString('base64url')}`;
let server;
let base;

async function call(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(method !== 'GET' && { origin: ORIGIN }),
      ...(cookie && { cookie }),
      'user-agent': `EduTrackAuditTest/${tag}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const admin = (path, options = {}) => call(path, { ...options, cookie: cookies.SUPER_ADMIN });
const dbNow = async () => (await prisma.$queryRaw`SELECT now() AS t`)[0].t;
const emailFor = (name) => `test-audit-${name}-${lower}@test.edutrack.example`;
const schoolBody = (key) => ({ name: `Audit Test ${key} ${tag}`, code: `AU${tag}-${key}`, phone: '+252 61 2345678', address: 'Test Road 1', city: 'Garowe' });
const eventsFor = (where) => prisma.auditEvent.findMany({ where, orderBy: { occurredAt: 'asc' } });
const ownedBy = () => ({ OR: [{ actorId: { in: Object.values(accounts).map((a) => a.id) } }, { targetName: { contains: tag } }] });

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  for (const role of ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'STAFF']) {
    const password = randomBytes(12).toString('base64url');
    const email = emailFor(`role-${role.toLowerCase()}`);
    const user = await prisma.user.create({ data: { name: `Audit ${role} ${tag}`, email, role, ...(await branchFor(role)), passwordHash: await hashPassword(password) } });
    accounts[role] = user;
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(res.status, 200, `${role} sign-in`);
    cookies[role] = res.headers.get('set-cookie').split(';')[0];
  }
});

after(async () => {
  const schools = await prisma.school.findMany({ where: { code: { startsWith: `AU${tag}` } }, select: { id: true } });
  const users = await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } });
  const schoolIds = schools.map((s) => s.id);
  const userIds = users.map((u) => u.id);
  await prisma.auditEvent.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { actorId: { in: userIds } }, { targetId: { in: userIds } }] } });
  await prisma.suspensionPeriod.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }] } });
  await prisma.school.updateMany({ where: { id: { in: schoolIds } }, data: { ownerId: null } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await removeTestBranches();
  server.close();
  await prisma.$disconnect();
});

describe('every approved action records actor, action, target, change and timestamp', () => {
  let school;
  let owner;
  let from;
  let until;

  before(async () => {
    from = await dbNow();
    const steps = [
      ['POST', '/api/platform/schools', () => schoolBody('A')],
      ['PATCH', () => `/api/platform/schools/${school.id}`, () => ({ name: `Audit Test A2 ${tag}`, description: 'Renamed' })],
      ['POST', () => `/api/platform/schools/${school.id}/suspend`, () => ({ reason: 'Audit check' })],
      ['POST', () => `/api/platform/schools/${school.id}/reactivate`, () => undefined],
      ['POST', '/api/platform/owners', () => ({ name: `Audit Owner ${tag}`, email: emailFor('owner'), phone: '+252 61 7654321', schoolId: school.id, password: OWNER_PASSWORD })],
      ['PATCH', () => `/api/platform/owners/${owner.id}`, () => ({ phone: '+252 61 1112223' })],
      ['POST', () => `/api/platform/owners/${owner.id}/suspend`, () => ({ reason: 'Audit check' })],
      ['POST', () => `/api/platform/owners/${owner.id}/reactivate`, () => undefined],
    ];
    for (const [method, path, body] of steps) {
      const res = await admin(typeof path === 'function' ? path() : path, { method, body: body() });
      assert.ok(res.status === 200 || res.status === 201, `${method} → ${res.status} ${JSON.stringify(res.body)}`);
      if (res.body.school && !school) school = res.body.school;
      if (res.body.owner && !owner) owner = res.body.owner;
    }
    until = await dbNow();
  });

  test('exactly one SUCCESS event per action, in order', async () => {
    const events = await eventsFor({ OR: [{ targetId: school.id }, { targetId: owner.id }] });
    assert.deepEqual(events.map((e) => `${e.action}:${e.result}`), [
      'SCHOOL_CREATED:SUCCESS',
      'SCHOOL_UPDATED:SUCCESS',
      'SCHOOL_SUSPENDED:SUCCESS',
      'SCHOOL_REACTIVATED:SUCCESS',
      'OWNER_CREATED:SUCCESS',
      'OWNER_UPDATED:SUCCESS',
      'OWNER_SUSPENDED:SUCCESS',
      'OWNER_REACTIVATED:SUCCESS',
    ]);
  });

  test('actor is the signed-in Super Admin (id, name and role copied at the time)', async () => {
    const events = await eventsFor({ OR: [{ targetId: school.id }, { targetId: owner.id }] });
    for (const e of events) {
      assert.equal(e.actorId, accounts.SUPER_ADMIN.id, e.action);
      assert.equal(e.actorName, accounts.SUPER_ADMIN.name, e.action);
      assert.equal(e.actorRole, 'SUPER_ADMIN', e.action);
    }
  });

  test('target, school and change are recorded; updates list field names only', async () => {
    const events = await eventsFor({ OR: [{ targetId: school.id }, { targetId: owner.id }] });
    const by = Object.fromEntries(events.map((e) => [e.action, e]));
    for (const action of ['SCHOOL_CREATED', 'SCHOOL_UPDATED', 'SCHOOL_SUSPENDED', 'SCHOOL_REACTIVATED']) {
      assert.equal(by[action].targetType, 'school');
      assert.equal(by[action].targetId, school.id);
      assert.equal(by[action].schoolId, school.id);
    }
    for (const action of ['OWNER_CREATED', 'OWNER_UPDATED', 'OWNER_SUSPENDED', 'OWNER_REACTIVATED']) {
      assert.equal(by[action].targetType, 'owner');
      assert.equal(by[action].targetId, owner.id);
      assert.equal(by[action].schoolId, school.id, 'linked to the owner’s school');
    }
    assert.equal(by.SCHOOL_CREATED.targetName, `Audit Test A ${tag}`, 'name at the time of the event');
    assert.equal(by.SCHOOL_UPDATED.targetName, `Audit Test A2 ${tag}`);
    assert.deepEqual(by.SCHOOL_CREATED.change, { field: 'Status', from: null, to: 'Active' });
    assert.deepEqual(by.SCHOOL_SUSPENDED.change, { field: 'Status', from: 'Active', to: 'Suspended' });
    assert.deepEqual(by.SCHOOL_REACTIVATED.change, { field: 'Status', from: 'Suspended', to: 'Active' });
    assert.deepEqual(by.OWNER_CREATED.change, { field: 'Status', from: null, to: 'Active' });
    assert.deepEqual(by.OWNER_SUSPENDED.change, { field: 'Status', from: 'Active', to: 'Suspended' });
    assert.deepEqual(by.OWNER_REACTIVATED.change, { field: 'Status', from: 'Suspended', to: 'Active' });
    assert.equal(by.SCHOOL_UPDATED.description, 'School details updated: name, description.');
    assert.equal(by.OWNER_UPDATED.description, 'School owner details updated: phone.');
    assert.ok(!JSON.stringify(by.OWNER_UPDATED).includes('1112223'), 'new values are not copied');
    assert.ok(by.SCHOOL_SUSPENDED.description.endsWith('Reason: Audit check'));
  });

  test('timestamps come from the server, within the request window, in order', async () => {
    const events = await eventsFor({ OR: [{ targetId: school.id }, { targetId: owner.id }] });
    for (const e of events) {
      assert.ok(e.occurredAt.getTime() >= from.getTime() - 1000 && e.occurredAt.getTime() <= until.getTime() + 1000, `${e.action} ${e.occurredAt.toISOString()}`);
    }
    const times = events.map((e) => e.occurredAt.getTime());
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  });

  test('no credentials stored: no password, hash, session token or cookie', async () => {
    const events = await eventsFor({ OR: [{ targetId: school.id }, { targetId: owner.id }] });
    const text = JSON.stringify(events);
    const sessionHashes = (await prisma.session.findMany({ where: { userId: accounts.SUPER_ADMIN.id }, select: { tokenHash: true } })).map((s) => s.tokenHash);
    assert.ok(!text.includes(OWNER_PASSWORD));
    assert.ok(!/scrypt\$|passwordHash|tokenHash|edutrack_session|DATABASE_URL|postgres(ql)?:\/\//i.test(text));
    assert.ok(!text.includes(cookies.SUPER_ADMIN.split('=')[1]), 'session cookie value');
    assert.ok(sessionHashes.every((hash) => !text.includes(hash)), 'session token hash');
  });

  test('the audit log API returns the events without raw user agents or credentials', async () => {
    const res = await admin(`/api/platform/audit-logs?school=${school.id}&pageSize=50`);
    assert.equal(res.status, 200);
    assert.equal(res.body.isDemo, false);
    const actions = res.body.items.filter((e) => [school.id, owner.id].includes(e.target.id)).map((e) => e.action);
    assert.equal(actions.length, 8);
    const one = res.body.items.find((e) => e.action === 'OWNER_CREATED');
    assert.deepEqual(one.actor, { id: accounts.SUPER_ADMIN.id, name: accounts.SUPER_ADMIN.name, role: 'SUPER_ADMIN' });
    assert.deepEqual(Object.keys(one.context).sort(), ['browser', 'device', 'ipAddress']);
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes(`EduTrackAuditTest/${tag}`), 'raw user agent not returned');
    assert.ok(!text.includes(OWNER_PASSWORD) && !/scrypt\$|passwordHash|tokenHash|edutrack_session/.test(text));
    const detail = await admin(`/api/platform/audit-logs/${one.id}`);
    assert.equal(detail.body.event.id, one.id);
  });
});

describe('the actor cannot be supplied by the request', () => {
  test('actor fields in the body are refused; nothing is created or audited', async () => {
    const before = await prisma.auditEvent.count({ where: ownedBy() });
    for (const extra of [{ actorId: accounts.OWNER.id }, { actorName: 'Someone Else' }, { actorRole: 'OWNER' }, { userId: accounts.OWNER.id }]) {
      const res = await admin('/api/platform/schools', { method: 'POST', body: { ...schoolBody('S'), ...extra } });
      assert.equal(res.status, 400, JSON.stringify(extra));
    }
    assert.equal(await prisma.school.count({ where: { code: `AU${tag}-S` } }), 0);
    assert.equal(await prisma.auditEvent.count({ where: ownedBy() }), before);
  });

  test('a non-admin session cannot act, even naming an admin as actor', async () => {
    const before = await prisma.auditEvent.count({ where: ownedBy() });
    const res = await call('/api/platform/schools', { method: 'POST', cookie: cookies.OWNER, body: { ...schoolBody('X'), actorId: accounts.SUPER_ADMIN.id } });
    assert.equal(res.status, 403);
    assert.equal(await prisma.auditEvent.count({ where: ownedBy() }), before);
  });
});

describe('failed requests record no success event', () => {
  test('validation, unknown ids, invalid status changes and duplicates → no event', async () => {
    const school = (await admin('/api/platform/schools', { method: 'POST', body: schoolBody('F') })).body.school;
    const taken = (await admin('/api/platform/schools', { method: 'POST', body: schoolBody('T') })).body.school;
    const before = await prisma.auditEvent.count({ where: ownedBy() });
    const missing = randomUUID();
    for (const [method, path, body, status] of [
      ['POST', '/api/platform/schools', { name: '' }, 400],
      ['POST', '/api/platform/schools', schoolBody('F'), 409],
      ['PATCH', `/api/platform/schools/${missing}`, { name: 'X Academy' }, 404],
      ['PATCH', `/api/platform/schools/${school.id}`, { phone: 'not a phone' }, 400],
      ['POST', `/api/platform/schools/${school.id}/suspend`, { reason: '' }, 400],
      ['POST', `/api/platform/schools/${school.id}/reactivate`, undefined, 409],
      ['POST', `/api/platform/schools/${missing}/suspend`, { reason: 'Audit check' }, 404],
      ['POST', '/api/platform/owners', { name: `Audit Owner ${tag}`, email: emailFor('f'), phone: '+252 61 7654321', schoolId: school.id, password: 'short' }, 400],
      ['POST', '/api/platform/owners', { name: `Audit Owner ${tag}`, email: emailFor('f'), phone: '+252 61 7654321', schoolId: missing, password: OWNER_PASSWORD }, 400],
      ['PATCH', `/api/platform/owners/${missing}`, { phone: '+252 61 1112223' }, 404],
      ['POST', `/api/platform/owners/${missing}/suspend`, { reason: 'Audit check' }, 404],
      ['POST', `/api/platform/owners/${accounts.SUPER_ADMIN.id}/suspend`, { reason: 'Audit check' }, 404],
    ]) {
      const res = await admin(path, { method, body });
      assert.equal(res.status, status, `${method} ${path} ${JSON.stringify(res.body)}`);
    }
    assert.equal(await prisma.auditEvent.count({ where: ownedBy() }), before, 'no audit events for failed requests');
    assert.ok(taken);
  });
});

describe('the action and its audit event succeed or fail together', () => {
  // A request whose user-agent cannot be read makes the audit write throw inside the transaction.
  const brokenRequest = { ip: '127.0.0.1', get: () => { throw new Error('audit write failed'); } };
  const actor = () => ({ id: accounts.SUPER_ADMIN.id, name: accounts.SUPER_ADMIN.name, role: 'SUPER_ADMIN' });

  test('register: audit failure → error, and no school is created', async () => {
    const values = { name: `Audit Test R ${tag}`, code: `AU${tag}-R`, phone: '+252 61 2345678', address: 'Test Road 1', city: 'Garowe' };
    await assert.rejects(registerSchool(values, actor(), brokenRequest), /audit write failed/);
    assert.equal(await prisma.school.count({ where: { code: `AU${tag}-R` } }), 0);
    assert.equal(await prisma.auditEvent.count({ where: { targetName: `Audit Test R ${tag}` } }), 0);
  });

  test('suspend owner: audit failure → error; status and sessions unchanged', async () => {
    const school = (await admin('/api/platform/schools', { method: 'POST', body: schoolBody('O') })).body.school;
    const owner = (await admin('/api/platform/owners', { method: 'POST', body: { name: `Audit Owner O ${tag}`, email: emailFor('o'), phone: '+252 61 7654321', schoolId: school.id, password: OWNER_PASSWORD } })).body.owner;
    const signIn = await call('/api/auth/login', { method: 'POST', body: { email: emailFor('o'), password: OWNER_PASSWORD } });
    assert.equal(signIn.status, 200);
    await assert.rejects(suspendOwner(owner.id, 'Audit check', actor(), brokenRequest), /audit write failed/);
    const after = await prisma.user.findUnique({ where: { id: owner.id }, select: { status: true, suspensionReason: true } });
    assert.deepEqual(after, { status: 'ACTIVE', suspensionReason: null });
    assert.equal(await prisma.session.count({ where: { userId: owner.id } }), 1, 'sessions are not ended');
    assert.equal(await prisma.auditEvent.count({ where: { targetId: owner.id, action: 'OWNER_SUSPENDED' } }), 0);
  });
});

describe('audit records are read-only and SUPER_ADMIN only', () => {
  let event;
  before(async () => {
    event = await prisma.auditEvent.findFirst({ where: ownedBy(), orderBy: { occurredAt: 'desc' } });
  });

  test('no create, update or delete through the API', async () => {
    const snapshot = await prisma.auditEvent.findUnique({ where: { id: event.id } });
    const total = await prisma.auditEvent.count({ where: ownedBy() });
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const path of ['/api/platform/audit-logs', `/api/platform/audit-logs/${event.id}`]) {
        const res = await admin(path, { method, body: { action: 'SCHOOL_CREATED', description: 'tampered' } });
        assert.equal(res.status, 404, `${method} ${path}`);
      }
    }
    assert.deepEqual(await prisma.auditEvent.findUnique({ where: { id: event.id } }), snapshot);
    assert.equal(await prisma.auditEvent.count({ where: ownedBy() }), total);
  });

  test('read access: 401 without a session, 403 for OWNER, MANAGER and STAFF, 200 for SUPER_ADMIN', async () => {
    for (const path of ['/api/platform/audit-logs', `/api/platform/audit-logs/${event.id}`]) {
      assert.equal((await call(path)).status, 401, path);
      for (const role of ['OWNER', 'MANAGER', 'STAFF']) {
        const res = await call(path, { cookie: cookies[role] });
        assert.equal(res.status, 403, `${role} ${path}`);
        assert.ok(!JSON.stringify(res.body).includes(event.id), 'no data in the refusal');
      }
      assert.equal((await admin(path)).status, 200, path);
    }
  });

  test('the action filter accepts recorded actions only', async () => {
    for (const action of ['PASSWORD_RESET', 'SETTINGS_UPDATED', 'SCHOOL_APPROVED']) {
      const res = await admin(`/api/platform/audit-logs?action=${action}`);
      assert.equal(res.status, 400, action);
      assert.equal(res.body.code, 'VALIDATION_ERROR');
    }
    assert.equal((await admin('/api/platform/audit-logs?action=OWNER_SUSPENDED')).status, 200);
  });

  test('write attempts by other roles are refused before reaching any route', async () => {
    for (const role of ['OWNER', 'MANAGER', 'STAFF']) {
      assert.equal((await call(`/api/platform/audit-logs/${event.id}`, { method: 'DELETE', cookie: cookies[role] })).status, 403, role);
    }
    assert.equal((await call(`/api/platform/audit-logs/${event.id}`, { method: 'DELETE' })).status, 401);
  });
});

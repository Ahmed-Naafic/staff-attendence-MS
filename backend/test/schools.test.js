/*
 * School Management tests (approved rules): register, edit, suspend, reactivate — SUPER_ADMIN
 * only; ACTIVE ⇄ SUSPENDED; School Code unique and immutable; no deletion, approval or
 * rejection; audit events only after successful changes. Runs on the Neon dev branch
 * (`npm test`); every school, account, session and audit event it creates is removed afterwards.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('School tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const accounts = {};
const cookies = {};
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
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const admin = (path, options = {}) => call(path, { ...options, cookie: cookies.SUPER_ADMIN });

const validSchool = (overrides = {}) => ({
  name: `Test Academy ${tag}`,
  code: `T${tag}-001`,
  phone: '+252 61 2345678',
  email: 'office@test-academy.example',
  address: 'Maka Al-Mukarama Road 12',
  city: 'Mogadishu',
  description: 'A school created by the automated tests.',
  website: 'https://test-academy.example',
  ...overrides,
});
const auditFor = (schoolId) => prisma.auditEvent.findMany({ where: { schoolId }, orderBy: { occurredAt: 'asc' } });

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  // A temporary account per role, signed in once (the session cookie is reused by every test).
  for (const role of ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'STAFF']) {
    const password = randomBytes(12).toString('base64url');
    const email = `test-sm-${role.toLowerCase()}-${tag.toLowerCase()}@test.edutrack.example`;
    const user = await prisma.user.create({ data: { name: `Test ${role} ${tag}`, email, role, ...(await branchFor(role)), passwordHash: await hashPassword(password) } });
    accounts[role] = { id: user.id };
    const response = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(response.status, 200, `${role} sign-in`);
    cookies[role] = response.headers.get('set-cookie').split(';')[0];
  }
});

after(async () => {
  const schools = await prisma.school.findMany({ where: { code: { startsWith: `T${tag}` } }, select: { id: true } });
  const schoolIds = schools.map((s) => s.id);
  const userIds = Object.values(accounts).map((a) => a.id);
  await prisma.auditEvent.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { actorId: { in: userIds } }] } });
  await prisma.suspensionPeriod.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }] } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await removeTestBranches();
  server.close();
  await prisma.$disconnect();
});

describe('authorization on every School Management endpoint', () => {
  const id = randomUUID();
  const endpoints = [
    ['GET', '/api/platform/schools'],
    ['GET', `/api/platform/schools/${id}`],
    ['GET', '/api/platform/schools/code-suggestion?name=Test'],
    ['POST', '/api/platform/schools', validSchool({ code: `T${tag}-AUTH` })],
    ['PATCH', `/api/platform/schools/${id}`, { phone: '+252 61 1111111' }],
    ['POST', `/api/platform/schools/${id}/suspend`, { reason: 'Test reason' }],
    ['POST', `/api/platform/schools/${id}/reactivate`],
  ];

  test('unauthenticated → 401', async () => {
    for (const [method, path, body] of endpoints) assert.equal((await call(path, { method, body })).status, 401, `${method} ${path}`);
  });

  for (const role of ['OWNER', 'MANAGER', 'STAFF']) {
    test(`${role} → 403, and nothing is created`, async () => {
      for (const [method, path, body] of endpoints) {
        const res = await call(path, { method, body, cookie: cookies[role] });
        assert.equal(res.status, 403, `${role} ${method} ${path}`);
      }
      assert.equal(await prisma.school.count({ where: { code: `T${tag}-AUTH` } }), 0);
    });
  }

  test('SUPER_ADMIN → allowed (unknown ids → 404)', async () => {
    for (const [method, path, body] of endpoints) {
      const res = await admin(path, { method, body });
      const expected = method === 'POST' && path === '/api/platform/schools' ? 201 : path.includes(id) ? 404 : 200;
      assert.equal(res.status, expected, `SUPER_ADMIN ${method} ${path}`);
    }
  });
});

describe('register', () => {
  test('a valid registration creates an ACTIVE school and a SCHOOL_CREATED audit event', async () => {
    const res = await admin('/api/platform/schools', { method: 'POST', body: validSchool({ code: ` t${tag.toLowerCase()}-001 ` }) });
    assert.equal(res.status, 201);
    const school = res.body.school;
    assert.equal(school.status, 'active');
    assert.equal(school.code, `T${tag}-001`, 'code trimmed and uppercased');
    assert.equal(school.location, 'Mogadishu');
    assert.equal(school.phone, '+252 61 2345678');
    assert.equal(school.ownerName, null, 'no owner is created');
    const events = await auditFor(school.id);
    assert.deepEqual(events.map((e) => `${e.action}:${e.result}`), ['SCHOOL_CREATED:SUCCESS']);
    assert.equal(events[0].actorId, accounts.SUPER_ADMIN.id);
    const listed = await admin(`/api/platform/schools?q=${encodeURIComponent(school.code)}`);
    assert.equal(listed.body.items[0]?.id, school.id, 'listed and searchable by code');
  });

  test('a duplicate School Code → 409, nothing created, no audit event', async () => {
    const before = await prisma.auditEvent.count({ where: { action: 'SCHOOL_CREATED' } });
    const res = await admin('/api/platform/schools', { method: 'POST', body: validSchool({ name: 'Another School' }) });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'CODE_TAKEN');
    assert.equal(res.body.details.code, 'This School Code is already in use.');
    assert.equal(await prisma.school.count({ where: { code: `T${tag}-001` } }), 1);
    assert.equal(await prisma.auditEvent.count({ where: { action: 'SCHOOL_CREATED' } }), before);
  });

  test('two schools may share a name', async () => {
    const res = await admin('/api/platform/schools', { method: 'POST', body: validSchool({ code: `T${tag}-002` }) });
    assert.equal(res.status, 201);
  });

  test('missing, blank and invalid fields → 400 with a message per field', async () => {
    const missing = await admin('/api/platform/schools', { method: 'POST', body: {} });
    assert.equal(missing.status, 400);
    assert.deepEqual(Object.keys(missing.body.details).sort(), ['address', 'city', 'code', 'name', 'phone']);
    const blank = await admin('/api/platform/schools', { method: 'POST', body: validSchool({ code: `T${tag}-003`, name: '   ', address: '\t' }) });
    assert.deepEqual(Object.keys(blank.body.details).sort(), ['address', 'name']);
    const invalid = await admin('/api/platform/schools', {
      method: 'POST',
      body: validSchool({ code: 'bad code!', email: 'not-an-email', phone: '12', website: 'javascript:alert(1)', name: 'x'.repeat(121) }),
    });
    assert.equal(invalid.status, 400);
    assert.deepEqual(Object.keys(invalid.body.details).sort(), ['code', 'email', 'name', 'phone', 'website']);
    for (const body of [validSchool({ code: `T${tag}-004`, status: 'SUSPENDED' }), validSchool({ code: `T${tag}-005`, ownerId: randomUUID() }), validSchool({ code: 42 })]) {
      assert.equal((await admin('/api/platform/schools', { method: 'POST', body })).status, 400, JSON.stringify(Object.keys(body)));
    }
    assert.equal((await admin('/api/platform/schools', { method: 'POST', body: '{broken' })).status, 400);
    assert.equal((await admin('/api/platform/schools', { method: 'POST', body: '[1,2]' })).status, 400);
    assert.equal(await prisma.school.count({ where: { code: { in: [`T${tag}-003`, `T${tag}-004`, `T${tag}-005`] } } }), 0);
  });

  test('optional fields may be empty', async () => {
    const res = await admin('/api/platform/schools', { method: 'POST', body: validSchool({ code: `T${tag}-006`, email: '', website: '  ', description: '' }) });
    assert.equal(res.status, 201);
    assert.equal(res.body.school.email, '');
    assert.equal(res.body.school.website, '');
  });

  test('code suggestion: initials + next free number', async () => {
    const res = await admin(`/api/platform/schools/code-suggestion?name=${encodeURIComponent('Jamhuriya Academy')}`);
    assert.match(res.body.code, /^JA-\d{3}$/);
    const single = await admin('/api/platform/schools/code-suggestion?name=Horseed');
    assert.match(single.body.code, /^HOR-\d{3}$/);
  });
});

describe('edit, suspend, reactivate', () => {
  let school;
  before(async () => {
    school = (await admin('/api/platform/schools', { method: 'POST', body: validSchool({ code: `T${tag}-010` }) })).body.school;
  });

  test('valid edit updates the fields and records SCHOOL_UPDATED (field names only)', async () => {
    const res = await admin(`/api/platform/schools/${school.id}`, { method: 'PATCH', body: { name: 'Renamed Academy', city: 'Hargeisa', email: '' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.school.name, 'Renamed Academy');
    assert.equal(res.body.school.location, 'Hargeisa');
    assert.equal(res.body.school.email, '');
    assert.equal(res.body.school.code, school.code);
    const updated = (await auditFor(school.id)).filter((e) => e.action === 'SCHOOL_UPDATED');
    assert.equal(updated.length, 1);
    assert.equal(updated[0].description, 'School details updated: name, email, city.');
  });

  test('no actual change → 200 without an audit event', async () => {
    const res = await admin(`/api/platform/schools/${school.id}`, { method: 'PATCH', body: { name: 'Renamed Academy' } });
    assert.equal(res.status, 200);
    assert.equal((await auditFor(school.id)).filter((e) => e.action === 'SCHOOL_UPDATED').length, 1);
  });

  test('School Code cannot change; invalid edits are rejected and change nothing', async () => {
    const code = await admin(`/api/platform/schools/${school.id}`, { method: 'PATCH', body: { code: 'NEW-001' } });
    assert.equal(code.status, 400);
    assert.equal(code.body.details.code, 'The School Code cannot be changed after registration.');
    for (const body of [{ phone: '' }, { email: 'nope' }, { name: '   ' }, {}, { status: 'SUSPENDED' }, { registeredAt: new Date().toISOString() }]) {
      assert.equal((await admin(`/api/platform/schools/${school.id}`, { method: 'PATCH', body })).status, 400, JSON.stringify(body));
    }
    const fresh = await admin(`/api/platform/schools/${school.id}`);
    assert.equal(fresh.body.school.code, school.code);
    assert.equal(fresh.body.school.status, 'active');
    assert.equal(fresh.body.school.phone, '+252 61 2345678');
  });

  test('unknown or malformed ids → 404 for every action', async () => {
    for (const id of [randomUUID(), 'not-an-id', '1 OR 1=1']) {
      const path = `/api/platform/schools/${encodeURIComponent(id)}`;
      assert.equal((await admin(path, { method: 'PATCH', body: { phone: '+252 61 7654321' } })).status, 404);
      assert.equal((await admin(`${path}/suspend`, { method: 'POST', body: { reason: 'Test' } })).status, 404);
      assert.equal((await admin(`${path}/reactivate`, { method: 'POST' })).status, 404);
    }
  });

  test('suspension requires a reason', async () => {
    for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 'ab' }, { reason: 'x'.repeat(501) }, { reason: 'Valid reason', extra: true }]) {
      assert.equal((await admin(`/api/platform/schools/${school.id}/suspend`, { method: 'POST', body })).status, 400, JSON.stringify(body));
    }
    assert.equal((await admin(`/api/platform/schools/${school.id}`)).body.school.status, 'active');
    assert.equal((await auditFor(school.id)).filter((e) => e.action === 'SCHOOL_SUSPENDED').length, 0);
  });

  test('an active school cannot be reactivated (409, no audit event)', async () => {
    const res = await admin(`/api/platform/schools/${school.id}/reactivate`, { method: 'POST' });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'INVALID_STATUS');
    assert.equal((await auditFor(school.id)).filter((e) => e.action === 'SCHOOL_REACTIVATED').length, 0);
  });

  test('ACTIVE → SUSPENDED with a reason; SCHOOL_SUSPENDED recorded with the reason', async () => {
    const res = await admin(`/api/platform/schools/${school.id}/suspend`, { method: 'POST', body: { reason: '  Unpaid subscription  ' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.school.status, 'suspended');
    assert.equal(res.body.school.suspensionReason, 'Unpaid subscription');
    assert.ok(res.body.school.suspendedAt);
    const [event] = (await auditFor(school.id)).filter((e) => e.action === 'SCHOOL_SUSPENDED');
    assert.equal(event.description, 'School suspended. Reason: Unpaid subscription');
    assert.deepEqual(event.change, { field: 'Status', from: 'Active', to: 'Suspended' });
    const listed = await admin('/api/platform/schools?status=suspended');
    assert.ok(listed.body.items.some((s) => s.id === school.id), 'filterable as suspended');
  });

  test('a suspended school cannot be suspended again (409, no second audit event); it can still be edited', async () => {
    const res = await admin(`/api/platform/schools/${school.id}/suspend`, { method: 'POST', body: { reason: 'Again' } });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'INVALID_STATUS');
    assert.equal((await auditFor(school.id)).filter((e) => e.action === 'SCHOOL_SUSPENDED').length, 1);
    assert.equal((await admin(`/api/platform/schools/${school.id}`, { method: 'PATCH', body: { phone: '+252 61 7654321' } })).status, 200);
  });

  test('SUSPENDED → ACTIVE; reason cleared; SCHOOL_REACTIVATED recorded', async () => {
    const res = await admin(`/api/platform/schools/${school.id}/reactivate`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal(res.body.school.status, 'active');
    assert.equal(res.body.school.suspensionReason, null);
    const actions = (await auditFor(school.id)).map((e) => e.action);
    assert.deepEqual(actions, ['SCHOOL_CREATED', 'SCHOOL_UPDATED', 'SCHOOL_SUSPENDED', 'SCHOOL_UPDATED', 'SCHOOL_REACTIVATED']);
  });

  test('simultaneous suspensions: exactly one succeeds', async () => {
    const results = await Promise.all(
      [1, 2, 3].map((n) => admin(`/api/platform/schools/${school.id}/suspend`, { method: 'POST', body: { reason: `Race ${n}` } })),
    );
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409, 409]);
    assert.equal((await auditFor(school.id)).filter((e) => e.action === 'SCHOOL_SUSPENDED').length, 2);
  });

  test('audit events for school actions contain no secrets and appear in the audit log API', async () => {
    const events = await auditFor(school.id);
    const text = JSON.stringify(events);
    assert.ok(!/passwordHash|tokenHash|scrypt\$|edutrack_session|DATABASE_URL|postgres(ql)?:\/\//i.test(text));
    assert.ok(events.every((e) => e.actorId === accounts.SUPER_ADMIN.id && e.actorRole === 'SUPER_ADMIN' && e.targetType === 'school'));
    const log = await admin(`/api/platform/audit-logs?school=${school.id}&pageSize=50`);
    assert.deepEqual(
      log.body.items.map((e) => e.action).sort(),
      ['SCHOOL_CREATED', 'SCHOOL_REACTIVATED', 'SCHOOL_SUSPENDED', 'SCHOOL_SUSPENDED', 'SCHOOL_UPDATED', 'SCHOOL_UPDATED'],
    );
    const byLabel = await admin(`/api/platform/audit-logs?school=${school.id}&q=${encodeURIComponent('reactivate school')}`);
    assert.equal(byLabel.body.total, 1, 'searchable by action name');
  });

  test('no delete workflow exists', async () => {
    for (const [method, path] of [['DELETE', `/api/platform/schools/${school.id}`], ['POST', `/api/platform/schools/${school.id}/delete`], ['POST', `/api/platform/schools/${school.id}/approve`], ['POST', `/api/platform/schools/${school.id}/reject`]]) {
      assert.equal((await admin(path, { method, body: {} })).status, 404, `${method} ${path}`);
    }
    assert.equal(await prisma.school.count({ where: { id: school.id } }), 1);
  });
});

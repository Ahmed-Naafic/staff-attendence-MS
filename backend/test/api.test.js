/*
 * API tests: authentication, authorization (every platform endpoint × every role), validation,
 * lists, details, audit events and error safety. Run with `npm test` (backend) — they use the
 * Neon dev branch (backend/.env.dev) and its seeded sample data, create temporary accounts for
 * every role, and remove them (and their sessions and audit events) afterwards.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('API tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(4).toString('hex');
const startedAt = new Date();
let server;
let base;
const accounts = {};

async function call(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(method !== 'GET' && { origin: ORIGIN }),
      ...(cookie && { cookie }),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: response.status, body: json, headers: response.headers };
}

async function signIn(role) {
  const { email, password } = accounts[role];
  const res = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(res.status, 200, `${role} sign-in`);
  return res.headers.get('set-cookie').split(';')[0];
}

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const role of ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'STAFF']) {
    const password = randomBytes(12).toString('base64url');
    const email = `test-${role.toLowerCase()}-${tag}@test.edutrack.example`;
    const user = await prisma.user.create({ data: { name: `Test ${role} ${tag}`, email, role, ...(await branchFor(role)), passwordHash: await hashPassword(password) } });
    accounts[role] = { id: user.id, email, password };
  }
  const suspended = `test-suspended-${tag}@test.edutrack.example`;
  const password = randomBytes(12).toString('base64url');
  const user = await prisma.user.create({ data: { name: `Test suspended ${tag}`, email: suspended, role: 'SUPER_ADMIN', status: 'SUSPENDED', passwordHash: await hashPassword(password) } });
  accounts.SUSPENDED = { id: user.id, email: suspended, password };
});

after(async () => {
  const ids = Object.values(accounts).map((a) => a.id);
  await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
  // Failed sign-ins for unknown accounts made by these tests (no actor is stored for them).
  await prisma.auditEvent.deleteMany({ where: { actorId: null, action: 'SIGN_IN', result: 'FAILURE', occurredAt: { gte: startedAt } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } }); // sessions cascade
  await removeTestBranches();
  server.close();
  await prisma.$disconnect();
});

describe('authentication', () => {
  test('sign-in sets an httpOnly, SameSite=Lax session cookie limited to /api and returns no secrets', async () => {
    resetLimiter();
    const { email, password } = accounts.SUPER_ADMIN;
    const res = await call('/api/auth/login', { method: 'POST', body: { email: email.toUpperCase(), password } });
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body.user).sort(), ['id', 'mustChangePassword', 'name', 'role']);
    assert.equal(res.body.user.mustChangePassword, false);
    const cookie = res.headers.get('set-cookie');
    assert.match(cookie, /^edutrack_session=[\w-]{40,};/);
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    assert.match(cookie, /Path=\/api/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const stored = await prisma.session.findFirst({ where: { userId: accounts.SUPER_ADMIN.id } });
    assert.ok(stored && !cookie.includes(stored.tokenHash), 'only a hash of the token is stored');
  });

  test('wrong password and unknown email give the same 401 message', async () => {
    resetLimiter();
    const wrong = await call('/api/auth/login', { method: 'POST', body: { email: accounts.OWNER.email, password: 'not-the-password' } });
    const unknown = await call('/api/auth/login', { method: 'POST', body: { email: `nobody-${tag}@test.edutrack.example`, password: 'whatever-123' } });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error, unknown.body.error);
    assert.equal(wrong.headers.get('set-cookie'), null);
  });

  test('a suspended account cannot sign in', async () => {
    resetLimiter();
    const res = await call('/api/auth/login', { method: 'POST', body: { email: accounts.SUSPENDED.email, password: accounts.SUSPENDED.password } });
    assert.equal(res.status, 401);
  });

  test('invalid sign-in requests are rejected', async () => {
    resetLimiter();
    assert.equal((await call('/api/auth/login', { method: 'POST', body: {} })).status, 400);
    assert.equal((await call('/api/auth/login', { method: 'POST', body: '{bad json' })).status, 400);
    assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: accounts.OWNER.email } })).status, 401);
    assert.equal((await call('/api/auth/login', { method: 'POST', body: { email: 'x'.repeat(300), password: 'y' } })).status, 400);
  });

  test('state-changing requests from another origin or without JSON are refused', async () => {
    resetLimiter();
    const { email, password } = accounts.SUPER_ADMIN;
    const foreign = await call('/api/auth/login', { method: 'POST', body: { email, password }, headers: { origin: 'https://evil.example' } });
    assert.equal(foreign.status, 403);
    const form = await call('/api/auth/login', { method: 'POST', body: `email=${email}&password=${password}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(form.status, 403);
  });

  test('repeated failures are rate-limited (429 with Retry-After), even with the right password', async () => {
    resetLimiter();
    const { email, password } = accounts.MANAGER;
    for (let i = 0; i < 5; i += 1) assert.equal((await call('/api/auth/login', { method: 'POST', body: { email, password: `wrong-${i}` } })).status, 401);
    const limited = await call('/api/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    resetLimiter();
  });

  test('session restores, then logout revokes it on the server', async () => {
    resetLimiter();
    const cookie = await signIn('SUPER_ADMIN');
    const session = await call('/api/auth/session', { cookie });
    assert.equal(session.status, 200);
    assert.equal(session.body.user.role, 'SUPER_ADMIN');
    assert.equal((await call('/api/auth/logout', { method: 'POST', cookie })).status, 204);
    assert.deepEqual((await call('/api/auth/session', { cookie })).body, { user: null });
    assert.equal((await call('/api/platform/schools', { cookie })).status, 401, 'old cookie no longer works');
  });

  test('expired sessions and forged cookies are rejected', async () => {
    resetLimiter();
    const cookie = await signIn('SUPER_ADMIN');
    await prisma.session.updateMany({ where: { userId: accounts.SUPER_ADMIN.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.deepEqual((await call('/api/auth/session', { cookie })).body, { user: null });
    assert.deepEqual((await call('/api/auth/session', { cookie: `edutrack_session=${randomBytes(32).toString('base64url')}` })).body, { user: null });
    assert.deepEqual((await call('/api/auth/session')).body, { user: null });
    assert.equal((await call('/api/platform/dashboard', { cookie })).status, 401, 'an expired session cannot reach data');
  });

  test('sign-in, failed sign-in and sign-out are audited without secrets', async () => {
    resetLimiter();
    const from = new Date();
    await call('/api/auth/login', { method: 'POST', body: { email: accounts.OWNER.email, password: 'wrong-password-xyz' } });
    const cookie = await signIn('OWNER');
    await call('/api/auth/logout', { method: 'POST', cookie });
    const events = await prisma.auditEvent.findMany({ where: { actorId: accounts.OWNER.id, occurredAt: { gte: from } }, orderBy: { occurredAt: 'asc' } });
    assert.deepEqual(events.map((e) => `${e.action}:${e.result}`), ['SIGN_IN:FAILURE', 'SIGN_IN:SUCCESS', 'SIGN_OUT:SUCCESS']);
    const text = JSON.stringify(events);
    assert.ok(!text.includes('wrong-password-xyz') && !text.includes(accounts.OWNER.password) && !/edutrack_session|tokenHash|scrypt\$/.test(text));
    const unknown = await prisma.auditEvent.findFirst({ where: { actorId: null, occurredAt: { gte: startedAt } } });
    assert.ok(unknown && !JSON.stringify(unknown).includes('nobody-'), 'the typed email of an unknown account is not stored');
  });
});

describe('authorization: SUPER_ADMIN only on every platform endpoint', () => {
  const endpoints = [
    '/api/platform/dashboard',
    '/api/platform/schools',
    `/api/platform/schools/${randomUUID()}`,
    '/api/platform/owners',
    `/api/platform/owners/${randomUUID()}`,
    '/api/platform/reports',
    '/api/platform/audit-logs',
    `/api/platform/audit-logs/${randomUUID()}`,
    '/api/platform/settings',
  ];
  const cookies = {};

  before(async () => {
    resetLimiter();
    for (const role of ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'STAFF']) cookies[role] = await signIn(role);
  });

  test('unauthenticated → 401 everywhere', async () => {
    for (const path of endpoints) assert.equal((await call(path)).status, 401, path);
  });

  for (const role of ['OWNER', 'MANAGER', 'STAFF']) {
    test(`${role} → 403 everywhere`, async () => {
      for (const path of endpoints) {
        const res = await call(path, { cookie: cookies[role] });
        assert.equal(res.status, 403, `${role} ${path}`);
        assert.equal(res.body.code, 'FORBIDDEN');
      }
    });
  }

  test('SUPER_ADMIN → allowed (200, or 404 for ids that do not exist)', async () => {
    for (const path of endpoints) {
      const res = await call(path, { cookie: cookies.SUPER_ADMIN });
      assert.equal(res.status, /[0-9a-f-]{36}$/.test(path) ? 404 : 200, path);
    }
  });

  test('a non-admin session is still valid for /api/auth/session (authentication ≠ authorization)', async () => {
    assert.equal((await call('/api/auth/session', { cookie: cookies.STAFF })).body.user.role, 'STAFF');
  });

  test('only the approved writes exist: no settings writes, no school or owner deletion, approval, rejection or transfer', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal((await call('/api/platform/settings', { method, body: {}, cookie: cookies.SUPER_ADMIN })).status, 404, `settings ${method}`);
    }
    const id = randomUUID();
    for (const [method, path] of [['PUT', '/api/platform/schools'], ['DELETE', '/api/platform/schools'], ['PUT', `/api/platform/schools/${id}`], ['DELETE', `/api/platform/schools/${id}`], ['POST', `/api/platform/schools/${id}/approve`], ['POST', `/api/platform/schools/${id}/reject`], ['POST', `/api/platform/schools/${id}/delete`], ['PUT', '/api/platform/owners'], ['DELETE', '/api/platform/owners'], ['PUT', `/api/platform/owners/${id}`], ['DELETE', `/api/platform/owners/${id}`], ['PATCH', `/api/platform/owners/${id}/school`], ['POST', `/api/platform/owners/${id}/transfer`], ['POST', `/api/platform/owners/${id}/approve`], ['POST', `/api/platform/owners/${id}/reject`], ['POST', `/api/platform/owners/${id}/delete`]]) {
      assert.equal((await call(path, { method, body: {}, cookie: cookies.SUPER_ADMIN })).status, 404, `${method} ${path}`);
    }
  });
});

describe('platform data (Super Admin)', () => {
  let cookie;
  before(async () => {
    resetLimiter();
    cookie = await signIn('SUPER_ADMIN');
  });
  const get = (path) => call(path, { cookie });

  test('schools: server-side pagination, summary and locations', async () => {
    const res = await get('/api/platform/schools');
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 8);
    assert.equal(res.body.page, 1);
    assert.equal(res.body.pageSize, 8);
    assert.equal(res.body.total, res.body.summary.total);
    assert.deepEqual(Object.keys(res.body.summary).sort(), ['active', 'suspended', 'total'], 'statuses are ACTIVE and SUSPENDED only');
    assert.equal(res.body.summary.total, res.body.summary.active + res.body.summary.suspended);
    assert.ok(res.body.locations.length > 0);
    const dates = res.body.items.map((s) => s.registeredAt);
    assert.deepEqual(dates, [...dates].sort().reverse(), 'newest first');
    assert.deepEqual(Object.keys(res.body.items[0]).sort(), ['address', 'code', 'description', 'email', 'id', 'location', 'name', 'ownerId', 'ownerName', 'phone', 'registeredAt', 'status', 'suspendedAt', 'suspensionReason', 'website']);
  });

  test('schools: search, filters combine, clamping, details', async () => {
    const active = await get('/api/platform/schools?status=active');
    assert.ok(active.body.items.every((s) => s.status === 'active'));
    assert.equal(active.body.total, active.body.summary.active);
    const city = active.body.items[0].location;
    const both = await get(`/api/platform/schools?status=active&location=${encodeURIComponent(city)}`);
    assert.ok(both.body.items.every((s) => s.status === 'active' && s.location === city));
    const name = active.body.items[0].name;
    const search = await get(`/api/platform/schools?q=${encodeURIComponent(name.slice(0, 5).toUpperCase())}`);
    assert.ok(search.body.items.some((s) => s.name === name), 'search ignores case');
    const clamped = await get('/api/platform/schools?page=999');
    assert.equal(clamped.body.page, clamped.body.pageCount);
    const detail = await get(`/api/platform/schools/${active.body.items[0].id}`);
    assert.equal(detail.body.school.name, name);
    assert.equal((await get('/api/platform/schools/not-an-id')).status, 404);
  });

  test('owners: list, filters, details; no password or session data', async () => {
    const res = await get('/api/platform/owners?pageSize=50');
    assert.equal(res.status, 200);
    assert.ok(res.body.items.every((o) => o.school === null || o.school.name));
    assert.ok(!/passwordHash|tokenHash|scrypt/.test(JSON.stringify(res.body)));
    assert.deepEqual(Object.keys(res.body.summary).sort(), ['active', 'suspended', 'total'], 'owner statuses are ACTIVE and SUSPENDED only');
    const others = ['SUPER_ADMIN', 'MANAGER', 'STAFF'].map((role) => accounts[role].email);
    assert.ok(!res.body.items.some((o) => others.includes(o.email)), 'only OWNER accounts are listed');
    const first = res.body.items.find((o) => o.school);
    const byEmail = await get(`/api/platform/owners?q=${encodeURIComponent(first.email)}`);
    assert.ok(byEmail.body.items.some((o) => o.id === first.id));
    const bySchool = await get(`/api/platform/owners?q=${encodeURIComponent(first.school.name)}`);
    assert.ok(bySchool.body.items.some((o) => o.id === first.id));
    assert.equal((await get(`/api/platform/owners/${first.id}`)).body.owner.id, first.id);
    assert.equal((await get(`/api/platform/owners/${accounts.SUPER_ADMIN.id}`)).status, 404, 'a non-owner id is not an owner');
  });

  test('dashboard and reports agree with the school and owner lists', async () => {
    const schools = (await get('/api/platform/schools')).body.summary;
    const owners = (await get('/api/platform/owners')).body.summary;
    const dashboard = (await get('/api/platform/dashboard?range=12m')).body;
    assert.equal(dashboard.summary.totalSchools.value, schools.total);
    assert.equal(dashboard.summary.activeSchools.value, schools.active);
    assert.equal(dashboard.summary.totalOwners.value, owners.total);
    assert.equal(dashboard.schoolsGrowth.length, 12);
    assert.equal(dashboard.schoolsGrowth.at(-1).total, schools.total);
    assert.equal(dashboard.schoolsByLocation.reduce((n, l) => n + l.count, 0), schools.total);
    assert.ok(!('changePercent' in dashboard.summary.totalSchools), 'no undefined change percentages');
    const report = (await get('/api/platform/reports?period=6m')).body;
    assert.equal(report.schools.trend.length, 6);
    assert.equal(report.owners.trend.length, 6);
    assert.deepEqual(report.schools.summary, schools);
    assert.equal(report.schools.byCity.reduce((n, c) => n + c.count, 0), schools.total);
    // The owner list also shows OWNER accounts without a school (this file's test OWNER); the report counts School Owners only.
    assert.equal(report.owners.summary.total, await prisma.user.count({ where: { role: 'OWNER', ownedSchool: { isNot: null } } }));
    assert.ok(report.owners.summary.total <= owners.total);
    assert.ok(!('pendingSchools' in dashboard.summary) && !('pending' in report.schools.summary) && !('pending' in report.owners.summary), 'no pending/approval figures');
  });

  test('audit logs: filters, pagination, summary, details', async () => {
    const res = await get('/api/platform/audit-logs?pageSize=25');
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, Math.min(25, res.body.total));
    const failed = await get('/api/platform/audit-logs?status=failure&action=SIGN_IN');
    assert.ok(failed.body.items.every((e) => e.result === 'failure' && e.action === 'SIGN_IN'));
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recent = await get(`/api/platform/audit-logs?since=${since}`);
    assert.ok(recent.body.items.every((e) => e.occurredAt >= since));
    const byAction = await get('/api/platform/audit-logs?q=sign%20out');
    assert.ok(byAction.body.items.every((e) => e.action === 'SIGN_OUT' || /sign out/i.test(JSON.stringify(e))));
    const event = res.body.items[0];
    assert.equal((await get(`/api/platform/audit-logs/${event.id}`)).body.event.id, event.id);
    assert.ok(!/"userAgent"|tokenHash|passwordHash|scrypt\$/.test(JSON.stringify(res.body)), 'no raw user agents or secrets');
  });

  test('settings: read-only values, platform switches not stored', async () => {
    const res = await get('/api/platform/settings');
    assert.equal(res.status, 200);
    assert.equal(res.body.settings.configuration, null);
    assert.ok(!/DATABASE_URL|postgres(ql)?:\/\/|neon\.tech|JWT/i.test(JSON.stringify(res.body)));
  });

  test('invalid query parameters → 400 with a clear message', async () => {
    for (const path of [
      '/api/platform/schools?page=abc',
      '/api/platform/schools?page=0',
      '/api/platform/schools?pageSize=1000',
      '/api/platform/schools?status=closed',
      '/api/platform/schools?status=pending',
      '/api/platform/schools?registered=5y',
      `/api/platform/schools?q=${'a'.repeat(101)}`,
      '/api/platform/schools?status=active&status=pending',
      '/api/platform/owners?status=closed',
      '/api/platform/owners?status=pending',
      '/api/platform/schools?owner=some',
      '/api/platform/dashboard?range=1y',
      '/api/platform/reports?period=2y',
      '/api/platform/audit-logs?action=DROP_TABLE',
      '/api/platform/audit-logs?user=not-an-id',
      '/api/platform/audit-logs?since=yesterday',
      `/api/platform/audit-logs?since=${new Date().toISOString()}&until=${new Date(Date.now() - 1000).toISOString()}`,
    ]) {
      const res = await get(path);
      assert.equal(res.status, 400, path);
      assert.equal(res.body.code, 'VALIDATION_ERROR', path);
    }
  });

  test('errors never expose internals', async () => {
    const res = await get('/api/platform/schools?q=%27%3B%20DROP%20TABLE%20%22School%22%3B--');
    assert.equal(res.status, 200, 'search text is a parameter, not SQL');
    const missing = await call('/api/nowhere');
    assert.deepEqual(missing.body, { error: 'Not found.', code: 'NOT_FOUND' });
    assert.equal(missing.headers.get('x-powered-by'), null);
  });
});

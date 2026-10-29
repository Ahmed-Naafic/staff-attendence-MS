/*
 * Authentication Settings tests (approved rules): only a SUPER_ADMIN reads and changes them (401
 * signed out, 403 for other roles); the absolute session lifetime is a whole number of hours from
 * 1 to 72, default 12, and a change applies to new sign-ins only; the inactivity timeout is
 * disabled by default or one of 5–480 minutes and ends idle sessions — existing ones included;
 * activity is written at most once a minute; each actual change records one AUTH_SETTINGS_UPDATED
 * event per setting in the same transaction; the command-line password reset accepts only a
 * SUPER_ADMIN and records a SUPER_ADMIN_PASSWORD_RESET security event in the same transaction.
 * Runs on the Neon dev branch (`npm test`). The settings row is restored afterwards exactly as it
 * was, and everything else the tests create is removed.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { ACTIVITY_WRITE_INTERVAL_MS, clearInactivityCache, INACTIVITY_CACHE_MS, inactivityTimeout } from '../src/features/auth/authPolicy.js';
import { hashPassword, verifyPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { resetSuperAdminPassword } from '../src/features/auth/superAdminRecovery.js';
import { updateAuthentication } from '../src/features/platform-settings/settings.service.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Authentication Settings tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const HOUR = 60 * 60 * 1000;
const tag = randomBytes(3).toString('hex');
const accounts = {};
const passwords = {};
const cookies = {};
let original; // the settings row before the tests (null when it did not exist)
let server;
let base;

async function call(path, { method = 'GET', body, rawBody, cookie, origin = ORIGIN, contentType = 'application/json' } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...((body !== undefined || rawBody !== undefined) && { 'content-type': contentType }),
      ...(method !== 'GET' && origin && { origin }),
      ...(cookie && { cookie }),
    },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, text, headers: response.headers };
}
const save = (body, role = 'SUPER_ADMIN') => call('/api/platform/settings/authentication', { method: 'PUT', body, cookie: cookies[role] });
const readSettings = (role = 'SUPER_ADMIN') => call('/api/platform/settings', { cookie: cookies[role] });
const storedLifetime = async () => (await prisma.platformSettings.findUnique({ where: { id: 'platform' } }))?.sessionLifetimeHours ?? null;
const setStoredLifetime = (value) =>
  prisma.platformSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform', sessionLifetimeHours: value }, update: { sessionLifetimeHours: value } });
const storedInactivity = async () => (await prisma.platformSettings.findUnique({ where: { id: 'platform' } }))?.inactivityTimeoutMinutes ?? null;
/** Writes the timeout directly (bypassing the API) and forgets this process's cached value. */
async function setStoredInactivity(value) {
  await prisma.platformSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform', inactivityTimeoutMinutes: value }, update: { inactivityTimeoutMinutes: value } });
  clearInactivityCache();
}
const authEvents = () =>
  prisma.auditEvent.findMany({ where: { actorId: { in: Object.values(accounts).map((a) => a.id) }, action: 'AUTH_SETTINGS_UPDATED' }, orderBy: { occurredAt: 'asc' } });

/** Signs in and returns { cookie, session } (the stored session row). */
async function signIn(role) {
  const res = await call('/api/auth/login', { method: 'POST', body: { email: accounts[role].email, password: passwords[role] } });
  assert.equal(res.status, 200, `${role} sign-in`);
  const token = res.headers.get('set-cookie').split(';')[0];
  const session = await prisma.session.findFirst({ where: { userId: accounts[role].id }, orderBy: { createdAt: 'desc' } });
  return { cookie: token, session };
}
const sessionById = (id) => prisma.session.findUnique({ where: { id } });

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  original = await prisma.platformSettings.findUnique({ where: { id: 'platform' } });
  await setStoredLifetime(null);
  await setStoredInactivity(null);
  for (const role of ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'STAFF']) {
    passwords[role] = randomBytes(12).toString('base64url');
    const email = `test-auth-${role.toLowerCase()}-${tag}@test.edutrack.example`;
    accounts[role] = await prisma.user.create({ data: { name: `Auth ${role} ${tag}`, email, role, ...(await branchFor(role)), passwordHash: await hashPassword(passwords[role]) } });
    cookies[role] = (await signIn(role)).cookie;
  }
});

after(async () => {
  if (original) {
    const { id, updatedAt, ...values } = original;
    await prisma.platformSettings.upsert({ where: { id }, create: { ...values, id }, update: values });
    // Put the original timestamp back too, so the row is exactly as before.
    await prisma.$executeRaw`UPDATE "PlatformSettings" SET "updatedAt" = ${updatedAt} WHERE "id" = ${id}`;
  } else {
    await prisma.platformSettings.deleteMany({ where: { id: 'platform' } });
  }
  clearInactivityCache();
  const ids = Object.values(accounts).map((a) => a.id);
  await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { targetId: { in: ids } }] } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } }); // sessions are removed with their users
  await removeTestBranches();
  server.close();
  await prisma.$disconnect();
});

describe('who may read and change Authentication Settings', () => {
  test('signed out → 401; OWNER, MANAGER, STAFF → 403; nothing changes and nothing is recorded', async () => {
    assert.equal((await call('/api/platform/settings')).status, 401);
    assert.equal((await call('/api/platform/settings/authentication', { method: 'PUT', body: { sessionLifetimeHours: 24 } })).status, 401);
    for (const role of ['OWNER', 'MANAGER', 'STAFF']) {
      for (const res of [await readSettings(role), await save({ sessionLifetimeHours: 24 }, role)]) {
        assert.equal(res.status, 403, role);
        assert.equal(res.body.code, 'FORBIDDEN');
        assert.ok(!res.text.includes('sessionLifetime'), `${role}: no settings in the response`);
      }
    }
    assert.equal(await storedLifetime(), null);
    assert.equal((await authEvents()).length, 0);
  });

  test('a request from another origin → 403', async () => {
    const res = await call('/api/platform/settings/authentication', { method: 'PUT', body: { sessionLifetimeHours: 24 }, cookie: cookies.SUPER_ADMIN, origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    assert.equal(await storedLifetime(), null);
  });

  test('the public branding endpoint exposes no authentication settings', async () => {
    const res = await call('/api/branding');
    assert.deepEqual(Object.keys(res.body), ['platformName']);
  });

  test('SUPER_ADMIN reads the enforced values; no sessions, tokens or password data', async () => {
    const res = await readSettings();
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.settings.authentication, {
      sessionLifetime: { hours: 12, source: 'default', minHours: 1, maxHours: 72, defaultHours: 12 },
      inactivityTimeout: { enabled: false, minutes: null, choices: [5, 10, 15, 30, 60, 120, 240, 480] },
      failedSignInLimit: { attempts: 5, windowMinutes: 15, per: 'email and network address' },
      minPasswordLength: 12,
      mfa: { available: false },
    });
    assert.ok(!/tokenHash|passwordHash|scrypt\$|edutrack_session|DATABASE_URL|postgres(ql)?:\/\//.test(res.text));
  });
});

describe('session lifetime: validation', () => {
  test('1 and 72 hours are accepted', async () => {
    for (const hours of [1, 72]) {
      const res = await save({ sessionLifetimeHours: hours });
      assert.equal(res.status, 200, String(hours));
      assert.equal(res.body.authentication.sessionLifetime.hours, hours);
      assert.equal(res.body.authentication.sessionLifetime.source, 'setting');
      assert.equal(await storedLifetime(), hours);
    }
  });

  test('values outside 1–72, non-integers, wrong types, other fields and non-JSON → 400; nothing changes, nothing recorded', async () => {
    await setStoredLifetime(24);
    const before = (await authEvents()).length;
    const invalid = [
      {},
      { sessionLifetimeHours: 0 },
      { sessionLifetimeHours: 73 },
      { sessionLifetimeHours: -1 },
      { sessionLifetimeHours: 12.5 },
      { sessionLifetimeHours: '12' },
      { sessionLifetimeHours: null },
      { sessionLifetimeHours: true },
      { sessionLifetimeHours: [12] },
      { sessionLifetimeHours: 1e309 },
      { inactivityTimeoutMinutes: 30, mfa: true },
      { sessionLifetimeHours: 12, minPasswordLength: 8 },
      { failedSignInLimit: 10 },
    ];
    for (const body of invalid) {
      const res = await save(body);
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.code, 'VALIDATION_ERROR');
    }
    const field = await save({ sessionLifetimeHours: 0 });
    assert.equal(field.body.details.sessionLifetimeHours, 'Session lifetime must be a whole number of hours from 1 to 72.');
    for (const raw of ['[]', '"12"', 'null']) assert.equal((await call('/api/platform/settings/authentication', { method: 'PUT', rawBody: raw, cookie: cookies.SUPER_ADMIN })).status, 400, raw);
    assert.equal((await call('/api/platform/settings/authentication', { method: 'PUT', rawBody: 'sessionLifetimeHours=12', contentType: 'application/x-www-form-urlencoded', cookie: cookies.SUPER_ADMIN })).status, 403);
    assert.equal(await storedLifetime(), 24);
    assert.equal((await authEvents()).length, before);
  });

  test('no valid stored value → 12 hours (stored values outside the rules are ignored)', async () => {
    for (const stored of [null, 0, 73, 500, -4]) {
      await setStoredLifetime(stored);
      const { sessionLifetime } = (await readSettings()).body.settings.authentication;
      assert.deepEqual([sessionLifetime.hours, sessionLifetime.source], [12, 'default'], String(stored));
      const { session } = await signIn('OWNER');
      assert.equal(session.expiresAt - session.lastUsedAt, 12 * HOUR, `sign-in with stored ${stored} lasts 12 hours`);
    }
  });
});

describe('session lifetime: applies to new sign-ins only', () => {
  test('a new sign-in gets the saved lifetime; an existing session keeps its expiry', async () => {
    await setStoredLifetime(null);
    const existing = await signIn('OWNER');
    assert.equal(existing.session.expiresAt - existing.session.lastUsedAt, 12 * HOUR);

    assert.equal((await save({ sessionLifetimeHours: 24 })).status, 200);
    const fresh = await signIn('OWNER');
    assert.equal(fresh.session.expiresAt - fresh.session.lastUsedAt, 24 * HOUR, 'new session: 24 hours from sign-in');
    assert.equal((await sessionById(existing.session.id)).expiresAt.getTime(), existing.session.expiresAt.getTime(), 'existing expiry unchanged');
    assert.equal((await call('/api/auth/session', { cookie: existing.cookie })).body.user?.role, 'OWNER', 'existing session still valid');

    assert.equal((await save({ sessionLifetimeHours: 1 })).status, 200);
    assert.equal((await sessionById(fresh.session.id)).expiresAt.getTime(), fresh.session.expiresAt.getTime(), 'shortening does not shorten open sessions');
    const short = await signIn('OWNER');
    assert.equal(short.session.expiresAt - short.session.lastUsedAt, 1 * HOUR);
    // The cookie's own expiry matches the session.
    const res = await call('/api/auth/login', { method: 'POST', body: { email: accounts.OWNER.email, password: passwords.OWNER } });
    const expires = new Date(/Expires=([^;]+)/i.exec(res.headers.get('set-cookie'))[1]);
    assert.ok(Math.abs(expires - Date.now() - HOUR) < 60 * 1000, 'cookie expires in about an hour');
  });
});

describe('audit', () => {
  test('an actual change records exactly one AUTH_SETTINGS_UPDATED event with the previous and new lifetime', async () => {
    await setStoredLifetime(null);
    await prisma.auditEvent.deleteMany({ where: { actorId: accounts.SUPER_ADMIN.id, action: 'AUTH_SETTINGS_UPDATED' } });
    assert.equal((await save({ sessionLifetimeHours: 24 })).status, 200);
    const events = await authEvents();
    assert.equal(events.length, 1);
    const [event] = events;
    assert.equal(event.result, 'SUCCESS');
    assert.equal(event.actorId, accounts.SUPER_ADMIN.id);
    assert.equal(event.targetName, 'Authentication settings');
    assert.deepEqual(event.change, { field: 'Session lifetime', from: '12 hours', to: '24 hours' });
    const text = JSON.stringify(event);
    assert.ok(!text.includes(passwords.SUPER_ADMIN) && !/tokenHash|passwordHash|scrypt\$|edutrack_session/.test(text), 'no secrets');
    for (const value of Object.values(cookies)) assert.ok(!text.includes(value.split('=')[1]), 'no session token');

    const listed = await call('/api/platform/audit-logs?action=AUTH_SETTINGS_UPDATED&pageSize=100', { cookie: cookies.SUPER_ADMIN });
    assert.equal(listed.status, 200);
    assert.ok(listed.body.items.some((e) => e.id === event.id), 'filterable in the audit log');
  });

  test('the same value (saved or in force by default) changes nothing and records nothing', async () => {
    const before = (await authEvents()).length;
    assert.equal((await save({ sessionLifetimeHours: 24 })).status, 200);
    await setStoredLifetime(null);
    const res = await save({ sessionLifetimeHours: 12 });
    assert.equal(res.status, 200);
    assert.equal(res.body.authentication.sessionLifetime.source, 'default');
    assert.equal(await storedLifetime(), null, 'the default stays a default');
    assert.equal((await authEvents()).length, before);
  });

  test('the change and its event are one transaction: an audit failure saves nothing', async () => {
    await setStoredLifetime(48);
    const before = (await authEvents()).length;
    const brokenRequest = { ip: '127.0.0.1', get: () => { throw new Error('audit write failed'); } };
    const actor = { id: accounts.SUPER_ADMIN.id, name: accounts.SUPER_ADMIN.name, role: 'SUPER_ADMIN' };
    await assert.rejects(updateAuthentication({ sessionLifetimeHours: 6 }, actor, brokenRequest), /audit write failed/);
    assert.equal(await storedLifetime(), 48);
    await setStoredInactivity(null);
    await assert.rejects(updateAuthentication({ inactivityTimeoutMinutes: 15 }, actor, brokenRequest), /audit write failed/);
    assert.equal(await storedInactivity(), null);
    assert.equal(await inactivityTimeout(), null, 'the rolled-back timeout is not applied');
    assert.equal((await authEvents()).length, before);
  });
});

describe('inactivity timeout', () => {
  const MINUTE = 60 * 1000;
  const setTimeoutTo = async (minutes) => {
    const res = await save({ inactivityTimeoutMinutes: minutes });
    assert.equal(res.status, 200, `save ${minutes}`);
    return res;
  };
  /** A fresh session for `role` whose last recorded activity was `idleMs` ago. */
  async function idleSession(role, idleMs) {
    const { cookie, session } = await signIn(role);
    await prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date(Date.now() - idleMs) } });
    return { cookie, id: session.id };
  }
  const isValid = async ({ cookie }) => (await call('/api/auth/session', { cookie })).body.user !== null;

  after(async () => {
    await prisma.platformSettings.update({ where: { id: 'platform' }, data: { inactivityTimeoutMinutes: null } });
    clearInactivityCache();
  });

  test('disabled by default: a long-idle session stays valid until its expiry', async () => {
    await setStoredInactivity(null);
    assert.deepEqual((await readSettings()).body.settings.authentication.inactivityTimeout, { enabled: false, minutes: null, choices: [5, 10, 15, 30, 60, 120, 240, 480] });
    assert.ok(await isValid(await idleSession('MANAGER', 10 * 24 * HOUR)));
  });

  test('only the approved choices (5–480 minutes) or null are accepted; nothing is saved otherwise', async () => {
    await setStoredInactivity(null);
    for (const minutes of [5, 10, 15, 30, 60, 120, 240, 480, null]) {
      const res = await setTimeoutTo(minutes);
      assert.deepEqual([res.body.authentication.inactivityTimeout.enabled, res.body.authentication.inactivityTimeout.minutes], [minutes !== null, minutes]);
      assert.equal(await storedInactivity(), minutes);
    }
    await setTimeoutTo(30);
    const before = (await authEvents()).length;
    for (const minutes of [0, 1, 4, 6, 20, 45, 481, 1440, -5, 30.5, '30', true, [30], {}]) {
      const res = await save({ inactivityTimeoutMinutes: minutes });
      assert.equal(res.status, 400, JSON.stringify(minutes));
      assert.equal(res.body.details.inactivityTimeoutMinutes, 'Inactivity timeout must be disabled (null) or one of 5, 10, 15, 30, 60, 120, 240, 480 minutes.');
    }
    const mixed = await save({ sessionLifetimeHours: 24, inactivityTimeoutMinutes: 7 });
    assert.equal(mixed.status, 400, 'one invalid field rejects the whole request');
    assert.equal(await storedInactivity(), 30);
    assert.notEqual(await storedLifetime(), 24);
    assert.equal((await authEvents()).length, before);
  });

  test('when set, it applies to existing sessions: idle ones end (and stay ended), active ones continue', async () => {
    await setStoredInactivity(null);
    const idle = await idleSession('SUPER_ADMIN', 31 * MINUTE);
    const active = await idleSession('SUPER_ADMIN', 5 * MINUTE);

    await setTimeoutTo(30); // set after both sessions exist
    assert.equal((await call('/api/platform/settings', { cookie: idle.cookie })).status, 401, 'idle session refused');
    assert.equal(await sessionById(idle.id), null, 'idle session deleted');
    const res = await call('/api/platform/settings', { cookie: active.cookie });
    assert.equal(res.status, 200, 'active session continues');
    assert.ok(Date.now() - (await sessionById(active.id)).lastUsedAt < MINUTE, 'its activity is recorded');

    await setTimeoutTo(null);
    assert.equal(await isValid(idle), false, 'turning the timeout off does not revive an ended session');
  });

  test('boundaries: 5 and 480 minutes', async () => {
    await setTimeoutTo(5);
    assert.equal(await isValid(await idleSession('STAFF', 5 * MINUTE + 1000)), false, 'just over 5 minutes idle → ended');
    assert.equal(await isValid(await idleSession('STAFF', 4 * MINUTE)), true, '4 minutes idle → valid');
    await setTimeoutTo(480);
    assert.equal(await isValid(await idleSession('STAFF', 480 * MINUTE + 1000)), false, 'just over 480 minutes idle → ended');
    assert.equal(await isValid(await idleSession('STAFF', 479 * MINUTE)), true, '479 minutes idle → valid');
  });

  test('changing the timeout applies to open sessions at once (raised keeps them, lowered ends them)', async () => {
    await setTimeoutTo(15);
    const session = await idleSession('OWNER', 20 * MINUTE); // idle longer than 15 minutes, not yet checked
    await setTimeoutTo(30);
    assert.equal(await isValid(session), true, 'raised to 30 before its next request: still valid');
    await prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: new Date(Date.now() - 20 * MINUTE) } });
    await setTimeoutTo(10);
    assert.equal(await isValid(session), false, 'lowered to 10: ended');
  });

  test('every change is audited once with the previous and new values; the same value records nothing', async () => {
    await setTimeoutTo(null);
    await prisma.auditEvent.deleteMany({ where: { actorId: accounts.SUPER_ADMIN.id, action: 'AUTH_SETTINGS_UPDATED' } });
    await setTimeoutTo(60);
    await setTimeoutTo(60);
    await setTimeoutTo(null);
    const events = (await authEvents()).filter((e) => e.change.field === 'Inactivity timeout');
    assert.deepEqual(events.map((e) => [e.change.from, e.change.to]), [['Disabled', '60 minutes'], ['60 minutes', 'Disabled']]);
    // Both settings in one request: one event per setting that changed.
    await prisma.auditEvent.deleteMany({ where: { actorId: accounts.SUPER_ADMIN.id, action: 'AUTH_SETTINGS_UPDATED' } });
    const lifetime = (await readSettings()).body.settings.authentication.sessionLifetime.hours;
    assert.equal((await save({ sessionLifetimeHours: lifetime === 8 ? 9 : 8, inactivityTimeoutMinutes: 15 })).status, 200);
    assert.deepEqual((await authEvents()).map((e) => e.change.field).sort(), ['Inactivity timeout', 'Session lifetime']);
  });

  test('a stored value that is not an approved choice is never used (disabled)', async () => {
    for (const stored of [7, 0, -30, 1000]) {
      await setStoredInactivity(stored);
      assert.equal((await readSettings()).body.settings.authentication.inactivityTimeout.enabled, false, String(stored));
      assert.equal(await isValid(await idleSession('STAFF', 5 * 24 * HOUR)), true, `stored ${stored}: no timeout applied`);
    }
  });

  test('cache: a value written elsewhere (e.g. by another API process) is applied after the cache period', async () => {
    await setTimeoutTo(null);
    const now = Date.now();
    assert.equal(await inactivityTimeout(now), null);
    // Written directly, as another process would: this process keeps the cached value for now...
    await prisma.platformSettings.update({ where: { id: 'platform' }, data: { inactivityTimeoutMinutes: 10 } });
    assert.equal(await inactivityTimeout(now + 1000), null, 'cached');
    // ...and reads it again once the cache period has passed.
    assert.equal(await inactivityTimeout(now + INACTIVITY_CACHE_MS + 1), 10, 'read again after the cache period');
    assert.equal(INACTIVITY_CACHE_MS, 30 * 1000);
    await setStoredInactivity(null);
  });

  test('the absolute lifetime still applies to active sessions', async () => {
    await setTimeoutTo(30);
    const { cookie, session } = await signIn('STAFF');
    await prisma.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await call('/api/auth/session', { cookie })).body.user, null);
    await setTimeoutTo(null);
  });
});

describe('activity tracking', () => {
  test('written at most once per interval, not on every request', async () => {
    assert.equal(ACTIVITY_WRITE_INTERVAL_MS, 60 * 1000);
    const { cookie, session } = await signIn('STAFF');
    for (let i = 0; i < 5; i += 1) assert.equal((await call('/api/auth/session', { cookie })).body.user?.role, 'STAFF');
    assert.equal((await sessionById(session.id)).lastUsedAt.getTime(), session.lastUsedAt.getTime(), 'no write within the first minute');

    const stale = new Date(Date.now() - 61 * 1000);
    await prisma.session.update({ where: { id: session.id }, data: { lastUsedAt: stale } });
    await call('/api/auth/session', { cookie });
    const written = (await sessionById(session.id)).lastUsedAt;
    assert.ok(written > stale && Date.now() - written < 60 * 1000, 'one request after the interval records activity');
    await Promise.all([1, 2, 3].map(() => call('/api/auth/session', { cookie })));
    assert.equal((await sessionById(session.id)).lastUsedAt.getTime(), written.getTime(), 'then no further writes within the interval');
  });

  test('a rejected session records no activity', async () => {
    const { cookie, session } = await signIn('STAFF');
    const old = new Date(Date.now() - 2 * HOUR);
    await prisma.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000), lastUsedAt: old } });
    assert.equal((await call('/api/auth/session', { cookie })).body.user, null);
    assert.equal((await sessionById(session.id)).lastUsedAt.getTime(), old.getTime());
  });
});

describe('command-line Super Admin password reset', () => {
  const script = fileURLToPath(new URL('../scripts/reset-super-admin-password.js', import.meta.url));
  const cwd = fileURLToPath(new URL('..', import.meta.url));

  /** Runs the command with the given arguments and input lines → { code, output }. */
  function run(args, lines = []) {
    return new Promise((resolve) => {
      const child = spawn(process.execPath, [script, ...args], { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', (chunk) => (output += chunk));
      child.stderr.on('data', (chunk) => (output += chunk));
      child.on('close', (code) => resolve({ code, output }));
      child.stdin.end(lines.map((line) => `${line}\n`).join(''));
    });
  }
  const hashOf = async (role) => (await prisma.user.findUnique({ where: { id: accounts[role].id } })).passwordHash;

  test('resets a SUPER_ADMIN password: new password works, old does not, sessions end; nothing secret is printed', async () => {
    resetLimiter();
    const { cookie } = await signIn('SUPER_ADMIN');
    const newPassword = `Reset-${randomBytes(9).toString('base64url')}`;
    const { code, output } = await run(['--email', accounts.SUPER_ADMIN.email.toUpperCase()], ['RESET', newPassword, newPassword]);
    assert.equal(code, 0, output);
    assert.match(output, /Password reset for /);
    const hash = await hashOf('SUPER_ADMIN');
    assert.ok(!output.includes(newPassword) && !output.includes(hash) && !output.includes('scrypt$'), 'no password or hash in the output');
    assert.ok(await verifyPassword(newPassword, hash));
    assert.equal(await prisma.session.count({ where: { userId: accounts.SUPER_ADMIN.id } }), 0, 'existing sessions ended');
    assert.equal((await call('/api/auth/session', { cookie })).body.user, null);
    const user = await prisma.user.findUnique({ where: { id: accounts.SUPER_ADMIN.id } });
    assert.deepEqual([user.role, user.status], ['SUPER_ADMIN', 'ACTIVE'], 'role and status unchanged');

    // One security audit event: target and execution context, no password or hash.
    assert.match(output, /A security audit event was recorded./);
    const resets = await prisma.auditEvent.findMany({ where: { action: 'SUPER_ADMIN_PASSWORD_RESET', targetId: accounts.SUPER_ADMIN.id } });
    assert.equal(resets.length, 1);
    const [event] = resets;
    assert.deepEqual(
      [event.result, event.actorId, event.actorName, event.actorRole, event.targetType, event.targetName],
      ['SUCCESS', null, 'Command-line operator', null, 'user', accounts.SUPER_ADMIN.name],
    );
    assert.match(event.description, /^Super Admin password reset from the command line \(reset-super-admin-password\) on host ".+" by operating-system user ".+"\. \d+ sessions? (was|were) ended\.$/);
    const eventText = JSON.stringify(event);
    assert.ok(!eventText.includes(newPassword) && !eventText.includes(hash) && !eventText.includes('scrypt$'), 'no password or hash in the event');

    const oldSignIn = await call('/api/auth/login', { method: 'POST', body: { email: accounts.SUPER_ADMIN.email, password: passwords.SUPER_ADMIN } });
    assert.equal(oldSignIn.status, 401);
    passwords.SUPER_ADMIN = newPassword;
    resetLimiter();
    cookies.SUPER_ADMIN = (await signIn('SUPER_ADMIN')).cookie;

    // Listed in the audit log and counted as a security event.
    const listed = await call('/api/platform/audit-logs?action=SUPER_ADMIN_PASSWORD_RESET&pageSize=100', { cookie: cookies.SUPER_ADMIN });
    const item = listed.body.items.find((e) => e.id === event.id);
    assert.ok(item, 'listed');
    assert.equal(item.target.type, 'user');
  });

  test('if the security audit record cannot be written, the password is not changed and the error is raised', async () => {
    resetLimiter();
    await signIn('SUPER_ADMIN');
    const before = { hash: await hashOf('SUPER_ADMIN'), sessions: await prisma.session.count({ where: { userId: accounts.SUPER_ADMIN.id } }) };
    const events = () => prisma.auditEvent.count({ where: { action: 'SUPER_ADMIN_PASSWORD_RESET', targetId: accounts.SUPER_ADMIN.id } });
    const eventsBefore = await events();
    // A NUL character cannot be stored in PostgreSQL text: the audit insert fails inside the transaction.
    await assert.rejects(resetSuperAdminPassword(accounts.SUPER_ADMIN.id, 'Unsaved-password-123', { tool: 'test', host: 'bad\u0000host', osUser: 'tester' }));
    assert.equal(await hashOf('SUPER_ADMIN'), before.hash, 'password unchanged');
    assert.equal(await prisma.session.count({ where: { userId: accounts.SUPER_ADMIN.id } }), before.sessions, 'sessions unchanged');
    assert.equal(await events(), eventsBefore, 'no event');
  });

  test('the recovery function itself refuses accounts that are not SUPER_ADMIN', async () => {
    for (const role of ['OWNER', 'MANAGER', 'STAFF']) {
      const before = await hashOf(role);
      await assert.rejects(resetSuperAdminPassword(accounts[role].id, 'Another-password-123', { tool: 'test', host: 'h', osUser: 'u' }), /No Super Admin account/);
      assert.equal(await hashOf(role), before, role);
    }
  });

  test('refuses OWNER, MANAGER, STAFF and unknown accounts with the same message; nothing changes', async () => {
    for (const role of ['OWNER', 'MANAGER', 'STAFF']) {
      const before = await hashOf(role);
      const { code, output } = await run(['--email', accounts[role].email], ['RESET', 'Another-password-123', 'Another-password-123']);
      assert.equal(code, 1, role);
      assert.match(output, /No Super Admin account has this email\. Nothing was changed\./);
      assert.ok(!output.includes(accounts[role].name), `${role}: the account is not described`);
      assert.equal(await hashOf(role), before, role);
      assert.equal(await prisma.auditEvent.count({ where: { action: 'SUPER_ADMIN_PASSWORD_RESET', targetId: accounts[role].id } }), 0, `${role}: no event`);
    }
    const unknown = await run(['--email', `nobody-${tag}@test.edutrack.example`], ['RESET', 'Another-password-123', 'Another-password-123']);
    assert.equal(unknown.code, 1);
    assert.match(unknown.output, /No Super Admin account has this email/);
  });

  test('needs explicit confirmation and a valid, repeated password; nothing changes otherwise', async () => {
    const before = await hashOf('SUPER_ADMIN');
    const email = accounts.SUPER_ADMIN.email;
    const cases = [
      [['reset', 'Another-password-123', 'Another-password-123'], /Not confirmed/],
      [['yes', 'Another-password-123', 'Another-password-123'], /Not confirmed/],
      [['RESET', 'short', 'short'], /at least 12 characters/],
      [['RESET', '              ', '              '], /only spaces/],
      [['RESET', 'Another-password-123', 'Different-password-123'], /do not match/],
      [['RESET', 'Another-password-123'], /Input ended/],
      [[], /Input ended/],
    ];
    for (const [lines, message] of cases) {
      const { code, output } = await run(['--email', email], lines);
      assert.equal(code, 1, JSON.stringify(lines));
      assert.match(output, message);
      assert.ok(!output.includes('Another-password-123'), 'typed passwords are not echoed');
    }
    assert.equal(await hashOf('SUPER_ADMIN'), before);
  });

  test('never takes the password as an argument, and the argument is not echoed', async () => {
    const before = await hashOf('SUPER_ADMIN');
    for (const args of [['--email', accounts.SUPER_ADMIN.email, '--password', 'Argument-password-123'], ['--email', accounts.SUPER_ADMIN.email, 'Argument-password-123'], []]) {
      const { code, output } = await run(args, ['RESET', 'Argument-password-123', 'Argument-password-123']);
      assert.equal(code, 1, JSON.stringify(args));
      assert.ok(!output.includes('Argument-password-123'), 'argument not echoed');
    }
    assert.equal(await hashOf('SUPER_ADMIN'), before);
  });
});

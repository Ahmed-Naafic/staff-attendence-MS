/*
 * Branding tests (approved rules): only a SUPER_ADMIN changes the platform name (401 signed out,
 * 403 for other roles); the name is trimmed, 1–60 characters, without control characters, and no
 * other field is accepted; each actual change records one BRANDING_UPDATED event with the previous
 * and new name, in the same transaction; the public branding endpoint returns the platform name only.
 * Runs on the Neon dev branch (`npm test`). The settings row is restored afterwards exactly as it
 * was, and everything else the tests create is removed.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { updateBranding } from '../src/features/platform-settings/settings.service.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Branding tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex');
const accounts = {};
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
  return { status: response.status, body: text ? JSON.parse(text) : null, text };
}
const save = (platformName, role = 'SUPER_ADMIN') => call('/api/platform/settings/branding', { method: 'PUT', body: { platformName }, cookie: cookies[role] });
const storedName = async () => (await prisma.platformSettings.findUnique({ where: { id: 'platform' } }))?.platformName ?? null;
const testEvents = () => prisma.auditEvent.findMany({ where: { actorId: { in: Object.values(accounts).map((a) => a.id) } }, orderBy: { occurredAt: 'asc' } });
const brandingEvents = async () => (await testEvents()).filter((e) => e.action === 'BRANDING_UPDATED');
const dbNow = async () => (await prisma.$queryRaw`SELECT now() AS t`)[0].t;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  original = await prisma.platformSettings.findUnique({ where: { id: 'platform' } });
  for (const role of ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'STAFF']) {
    const password = randomBytes(12).toString('base64url');
    const email = `test-brand-${role.toLowerCase()}-${tag}@test.edutrack.example`;
    accounts[role] = await prisma.user.create({ data: { name: `Branding ${role} ${tag}`, email, role, ...(await branchFor(role)), passwordHash: await hashPassword(password) } });
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(res.status, 200, `${role} sign-in`);
    cookies[role] = res.headers.get('set-cookie').split(';')[0];
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
  const ids = Object.values(accounts).map((a) => a.id);
  await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await removeTestBranches();
  server.close();
  await prisma.$disconnect();
});

describe('public branding endpoint', () => {
  test('returns only { platformName }, without sign-in', async () => {
    await prisma.platformSettings.upsert({
      where: { id: 'platform' },
      create: { id: 'platform', platformName: `Public ${tag}`, supportEmail: `hidden-${tag}@example.com`, description: `Hidden ${tag}` },
      update: { platformName: `Public ${tag}`, supportEmail: `hidden-${tag}@example.com`, description: `Hidden ${tag}` },
    });
    const res = await call('/api/branding');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { platformName: `Public ${tag}` });
    assert.ok(!res.text.includes(`hidden-${tag}`) && !res.text.includes(`Hidden ${tag}`), 'no other settings');
  });

  test('returns null when the name is not set or does not meet the rules', async () => {
    for (const stored of [null, '', '   ', `Line\nbreak ${tag}`, 'x'.repeat(61)]) {
      await prisma.platformSettings.update({ where: { id: 'platform' }, data: { platformName: stored } });
      assert.deepEqual((await call('/api/branding')).body, { platformName: null }, JSON.stringify(stored));
    }
  });

  test('is read-only', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal((await call('/api/branding', { method, body: { platformName: 'X' }, cookie: cookies.SUPER_ADMIN })).status, 404, method);
    }
  });
});

describe('who may change the platform name', () => {
  before(async () => {
    await prisma.platformSettings.update({ where: { id: 'platform' }, data: { platformName: `Start ${tag}` } });
  });

  test('signed out → 401, other roles → 403; nothing changes and nothing is recorded', async () => {
    assert.equal((await call('/api/platform/settings/branding', { method: 'PUT', body: { platformName: 'Nope' } })).status, 401);
    for (const role of ['OWNER', 'MANAGER', 'STAFF']) {
      const res = await save(`Nope ${role}`, role);
      assert.equal(res.status, 403, role);
      assert.equal(res.body.code, 'FORBIDDEN');
    }
    assert.equal(await storedName(), `Start ${tag}`);
    assert.equal((await brandingEvents()).length, 0);
  });

  test('a request from another origin → 403', async () => {
    const res = await call('/api/platform/settings/branding', { method: 'PUT', body: { platformName: 'Elsewhere' }, cookie: cookies.SUPER_ADMIN, origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    assert.equal(await storedName(), `Start ${tag}`);
  });
});

describe('validation', () => {
  test('invalid names, other fields and non-JSON bodies → 400; nothing changes', async () => {
    const invalid = [
      { body: {}, field: true },
      { body: { platformName: '' }, field: true },
      { body: { platformName: '    ' }, field: true },
      { body: { platformName: null }, field: true },
      { body: { platformName: 42 }, field: true },
      { body: { platformName: ['A'] }, field: true },
      { body: { platformName: 'x'.repeat(61) }, field: true },
      { body: { platformName: 'Line\nbreak' }, field: true },
      { body: { platformName: 'Tab\there' }, field: true },
      { body: { platformName: 'Bell\u0007' }, field: true },
      { body: { platformName: 'Next\u0085line' }, field: true },
      { body: { platformName: 'Delete\u007f' }, field: true },
      { body: { platformName: 'Fine', description: 'extra' } },
      { body: { platformName: 'Fine', supportEmail: 'a@b.example' } },
      { body: { platformName: 'Fine', logo: 'data:image/png;base64,AAAA' } },
      { body: { platformName: 'Fine', actorId: accounts.OWNER?.id ?? 'x' } },
    ];
    for (const { body, field } of invalid) {
      const res = await call('/api/platform/settings/branding', { method: 'PUT', body, cookie: cookies.SUPER_ADMIN });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.equal(res.body.code, 'VALIDATION_ERROR');
      if (field) assert.ok(res.body.details?.platformName, `field message for ${JSON.stringify(body)}`);
    }
    for (const rawBody of ['["Name"]', '"Name"']) {
      assert.equal((await call('/api/platform/settings/branding', { method: 'PUT', rawBody, cookie: cookies.SUPER_ADMIN })).status, 400, rawBody);
    }
    assert.equal(await storedName(), `Start ${tag}`);
    assert.equal((await brandingEvents()).length, 0);
  });

  test('the name is trimmed; 1 and 60 characters are accepted (characters, not bytes)', async () => {
    for (const [sent, saved] of [
      ['  Spaced Name  ', 'Spaced Name'],
      ['A', 'A'],
      ['é'.repeat(60), 'é'.repeat(60)],
      ['🏫'.repeat(60), '🏫'.repeat(60)],
    ]) {
      const res = await save(sent);
      assert.equal(res.status, 200, JSON.stringify(sent));
      assert.deepEqual(res.body, { branding: { platformName: saved } });
      assert.equal(await storedName(), saved);
    }
  });
});

describe('saving and auditing', () => {
  before(async () => {
    await prisma.platformSettings.update({ where: { id: 'platform' }, data: { platformName: `Before ${tag}` } });
    await prisma.auditEvent.deleteMany({ where: { actorId: accounts.SUPER_ADMIN.id, action: 'BRANDING_UPDATED' } });
  });

  test('a change is saved and records one event with the actor, target and before/after name', async () => {
    const start = await dbNow();
    const res = await save(`After ${tag}`);
    const end = await dbNow();
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { branding: { platformName: `After ${tag}` } });
    assert.equal(await storedName(), `After ${tag}`);

    const events = await brandingEvents();
    assert.equal(events.length, 1);
    const [event] = events;
    assert.equal(event.result, 'SUCCESS');
    assert.equal(event.actorId, accounts.SUPER_ADMIN.id);
    assert.equal(event.actorName, accounts.SUPER_ADMIN.name);
    assert.equal(event.actorRole, 'SUPER_ADMIN');
    assert.equal(event.targetType, 'system');
    assert.equal(event.targetId, null);
    assert.equal(event.schoolId, null);
    assert.deepEqual(event.change, { field: 'Platform name', from: `Before ${tag}`, to: `After ${tag}` });
    assert.ok(event.occurredAt >= start && event.occurredAt <= end, 'server timestamp');

    // The saved name is what every reader sees.
    assert.deepEqual((await call('/api/branding')).body, { platformName: `After ${tag}` });
    assert.equal((await call('/api/platform/settings', { cookie: cookies.SUPER_ADMIN })).body.settings.information.platformName, `After ${tag}`);
  });

  test('saving the current name (even with surrounding spaces) changes nothing and records nothing', async () => {
    const before = await prisma.platformSettings.findUnique({ where: { id: 'platform' } });
    for (const sent of [`After ${tag}`, `  After ${tag} `]) {
      const res = await save(sent);
      assert.equal(res.status, 200);
      assert.deepEqual(res.body, { branding: { platformName: `After ${tag}` } });
    }
    assert.equal((await brandingEvents()).length, 1);
    assert.deepEqual(await prisma.platformSettings.findUnique({ where: { id: 'platform' } }), before, 'row untouched');
  });

  test('the event is in the audit log API, filterable and searchable by its name, without credentials', async () => {
    const byAction = await call('/api/platform/audit-logs?action=BRANDING_UPDATED&pageSize=100', { cookie: cookies.SUPER_ADMIN });
    assert.equal(byAction.status, 200);
    const event = byAction.body.items.find((e) => e.actor.id === accounts.SUPER_ADMIN.id);
    assert.ok(event);
    assert.deepEqual(event.target, { type: 'system', id: null, name: 'Platform branding' });
    assert.deepEqual(event.change, { field: 'Platform name', from: `Before ${tag}`, to: `After ${tag}` });
    assert.ok(byAction.body.items.every((e) => e.action === 'BRANDING_UPDATED'));

    const bySearch = await call(`/api/platform/audit-logs?q=${encodeURIComponent('Update Branding')}&user=${accounts.SUPER_ADMIN.id}`, { cookie: cookies.SUPER_ADMIN });
    assert.ok(bySearch.body.items.some((e) => e.id === event.id));

    const text = JSON.stringify(byAction.body);
    assert.ok(!/scrypt\$|passwordHash|tokenHash|edutrack_session|DATABASE_URL|postgres(ql)?:\/\//i.test(text));
    assert.ok(!text.includes(cookies.SUPER_ADMIN.split('=')[1]), 'session cookie value');
  });

  test('if the audit event cannot be written, the name is not changed', async () => {
    const brokenRequest = { ip: '127.0.0.1', get() { throw new Error('audit write failed'); } };
    await assert.rejects(updateBranding(`Rolled back ${tag}`, accounts.SUPER_ADMIN, brokenRequest), /audit write failed/);
    assert.equal(await storedName(), `After ${tag}`);
    assert.equal((await brandingEvents()).length, 1);
  });

  test('simultaneous saves are applied one after the other, each event recording the exact previous name', async () => {
    const names = [`One ${tag}`, `Two ${tag}`, `Three ${tag}`];
    const results = await Promise.all(names.map((name) => save(name)));
    assert.ok(results.every((r) => r.status === 200));
    const events = (await brandingEvents()).slice(1);
    assert.equal(events.length, 3);
    // The events form one chain from the previous name to the stored one.
    const froms = new Map(events.map((e) => [e.change.from, e.change.to]));
    let name = `After ${tag}`;
    for (let i = 0; i < 3; i += 1) {
      assert.ok(froms.has(name), `an event changes "${name}"`);
      name = froms.get(name);
    }
    assert.equal(await storedName(), name);
  });

  test('when no settings row exists, saving creates it', async () => {
    const saved = await prisma.platformSettings.findUnique({ where: { id: 'platform' } });
    await prisma.platformSettings.delete({ where: { id: 'platform' } });
    try {
      assert.deepEqual((await call('/api/branding')).body, { platformName: null });
      const res = await save(`Fresh ${tag}`);
      assert.equal(res.status, 200);
      const row = await prisma.platformSettings.findUnique({ where: { id: 'platform' } });
      assert.equal(row.platformName, `Fresh ${tag}`);
      assert.equal(row.supportEmail, null, 'no other setting is written');
      const last = (await brandingEvents()).at(-1);
      assert.deepEqual(last.change, { field: 'Platform name', from: null, to: `Fresh ${tag}` });
    } finally {
      const { id, updatedAt, ...values } = saved;
      await prisma.platformSettings.upsert({ where: { id }, create: { ...values, id }, update: values });
    }
  });
});

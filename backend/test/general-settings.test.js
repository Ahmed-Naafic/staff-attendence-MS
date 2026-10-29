/*
 * General Settings tests (approved rules): only a SUPER_ADMIN reads and changes platform
 * information and localization (401 signed out, 403 for other roles and other origins); every
 * field is validated by the server and invalid requests change nothing; empty optional text is
 * "Not set"; only fields that actually change are written, recording one GENERAL_SETTINGS_UPDATED
 * event with their previous and new values in the same transaction; stored values that break the
 * rules are kept until changed; the Dashboard follows the platform time zone, not the request.
 * Runs on the Neon dev branch (`npm test`). The settings row is restored afterwards exactly as it
 * was, and everything else the tests create is removed.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { updateGeneral } from '../src/features/platform-settings/settings.service.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('General settings tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex');
const accounts = {};
const cookies = {};
let original; // the settings row before the tests (null when it did not exist)
let server;
let base;

// A valid starting point for each test.
const START = {
  description: `Start description ${tag}`,
  supportEmail: `start-${tag}@example.com`,
  supportPhone: '+252612345678',
  websiteUrl: 'https://start.example.com',
  timezone: 'Africa/Mogadishu',
  language: 'en',
  dateFormat: 'YYYY-MM-DD',
  timeFormat: '24h',
  firstDayOfWeek: 'monday',
};

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
const save = (body, role = 'SUPER_ADMIN') => call('/api/platform/settings/general', { method: 'PUT', body, cookie: cookies[role] });
const row = () => prisma.platformSettings.findUnique({ where: { id: 'platform' } });
const generalEvents = () =>
  prisma.auditEvent.findMany({ where: { actorId: { in: Object.values(accounts).map((a) => a.id) }, action: 'GENERAL_SETTINGS_UPDATED' }, orderBy: { occurredAt: 'asc' } });
const reset = async (values = START) => {
  await prisma.platformSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform', ...values }, update: values });
  await prisma.auditEvent.deleteMany({ where: { actorId: { in: Object.values(accounts).map((a) => a.id) } } });
};
const pick = (r) => Object.fromEntries(Object.keys(START).map((k) => [k, r[k]]));

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  original = await row();
  for (const role of ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'STAFF']) {
    const password = randomBytes(12).toString('base64url');
    const email = `test-general-${role.toLowerCase()}-${tag}@test.edutrack.example`;
    accounts[role] = await prisma.user.create({ data: { name: `General ${role} ${tag}`, email, role, ...(await branchFor(role)), passwordHash: await hashPassword(password) } });
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(res.status, 200, `${role} sign-in`);
    cookies[role] = res.headers.get('set-cookie').split(';')[0];
  }
});

after(async () => {
  if (original) {
    const { id, updatedAt, ...values } = original;
    await prisma.platformSettings.upsert({ where: { id }, create: { ...values, id }, update: values });
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

describe('who may read and change General settings', () => {
  beforeEach(() => reset());

  test('signed out → 401, other roles → 403, for reading and saving; nothing changes and nothing is recorded', async () => {
    const body = { description: `Hacked ${tag}` };
    assert.equal((await call('/api/platform/settings')).status, 401);
    assert.equal((await call('/api/platform/settings/general', { method: 'PUT', body })).status, 401);
    for (const role of ['OWNER', 'MANAGER', 'STAFF']) {
      assert.equal((await call('/api/platform/settings', { cookie: cookies[role] })).status, 403, `read as ${role}`);
      assert.equal((await save(body, role)).status, 403, `save as ${role}`);
    }
    assert.deepEqual(pick(await row()), START);
    assert.equal((await generalEvents()).length, 0);
  });

  test('a request from another origin → 403', async () => {
    const res = await call('/api/platform/settings/general', { method: 'PUT', body: { description: 'x' }, cookie: cookies.SUPER_ADMIN, origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    assert.deepEqual(pick(await row()), START);
  });

  test('the public branding endpoint exposes no General setting', async () => {
    const res = await call('/api/branding');
    assert.deepEqual(Object.keys(res.body), ['platformName']);
    assert.ok(!res.text.includes(tag));
  });
});

describe('validation (server side)', () => {
  beforeEach(() => reset());

  const INVALID = {
    description: ['x'.repeat(501), '😀'.repeat(501), `Tab\there ${tag}`, `Bell\u0007 ${tag}`, `Nul\u0000 ${tag}`, `Del\u007f ${tag}`, 12, true, ['a'], { a: 1 }],
    supportEmail: [
      'not-an-email',
      'a@b',
      'a b@example.com',
      'a@exa mple.com',
      'a@@example.com',
      '.a@example.com',
      'a..b@example.com',
      'a@-example.com',
      'a@example.c',
      'a@example.123',
      `${'a'.repeat(65)}@example.com`,
      `a@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(57)}.com`,
      `a\u0000@example.com`,
      'a@example.com\nb@example.com',
      42,
    ],
    supportPhone: ['252612345678', '+252 61 2345678', '+252-61-2345678', '+0252612345678', '+1234567890123456', '+252612345678 ext 5', '+252612345678x5', '+25261234567a', '+', '+1', 'phone', 252612345678],
    websiteUrl: [
      'http://example.com',
      'example.com',
      'www.example.com',
      'https://',
      'https://user:pass@example.com',
      'https://user@example.com',
      'https://localhost',
      'https://127.0.0.1',
      'https://exa mple.com',
      'https://example.com/a b',
      'https://example.com/\u0007',
      'ftp://example.com',
      'javascript:alert(1)',
      `https://example.com/${'a'.repeat(2048 - 'https://example.com/'.length + 1)}`,
      'https://-bad-.com',
      7,
    ],
    timezone: ['+03:00', 'GMT+3', 'Mars/Base', 'utc', 'africa/mogadishu', 'Africa/Mogadishu ', '', null, 3],
    language: ['so', 'EN', 'en-US', '', null],
    dateFormat: ['MMM DD, YYYY', 'YYYY/MM/DD', 'dd/mm/yyyy', '', null],
    timeFormat: ['24', '12', '24H', 'h23', '', null],
    firstDayOfWeek: ['saturday', 'Monday', 'SUNDAY', 'mon', '', null, 1],
  };

  for (const [field, values] of Object.entries(INVALID)) {
    test(`${field}: invalid values → 400 naming the field; nothing changes, nothing recorded`, async () => {
      for (const value of values) {
        const res = await save({ [field]: value });
        assert.equal(res.status, 400, `${field} = ${JSON.stringify(value)?.slice(0, 60)}`);
        assert.equal(res.body.code, 'VALIDATION_ERROR');
        assert.ok(res.body.details?.[field], `details.${field} for ${JSON.stringify(value)?.slice(0, 60)}`);
      }
      assert.deepEqual(pick(await row()), START);
      assert.equal((await generalEvents()).length, 0);
    });
  }

  test('unknown fields (including the platform name, authentication and switches), empty and non-JSON bodies → 400', async () => {
    for (const body of [
      { platformName: `Renamed ${tag}` },
      { description: 'ok', platformName: 'x' },
      { sessionLifetimeHours: 24 },
      { allowSchoolRegistration: true },
      { auditLogging: false },
      { maintenanceMode: true },
      { logo: 'x.png' },
      {},
    ]) {
      const res = await save(body);
      assert.equal(res.status, 400, JSON.stringify(body));
    }
    for (const rawBody of ['[]', '"text"', 'null', '42']) {
      assert.equal((await call('/api/platform/settings/general', { method: 'PUT', rawBody, cookie: cookies.SUPER_ADMIN })).status, 400, rawBody);
    }
    assert.equal((await call('/api/platform/settings/general', { method: 'PUT', rawBody: 'description=x', contentType: 'application/x-www-form-urlencoded', cookie: cookies.SUPER_ADMIN })).status, 403);
    assert.deepEqual(pick(await row()), START);
    assert.equal((await generalEvents()).length, 0);
  });

  test('one invalid field rejects the whole request: nothing is saved (atomic)', async () => {
    const res = await save({ description: `New ${tag}`, supportEmail: `new-${tag}@example.com`, firstDayOfWeek: 'saturday' });
    assert.equal(res.status, 400);
    assert.deepEqual(Object.keys(res.body.details), ['firstDayOfWeek']);
    assert.deepEqual(pick(await row()), START);
    assert.equal((await generalEvents()).length, 0);
  });

  test('boundaries are accepted: 500-character description (characters, not bytes), line breaks, 254-character email, 15-digit phone, 2,048-character URL', async () => {
    const local = 'a'.repeat(64);
    const email = `${local}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`;
    assert.equal(email.length, 254);
    const url = `https://example.com/${'a'.repeat(2048 - 'https://example.com/'.length)}`;
    const cases = [
      [{ description: 'x'.repeat(500) }, 'x'.repeat(500)],
      [{ description: '😀'.repeat(500) }, '😀'.repeat(500)],
      [{ description: '  Line one\r\nLine two\rLine three\n  ' }, 'Line one\nLine two\nLine three'],
      [{ supportEmail: email }, email],
      [{ supportPhone: '+123456789012345' }, '+123456789012345'],
      [{ supportPhone: '+12' }, '+12'],
      [{ websiteUrl: url }, url],
      [{ websiteUrl: 'https://xn--bcher-kva.example/path?q=1#top' }, 'https://xn--bcher-kva.example/path?q=1#top'],
    ];
    for (const [body, stored] of cases) {
      const res = await save(body);
      assert.equal(res.status, 200, JSON.stringify(body).slice(0, 80));
      const [field] = Object.keys(body);
      assert.equal((await row())[field], stored, field);
    }
  });

  test('normalization: text is trimmed and the email is saved in lower case', async () => {
    const res = await save({ supportEmail: `  Support-${tag}@Example.COM  `, supportPhone: ' +252611111111 ', websiteUrl: ' https://Example.com/Path ' });
    assert.equal(res.status, 200);
    const r = await row();
    assert.equal(r.supportEmail, `support-${tag}@example.com`);
    assert.equal(r.supportPhone, '+252611111111');
    assert.equal(r.websiteUrl, 'https://Example.com/Path');
  });

  test('every approved choice is accepted', async () => {
    for (const [field, values] of Object.entries({
      timezone: ['UTC', 'Africa/Mogadishu', 'America/New_York', 'Europe/London'],
      language: ['en'],
      dateFormat: ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'],
      timeFormat: ['12h', '24h'],
      firstDayOfWeek: ['sunday', 'monday'],
    })) {
      for (const value of values) {
        assert.equal((await save({ [field]: value })).status, 200, `${field} = ${value}`);
        assert.equal((await row())[field], value);
      }
    }
  });

  test('empty optional text means "Not set" (stored as null); null is accepted too', async () => {
    const res = await save({ description: '   ', supportEmail: '', supportPhone: null, websiteUrl: '\n' });
    assert.equal(res.status, 200);
    const r = await row();
    assert.deepEqual([r.description, r.supportEmail, r.supportPhone, r.websiteUrl], [null, null, null, null]);
    assert.deepEqual(res.body.general.information, { platformName: r.platformName ?? '', description: '', supportEmail: '', supportPhone: '', websiteUrl: '' });
  });
});

describe('saving and audit', () => {
  beforeEach(() => reset());

  test('a multi-field change saves only the changed fields and records exactly one event with their before/after values', async () => {
    const res = await save({
      description: `New description ${tag}`,
      supportEmail: START.supportEmail, // unchanged
      timezone: 'UTC',
      timeFormat: '12h',
      firstDayOfWeek: 'sunday',
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.general.localization.timezone, 'UTC');
    assert.deepEqual(res.body.general.display, { timeZone: 'UTC', dateFormat: 'YYYY-MM-DD', timeFormat: '12h' });

    // Persisted: a fresh read (as after a page reload) returns the new values.
    const reread = (await call('/api/platform/settings', { cookie: cookies.SUPER_ADMIN })).body.settings;
    assert.equal(reread.information.description, `New description ${tag}`);
    assert.deepEqual(reread.localization, { timezone: 'UTC', language: 'en', dateFormat: 'YYYY-MM-DD', timeFormat: '12h', firstDayOfWeek: 'sunday' });
    assert.deepEqual(reread.conflicts, {});

    const events = await generalEvents();
    assert.equal(events.length, 1);
    const [event] = events;
    assert.equal(event.result, 'SUCCESS');
    assert.equal(event.actorId, accounts.SUPER_ADMIN.id);
    assert.equal(event.actorRole, 'SUPER_ADMIN');
    assert.equal(event.targetType, 'system');
    assert.equal(event.targetName, 'General settings');
    assert.deepEqual(event.change, {
      fields: [
        { field: 'Platform description', from: START.description, to: `New description ${tag}` },
        { field: 'Timezone', from: 'Africa/Mogadishu', to: 'UTC' },
        { field: 'Time format', from: '24-hour', to: '12-hour' },
        { field: 'First day of week', from: 'Monday', to: 'Sunday' },
      ],
    });
    assert.ok(!event.change.fields.some((f) => f.field === 'Support email'), 'unchanged fields are not recorded');
  });

  test('clearing a field records "Not set"', async () => {
    assert.equal((await save({ supportPhone: '' })).status, 200);
    const [event] = await generalEvents();
    assert.deepEqual(event.change.fields, [{ field: 'Support phone', from: START.supportPhone, to: 'Not set' }]);
  });

  test('saving the current values (even untrimmed or in another case) changes nothing and records nothing', async () => {
    const before = await row();
    const res = await save({ description: `  ${START.description}  `, supportEmail: START.supportEmail.toUpperCase(), timezone: START.timezone, dateFormat: START.dateFormat });
    assert.equal(res.status, 200);
    const afterSave = await row();
    assert.equal(afterSave.updatedAt.getTime(), before.updatedAt.getTime(), 'row untouched');
    assert.equal((await generalEvents()).length, 0);
  });

  test('if the audit event cannot be written, nothing is saved', async () => {
    const brokenRequest = { ip: '127.0.0.1', get() { throw new Error('audit write failed'); } };
    await assert.rejects(updateGeneral({ description: `Rolled back ${tag}`, timezone: 'UTC' }, accounts.SUPER_ADMIN, brokenRequest), /audit write failed/);
    assert.deepEqual(pick(await row()), START);
    assert.equal((await generalEvents()).length, 0);
  });

  test('simultaneous saves of different fields are applied one after the other; each records its own event', async () => {
    const results = await Promise.all([save({ description: `Parallel ${tag}` }), save({ timezone: 'UTC' }), save({ supportPhone: '+252699999999' })]);
    assert.ok(results.every((r) => r.status === 200));
    const r = await row();
    assert.deepEqual([r.description, r.timezone, r.supportPhone], [`Parallel ${tag}`, 'UTC', '+252699999999']);
    const events = await generalEvents();
    assert.equal(events.length, 3);
    assert.deepEqual(events.map((e) => e.change.fields.length), [1, 1, 1]);
  });

  test('the event is in the audit log API, filterable and searchable by its name, and holds no credentials', async () => {
    await save({ description: `Audited ${tag}` });
    const byAction = (await call('/api/platform/audit-logs?action=GENERAL_SETTINGS_UPDATED&pageSize=100', { cookie: cookies.SUPER_ADMIN })).body;
    const item = byAction.items.find((e) => e.description.includes('Platform description') && e.actor.id === accounts.SUPER_ADMIN.id);
    assert.ok(item, 'listed under its action');
    assert.deepEqual(item.change.fields, [{ field: 'Platform description', from: START.description, to: `Audited ${tag}` }]);
    const bySearch = (await call(`/api/platform/audit-logs?q=${encodeURIComponent('Update General Settings')}&pageSize=100`, { cookie: cookies.SUPER_ADMIN })).body;
    assert.ok(bySearch.items.some((e) => e.id === item.id), 'found by its label');
    const text = JSON.stringify([byAction, await prisma.auditEvent.findMany({ where: { action: 'GENERAL_SETTINGS_UPDATED', actorId: accounts.SUPER_ADMIN.id } })]);
    assert.ok(!/scrypt\$|passwordHash|tokenHash|edutrack_session|DATABASE_URL|postgres(ql)?:\/\//i.test(text));
  });

  test('a General change is an admin action, not a security event', async () => {
    await save({ description: `Summary ${tag}` });
    const dashboard = (await call('/api/platform/dashboard?range=30d', { cookie: cookies.SUPER_ADMIN })).body;
    assert.ok(dashboard.recentActivity.some((a) => a.type === 'GENERAL_SETTINGS_UPDATED'), 'listed in recent platform activity (security events are not)');
  });

  test('when no settings row exists, saving creates it with only the given fields', async () => {
    const saved = await row();
    await prisma.platformSettings.delete({ where: { id: 'platform' } });
    try {
      const res = await save({ timezone: 'UTC' });
      assert.equal(res.status, 200);
      const r = await row();
      assert.equal(r.timezone, 'UTC');
      assert.equal(r.description, null);
      assert.deepEqual((await generalEvents()).at(-1).change.fields, [{ field: 'Timezone', from: 'Not set', to: 'UTC' }]);
    } finally {
      const { id, updatedAt, ...values } = saved;
      await prisma.platformSettings.upsert({ where: { id }, create: { ...values, id }, update: values });
    }
  });
});

describe('stored values that break the rules', () => {
  const LEGACY = { ...START, supportPhone: '+252 61 2345678', dateFormat: 'MMM DD, YYYY', firstDayOfWeek: 'saturday', supportEmail: `Mixed-${tag}@Example.com` };
  beforeEach(() => reset(LEGACY));

  test('are reported as conflicts, never replaced, and do not block saving other fields', async () => {
    const settings = (await call('/api/platform/settings', { cookie: cookies.SUPER_ADMIN })).body.settings;
    assert.deepEqual(Object.keys(settings.conflicts).sort(), ['dateFormat', 'firstDayOfWeek', 'supportEmail', 'supportPhone']);
    assert.deepEqual(settings.display, { timeZone: 'Africa/Mogadishu', dateFormat: null, timeFormat: '24h' }, 'an unapproved date format is not applied');
    const res = await save({ description: `Only this ${tag}` });
    assert.equal(res.status, 200);
    const r = await row();
    assert.equal(r.description, `Only this ${tag}`);
    assert.deepEqual([r.supportPhone, r.dateFormat, r.firstDayOfWeek, r.supportEmail], [LEGACY.supportPhone, LEGACY.dateFormat, LEGACY.firstDayOfWeek, LEGACY.supportEmail]);
    // Changing a conflicting field needs a valid value; the event shows the old stored value.
    assert.equal((await save({ firstDayOfWeek: 'saturday' })).status, 400);
    assert.equal((await save({ firstDayOfWeek: 'sunday' })).status, 200);
    assert.deepEqual((await generalEvents()).at(-1).change.fields, [{ field: 'First day of week', from: 'saturday', to: 'Sunday' }]);
  });
});

describe('platform time zone', () => {
  beforeEach(() => reset());

  test('the Dashboard ignores a request time zone (no viewer override; an invalid one is not even read)', async () => {
    for (const tz of ['Mars/Base', 'UTC', 'Pacific/Kiritimati']) {
      const res = await call(`/api/platform/dashboard?range=30d&tz=${encodeURIComponent(tz)}`, { cookie: cookies.SUPER_ADMIN });
      assert.equal(res.status, 200, tz);
    }
  });

  test('settings.display gives the time zone and formats the web app applies (UTC when not set or invalid)', async () => {
    const display = async () => (await call('/api/platform/settings', { cookie: cookies.SUPER_ADMIN })).body.settings.display;
    assert.deepEqual(await display(), { timeZone: 'Africa/Mogadishu', dateFormat: 'YYYY-MM-DD', timeFormat: '24h' });
    for (const timezone of [null, '+03:00', 'Mars/Base']) {
      await prisma.platformSettings.update({ where: { id: 'platform' }, data: { timezone } });
      assert.equal((await display()).timeZone, 'UTC', String(timezone));
    }
  });
});

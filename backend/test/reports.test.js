/*
 * Platform Reports tests (approved definitions): school and owner summaries, schools by city,
 * creation trends for every period (grouping, zero-filled buckets, creation dates, the platform
 * time zone and its precedence over a request time zone),
 * status distribution, filters, validation, SUPER_ADMIN-only access, and that viewing a report
 * writes nothing. Runs on the Neon dev branch (`npm test`). Fixture schools use cities unique to
 * this run, so filtered figures are exact; platform-wide figures are checked against direct
 * database counts and against a baseline taken before the fixtures were added. Everything created
 * here is removed afterwards; the platform time zone is set for the run and the settings row is
 * restored exactly.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Report tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const TZ = 'Africa/Mogadishu';
const DAY = 24 * 60 * 60 * 1000;
const cookies = {};
const accounts = {};
let server;
let base;
let baseline;
let originalSettings;

// The platform time zone (Platform Settings → General) decides report days and months.
const setPlatformTimeZone = (timezone) =>
  prisma.platformSettings.upsert({ where: { id: 'platform' }, create: { id: 'platform', timezone }, update: { timezone } });

const city = (key) => `Rpt-${key} ${tag}`;
const now = Date.now();
const ago = (days, hours = 0) => new Date(now - days * DAY - hours * 60 * 60 * 1000);

// Fixture schools (inserted in this order; D before B so the tie-break is not insertion order).
const SCHOOLS = [
  { key: 'a1', city: city('A'), status: 'ACTIVE', registeredAt: ago(0, 1) },
  { key: 'a2', city: city('A'), status: 'SUSPENDED', registeredAt: ago(3) },
  { key: 'a3', city: city('A'), status: 'ACTIVE', registeredAt: ago(75) },
  { key: 'd1', city: city('D'), status: 'ACTIVE', registeredAt: ago(10) },
  { key: 'd2', city: city('D'), status: 'ACTIVE', registeredAt: ago(20) },
  { key: 'b1', city: city('B'), status: 'ACTIVE', registeredAt: ago(200) },
  { key: 'b2', city: city('B'), status: 'SUSPENDED', registeredAt: ago(400) },
  { key: 'u1', city: '   ', status: 'ACTIVE', registeredAt: ago(5) },
];
const fixtures = {};

async function call(path, { cookie } = {}) {
  const response = await fetch(base + path, { headers: cookie ? { cookie } : {} });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const report = async (query = '') => {
  const res = await call(`/api/platform/reports${query ? `?${query}` : ''}`, { cookie: cookies.SUPER_ADMIN });
  assert.equal(res.status, 200, query);
  return res.body;
};

// Independent calendar arithmetic for the expectations.
const dayOf = (date, tz = TZ) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const monthOf = (date, tz = TZ) => dayOf(date, tz).slice(0, 7);
const expectedKeys = (unit, count, tz = TZ) => {
  const [y, m, d] = dayOf(new Date(), tz).split('-').map(Number);
  return Array.from({ length: count }, (_, i) =>
    unit === 'day'
      ? new Date(Date.UTC(y, m - 1, d - (count - 1 - i))).toISOString().slice(0, 10)
      : new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1)).toISOString().slice(0, 7),
  );
};
const PERIODS = { '7d': ['day', 7], '30d': ['day', 30], '3m': ['month', 3], '6m': ['month', 6], '12m': ['month', 12] };
const keyOf = (unit, date, tz = TZ) => (unit === 'day' ? dayOf(date, tz) : monthOf(date, tz));
const countAt = (trend, key) => trend.find((p) => p.key === key)?.count;

// Ground truth straight from the database.
const ownerTruth = async () => {
  const where = { role: 'OWNER', ownedSchool: { isNot: null } };
  return {
    total: await prisma.user.count({ where }),
    active: await prisma.user.count({ where: { ...where, status: 'ACTIVE' } }),
    suspended: await prisma.user.count({ where: { ...where, status: 'SUSPENDED' } }),
  };
};
const schoolTruth = async () => ({
  total: await prisma.school.count(),
  active: await prisma.school.count({ where: { status: 'ACTIVE' } }),
  suspended: await prisma.school.count({ where: { status: 'SUSPENDED' } }),
});

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  originalSettings = await prisma.platformSettings.findUnique({ where: { id: 'platform' } });
  await setPlatformTimeZone(TZ);
  for (const role of ['SUPER_ADMIN', 'OWNER', 'MANAGER', 'STAFF']) {
    const password = randomBytes(12).toString('base64url');
    const email = `test-rpt-${role.toLowerCase()}-${lower}@test.edutrack.example`;
    // The OWNER here has no school: it must never count as a School Owner.
    const user = await prisma.user.create({ data: { name: `Test ${role} ${tag}`, email, role, ...(await branchFor(role)), passwordHash: await hashPassword(password) } });
    accounts[role] = user;
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
    assert.equal(res.status, 200, `${role} sign-in`);
    cookies[role] = res.headers.get('set-cookie').split(';')[0];
  }

  baseline = {};
  for (const period of Object.keys(PERIODS)) baseline[period] = await report(`period=${period}`);

  for (const [i, s] of SCHOOLS.entries()) {
    fixtures[s.key] = await prisma.school.create({
      data: { code: `R${tag}-${i}`, name: `Report Test ${s.key} ${tag}`, location: s.city, status: s.status, registeredAt: s.registeredAt, phone: '+252 61 1234567', address: 'Test Road 1' },
    });
  }
  // School Owners: one active (created 2 days ago), one suspended (created 50 days ago).
  for (const [key, status, createdAt, school] of [
    ['o1', 'ACTIVE', ago(2), 'a1'],
    ['o2', 'SUSPENDED', ago(50), 'a2'],
  ]) {
    const owner = await prisma.user.create({ data: { name: `Report Owner ${key} ${tag}`, email: `test-rpt-${key}-${lower}@test.edutrack.example`, role: 'OWNER', status, createdAt } });
    await prisma.school.update({ where: { id: fixtures[school].id }, data: { ownerId: owner.id } });
    fixtures[key] = owner;
  }
});

after(async () => {
  const schools = await prisma.school.findMany({ where: { code: { startsWith: `R${tag}` } }, select: { id: true } });
  const users = await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } });
  const schoolIds = schools.map((s) => s.id);
  const userIds = users.map((u) => u.id);
  await prisma.auditEvent.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { actorId: { in: userIds } }, { targetId: { in: userIds } }] } });
  await prisma.school.updateMany({ where: { id: { in: schoolIds } }, data: { ownerId: null } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await removeTestBranches();
  if (originalSettings) {
    const { id, updatedAt, ...values } = originalSettings;
    await prisma.platformSettings.update({ where: { id }, data: values });
    await prisma.$executeRaw`UPDATE "PlatformSettings" SET "updatedAt" = ${updatedAt} WHERE "id" = ${id}`;
  } else {
    await prisma.platformSettings.deleteMany({ where: { id: 'platform' } });
  }
  server.close();
  await prisma.$disconnect();
});

describe('authorization', () => {
  const paths = ['/api/platform/reports', '/api/platform/reports?period=7d&status=active&city=Mogadishu'];

  test('unauthenticated → 401', async () => {
    for (const path of paths) assert.equal((await call(path)).status, 401, path);
  });

  for (const role of ['OWNER', 'MANAGER', 'STAFF']) {
    test(`${role} → 403`, async () => {
      for (const path of paths) {
        const res = await call(path, { cookie: cookies[role] });
        assert.equal(res.status, 403, path);
        assert.equal(res.body.code, 'FORBIDDEN');
      }
    });
  }

  test('SUPER_ADMIN → 200', async () => {
    for (const path of paths) assert.equal((await call(path, { cookie: cookies.SUPER_ADMIN })).status, 200, path);
  });
});

describe('school summary and status distribution', () => {
  test('total / active / suspended equal direct database counts', async () => {
    const r = await report();
    assert.deepEqual(r.schools.summary, await schoolTruth());
    assert.deepEqual(Object.keys(r.schools.summary).sort(), ['active', 'suspended', 'total'], 'no pending, approved or rejected');
  });

  test('the fixtures change the counts by exactly what was added', async () => {
    const r = await report();
    const before = baseline['12m'].schools.summary;
    assert.equal(r.schools.summary.total - before.total, SCHOOLS.length);
    assert.equal(r.schools.summary.active - before.active, SCHOOLS.filter((s) => s.status === 'ACTIVE').length);
    assert.equal(r.schools.summary.suspended - before.suspended, SCHOOLS.filter((s) => s.status === 'SUSPENDED').length);
  });

  test('a city filter gives exact counts', async () => {
    assert.deepEqual((await report(`city=${encodeURIComponent(city('A'))}`)).schools.summary, { total: 3, active: 2, suspended: 1 });
    assert.deepEqual((await report(`city=${encodeURIComponent(city('B'))}`)).schools.summary, { total: 2, active: 1, suspended: 1 });
  });
});

describe('owner summary and status distribution', () => {
  test('only OWNER accounts assigned to a school count', async () => {
    const r = await report();
    assert.deepEqual(r.owners.summary, await ownerTruth());
    assert.deepEqual(Object.keys(r.owners.summary).sort(), ['active', 'suspended', 'total'], 'no pending owners');
  });

  test('the fixtures change the counts by exactly the two school owners added (not the owner without a school, managers or staff)', async () => {
    const r = await report();
    const before = baseline['12m'].owners.summary;
    assert.deepEqual(
      { total: r.owners.summary.total - before.total, active: r.owners.summary.active - before.active, suspended: r.owners.summary.suspended - before.suspended },
      { total: 2, active: 1, suspended: 1 },
    );
  });

  test('school filters do not change owner figures', async () => {
    const all = await report();
    const filtered = await report(`status=suspended&city=${encodeURIComponent(city('A'))}`);
    assert.deepEqual(filtered.owners, all.owners);
  });
});

describe('schools by city', () => {
  test('grouped by city, most schools first, ties A–Z, every school counted', async () => {
    const r = await report();
    const rows = r.schools.byCity;
    assert.equal(rows.reduce((n, row) => n + row.count, 0), r.schools.summary.total, 'no school is dropped');
    for (let i = 1; i < rows.length; i += 1) {
      const [a, b] = [rows[i - 1], rows[i]];
      assert.ok(a.count > b.count || (a.count === b.count && (b.city === null || (a.city !== null && a.city.localeCompare(b.city, 'en') <= 0))), `${a.city} before ${b.city}`);
    }
    const find = (name) => rows.findIndex((row) => row.city === name);
    assert.equal(rows[find(city('A'))].count, 3);
    assert.equal(rows[find(city('B'))].count, 2);
    assert.equal(rows[find(city('D'))].count, 2);
    assert.ok(find(city('B')) < find(city('D')), 'equal counts: B before D although D was added first');
    assert.ok(find(city('A')) < find(city('B')));
  });

  test('a school without a city is reported as Unknown (null), not dropped', async () => {
    const unknown = (await report()).schools.byCity.find((row) => row.city === null);
    assert.ok(unknown && unknown.count >= 1);
  });

  test('filters apply, and the City choices list every city with a school', async () => {
    const r = await report(`status=active&city=${encodeURIComponent(city('A'))}`);
    assert.deepEqual(r.schools.byCity, [{ city: city('A'), count: 2 }]);
    assert.ok([city('A'), city('B'), city('D')].every((c) => r.cities.includes(c)), 'choices are not filtered');
    assert.ok(!r.cities.some((c) => !c.trim()), 'blank cities are not a choice');
  });
});

describe('creation trends', () => {
  for (const [period, [unit, count]] of Object.entries(PERIODS)) {
    test(`${period}: ${count} ${unit}s ending ${unit === 'day' ? 'today' : 'this month'}, zero-filled`, async () => {
      const r = await report(`period=${period}`);
      const keys = expectedKeys(unit, count);
      assert.equal(r.period.unit, unit);
      assert.deepEqual(r.schools.trend.map((p) => p.key), keys);
      assert.deepEqual(r.owners.trend.map((p) => p.key), keys);
      assert.ok(r.schools.trend.every((p) => Number.isInteger(p.count) && p.count >= 0));
      // The period starts at local midnight of its first day (Mogadishu is UTC+3, no DST).
      const first = unit === 'day' ? keys[0] : `${keys[0]}-01`;
      assert.equal(r.period.start, new Date(`${first}T00:00:00+03:00`).toISOString());
    });

    test(`${period}: school trend counts each school on its registration ${unit}`, async () => {
      const filtered = (await report(`period=${period}&city=${encodeURIComponent(city('A'))}`)).schools.trend;
      const keys = expectedKeys(unit, count);
      const expected = Object.fromEntries(keys.map((k) => [k, 0]));
      for (const s of SCHOOLS.filter((x) => x.city === city('A'))) {
        const key = keyOf(unit, s.registeredAt);
        if (key in expected) expected[key] += 1;
      }
      assert.deepEqual(Object.fromEntries(filtered.map((p) => [p.key, p.count])), expected);
    });

    test(`${period}: owner trend counts each school owner on its account creation ${unit}`, async () => {
      const r = await report(`period=${period}`);
      const before = baseline[period].owners.trend;
      for (const owner of [fixtures.o1, fixtures.o2]) {
        const key = keyOf(unit, owner.createdAt);
        const added = [fixtures.o1, fixtures.o2].filter((o) => keyOf(unit, o.createdAt) === key).length;
        if (countAt(before, key) === undefined) assert.equal(countAt(r.owners.trend, key), undefined, 'outside the period');
        else assert.equal(countAt(r.owners.trend, key) - countAt(before, key), added, `${owner.name} on ${key}`);
      }
    });
  }

  test('uses the registration date, not the last update', async () => {
    await prisma.school.update({ where: { id: fixtures.b1.id }, data: { description: 'touched' } }); // updatedAt = now
    const trend = (await report(`period=12m&city=${encodeURIComponent(city('B'))}`)).schools.trend;
    assert.equal(countAt(trend, monthOf(new Date())), 0, 'not counted in the current month');
    assert.equal(countAt(trend, monthOf(fixtures.b1.registeredAt)), 1);
    assert.equal(trend.reduce((n, p) => n + p.count, 0), 1, 'b2 (400 days ago) is outside 12 months');
  });

  test('schools outside the period are not counted; status filter applies', async () => {
    const week = (await report(`period=7d&city=${encodeURIComponent(city('A'))}`)).schools.trend;
    assert.equal(week.reduce((n, p) => n + p.count, 0), 2, 'a1 and a2, not a3 (75 days ago)');
    const active = (await report(`period=7d&status=active&city=${encodeURIComponent(city('A'))}`)).schools.trend;
    assert.equal(active.reduce((n, p) => n + p.count, 0), 1, 'a1 only');
  });

  test('days follow the platform time zone; a request time zone is ignored', async () => {
    const midnightUtc = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const late = new Date(midnightUtc.getTime() - 90 * 60 * 1000); // 22:30 UTC yesterday = 01:30 today in Mogadishu
    assert.notEqual(dayOf(late, 'UTC'), dayOf(late, TZ));
    const s = await prisma.school.create({ data: { code: `R${tag}-TZ`, name: `Report Test tz ${tag}`, location: city('T'), registeredAt: late } });
    const path = (tz) => `/api/platform/reports?period=7d&city=${encodeURIComponent(city('T'))}${tz ? `&tz=${tz}` : ''}`;
    const get = async (tz) => (await call(path(tz), { cookie: cookies.SUPER_ADMIN })).body;
    try {
      await setPlatformTimeZone('UTC');
      for (const tz of [undefined, TZ, 'Pacific/Kiritimati', 'Mars/Base']) {
        const r = await get(tz);
        assert.equal(r.timeZone, 'UTC', `platform UTC, request tz ${tz}`);
        assert.equal(countAt(r.schools.trend, dayOf(late, 'UTC')), 1, `UTC day, request tz ${tz}`);
        assert.deepEqual(r.schools.trend.map((p) => p.key), expectedKeys('day', 7, 'UTC'));
      }
      await setPlatformTimeZone(TZ);
      for (const tz of [undefined, 'UTC']) {
        const r = await get(tz);
        assert.equal(r.timeZone, TZ);
        assert.equal(countAt(r.schools.trend, dayOf(late, TZ)), 1, `Mogadishu day, request tz ${tz}`);
      }
    } finally {
      await setPlatformTimeZone(TZ);
      await prisma.school.delete({ where: { id: s.id } });
    }
  });

  test('platform time zone not set or not valid → UTC (never the viewer time zone)', async () => {
    try {
      for (const stored of [null, 'Mars/Base', '+03:00']) {
        await prisma.platformSettings.update({ where: { id: 'platform' }, data: { timezone: stored } });
        const r = (await call(`/api/platform/reports?period=7d&tz=${TZ}`, { cookie: cookies.SUPER_ADMIN })).body;
        assert.equal(r.timeZone, 'UTC', String(stored));
        assert.deepEqual(r.schools.trend.map((p) => p.key), expectedKeys('day', 7, 'UTC'));
      }
    } finally {
      await setPlatformTimeZone(TZ);
    }
  });
});

describe('filters and validation', () => {
  test('defaults (reset state): 12 months, no school filters', async () => {
    const r = await report();
    assert.deepEqual(r.filters, { period: '12m', status: null, city: null });
    assert.equal(r.timeZone, TZ);
  });

  test('combined filters echo back and narrow every school figure', async () => {
    const r = await report(`period=30d&status=suspended&city=${encodeURIComponent(city('A'))}`);
    assert.deepEqual(r.filters, { period: '30d', status: 'suspended', city: city('A') });
    assert.deepEqual(r.schools.summary, { total: 1, active: 0, suspended: 1 });
    assert.deepEqual(r.schools.byCity, [{ city: city('A'), count: 1 }]);
    assert.equal(r.schools.trend.reduce((n, p) => n + p.count, 0), 1);
  });

  test('an unknown city is valid and gives empty figures (no fake data)', async () => {
    const r = await report(`city=${encodeURIComponent(`Nowhere ${tag}`)}`);
    assert.deepEqual(r.schools.summary, { total: 0, active: 0, suspended: 0 });
    assert.deepEqual(r.schools.byCity, []);
    assert.ok(r.schools.trend.every((p) => p.count === 0));
    assert.equal(r.isDemo, false);
  });

  test('invalid values → 400 VALIDATION_ERROR', async () => {
    for (const query of [
      'period=1y',
      'period=7D',
      'period=90d',
      'period=7d&period=30d',
      'status=pending',
      'status=approved',
      'status=rejected',
      'status=ACTIVE',
      `city=${'x'.repeat(101)}`,
      'city=a&city=b',
    ]) {
      const res = await call(`/api/platform/reports?${query}`, { cookie: cookies.SUPER_ADMIN });
      assert.equal(res.status, 400, query);
      assert.equal(res.body.code, 'VALIDATION_ERROR', query);
    }
  });

  test('filter values are parameters, not SQL', async () => {
    const r = await report(`city=${encodeURIComponent(`x' OR 1=1; DROP TABLE "School"; --`)}`);
    assert.equal(r.schools.summary.total, 0);
    assert.ok((await prisma.school.count()) > 0);
  });
});

describe('read-only and safe', () => {
  test('viewing reports writes no audit events and changes no records', async () => {
    const from = new Date();
    const latest = await prisma.school.aggregate({ _max: { updatedAt: true } });
    for (const period of Object.keys(PERIODS)) await report(`period=${period}&status=active`);
    assert.equal(await prisma.auditEvent.count({ where: { occurredAt: { gte: from } } }), 0);
    assert.deepEqual(await prisma.school.aggregate({ _max: { updatedAt: true } }), latest);
  });

  test('only aggregate figures: no names, emails, ids or secrets', async () => {
    const r = await report();
    assert.deepEqual(Object.keys(r).sort(), ['cities', 'filters', 'generatedAt', 'isDemo', 'owners', 'period', 'schools', 'timeZone']);
    const text = JSON.stringify(r);
    assert.ok(!text.includes('@') && !/passwordHash|tokenHash|scrypt|DATABASE_URL|postgres/i.test(text));
    assert.ok(!text.includes(fixtures.a1.id) && !text.includes(fixtures.o1.name));
  });
});

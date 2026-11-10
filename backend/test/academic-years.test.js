/*
 * Academic year tests (approved rules: docs/business-rules.md → Academic years). School level: the
 * School Owner manages their own school's years; the school's Managers read them; nobody else has
 * access. PLANNED → CURRENT → CLOSED; one current year per school; no overlapping years; names
 * unique per school regardless of capitalization; closed years read only; only planned years
 * deleted; a suspended school is read only; every change is audited in the same transaction.
 * Runs on the Neon dev branch (`npm test`); everything it creates is removed afterwards.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Academic year tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const cookies = {};
const schools = {};
const branches = {};
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
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const as = (who) => (path, options = {}) => call(path, { ...options, cookie: cookies[who] });
const ownerA = as('OWNER_A');
const ownerB = as('OWNER_B');
const managerA = as('MANAGER_A');

const plan = (name, startDate, endDate, who = ownerA) => who('/api/owner/academic-years', { method: 'POST', body: { name, startDate, endDate } });
const start = (id, body, who = ownerA) => who(`/api/owner/academic-years/${id}/start`, { method: 'POST', body });
const close = (id, who = ownerA) => who(`/api/owner/academic-years/${id}/close`, { method: 'POST' });
const remove = (id, who = ownerA) => who(`/api/owner/academic-years/${id}`, { method: 'DELETE' });
const events = (id) => prisma.auditEvent.findMany({ where: { targetType: 'academic_year', targetId: id }, orderBy: { occurredAt: 'asc' } });
const wipe = (key) => prisma.academicYear.deleteMany({ where: { schoolId: schools[key].id } });

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  for (const key of ['A', 'B']) {
    schools[key] = await prisma.school.create({
      data: { code: `TAY${tag}-${key}`, name: `Academic Year Test ${key} ${tag}`, location: 'Mogadishu', phone: '+252 61 1234567', address: 'Test Road 1' },
    });
    branches[key] = await prisma.branch.create({
      data: { schoolId: schools[key].id, number: 1, code: `TAY${tag}-${key}-B001`, name: 'Main', nameKey: 'main', address: 'Test Road 1', city: 'Mogadishu' },
    });
  }
  const people = [
    ['SUPER_ADMIN', 'SUPER_ADMIN'],
    ['OWNER_A', 'OWNER', 'A'],
    ['OWNER_B', 'OWNER', 'B'],
    ['MANAGER_A', 'MANAGER', 'A'],
    ['MANAGER_B', 'MANAGER', 'B'],
    ['STAFF', 'STAFF'],
  ];
  for (const [key, role, school] of people) {
    const password = randomBytes(12).toString('base64url');
    const email = `test-ay-${key.toLowerCase().replace('_', '-')}-${lower}@test.edutrack.example`;
    const scope = role === 'MANAGER' ? { branchId: branches[school].id } : await branchFor(role);
    const user = await prisma.user.create({ data: { name: `Test ${key} ${tag}`, email, role, ...scope, passwordHash: await hashPassword(password) } });
    if (role === 'OWNER') await prisma.school.update({ where: { id: schools[school].id }, data: { ownerId: user.id } });
    const res = await call('/api/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(res.status, 200, `${key} sign-in`);
    cookies[key] = res.cookie;
  }
});

after(async () => {
  const schoolIds = Object.values(schools).map((s) => s.id);
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  await prisma.auditEvent.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { actorId: { in: userIds } }] } });
  await prisma.academicYear.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.school.updateMany({ where: { id: { in: schoolIds } }, data: { ownerId: null } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await removeTestBranches();
  server.close();
  await prisma.$disconnect();
});

describe('access: School Owner manages, the school\'s Managers read', () => {
  const id = randomUUID();
  const ownerEndpoints = [
    ['GET', '/api/owner/academic-years'],
    ['GET', `/api/owner/academic-years/${id}`],
    ['POST', '/api/owner/academic-years', { name: 'X', startDate: '2030-09-01', endDate: '2031-06-30' }],
    ['PATCH', `/api/owner/academic-years/${id}`, { name: 'Y' }],
    ['POST', `/api/owner/academic-years/${id}/start`, {}],
    ['POST', `/api/owner/academic-years/${id}/close`],
    ['DELETE', `/api/owner/academic-years/${id}`],
  ];

  test('signed out → 401', async () => {
    for (const [method, path, body] of [...ownerEndpoints, ['GET', '/api/manager/academic-years']]) {
      assert.equal((await call(path, { method, body })).status, 401, `${method} ${path}`);
    }
  });

  for (const role of ['SUPER_ADMIN', 'MANAGER_A', 'STAFF']) {
    test(`${role} → 403 on the owner endpoints`, async () => {
      for (const [method, path, body] of ownerEndpoints) assert.equal((await as(role)(path, { method, body })).status, 403, `${role} ${method} ${path}`);
    });
  }

  test('SUPER_ADMIN, OWNER and STAFF → 403 on the Manager endpoint', async () => {
    for (const role of ['SUPER_ADMIN', 'OWNER_A', 'STAFF']) assert.equal((await as(role)('/api/manager/academic-years')).status, 403, role);
  });

  test('a Manager reads their own school\'s years only', async () => {
    await wipe('A');
    await wipe('B');
    const a = (await plan('2030/2031', '2030-09-01', '2031-06-30')).body.academicYear;
    await plan('2030/2031', '2030-09-01', '2031-06-30', ownerB);
    assert.equal((await start(a.id, {})).status, 200);

    const res = await managerA('/api/manager/academic-years');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items.map((y) => y.id), [a.id]);
    assert.equal(res.body.current.id, a.id);
    // The Manager endpoint is read only.
    assert.equal((await managerA('/api/manager/academic-years', { method: 'POST', body: {} })).status, 404);
  });

  test('another school\'s year is reported as not found', async () => {
    const theirs = (await ownerB('/api/owner/academic-years')).body.items[0];
    for (const [method, path, body] of [
      ['GET', `/api/owner/academic-years/${theirs.id}`],
      ['PATCH', `/api/owner/academic-years/${theirs.id}`, { name: 'Taken over' }],
      ['POST', `/api/owner/academic-years/${theirs.id}/start`, {}],
      ['DELETE', `/api/owner/academic-years/${theirs.id}`],
    ]) {
      assert.equal((await ownerA(path, { method, body })).status, 404, `${method} ${path}`);
    }
    assert.equal((await prisma.academicYear.findUnique({ where: { id: theirs.id } })).name, '2030/2031');
  });
});

describe('validation', () => {
  test('required fields, real dates, order and length', async () => {
    let res = await ownerA('/api/owner/academic-years', { method: 'POST', body: {} });
    assert.equal(res.status, 400);
    assert.ok(res.body.details.name && res.body.details.startDate && res.body.details.endDate);

    res = await plan('Bad', '2031-02-30', '2031-06-30');
    assert.equal(res.status, 400);
    assert.ok(res.body.details.startDate);

    res = await plan('Backwards', '2031-06-30', '2031-06-30');
    assert.equal(res.status, 400);
    assert.match(res.body.details.endDate, /after the start date/);

    res = await plan('Too long', '2031-01-01', '2033-01-02');
    assert.equal(res.status, 400);
    assert.match(res.body.details.endDate, /731 days/);

    res = await plan('x'.repeat(41), '2040-01-01', '2040-12-31');
    assert.equal(res.status, 400);
    assert.ok(res.body.details.name);
  });

  test('server-decided fields and unknown fields are refused', async () => {
    let res = await ownerA('/api/owner/academic-years', { method: 'POST', body: { name: 'X', startDate: '2040-01-01', endDate: '2040-12-31', status: 'CURRENT' } });
    assert.equal(res.status, 400);
    assert.ok(res.body.details.status);
    res = await ownerA('/api/owner/academic-years', { method: 'POST', body: { name: 'X', startDate: '2040-01-01', endDate: '2040-12-31', schoolId: schools.B.id } });
    assert.equal(res.status, 400);
    res = await ownerA('/api/owner/academic-years', { method: 'POST', body: { name: 'X', startDate: '2040-01-01', endDate: '2040-12-31', colour: 'red' } });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Unknown fields/);
  });
});

describe('planning, overlap and names', () => {
  test('a new year is planned, with dates as calendar days, and audited', async () => {
    await wipe('A');
    const res = await plan('  2031 /  2032 ', '2031-09-01', '2032-06-30');
    assert.equal(res.status, 201);
    const year = res.body.academicYear;
    assert.equal(year.name, '2031 / 2032');
    assert.equal(year.status, 'planned');
    assert.equal(year.startDate, '2031-09-01');
    assert.equal(year.endDate, '2032-06-30');
    assert.equal(year.days, 304);
    const [event] = await events(year.id);
    assert.equal(event.action, 'ACADEMIC_YEAR_CREATED');
    assert.equal(event.schoolId, schools.A.id);
  });

  test('names are unique per school regardless of capitalization, not across schools', async () => {
    await wipe('A');
    await plan('Year One', '2031-09-01', '2032-06-30');
    const res = await plan('YEAR  one', '2033-09-01', '2034-06-30');
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'NAME_TAKEN');
    assert.equal((await plan('Year One', '2035-09-01', '2036-06-30', ownerB)).status, 201);
  });

  test('overlapping years are refused (both dates inclusive); adjacent ones are fine', async () => {
    await wipe('A');
    await plan('First', '2031-09-01', '2032-06-30');
    const res = await plan('Clash', '2032-06-30', '2033-06-30');
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'DATES_OVERLAP');
    assert.match(res.body.error, /First/);
    assert.equal((await plan('Next', '2032-07-01', '2033-06-30')).status, 201);
  });

  test('simultaneous overlapping creations: exactly one succeeds', async () => {
    await wipe('A');
    const results = await Promise.all([1, 2, 3, 4].map((n) => plan(`Race ${n}`, '2034-09-01', '2035-06-30')));
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409, 409]);
    assert.equal(await prisma.academicYear.count({ where: { schoolId: schools.A.id } }), 1);
  });

  test('the database refuses overlap even when the API checks are bypassed', async () => {
    await wipe('A');
    const data = { schoolId: schools.A.id, startDate: new Date('2036-01-01'), endDate: new Date('2036-12-31') };
    await prisma.academicYear.create({ data: { ...data, name: 'Direct 1', nameKey: 'direct 1' } });
    await assert.rejects(prisma.academicYear.create({ data: { ...data, name: 'Direct 2', nameKey: 'direct 2' } }));
  });
});

describe('editing', () => {
  test('name and dates change with old and new values audited; unchanged → no event', async () => {
    await wipe('A');
    const year = (await plan('Edit me', '2031-09-01', '2032-06-30')).body.academicYear;
    let res = await ownerA(`/api/owner/academic-years/${year.id}`, { method: 'PATCH', body: { name: 'Edited', endDate: '2032-07-15' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.academicYear.name, 'Edited');
    assert.equal(res.body.academicYear.endDate, '2032-07-15');
    const updated = (await events(year.id)).at(-1);
    assert.equal(updated.action, 'ACADEMIC_YEAR_UPDATED');
    assert.deepEqual(updated.change.fields, [
      { field: 'Name', from: 'Edit me', to: 'Edited' },
      { field: 'End date', from: '2032-06-30', to: '2032-07-15' },
    ]);

    res = await ownerA(`/api/owner/academic-years/${year.id}`, { method: 'PATCH', body: { name: 'Edited', startDate: '2031-09-01' } });
    assert.equal(res.status, 200);
    assert.equal((await events(year.id)).length, 2);
  });

  test('a partial date change is checked against the stored date', async () => {
    await wipe('A');
    const year = (await plan('Range', '2031-09-01', '2032-06-30')).body.academicYear;
    const res = await ownerA(`/api/owner/academic-years/${year.id}`, { method: 'PATCH', body: { startDate: '2032-07-01' } });
    assert.equal(res.status, 400);
    assert.ok(res.body.details.endDate);
  });
});

describe('lifecycle: planned → current → closed', () => {
  test('start, rollover with confirmation, close, and read-only closed years', async () => {
    await wipe('A');
    const first = (await plan('2031/2032', '2031-09-01', '2032-06-30')).body.academicYear;
    const second = (await plan('2032/2033', '2032-09-01', '2033-06-30')).body.academicYear;

    let res = await start(first.id, undefined);
    assert.equal(res.status, 200);
    assert.equal(res.body.academicYear.status, 'current');
    assert.equal(res.body.closed, null);
    // Starting the current year again changes nothing.
    assert.equal((await start(first.id, {})).status, 200);
    assert.equal((await events(first.id)).filter((e) => e.action === 'ACADEMIC_YEAR_STARTED').length, 1);

    // Another start needs confirmation that the current year is closed.
    res = await start(second.id, {});
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'CURRENT_EXISTS');
    assert.equal((await prisma.academicYear.findUnique({ where: { id: second.id } })).status, 'PLANNED');

    res = await start(second.id, { closeCurrent: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.academicYear.status, 'current');
    assert.equal(res.body.closed.id, first.id);
    assert.equal(res.body.closed.status, 'closed');
    assert.ok(res.body.closed.closedAt);
    assert.equal((await events(first.id)).at(-1).action, 'ACADEMIC_YEAR_CLOSED');

    // Closed years are read only, cannot be restarted or deleted.
    res = await ownerA(`/api/owner/academic-years/${first.id}`, { method: 'PATCH', body: { name: 'Rewritten' } });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'YEAR_CLOSED');
    assert.equal((await start(first.id, { closeCurrent: true })).body.code, 'INVALID_STATUS');
    assert.equal((await remove(first.id)).body.code, 'INVALID_STATUS');

    // Close the current year: the school has no current year.
    res = await close(second.id);
    assert.equal(res.status, 200);
    assert.equal(res.body.academicYear.status, 'closed');
    assert.equal((await ownerA('/api/owner/academic-years')).body.current, null);
  });

  test('a planned year cannot be closed; years are started in date order', async () => {
    await wipe('A');
    const early = (await plan('Early', '2031-09-01', '2032-06-30')).body.academicYear;
    const late = (await plan('Late', '2032-09-01', '2033-06-30')).body.academicYear;
    assert.equal((await close(early.id)).body.code, 'INVALID_STATUS');
    await start(late.id, {});
    await close(late.id);
    const res = await start(early.id, {});
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'OUT_OF_ORDER');
  });

  test('simultaneous starts never leave two current years', async () => {
    await wipe('A');
    const ids = [];
    for (const [n, from, to] of [
      [1, '2031-09-01', '2032-06-30'],
      [2, '2032-09-01', '2033-06-30'],
      [3, '2033-09-01', '2034-06-30'],
    ]) {
      ids.push((await plan(`Y${n}`, from, to)).body.academicYear.id);
    }
    const results = await Promise.all(ids.map((id) => start(id, { closeCurrent: true })));
    assert.ok(results.every((r) => r.status === 200 || r.status === 409));
    assert.equal(await prisma.academicYear.count({ where: { schoolId: schools.A.id, status: 'CURRENT' } }), 1);
  });

  test('only a planned year can be deleted; the event keeps its details', async () => {
    await wipe('A');
    const year = (await plan('Drop me', '2031-09-01', '2032-06-30')).body.academicYear;
    const res = await remove(year.id);
    assert.equal(res.status, 204);
    assert.equal(await prisma.academicYear.findUnique({ where: { id: year.id } }), null);
    const deleted = (await events(year.id)).at(-1);
    assert.equal(deleted.action, 'ACADEMIC_YEAR_DELETED');
    assert.equal(deleted.targetName, 'Drop me');
  });
});

describe('school suspension and audit view', () => {
  test('a suspended school\'s years can be read but not changed', async () => {
    await wipe('A');
    const year = (await plan('Before suspension', '2031-09-01', '2032-06-30')).body.academicYear;
    await prisma.school.update({ where: { id: schools.A.id }, data: { status: 'SUSPENDED' } });
    try {
      assert.equal((await ownerA('/api/owner/academic-years')).status, 200);
      assert.equal((await managerA('/api/manager/academic-years')).status, 200);
      for (const res of [
        await plan('During suspension', '2033-09-01', '2034-06-30'),
        await ownerA(`/api/owner/academic-years/${year.id}`, { method: 'PATCH', body: { name: 'Changed' } }),
        await start(year.id, {}),
        await remove(year.id),
      ]) {
        assert.equal(res.status, 409);
        assert.equal(res.body.code, 'SCHOOL_SUSPENDED');
      }
    } finally {
      await prisma.school.update({ where: { id: schools.A.id }, data: { status: 'ACTIVE' } });
    }
  });

  test('the owner reads their school\'s academic year events, without network details', async () => {
    const res = await ownerA('/api/owner/academic-years/audit-logs');
    assert.equal(res.status, 200);
    assert.ok(res.body.items.length > 0);
    assert.ok(res.body.items.every((e) => e.action.startsWith('ACADEMIC_YEAR_') && !('ipAddress' in e)));
    const theirs = await ownerB('/api/owner/academic-years/audit-logs');
    assert.ok(theirs.body.items.every((e) => !res.body.items.some((mine) => mine.id === e.id)));
  });
});

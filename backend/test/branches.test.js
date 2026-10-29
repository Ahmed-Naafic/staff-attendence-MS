/*
 * Branch Management tests (approved rules: docs/business-rules.md → Branch management). School
 * Owners manage their own school's branches only; codes are generated, unique and never reused;
 * names are unique per school regardless of capitalization; ACTIVE ⇄ SUSPENDED with safe
 * concurrent changes; a suspended school makes branch records read-only without changing branch
 * statuses; GPS locations keep their history with effective times (no backdating); audit events
 * are written with each change, carry old and new values, and are scoped to the owner's school.
 * Runs on the Neon dev branch (`npm test`); everything it creates is removed afterwards.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { nameKey } from '../src/features/branches/branchInput.js';
import { createBranch, locationAt, operatingState } from '../src/features/branches/branches.service.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Branch tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const accounts = {};
const cookies = {};
const schools = {};
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
  return { status: response.status, body: text ? JSON.parse(text) : null, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const as = (who) => (path, options = {}) => call(path, { ...options, cookie: cookies[who] });
const ownerA = as('OWNER_A');
const ownerB = as('OWNER_B');
const admin = as('SUPER_ADMIN');

// Mogadishu-ish coordinates; a few metres apart are different positions.
const SPOT = { latitude: 2.046934, longitude: 45.318162, accuracy: 12, confirmed: true };
const OTHER = { latitude: 2.050001, longitude: 45.320002, accuracy: 8.4, confirmed: true };
const THIRD = { latitude: 2.060003, longitude: 45.330004, accuracy: 20, confirmed: true };
const valid = (name, overrides = {}) => ({ name, address: 'Maka Al Mukarama Road 12', city: 'Mogadishu', phone: '+252 61 2345678', location: SPOT, ...overrides });
const create = (name, overrides, who = ownerA) => who('/api/owner/branches', { method: 'POST', body: valid(name, overrides) });
const branchEvents = (branchId) => prisma.auditEvent.findMany({ where: { targetType: 'branch', targetId: branchId }, orderBy: { occurredAt: 'asc' } });
const schoolEvents = (school) => prisma.auditEvent.count({ where: { schoolId: school.id, targetType: 'branch' } });
const minutes = (n) => new Date(Date.now() + n * 60 * 1000).toISOString();

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  for (const key of ['A', 'B', 'C']) {
    schools[key] = await prisma.school.create({
      data: { code: `T${tag}-${key}`, name: `Branch Test School ${key} ${tag}`, location: 'Mogadishu', phone: '+252 61 1234567', address: 'Test Road 1' },
    });
  }
  const people = [
    ['SUPER_ADMIN', 'SUPER_ADMIN'],
    ['OWNER_A', 'OWNER', 'A'],
    ['OWNER_B', 'OWNER', 'B'],
    ['OWNER_C', 'OWNER', 'C'],
    ['OWNER_NONE', 'OWNER'],
    ['MANAGER', 'MANAGER'],
    ['STAFF', 'STAFF'],
  ];
  for (const [key, role, school] of people) {
    const password = randomBytes(12).toString('base64url');
    const email = `test-br-${key.toLowerCase().replace('_', '-')}-${lower}@test.edutrack.example`;
    const user = await prisma.user.create({ data: { name: `Test ${key} ${tag}`, email, role, ...(await branchFor(role)), passwordHash: await hashPassword(password) } });
    if (school) await prisma.school.update({ where: { id: schools[school].id }, data: { ownerId: user.id } });
    accounts[key] = { id: user.id, name: user.name, role };
    const res = await call('/api/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(res.status, 200, `${key} sign-in`);
    cookies[key] = res.cookie;
  }
});

after(async () => {
  const schoolIds = (await prisma.school.findMany({ where: { code: { startsWith: `T${tag}` } }, select: { id: true } })).map((s) => s.id);
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  const branchIds = (await prisma.branch.findMany({ where: { schoolId: { in: schoolIds } }, select: { id: true } })).map((b) => b.id);
  await prisma.auditEvent.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { actorId: { in: userIds } }, { targetId: { in: [...userIds, ...branchIds] } }] } });
  await prisma.branchLocation.deleteMany({ where: { branchId: { in: branchIds } } });
  await prisma.suspensionPeriod.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { branchId: { in: branchIds } }] } });
  await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
  await prisma.school.updateMany({ where: { id: { in: schoolIds } }, data: { ownerId: null } });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await removeTestBranches();
  server.close();
  await prisma.$disconnect();
});

describe('access: School Owners only, for their own school', () => {
  const id = randomUUID();
  const endpoints = [
    ['GET', '/api/owner/school'],
    ['GET', '/api/owner/branches'],
    ['GET', `/api/owner/branches/${id}`],
    ['POST', '/api/owner/branches', {}],
    ['PATCH', `/api/owner/branches/${id}`, { name: 'Changed' }],
    ['POST', `/api/owner/branches/${id}/suspend`, { reason: 'Testing access' }],
    ['POST', `/api/owner/branches/${id}/reactivate`],
    ['GET', `/api/owner/branches/${id}/locations`],
    ['POST', `/api/owner/branches/${id}/locations`, { ...SPOT, effectiveFrom: 'now' }],
    ['DELETE', `/api/owner/branches/${id}/locations/scheduled`],
    ['GET', '/api/owner/audit-logs'],
  ];

  test('signed out → 401', async () => {
    for (const [method, path, body] of endpoints) assert.equal((await call(path, { method, body })).status, 401, `${method} ${path}`);
  });

  for (const role of ['SUPER_ADMIN', 'MANAGER', 'STAFF']) {
    test(`${role} → 403 (no routine branch actions)`, async () => {
      for (const [method, path, body] of endpoints) {
        const res = await as(role)(path, { method, body });
        assert.equal(res.status, 403, `${role} ${method} ${path}`);
        assert.equal(res.body.code, 'FORBIDDEN');
      }
    });
  }

  test('an owner without a school → 403', async () => {
    const res = await as('OWNER_NONE')('/api/owner/branches');
    assert.equal(res.status, 403);
    assert.match(res.body.error, /No school is linked/);
  });

  test('a write from another origin → 403', async () => {
    assert.equal((await call('/api/owner/branches', { method: 'POST', body: valid('Origin test'), cookie: cookies.OWNER_A, origin: 'https://evil.example' })).status, 403);
    assert.equal(await prisma.branch.count({ where: { schoolId: schools.A.id } }), 0);
  });

  test('the owner reads their own school', async () => {
    const res = await ownerA('/api/owner/school');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.school, { id: schools.A.id, code: schools.A.code, name: schools.A.name, status: 'active' });
  });
});

describe('creating branches', () => {
  let main;

  test('a valid branch: ACTIVE, generated code, trimmed values, first location effective now, one audit event', async () => {
    const res = await create('  Main   Branch ', { address: ' Maka  Al Mukarama Road 12 ', city: ' Mogadishu ' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    main = res.body.branch;
    assert.equal(main.code, `${schools.A.code}-B001`);
    assert.equal(main.name, 'Main Branch');
    assert.equal(main.address, 'Maka Al Mukarama Road 12');
    assert.equal(main.city, 'Mogadishu');
    assert.equal(main.status, 'active');
    assert.deepEqual(main.operating, { operating: true, reasons: [] });
    assert.equal(main.location.latitude, SPOT.latitude);
    assert.equal(main.location.accuracyMeters, 12);
    assert.ok(Math.abs(Date.parse(main.location.effectiveFrom) - Date.now()) < 60_000);
    assert.equal(main.scheduledLocation, null);
    const events = await branchEvents(main.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].action, 'BRANCH_CREATED');
    assert.equal(events[0].schoolId, schools.A.id);
    assert.equal(events[0].actorId, accounts.OWNER_A.id);
    assert.equal(events[0].targetName, `Main Branch (${main.code})`);
    const fields = Object.fromEntries(events[0].change.fields.map((f) => [f.field, f.to]));
    assert.equal(fields.Status, 'Active');
    assert.equal(fields.Name, 'Main Branch');
    assert.equal(fields.Location, '2.046934, 45.318162 (±12 m)');
  });

  test('phone is optional; empty means not set', async () => {
    const res = await create('No Phone Branch', { phone: '   ' });
    assert.equal(res.status, 201);
    assert.equal(res.body.branch.phone, '');
    assert.equal((await prisma.branch.findUnique({ where: { id: res.body.branch.id } })).phone, null);
    assert.equal(res.body.branch.code, `${schools.A.code}-B002`);
  });

  test('required fields, phone format, lengths and control characters → 400 with field details; nothing created', async () => {
    const before = await prisma.branch.count({ where: { schoolId: schools.A.id } });
    const cases = [
      [{ name: '' }, 'name'],
      [{ address: '' }, 'address'],
      [{ city: '   ' }, 'city'],
      [{ city: undefined }, 'city'],
      [{ phone: '12' }, 'phone'],
      [{ phone: '+252 61 abc' }, 'phone'],
      [{ name: 'x'.repeat(121) }, 'name'],
      [{ address: 'x'.repeat(201) }, 'address'],
      [{ name: 'Bad\u0007Name' }, 'name'],
      [{ name: 42 }, 'name'],
    ];
    for (const [overrides, field] of cases) {
      const res = await create('Valid Name', overrides);
      assert.equal(res.status, 400, JSON.stringify(overrides));
      assert.ok(res.body.details?.[field], `${JSON.stringify(overrides)} → details.${field}`);
    }
    assert.equal(await prisma.branch.count({ where: { schoolId: schools.A.id } }), before);
  });

  test('a captured position must be complete, in range, real, confirmed and accurate to 50 m', async () => {
    const cases = [
      [{ location: undefined }, 'location'],
      [{ location: { ...SPOT, accuracy: 50.1 } }, 'location.accuracy'],
      [{ location: { ...SPOT, accuracy: undefined } }, 'location.accuracy'],
      [{ location: { ...SPOT, latitude: 90.5 } }, 'location.latitude'],
      [{ location: { ...SPOT, longitude: -180.01 } }, 'location.longitude'],
      [{ location: { ...SPOT, latitude: '2.04' } }, 'location.latitude'],
      [{ location: { ...SPOT, latitude: 0, longitude: 0 } }, 'location.latitude'],
      [{ location: { ...SPOT, confirmed: undefined } }, 'location.confirmed'],
    ];
    for (const [overrides, field] of cases) {
      const res = await create('Position Test', overrides);
      assert.equal(res.status, 400, JSON.stringify(overrides));
      assert.ok(res.body.details?.[field], `${JSON.stringify(overrides)} → details.${field}: ${JSON.stringify(res.body)}`);
    }
    assert.equal((await create('Exactly Fifty', { location: { ...SPOT, accuracy: 50 } })).status, 201);
  });

  test('code, number, school, status and unknown fields are refused, never used', async () => {
    for (const extra of [{ code: 'MY-CODE' }, { number: 7 }, { schoolId: schools.B.id }, { status: 'SUSPENDED' }, { colour: 'blue' }]) {
      const res = await create(`Override ${Object.keys(extra)[0]}`, extra);
      assert.equal(res.status, 400, JSON.stringify(extra));
    }
    assert.equal(await prisma.branch.count({ where: { schoolId: schools.B.id } }), 0);
    const location = await create('Extra Location Key', { location: { ...SPOT, altitude: 5 } });
    assert.equal(location.status, 400);
  });

  test('duplicate names are refused regardless of capitalization, spacing and Unicode width (409 NAME_TAKEN)', async () => {
    for (const name of ['MAIN BRANCH', 'main branch', 'Main\tBranch', 'Ｍａｉｎ Ｂｒａｎｃｈ']) {
      const res = await create(name);
      assert.equal(res.status, 409, name);
      assert.equal(res.body.code, 'NAME_TAKEN');
      assert.ok(res.body.details.name);
    }
    assert.equal((await create('Straße Campus')).status, 201);
    assert.equal((await create('STRASSE CAMPUS')).body.code, 'NAME_TAKEN');
    // Locale-independent: dotted capital I is not merged with plain I.
    assert.equal(nameKey('İstanbul') === nameKey('Istanbul'), false);
  });

  test('the same name in another school is allowed', async () => {
    const res = await create('Main Branch', {}, ownerB);
    assert.equal(res.status, 201);
    assert.equal(res.body.branch.code, `${schools.B.code}-B001`);
  });

  test('simultaneous creations get distinct consecutive codes', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) => create(`Parallel ${i}`, {}, ownerB)));
    assert.ok(results.every((r) => r.status === 201), JSON.stringify(results.map((r) => r.body)));
    const codes = results.map((r) => r.body.branch.code).sort();
    assert.deepEqual(codes, [2, 3, 4, 5, 6, 7].map((n) => `${schools.B.code}-B00${n}`));
    assert.equal((await prisma.school.findUnique({ where: { id: schools.B.id } })).branchSequence, 7);
  });

  test('simultaneous creations of the same name: exactly one succeeds', async () => {
    const results = await Promise.all(['Twin Branch', 'TWIN BRANCH', 'twin branch'].map((n) => create(n, {}, ownerB)));
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
    assert.equal(await prisma.branch.count({ where: { schoolId: schools.B.id, nameKey: 'twin branch' } }), 1);
  });

  test('a failed audit write rolls the creation back (no branch, no number used)', async () => {
    const sequence = (await prisma.school.findUnique({ where: { id: schools.C.id } })).branchSequence;
    const brokenRequest = { ip: '127.0.0.1', get() { throw new Error('audit write failed'); } };
    const school = await prisma.school.findUnique({ where: { id: schools.C.id }, select: { id: true, code: true, name: true, status: true } });
    const values = { name: 'Rolled Back', address: 'Road 1', city: 'Baidoa', phone: null, location: { latitude: 3.1, longitude: 43.6, accuracyMeters: 10 } };
    await assert.rejects(createBranch(school, values, accounts.OWNER_C, brokenRequest), /audit write failed/);
    assert.equal(await prisma.branch.count({ where: { schoolId: schools.C.id } }), 0);
    assert.equal((await prisma.school.findUnique({ where: { id: schools.C.id } })).branchSequence, sequence);
    assert.equal(await schoolEvents(schools.C), 0);
  });
});

describe('isolation between schools', () => {
  let branchA;
  before(async () => {
    branchA = (await create('Isolation Branch')).body.branch;
  });

  test('another school\'s branch is not found for every action, and is not changed', async () => {
    const id = branchA.id;
    const attempts = [
      ['GET', `/api/owner/branches/${id}`],
      ['PATCH', `/api/owner/branches/${id}`, { name: 'Taken Over' }],
      ['POST', `/api/owner/branches/${id}/suspend`, { reason: 'Not mine' }],
      ['POST', `/api/owner/branches/${id}/reactivate`],
      ['GET', `/api/owner/branches/${id}/locations`],
      ['POST', `/api/owner/branches/${id}/locations`, { ...OTHER, effectiveFrom: 'now' }],
      ['DELETE', `/api/owner/branches/${id}/locations/scheduled`],
    ];
    for (const [method, path, body] of attempts) assert.equal((await ownerB(path, { method, body })).status, 404, `${method} ${path}`);
    const stored = await prisma.branch.findUnique({ where: { id } });
    assert.equal(stored.name, 'Isolation Branch');
    assert.equal(stored.status, 'ACTIVE');
    assert.equal((await branchEvents(id)).length, 1);
  });

  test('lists and audit show only the owner\'s school; a school id in the query is ignored', async () => {
    const list = await ownerB(`/api/owner/branches?pageSize=100&schoolId=${schools.A.id}`);
    assert.equal(list.status, 200);
    assert.ok(list.body.items.length > 0);
    assert.ok(list.body.items.every((b) => b.code.startsWith(schools.B.code)));
    const audit = await ownerB(`/api/owner/audit-logs?branch=${branchA.id}`);
    assert.equal(audit.status, 200);
    assert.equal(audit.body.total, 0);
  });
});

describe('editing branch details', () => {
  let branch;
  before(async () => {
    branch = (await create('Edit Branch', { city: 'Kismayo' })).body.branch;
  });
  const patch = (body) => ownerA(`/api/owner/branches/${branch.id}`, { method: 'PATCH', body });

  test('only changed fields are written and audited with old and new values', async () => {
    const res = await patch({ name: 'Edited Branch', city: 'Kismayo', phone: '' });
    assert.equal(res.status, 200);
    assert.equal(res.body.branch.name, 'Edited Branch');
    assert.equal(res.body.branch.phone, '');
    assert.equal(res.body.branch.code, branch.code);
    const [, updated] = await branchEvents(branch.id);
    assert.equal(updated.action, 'BRANCH_UPDATED');
    assert.deepEqual(updated.change.fields, [
      { field: 'Name', from: 'Edit Branch', to: 'Edited Branch' },
      { field: 'Phone', from: '+252 61 2345678', to: 'Not set' },
    ]);
    assert.match(updated.description, /Name, Phone/);
  });

  test('unchanged values (after trimming) → 200 and no event', async () => {
    const res = await patch({ name: '  Edited   Branch ', city: 'Kismayo' });
    assert.equal(res.status, 200);
    assert.equal((await branchEvents(branch.id)).length, 2);
  });

  test('changing only the capitalization of the own name is allowed', async () => {
    assert.equal((await patch({ name: 'EDITED BRANCH' })).status, 200);
    assert.equal((await branchEvents(branch.id)).length, 3);
  });

  test('a name used by another branch of the school → 409, nothing changed', async () => {
    const res = await patch({ name: 'main branch' });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'NAME_TAKEN');
    assert.equal((await prisma.branch.findUnique({ where: { id: branch.id } })).name, 'EDITED BRANCH');
    assert.equal((await branchEvents(branch.id)).length, 3);
  });

  test('code, school, status, location and empty requests are refused', async () => {
    for (const body of [{ code: 'X-B999' }, { schoolId: schools.B.id }, { status: 'suspended' }, { location: OTHER }, {}, { name: '' }]) {
      assert.equal((await patch(body)).status, 400, JSON.stringify(body));
    }
    const stored = await prisma.branch.findUnique({ where: { id: branch.id } });
    assert.equal(stored.code, branch.code);
    assert.equal(stored.schoolId, schools.A.id);
  });
});

describe('suspension and reactivation', () => {
  let branch;
  before(async () => {
    branch = (await create('Lifecycle Branch')).body.branch;
  });
  const suspend = (reason, who = ownerA) => who(`/api/owner/branches/${branch.id}/suspend`, { method: 'POST', body: { reason } });
  const reactivate = () => ownerA(`/api/owner/branches/${branch.id}/reactivate`, { method: 'POST' });

  test('a reason of 3–500 characters is required', async () => {
    for (const reason of ['', '  ', 'ab', 'x'.repeat(501)]) assert.equal((await suspend(reason)).status, 400, JSON.stringify(reason));
    assert.equal((await branchEvents(branch.id)).length, 1);
  });

  test('simultaneous suspensions: one succeeds, the other gets 409 INVALID_STATUS; one event', async () => {
    const results = await Promise.all([suspend('Renovation works'), suspend('Renovation works')]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(results.find((r) => r.status === 409).body.code, 'INVALID_STATUS');
    const ok = results.find((r) => r.status === 200).body.branch;
    assert.equal(ok.status, 'suspended');
    assert.equal(ok.suspensionReason, 'Renovation works');
    assert.deepEqual(ok.operating, { operating: false, reasons: ['branch_suspended'] });
    const suspended = (await branchEvents(branch.id)).filter((e) => e.action === 'BRANCH_SUSPENDED');
    assert.equal(suspended.length, 1);
    assert.deepEqual(suspended[0].change, { field: 'Status', from: 'Active', to: 'Suspended', reason: 'Renovation works' });
  });

  test('a suspended branch keeps its name and code reserved; the next code is never a reused one', async () => {
    assert.equal((await create('LIFECYCLE BRANCH')).body.code, 'NAME_TAKEN');
    const next = (await create('After Suspension')).body.branch;
    const used = (await prisma.branch.findMany({ where: { schoolId: schools.A.id }, select: { number: true } })).map((b) => b.number);
    assert.equal(new Set(used).size, used.length);
    assert.equal(Math.max(...used), Number(next.code.slice(-3)));
  });

  test('reactivate: SUSPENDED → ACTIVE, reason cleared; a second reactivation → 409', async () => {
    const res = await reactivate();
    assert.equal(res.status, 200);
    assert.equal(res.body.branch.status, 'active');
    assert.equal(res.body.branch.suspensionReason, null);
    const again = await reactivate();
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'INVALID_STATUS');
    assert.equal((await branchEvents(branch.id)).filter((e) => e.action === 'BRANCH_REACTIVATED').length, 1);
  });
});

describe('school suspension: branch records read-only, branch statuses unchanged', () => {
  let active;
  let suspended;
  let schoolC;

  before(async () => {
    active = (await create('C Active', {}, as('OWNER_C'))).body.branch;
    suspended = (await create('C Suspended', {}, as('OWNER_C'))).body.branch;
    assert.equal((await as('OWNER_C')(`/api/owner/branches/${suspended.id}/suspend`, { method: 'POST', body: { reason: 'Closed for now' } })).status, 200);
    const res = await admin(`/api/platform/schools/${schools.C.id}/suspend`, { method: 'POST', body: { reason: 'Unpaid subscription' } });
    assert.equal(res.status, 200);
    schoolC = res.body.school;
  });

  test('the school is suspended; its branches keep their own statuses', async () => {
    assert.equal(schoolC.status, 'suspended');
    const rows = await prisma.branch.findMany({ where: { schoolId: schools.C.id }, select: { id: true, status: true } });
    assert.deepEqual(Object.fromEntries(rows.map((r) => [r.id, r.status])), { [active.id]: 'ACTIVE', [suspended.id]: 'SUSPENDED' });
  });

  test('reads still work and show that no branch is operating', async () => {
    const owner = as('OWNER_C');
    assert.equal((await owner('/api/owner/school')).body.school.status, 'suspended');
    const one = await owner(`/api/owner/branches/${active.id}`);
    assert.equal(one.status, 200);
    assert.deepEqual(one.body.branch.operating, { operating: false, reasons: ['school_suspended'] });
    const other = await owner(`/api/owner/branches/${suspended.id}`);
    assert.deepEqual(other.body.branch.operating, { operating: false, reasons: ['branch_suspended', 'school_suspended'] });
    assert.equal((await owner(`/api/owner/branches/${active.id}/locations`)).status, 200);
    assert.equal((await owner('/api/owner/audit-logs')).status, 200);
  });

  test('every branch change → 409 SCHOOL_SUSPENDED, nothing written or recorded', async () => {
    const owner = as('OWNER_C');
    const events = await schoolEvents(schools.C);
    const attempts = [
      ['POST', '/api/owner/branches', valid('C New')],
      ['PATCH', `/api/owner/branches/${active.id}`, { name: 'C Renamed' }],
      ['POST', `/api/owner/branches/${active.id}/suspend`, { reason: 'Trying anyway' }],
      ['POST', `/api/owner/branches/${suspended.id}/reactivate`],
      ['POST', `/api/owner/branches/${active.id}/locations`, { ...OTHER, effectiveFrom: 'now' }],
      ['DELETE', `/api/owner/branches/${active.id}/locations/scheduled`],
    ];
    for (const [method, path, body] of attempts) {
      const res = await owner(path, { method, body });
      assert.equal(res.status, 409, `${method} ${path}`);
      assert.equal(res.body.code, 'SCHOOL_SUSPENDED');
    }
    assert.equal(await prisma.branch.count({ where: { schoolId: schools.C.id } }), 2);
    assert.equal(await schoolEvents(schools.C), events);
    assert.equal((await prisma.school.findUnique({ where: { id: schools.C.id } })).branchSequence, 2);
  });

  test('reactivating the school does not reactivate a suspended branch', async () => {
    assert.equal((await admin(`/api/platform/schools/${schools.C.id}/reactivate`, { method: 'POST' })).status, 200);
    const owner = as('OWNER_C');
    assert.deepEqual((await owner(`/api/owner/branches/${active.id}`)).body.branch.operating, { operating: true, reasons: [] });
    const other = (await owner(`/api/owner/branches/${suspended.id}`)).body.branch;
    assert.equal(other.status, 'suspended');
    assert.deepEqual(other.operating, { operating: false, reasons: ['branch_suspended'] });
  });

  test('operatingState: operating only when the branch and the school are both ACTIVE', () => {
    assert.deepEqual(operatingState({ status: 'ACTIVE' }, { status: 'ACTIVE' }), { operating: true, reasons: [] });
    assert.deepEqual(operatingState({ status: 'SUSPENDED' }, { status: 'ACTIVE' }), { operating: false, reasons: ['branch_suspended'] });
    assert.deepEqual(operatingState({ status: 'ACTIVE' }, { status: 'SUSPENDED' }), { operating: false, reasons: ['school_suspended'] });
  });
});

describe('GPS location history and effective times', () => {
  let branch;
  let firstEffective;
  before(async () => {
    branch = (await create('Location Branch')).body.branch;
    firstEffective = new Date(branch.location.effectiveFrom);
  });
  const change = (body) => ownerA(`/api/owner/branches/${branch.id}/locations`, { method: 'POST', body });
  const events = async (action) => (await branchEvents(branch.id)).filter((e) => e.action === action);

  test('effective time: missing, malformed, without a zone, in the past or over a year ahead → 400', async () => {
    for (const effectiveFrom of [undefined, '', 'tomorrow', '2030-01-01T10:00', minutes(-2), new Date(Date.now() + 367 * 86400000).toISOString()]) {
      const res = await change({ ...OTHER, effectiveFrom });
      assert.equal(res.status, 400, String(effectiveFrom));
      assert.ok(res.body.details?.effectiveFrom, String(effectiveFrom));
    }
    assert.equal((await change({ ...OTHER, effectiveFrom: 'now', confirmed: false })).body.details.confirmed !== undefined, true);
    assert.equal((await change({ ...OTHER, accuracy: 75, effectiveFrom: 'now' })).status, 400);
    assert.equal((await events('BRANCH_LOCATION_CHANGED')).length, 0);
  });

  test('saving the location already in force with nothing scheduled → no change, no event', async () => {
    const res = await change({ ...SPOT, accuracy: 30, effectiveFrom: 'now' });
    assert.equal(res.status, 200);
    assert.equal(await prisma.branchLocation.count({ where: { branchId: branch.id } }), 1);
    assert.equal((await branchEvents(branch.id)).length, 1);
  });

  let scheduledAt;
  test('a future change is scheduled; the current location stays in force until then', async () => {
    scheduledAt = minutes(60);
    const res = await change({ ...OTHER, effectiveFrom: scheduledAt });
    assert.equal(res.status, 200);
    assert.equal(res.body.branch.location.latitude, SPOT.latitude);
    assert.equal(res.body.branch.scheduledLocation.latitude, OTHER.latitude);
    assert.equal(res.body.branch.scheduledLocation.effectiveFrom, new Date(scheduledAt).toISOString());
    const [event] = await events('BRANCH_LOCATION_CHANGED');
    assert.match(event.description, /scheduled, effective/);
    assert.deepEqual(event.change.fields[0], { field: 'Location', from: '2.046934, 45.318162 (±12 m)', to: '2.050001, 45.320002 (±8.4 m)' });
  });

  test('locationAt: each location applies from its effective time until the next one (boundaries included)', async () => {
    const at = new Date(scheduledAt);
    assert.equal(await locationAt(branch.id, new Date(firstEffective.getTime() - 1)), null);
    assert.equal((await locationAt(branch.id, firstEffective)).latitude, SPOT.latitude);
    assert.equal((await locationAt(branch.id, new Date(at.getTime() - 1))).latitude, SPOT.latitude);
    assert.equal((await locationAt(branch.id, at)).latitude, OTHER.latitude);
    assert.equal((await locationAt(branch.id, new Date(at.getTime() + 86400000))).latitude, OTHER.latitude);
  });

  test('a second scheduled change replaces the first, which is kept as cancelled and never applies', async () => {
    const later = minutes(120);
    const res = await change({ ...THIRD, effectiveFrom: later });
    assert.equal(res.status, 200);
    assert.equal(res.body.branch.scheduledLocation.latitude, THIRD.latitude);
    const rows = await prisma.branchLocation.findMany({ where: { branchId: branch.id }, orderBy: { recordedAt: 'asc' } });
    assert.equal(rows.length, 3);
    assert.ok(rows[1].cancelledAt, 'the replaced change is marked cancelled');
    assert.equal(rows[1].latitude, OTHER.latitude);
    assert.equal((await locationAt(branch.id, new Date(Date.parse(scheduledAt) + 1000))).latitude, SPOT.latitude);
    const [, replaced] = await events('BRANCH_LOCATION_CHANGED');
    assert.equal(replaced.change.fields.at(-1).to, 'Replaced');
  });

  test('cancel the scheduled change; a second cancel → 404', async () => {
    const res = await ownerA(`/api/owner/branches/${branch.id}/locations/scheduled`, { method: 'DELETE' });
    assert.equal(res.status, 200);
    assert.equal(res.body.branch.scheduledLocation, null);
    assert.equal((await events('BRANCH_LOCATION_CHANGE_CANCELLED')).length, 1);
    assert.equal((await ownerA(`/api/owner/branches/${branch.id}/locations/scheduled`, { method: 'DELETE' })).status, 404);
    assert.equal((await events('BRANCH_LOCATION_CHANGE_CANCELLED')).length, 1);
  });

  test('an immediate change applies now; a time up to a minute in the past counts as now; history keeps every location', async () => {
    const res = await change({ ...OTHER, effectiveFrom: new Date(Date.now() - 30_000).toISOString() });
    assert.equal(res.status, 200);
    assert.equal(res.body.branch.location.latitude, OTHER.latitude);
    assert.ok(Date.parse(res.body.branch.location.effectiveFrom) >= Date.now() - 10_000, 'set to the server time, not the requested past time');
    const history = (await ownerA(`/api/owner/branches/${branch.id}/locations`)).body.items;
    // Newest effective time first: the two cancelled future changes, then the current and the first location.
    assert.deepEqual(history.map((l) => l.state), ['cancelled', 'cancelled', 'current', 'previous']);
    const current = history[2];
    const previous = history[3];
    assert.equal(current.latitude, OTHER.latitude);
    assert.equal(current.effectiveUntil, null);
    assert.equal(previous.latitude, SPOT.latitude);
    assert.equal(previous.effectiveUntil, current.effectiveFrom);
    assert.ok(history.slice(0, 2).every((l) => l.cancelledAt && l.effectiveUntil === null));
  });

  test('saving the current location while a change is scheduled cancels the scheduled change only', async () => {
    assert.equal((await change({ ...THIRD, effectiveFrom: minutes(30) })).status, 200);
    const res = await change({ ...OTHER, effectiveFrom: 'now' });
    assert.equal(res.body.branch.scheduledLocation, null);
    assert.equal(res.body.branch.location.latitude, OTHER.latitude);
    const [, second] = await events('BRANCH_LOCATION_CHANGE_CANCELLED');
    assert.match(second.description, /already in force/);
  });

  test('a suspended branch can still have its location changed (as suspended schools can be edited)', async () => {
    const other = (await create('Suspended Location Branch')).body.branch;
    await ownerA(`/api/owner/branches/${other.id}/suspend`, { method: 'POST', body: { reason: 'Moving premises' } });
    const res = await ownerA(`/api/owner/branches/${other.id}/locations`, { method: 'POST', body: { ...THIRD, effectiveFrom: 'now' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.branch.location.latitude, THIRD.latitude);
  });
});

describe('audit access', () => {
  test('owners see their own school\'s branch events only, without network or browser details', async () => {
    const res = await ownerA('/api/owner/audit-logs?pageSize=100');
    assert.equal(res.status, 200);
    assert.ok(res.body.total > 0);
    const ids = new Set((await prisma.branch.findMany({ where: { schoolId: schools.A.id }, select: { id: true } })).map((b) => b.id));
    for (const event of res.body.items) {
      assert.ok(ids.has(event.target.id), 'own school only');
      assert.ok(event.action.startsWith('BRANCH_'));
      assert.equal(event.ipAddress, undefined);
      assert.equal(event.context, undefined);
    }
  });

  test('the branch filter limits events to one branch; an invalid id → 400', async () => {
    const branch = await prisma.branch.findFirst({ where: { schoolId: schools.A.id, name: 'Location Branch' } });
    const res = await ownerA(`/api/owner/audit-logs?branch=${branch.id}&pageSize=100`);
    assert.ok(res.body.items.every((e) => e.target.id === branch.id));
    assert.equal(res.body.items.at(-1).action, 'BRANCH_CREATED');
    assert.equal((await ownerA('/api/owner/audit-logs?branch=nope')).status, 400);
  });

  test('Super Admins see branch events in the audit log (filter by action, branch target with its school)', async () => {
    const res = await admin(`/api/platform/audit-logs?action=BRANCH_CREATED&school=${schools.A.id}&pageSize=100`);
    assert.equal(res.status, 200);
    assert.ok(res.body.total > 0);
    const event = res.body.items[0];
    assert.equal(event.target.type, 'branch');
    assert.equal(event.target.schoolName, schools.A.name);
    assert.equal(event.actor.role, 'OWNER');
  });

  test('branch events are not listed in the dashboard\'s recent platform activity', async () => {
    const res = await admin('/api/platform/dashboard');
    assert.equal(res.status, 200);
    assert.ok(res.body.recentActivity.every((e) => !e.type.startsWith('BRANCH_')));
  });

  test('managers and staff have no branch audit access', async () => {
    for (const role of ['MANAGER', 'STAFF']) assert.equal((await as(role)('/api/owner/audit-logs')).status, 403);
  });
});

/*
 * Class and section tests (approved rules: docs/business-rules.md → Classes and sections). Classes
 * are permanent and school level (School Owner manages, Managers read); sections belong to one class,
 * one academic year and one branch (School Owner: any branch of the school; Manager: own branch).
 * Covers school and branch isolation, role access, uniqueness, academic-year rules (closed years
 * read only), the section picker list, history after a new year, deactivation and audit.
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

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Class tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const cookies = {};
const schools = {};
const branches = {};
const years = {};
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
const managerA1 = as('MANAGER_A1');
const managerA2 = as('MANAGER_A2');

const newClass = (name, sequence, who = ownerA, extra = {}) => who('/api/owner/classes', { method: 'POST', body: { name, sequence, ...extra } });
const ownerSection = (body, who = ownerA) => who('/api/owner/sections', { method: 'POST', body });
const managerSection = (body, who = managerA1) => who('/api/manager/sections', { method: 'POST', body });
const events = (id) => prisma.auditEvent.findMany({ where: { targetId: id }, orderBy: { occurredAt: 'asc' } });
let seq = 0;
const nextSeq = () => (seq += 1);

async function wipeSchool(key) {
  await prisma.section.deleteMany({ where: { schoolId: schools[key].id } });
  await prisma.schoolClass.deleteMany({ where: { schoolId: schools[key].id } });
}

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  for (const key of ['A', 'B']) {
    schools[key] = await prisma.school.create({
      data: { code: `TCL${tag}-${key}`, name: `Class Test ${key} ${tag}`, location: 'Mogadishu', phone: '+252 61 1234567', address: 'Test Road 1' },
    });
  }
  const branch = (school, n, name) =>
    prisma.branch.create({
      data: { schoolId: schools[school].id, number: n, code: `TCL${tag}-${school}-B00${n}`, name, nameKey: name.toLowerCase(), address: 'Road 1', city: 'Mogadishu' },
    });
  branches.A1 = await branch('A', 1, 'North');
  branches.A2 = await branch('A', 2, 'South');
  branches.B1 = await branch('B', 1, 'Main');

  const year = (school, name, from, to, status) =>
    prisma.academicYear.create({
      data: { schoolId: schools[school].id, name, nameKey: name.toLowerCase(), startDate: new Date(`${from}T00:00:00Z`), endDate: new Date(`${to}T00:00:00Z`), status },
    });
  years.closed = await year('A', '2024/2025', '2024-09-01', '2025-06-30', 'CLOSED');
  years.current = await year('A', '2025/2026', '2025-09-01', '2026-06-30', 'CURRENT');
  years.planned = await year('A', '2026/2027', '2026-09-01', '2027-06-30', 'PLANNED');
  years.otherSchool = await year('B', '2025/2026', '2025-09-01', '2026-06-30', 'CURRENT');

  const people = [
    ['SUPER_ADMIN', 'SUPER_ADMIN'],
    ['OWNER_A', 'OWNER', { school: 'A' }],
    ['OWNER_B', 'OWNER', { school: 'B' }],
    ['MANAGER_A1', 'MANAGER', { branch: 'A1' }],
    ['MANAGER_A2', 'MANAGER', { branch: 'A2' }],
    ['MANAGER_B1', 'MANAGER', { branch: 'B1' }],
    ['STAFF', 'STAFF'],
  ];
  for (const [key, role, link = {}] of people) {
    const password = randomBytes(12).toString('base64url');
    const email = `test-cl-${key.toLowerCase().replace('_', '-')}-${lower}@test.edutrack.example`;
    const scope = link.branch ? { branchId: branches[link.branch].id } : await branchFor(role);
    const user = await prisma.user.create({ data: { name: `Test ${key} ${tag}`, email, role, ...scope, passwordHash: await hashPassword(password) } });
    if (link.school) await prisma.school.update({ where: { id: schools[link.school].id }, data: { ownerId: user.id } });
    const res = await call('/api/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(res.status, 200, `${key} sign-in`);
    cookies[key] = res.cookie;
  }
});

after(async () => {
  const schoolIds = Object.values(schools).map((s) => s.id);
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  await prisma.auditEvent.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { actorId: { in: userIds } }] } });
  await prisma.section.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.schoolClass.deleteMany({ where: { schoolId: { in: schoolIds } } });
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

describe('access by role', () => {
  const id = randomUUID();
  const ownerEndpoints = [
    ['GET', '/api/owner/classes'],
    ['GET', `/api/owner/classes/${id}`],
    ['POST', '/api/owner/classes', { name: 'X', sequence: 1 }],
    ['PATCH', `/api/owner/classes/${id}`, { name: 'Y' }],
    ['POST', `/api/owner/classes/${id}/deactivate`],
    ['POST', `/api/owner/classes/${id}/reactivate`],
    ['GET', '/api/owner/sections'],
    ['POST', '/api/owner/sections', {}],
    ['PATCH', `/api/owner/sections/${id}`, { name: 'B' }],
    ['POST', `/api/owner/sections/${id}/deactivate`],
  ];
  const managerEndpoints = [
    ['GET', '/api/manager/classes'],
    ['GET', `/api/manager/classes/${id}`],
    ['GET', '/api/manager/sections'],
    ['POST', '/api/manager/sections', {}],
    ['PATCH', `/api/manager/sections/${id}`, { name: 'B' }],
    ['POST', `/api/manager/sections/${id}/deactivate`],
  ];

  test('signed out → 401', async () => {
    for (const [method, path, body] of [...ownerEndpoints, ...managerEndpoints]) assert.equal((await call(path, { method, body })).status, 401, `${method} ${path}`);
  });

  test('STAFF and SUPER_ADMIN have no class or section access (403)', async () => {
    for (const role of ['STAFF', 'SUPER_ADMIN']) {
      for (const [method, path, body] of [...ownerEndpoints, ...managerEndpoints]) {
        assert.equal((await as(role)(path, { method, body })).status, 403, `${role} ${method} ${path}`);
      }
    }
  });

  test('Managers cannot use the Owner endpoints (classes are managed by the Owner)', async () => {
    for (const [method, path, body] of ownerEndpoints) assert.equal((await managerA1(path, { method, body })).status, 403, `${method} ${path}`);
    // There is no Manager endpoint for changing classes.
    assert.equal((await managerA1('/api/manager/classes', { method: 'POST', body: { name: 'X', sequence: 1 } })).status, 404);
  });

  test('Owners cannot use the Manager endpoints', async () => {
    for (const [method, path, body] of managerEndpoints) assert.equal((await ownerA(path, { method, body })).status, 403, `${method} ${path}`);
  });
});

describe('classes (School Owner)', () => {
  test('create with audit; names unique per school regardless of capitalization; order unique', async () => {
    await wipeSchool('A');
    const res = await newClass('  Grade   7 ', 7, ownerA, { description: 'Seventh grade' });
    assert.equal(res.status, 201);
    assert.equal(res.body.class.name, 'Grade 7');
    assert.equal(res.body.class.status, 'active');
    assert.equal((await events(res.body.class.id))[0].action, 'CLASS_CREATED');

    let dup = await newClass('GRADE 7', 8);
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'NAME_TAKEN');
    dup = await newClass('Grade Seven', 7);
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'SEQUENCE_TAKEN');
    assert.match(dup.body.error, /Grade 7/);

    // Another school may use the same name and order.
    assert.equal((await newClass('Grade 7', 7, ownerB)).status, 201);
  });

  test('validation: required name and a whole-number order; server fields refused', async () => {
    let res = await ownerA('/api/owner/classes', { method: 'POST', body: {} });
    assert.equal(res.status, 400);
    assert.ok(res.body.details.name && res.body.details.sequence);
    res = await newClass('Grade X', 1.5);
    assert.equal(res.status, 400);
    res = await ownerA('/api/owner/classes', { method: 'POST', body: { name: 'Grade X', sequence: 3, schoolId: schools.B.id } });
    assert.equal(res.status, 400);
    assert.ok(res.body.details.schoolId);
  });

  test('edit records old and new values; unchanged → no event', async () => {
    await wipeSchool('A');
    const cls = (await newClass('Grade 1', 1)).body.class;
    let res = await ownerA(`/api/owner/classes/${cls.id}`, { method: 'PATCH', body: { name: 'Grade One', sequence: 2 } });
    assert.equal(res.status, 200);
    const updated = (await events(cls.id)).at(-1);
    assert.equal(updated.action, 'CLASS_UPDATED');
    assert.deepEqual(updated.change.fields, [
      { field: 'Name', from: 'Grade 1', to: 'Grade One' },
      { field: 'Order', from: '1', to: '2' },
    ]);
    res = await ownerA(`/api/owner/classes/${cls.id}`, { method: 'PATCH', body: { name: 'Grade One' } });
    assert.equal(res.status, 200);
    assert.equal((await events(cls.id)).length, 2);
  });

  test('school isolation: another school\'s class is not found', async () => {
    const theirs = (await ownerB('/api/owner/classes')).body.items[0];
    assert.equal((await ownerA(`/api/owner/classes/${theirs.id}`)).status, 404);
    assert.equal((await ownerA(`/api/owner/classes/${theirs.id}`, { method: 'PATCH', body: { name: 'Taken' } })).status, 404);
    assert.equal((await ownerA(`/api/owner/classes/${theirs.id}/deactivate`, { method: 'POST' })).status, 404);
    assert.equal((await ownerA('/api/owner/sections', { method: 'POST', body: { classId: theirs.id, academicYearId: years.current.id, branchId: branches.A1.id, name: 'A' } })).status, 404);
  });
});

describe('sections', () => {
  let g7;
  let g8;

  before(async () => {
    await wipeSchool('A');
    g7 = (await newClass('Grade 7', 7)).body.class;
    g8 = (await newClass('Grade 8', 8)).body.class;
  });

  test('Owner creates a section in any branch of the school; it is audited with its scope', async () => {
    const res = await ownerSection({ classId: g7.id, academicYearId: years.current.id, branchId: branches.A2.id, name: 'A', capacity: 35, room: 'R-12' });
    assert.equal(res.status, 201);
    const s = res.body.section;
    assert.equal(s.displayName, 'Grade 7A');
    assert.equal(s.branch.id, branches.A2.id);
    assert.equal(s.academicYear.name, '2025/2026');
    assert.equal(s.capacity, 35);
    const [event] = await events(s.id);
    assert.equal(event.action, 'SECTION_CREATED');
    assert.equal(event.schoolId, schools.A.id);
    assert.match(event.targetName, /Grade 7A · 2025\/2026/);
  });

  test('Manager creates sections in their own branch only; a branch cannot be chosen', async () => {
    const res = await managerSection({ classId: g7.id, academicYearId: years.current.id, name: 'A' });
    assert.equal(res.status, 201);
    assert.equal(res.body.section.branch.id, branches.A1.id);
    const refused = await managerSection({ classId: g7.id, academicYearId: years.current.id, branchId: branches.A2.id, name: 'B' });
    assert.equal(refused.status, 400);
    assert.ok(refused.body.details.branchId);
  });

  test('uniqueness: per class, year and branch; reusable in another year, class or branch', async () => {
    const base = { classId: g7.id, academicYearId: years.current.id, name: 'A' };
    // Compared without regard to capitalization.
    const dup = await managerSection({ ...base, name: 'a' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'NAME_TAKEN');
    // Same name: other academic year, other class.
    assert.equal((await managerSection({ ...base, academicYearId: years.planned.id })).status, 201);
    assert.equal((await managerSection({ ...base, classId: g8.id })).status, 201);
    // Other branch: Grade 7 "A" exists in both North (Manager) and South (Owner) for the same year.
    const both = (await ownerA(`/api/owner/sections?academicYear=${years.current.id}&class=${g7.id}`)).body.items.filter((s) => s.name === 'A');
    assert.deepEqual(both.map((s) => s.branch.id).sort(), [branches.A1.id, branches.A2.id].sort());
  });

  test('simultaneous duplicates: exactly one is created', async () => {
    const body = { classId: g8.id, academicYearId: years.current.id, name: 'Z' };
    const results = await Promise.all([1, 2, 3].map(() => managerSection(body)));
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
  });

  test('closed academic years: no new sections, and their sections are read only', async () => {
    const res = await managerSection({ classId: g7.id, academicYearId: years.closed.id, name: 'A' });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'YEAR_CLOSED');
    const historic = await prisma.section.create({
      data: { schoolId: schools.A.id, branchId: branches.A1.id, classId: g7.id, academicYearId: years.closed.id, name: 'H', nameKey: 'h' },
    });
    assert.equal((await managerA1(`/api/manager/sections/${historic.id}`, { method: 'PATCH', body: { capacity: 10 } })).body.code, 'YEAR_CLOSED');
    assert.equal((await managerA1(`/api/manager/sections/${historic.id}/deactivate`, { method: 'POST' })).body.code, 'YEAR_CLOSED');
    const read = await managerA1(`/api/manager/sections/${historic.id}`);
    assert.equal(read.status, 200);
    assert.equal(read.body.section.readOnly, true);
  });

  test('academic year, class and branch must belong to the account\'s school', async () => {
    let res = await managerSection({ classId: g7.id, academicYearId: years.otherSchool.id, name: 'Q' });
    assert.equal(res.status, 404);
    res = await ownerSection({ classId: g7.id, academicYearId: years.current.id, branchId: branches.B1.id, name: 'Q' });
    assert.equal(res.status, 404);
    res = await as('MANAGER_B1')('/api/manager/sections', { method: 'POST', body: { classId: g7.id, academicYearId: years.otherSchool.id, name: 'Q' } });
    assert.equal(res.status, 404);
  });

  test('branch isolation: a Manager neither sees nor changes another branch\'s sections', async () => {
    const south = (await managerA2('/api/manager/sections')).body.items[0];
    assert.equal(south.branch.id, branches.A2.id);
    assert.equal((await managerA1(`/api/manager/sections/${south.id}`)).status, 404);
    assert.equal((await managerA1(`/api/manager/sections/${south.id}`, { method: 'PATCH', body: { capacity: 5 } })).status, 404);
    assert.equal((await managerA1(`/api/manager/sections/${south.id}/deactivate`, { method: 'POST' })).status, 404);
    const mine = (await managerA1('/api/manager/sections')).body.items;
    assert.ok(mine.length > 0 && mine.every((s) => s.branch.id === branches.A1.id));
    assert.equal((await managerA1(`/api/manager/sections?branch=${branches.A2.id}`)).status, 400);
  });

  test('the section picker: active sections of the year, in class order, as "Grade 7A"', async () => {
    const north = (await managerA1('/api/manager/sections')).body.items.find((s) => s.displayName === 'Grade 7B');
    if (!north) await managerSection({ classId: g7.id, academicYearId: years.current.id, name: 'B' });
    const b = (await managerA1('/api/manager/sections')).body.items.find((s) => s.displayName === 'Grade 7B');
    await managerA1(`/api/manager/sections/${b.id}/deactivate`, { method: 'POST' });

    const res = await managerA1(`/api/manager/sections?academicYear=${years.current.id}&status=active`);
    assert.equal(res.status, 200);
    assert.equal(res.body.academicYear.id, years.current.id);
    const names = res.body.items.map((s) => s.displayName);
    assert.deepEqual(names, ['Grade 7A', 'Grade 8A', 'Grade 8Z']);
    // Default year: the current one; another year's sections are not mixed in.
    const planned = (await managerA1(`/api/manager/sections?academicYear=${years.planned.id}`)).body.items;
    assert.ok(planned.every((s) => s.academicYear.id === years.planned.id));
    // The Owner sees every branch, or one.
    const all = (await ownerA(`/api/owner/sections?academicYear=${years.current.id}&status=active`)).body.items;
    assert.ok(all.some((s) => s.branch.id === branches.A2.id) && all.some((s) => s.branch.id === branches.A1.id));
    const south = (await ownerA(`/api/owner/sections?academicYear=${years.current.id}&branch=${branches.A2.id}`)).body.items;
    assert.ok(south.every((s) => s.branch.id === branches.A2.id));
  });

  test('class list and details count sections per year and scope', async () => {
    const mine = (await managerA1(`/api/manager/classes?academicYear=${years.current.id}`)).body;
    const grade7 = mine.items.find((c) => c.id === g7.id);
    assert.equal(grade7.sections, 1);
    assert.equal(grade7.inactiveSections, 1);
    const owner = (await ownerA(`/api/owner/classes?academicYear=${years.current.id}`)).body.items.find((c) => c.id === g7.id);
    assert.equal(owner.sections, 2);
    const details = (await ownerA(`/api/owner/classes/${g7.id}?academicYear=${years.current.id}`)).body;
    assert.equal(details.class.name, 'Grade 7');
    assert.ok(details.sections.every((s) => s.class.id === g7.id && s.academicYear.id === years.current.id));
  });
});

describe('history and deactivation', () => {
  test('a new academic year never changes the previous year\'s sections', async () => {
    await wipeSchool('A');
    const cls = (await newClass('Grade 9', nextSeq() + 20)).body.class;
    const old = (await managerSection({ classId: cls.id, academicYearId: years.current.id, name: 'A', capacity: 30 })).body.section;
    const next = (await managerSection({ classId: cls.id, academicYearId: years.planned.id, name: 'A', capacity: 25 })).body.section;
    assert.notEqual(old.id, next.id);
    const kept = (await managerA1(`/api/manager/sections/${old.id}`)).body.section;
    assert.deepEqual([kept.academicYear.id, kept.capacity, kept.name], [years.current.id, 30, 'A']);
  });

  test('a class with active sections in an open year cannot be deactivated; history is kept', async () => {
    await wipeSchool('A');
    const cls = (await newClass('Grade 10', 10)).body.class;
    const section = (await managerSection({ classId: cls.id, academicYearId: years.current.id, name: 'A' })).body.section;
    let res = await ownerA(`/api/owner/classes/${cls.id}/deactivate`, { method: 'POST' });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'CLASS_IN_USE');

    await managerA1(`/api/manager/sections/${section.id}/deactivate`, { method: 'POST' });
    res = await ownerA(`/api/owner/classes/${cls.id}/deactivate`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.equal(res.body.class.status, 'inactive');
    // Nothing was deleted, and no new or reactivated section can use an inactive class.
    assert.ok(await prisma.section.findUnique({ where: { id: section.id } }));
    assert.equal((await managerSection({ classId: cls.id, academicYearId: years.current.id, name: 'B' })).body.code, 'CLASS_INACTIVE');
    assert.equal((await managerA1(`/api/manager/sections/${section.id}/reactivate`, { method: 'POST' })).body.code, 'CLASS_INACTIVE');
    // Managers still see an inactive class that has sections in the year (history).
    const listed = (await managerA1(`/api/manager/classes?academicYear=${years.current.id}`)).body.items;
    assert.ok(listed.some((c) => c.id === cls.id));

    assert.equal((await ownerA(`/api/owner/classes/${cls.id}/reactivate`, { method: 'POST' })).body.class.status, 'active');
    const actions = (await events(section.id)).map((e) => e.action);
    assert.deepEqual(actions, ['SECTION_CREATED', 'SECTION_DEACTIVATED']);
  });

  test('a planned academic year with sections cannot be deleted', async () => {
    const cls = (await ownerA('/api/owner/classes')).body.items[0];
    await managerSection({ classId: cls.id, academicYearId: years.planned.id, name: 'P' });
    const res = await ownerA(`/api/owner/academic-years/${years.planned.id}`, { method: 'DELETE' });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'YEAR_IN_USE');
  });
});

describe('suspension', () => {
  test('a suspended branch or school makes sections read only', async () => {
    await wipeSchool('A');
    const cls = (await newClass('Grade 11', 11)).body.class;
    await prisma.branch.update({ where: { id: branches.A1.id }, data: { status: 'SUSPENDED' } });
    try {
      const res = await managerSection({ classId: cls.id, academicYearId: years.current.id, name: 'A' });
      assert.equal(res.status, 409);
      assert.equal(res.body.code, 'BRANCH_NOT_OPERATING');
      assert.equal((await managerA1('/api/manager/sections')).status, 200);
    } finally {
      await prisma.branch.update({ where: { id: branches.A1.id }, data: { status: 'ACTIVE' } });
    }
    await prisma.school.update({ where: { id: schools.A.id }, data: { status: 'SUSPENDED' } });
    try {
      assert.equal((await newClass('Grade 12', 12)).body.code, 'SCHOOL_SUSPENDED');
      assert.equal((await managerSection({ classId: cls.id, academicYearId: years.current.id, name: 'A' })).body.code, 'BRANCH_NOT_OPERATING');
    } finally {
      await prisma.school.update({ where: { id: schools.A.id }, data: { status: 'ACTIVE' } });
    }
  });
});

/*
 * Student, enrollment and promotion tests (approved rules: docs/business-rules.md → Students; Student
 * enrollment; Academic year promotion). Registration once per student; enrollment per academic year
 * (one per student and year) in a section of the Manager's branch; Bulk Academic Year Enrollment &
 * Promotion with recommendations, Manager decisions, confirmation, chunked idempotent processing,
 * partial failure and retry, and history kept. Runs on the Neon dev branch (`npm test`); everything
 * it creates is removed afterwards.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Student tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const cookies = {};
const schools = {};
const branches = {};
const years = {};
const classes = {};
const sections = {};
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
const managerA1 = as('MANAGER_A1');
const managerA2 = as('MANAGER_A2');

let n = 0;
const profile = (overrides = {}) => {
  n += 1;
  return {
    firstName: `Amina${n}`,
    lastName: `Test${tag}`,
    gender: 'female',
    dateOfBirth: '2014-03-0' + ((n % 9) + 1),
    guardianName: 'Hodan Ali',
    guardianPhone: '+252 61 2345678',
    ...overrides,
  };
};
const register = (body = profile(), who = managerA1) => who(`/api/${who === ownerA ? 'owner' : 'manager'}/students`, { method: 'POST', body });
const enroll = (studentId, sectionId, who = managerA1) => who(`/api/manager/students/${studentId}/enrollments`, { method: 'POST', body: { sectionId } });

/** A registered and enrolled student in A1 for the current year, with a result. */
async function enrolledStudent(sectionKey, result) {
  const student = (await register()).body.student;
  const enrollment = (await enroll(student.id, sections[sectionKey].id)).body.enrollment;
  if (result) await managerA1(`/api/manager/enrollments/${enrollment.id}`, { method: 'PATCH', body: { result } });
  return { student, enrollment };
}

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  for (const key of ['A', 'B']) {
    schools[key] = await prisma.school.create({
      data: { code: `TST${tag}-${key}`, name: `Student Test ${key} ${tag}`, location: 'Mogadishu', phone: '+252 61 1234567', address: 'Test Road 1' },
    });
  }
  const branch = (school, number, name) =>
    prisma.branch.create({ data: { schoolId: schools[school].id, number, code: `TST${tag}-${school}-B00${number}`, name, nameKey: name.toLowerCase(), address: 'Road 1', city: 'Mogadishu' } });
  branches.A1 = await branch('A', 1, 'North');
  branches.A2 = await branch('A', 2, 'South');
  branches.B1 = await branch('B', 1, 'Main');

  const year = (school, name, from, to, status) =>
    prisma.academicYear.create({ data: { schoolId: schools[school].id, name, nameKey: name, startDate: new Date(`${from}T00:00:00Z`), endDate: new Date(`${to}T00:00:00Z`), status } });
  years.closed = await year('A', '2024/2025', '2024-09-01', '2025-06-30', 'CLOSED');
  years.current = await year('A', '2025/2026', '2025-09-01', '2026-06-30', 'CURRENT');
  years.next = await year('A', '2026/2027', '2026-09-01', '2027-06-30', 'PLANNED');

  for (const seq of [6, 7, 8]) {
    classes[seq] = await prisma.schoolClass.create({ data: { schoolId: schools.A.id, name: `Grade ${seq}`, nameKey: `grade ${seq}`, sequence: seq } });
  }
  const section = (key, seq, name, yearKey, branchKey = 'A1') =>
    prisma.section
      .create({ data: { schoolId: schools.A.id, branchId: branches[branchKey].id, classId: classes[seq].id, academicYearId: years[yearKey].id, name, nameKey: name.toLowerCase() } })
      .then((s) => (sections[key] = s));
  // Current year (North): 6A, 6B, 7A, 8A. Next year (North): 6A, 7A, 8A — no 7B (a missing destination).
  await section('6A', 6, 'A', 'current');
  await section('6B', 6, 'B', 'current');
  await section('7A', 7, 'A', 'current');
  await section('8A', 8, 'A', 'current');
  await section('n6A', 6, 'A', 'next');
  await section('n7A', 7, 'A', 'next');
  await section('n8A', 8, 'A', 'next');
  await section('old6A', 6, 'A', 'closed');
  await section('south6A', 6, 'A', 'current', 'A2');

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
    const email = `test-st-${key.toLowerCase().replace('_', '-')}-${lower}@test.edutrack.example`;
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
  const batchIds = (await prisma.promotionBatch.findMany({ where: { schoolId: { in: schoolIds } }, select: { id: true } })).map((b) => b.id);
  await prisma.auditEvent.deleteMany({ where: { OR: [{ schoolId: { in: schoolIds } }, { actorId: { in: userIds } }] } });
  await prisma.promotionItem.deleteMany({ where: { batchId: { in: batchIds } } });
  await prisma.promotionBatch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.enrollment.updateMany({ where: { schoolId: { in: schoolIds } }, data: { previousEnrollmentId: null } });
  await prisma.enrollment.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.student.deleteMany({ where: { schoolId: { in: schoolIds } } });
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
  const managerEndpoints = [
    ['GET', '/api/manager/students'],
    ['POST', '/api/manager/students', {}],
    ['GET', `/api/manager/students/${id}`],
    ['POST', `/api/manager/students/${id}/enrollments`, { sectionId: id }],
    ['PATCH', `/api/manager/enrollments/${id}`, { result: 'PASSED' }],
    ['POST', `/api/manager/students/${id}/transfer-out`, { reason: 'Moving' }],
    ['GET', '/api/manager/promotions'],
    ['POST', '/api/manager/promotions', {}],
    ['POST', `/api/manager/promotions/${id}/confirm`, { confirm: 'PROCESS' }],
    ['POST', `/api/manager/promotions/${id}/process`],
  ];
  test('STAFF and SUPER_ADMIN cannot register, enroll or promote (403)', async () => {
    for (const role of ['STAFF', 'SUPER_ADMIN']) {
      for (const [method, path, body] of [...managerEndpoints, ['GET', '/api/owner/students'], ['POST', '/api/owner/students', {}]]) {
        assert.equal((await as(role)(path, { method, body })).status, 403, `${role} ${method} ${path}`);
      }
    }
  });
  test('Owners cannot use the Manager endpoints (enrollment and promotion are the Manager’s)', async () => {
    for (const [method, path, body] of managerEndpoints) assert.equal((await ownerA(path, { method, body })).status, 403, `${method} ${path}`);
  });
});

describe('student registration', () => {
  test('a profile is created once, without a class, with a generated Student ID; audited', async () => {
    const res = await register(profile({ middleName: 'Hassan', firstName: '  Ayaan ' }));
    assert.equal(res.status, 201);
    const s = res.body.student;
    assert.equal(s.status, 'pending_enrollment');
    assert.match(s.studentNumber, new RegExp(`^TST${tag}-A-B001-S\\d{4}$`));
    assert.equal(s.fullName, `Ayaan Hassan Test${tag}`);
    assert.equal(s.branch.id, branches.A1.id);
    const event = await prisma.auditEvent.findFirst({ where: { targetId: s.id } });
    assert.equal(event.action, 'STUDENT_REGISTERED');
  });

  test('required fields, dates and phones are checked; server fields refused', async () => {
    let res = await managerA1('/api/manager/students', { method: 'POST', body: {} });
    assert.equal(res.status, 400);
    for (const field of ['firstName', 'lastName', 'gender', 'dateOfBirth', 'guardianName', 'guardianPhone']) assert.ok(res.body.details[field], field);
    res = await register(profile({ dateOfBirth: '2999-01-01', guardianPhone: '12' }));
    assert.ok(res.body.details.dateOfBirth && res.body.details.guardianPhone);
    res = await register(profile({ studentNumber: 'X-1' }));
    assert.equal(res.status, 400);
    res = await register(profile({ branchId: branches.A2.id }));
    assert.ok(res.body.details.branchId);
  });

  test('a possible duplicate (same full name and date of birth) needs confirmation', async () => {
    const body = profile({ firstName: 'Duplicate', dateOfBirth: '2013-05-05' });
    const first = await register(body);
    assert.equal(first.status, 201);
    const again = await register({ ...body, firstName: 'DUPLICATE' });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'POSSIBLE_DUPLICATE');
    assert.deepEqual(again.body.details.studentNumbers, [first.body.student.studentNumber]);
    const confirmed = await register({ ...body, confirmDuplicate: true });
    assert.equal(confirmed.status, 201);
    assert.notEqual(confirmed.body.student.studentNumber, first.body.student.studentNumber);
  });

  test('Owners register in a branch of their school only; Managers see their branch only', async () => {
    let res = await register({ ...profile(), branchId: branches.A2.id }, ownerA);
    assert.equal(res.status, 201);
    assert.equal(res.body.student.branch.id, branches.A2.id);
    const south = res.body.student;
    res = await register({ ...profile(), branchId: branches.B1.id }, ownerA);
    assert.equal(res.status, 404);
    assert.equal((await managerA1(`/api/manager/students/${south.id}`)).status, 404);
    assert.equal((await managerA2(`/api/manager/students/${south.id}`)).status, 200);
    assert.equal((await as('OWNER_B')(`/api/owner/students/${south.id}`)).status, 404);
  });
});

describe('enrollment', () => {
  test('enrolls in a section of the branch; one enrollment per student and year', async () => {
    const student = (await register()).body.student;
    const res = await enroll(student.id, sections['6A'].id);
    assert.equal(res.status, 201);
    assert.equal(res.body.enrollment.section.displayName, 'Grade 6A');
    assert.equal(res.body.enrollment.academicYear.id, years.current.id);
    assert.equal((await managerA1(`/api/manager/students/${student.id}`)).body.student.status, 'enrolled');
    const dup = await enroll(student.id, sections['6B'].id);
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'ALREADY_ENROLLED');
    // Simultaneous enrollments in another year: exactly one succeeds.
    const results = await Promise.all([enroll(student.id, sections.n6A.id), enroll(student.id, sections.n7A.id)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  });

  test('invalid year, branch, school or section are refused', async () => {
    const student = (await register()).body.student;
    assert.equal((await enroll(student.id, sections.old6A.id)).body.code, 'YEAR_CLOSED');
    assert.equal((await enroll(student.id, sections.south6A.id)).status, 404);
    assert.equal((await enroll(student.id, randomUUID())).status, 404);
    assert.equal((await managerA1(`/api/manager/students/${student.id}/enrollments`, { method: 'POST', body: { sectionId: sections['6A'].id, academicYearId: years.next.id } })).status, 400);
    assert.equal((await as('MANAGER_B1')(`/api/manager/students/${student.id}/enrollments`, { method: 'POST', body: { sectionId: sections['6A'].id } })).status, 404);
  });

  test('a section change stays in the same academic year; results are recorded', async () => {
    const { enrollment } = await enrolledStudent('6A');
    let res = await managerA1(`/api/manager/enrollments/${enrollment.id}`, { method: 'PATCH', body: { sectionId: sections.n6A.id } });
    assert.equal(res.body.code, 'WRONG_YEAR');
    res = await managerA1(`/api/manager/enrollments/${enrollment.id}`, { method: 'PATCH', body: { sectionId: sections['6B'].id, result: 'passed' } });
    assert.equal(res.status, 200);
    assert.deepEqual([res.body.enrollment.section.displayName, res.body.enrollment.result], ['Grade 6B', 'passed']);
  });

  test('directory: year, class, section and enrollment filters, with "Grade 6A" labels', async () => {
    const res = await managerA1(`/api/manager/students?academicYear=${years.current.id}&section=${sections['6A'].id}&pageSize=100`);
    assert.equal(res.status, 200);
    assert.ok(res.body.items.length > 0 && res.body.items.every((s) => s.enrollment.section.displayName === 'Grade 6A'));
    const pending = (await managerA1(`/api/manager/students?academicYear=${years.current.id}&enrollment=not_enrolled&pageSize=100`)).body.items;
    assert.ok(pending.every((s) => s.enrollment === null));
    const owner = (await ownerA(`/api/owner/students?branch=${branches.A2.id}&pageSize=100`)).body.items;
    assert.ok(owner.length > 0 && owner.every((s) => s.branch.id === branches.A2.id));
    assert.equal((await managerA1(`/api/manager/students?branch=${branches.A2.id}`)).status, 400);
  });
});

describe('bulk academic year enrollment and promotion', () => {
  const people = {};
  let batch;
  const promotion = (path = '', options) => managerA1(`/api/manager/promotions${path}`, options);
  const item = (key) => batch.items.find((i) => i.student.id === people[key].student.id);

  before(async () => {
    // Fresh students for this scenario (earlier tests' students stay pending in the review).
    await prisma.enrollment.updateMany({ where: { branchId: branches.A1.id, academicYearId: years.current.id }, data: { status: 'COMPLETED' } });
    people.passed6A = await enrolledStudent('6A', 'PASSED');
    people.failed6A = await enrolledStudent('6A', 'FAILED');
    people.passed6B = await enrolledStudent('6B', 'PASSED');
    people.passed8A = await enrolledStudent('8A', 'PASSED');
    people.unknown7A = await enrolledStudent('7A');
    people.leaving7A = await enrolledStudent('7A', 'PASSED');
    people.gone = await enrolledStudent('7A', 'PASSED');
    const res = await managerA1(`/api/manager/students/${people.gone.student.id}/transfer-out`, { method: 'POST', body: { reason: 'Family moved' } });
    assert.equal(res.body.student.status, 'transferred_out');
  });

  test('validation: years in order, new year not closed', async () => {
    assert.equal((await promotion('', { method: 'POST', body: { fromYearId: years.next.id, toYearId: years.current.id } })).body.code, 'WRONG_ORDER');
    assert.equal((await promotion('', { method: 'POST', body: { fromYearId: years.closed.id, toYearId: years.closed.id } })).status, 400);
  });

  test('recommendations: promote with the same section, repeat, graduate, review; missing destinations flagged', async () => {
    const res = await promotion('', { method: 'POST', body: { fromYearId: years.current.id, toYearId: years.next.id } });
    assert.equal(res.status, 200);
    batch = res.body;
    assert.equal(batch.batch.status, 'draft');
    // Transferred-out students are not candidates.
    assert.equal(item('gone'), undefined);
    assert.deepEqual([item('passed6A').decision, item('passed6A').target.displayName], ['PROMOTE', 'Grade 7A']);
    assert.deepEqual([item('failed6A').decision, item('failed6A').target.displayName], ['REPEAT', 'Grade 6A']);
    assert.deepEqual([item('passed6B').decision, item('passed6B').target, item('passed6B').missingTarget], ['PROMOTE', null, true]);
    assert.match(item('passed6B').recommendationNote, /Grade 7B does not exist/);
    assert.equal(item('passed8A').decision, 'GRADUATE');
    assert.equal(item('unknown7A').decision, 'PENDING');
    assert.equal(batch.summary.missingTargets, 1);
    assert.ok(batch.groups.find((g) => g.displayName === 'Grade 6A').students >= 2);
    // Starting again resumes the same batch.
    const again = await promotion('', { method: 'POST', body: { fromYearId: years.current.id, toYearId: years.next.id } });
    assert.equal(again.body.batch.id, batch.batch.id);
  });

  test('confirmation needs every destination, a typed confirmation, and the right Manager', async () => {
    const id = batch.batch.id;
    assert.equal((await promotion(`/${id}/confirm`, { method: 'POST', body: { confirm: 'PROCESS' } })).body.code, 'MISSING_TARGETS');
    // The Manager creates Grade 7B for the new year; a refresh fills the destination.
    const created = await managerA1('/api/manager/sections', { method: 'POST', body: { classId: classes[7].id, academicYearId: years.next.id, name: 'B' } });
    assert.equal(created.status, 201);
    batch = (await promotion(`/${id}/refresh`, { method: 'POST' })).body;
    assert.equal(item('passed6B').target.displayName, 'Grade 7B');
    // Manager decisions: transfer one student out; an invalid destination is refused.
    const bad = await promotion(`/${id}/items`, { method: 'PATCH', body: { items: [{ id: item('failed6A').id, decision: 'REPEAT', targetSectionId: sections.n7A.id }] } });
    assert.equal(bad.body.code, 'INVALID_TARGET');
    batch = (await promotion(`/${id}/items`, { method: 'PATCH', body: { items: [{ id: item('leaving7A').id, decision: 'TRANSFER_OUT' }] } })).body;
    assert.equal(item('leaving7A').decision, 'TRANSFER_OUT');

    assert.equal((await promotion(`/${id}/confirm`, { method: 'POST', body: {} })).status, 400);
    assert.equal((await managerA2(`/api/manager/promotions/${id}/confirm`, { method: 'POST', body: { confirm: 'PROCESS' } })).status, 404);
    assert.equal((await ownerA(`/api/owner/promotions/${id}`)).status, 200);
    assert.equal((await promotion(`/${id}/process`, { method: 'POST' })).body.code, 'NOT_CONFIRMED');
  });

  test('processing: a failure is reported per student, retried, and nothing is enrolled twice', async () => {
    const id = batch.batch.id;
    // The repeating student's destination becomes inactive before processing: that student fails.
    await prisma.section.update({ where: { id: sections.n6A.id }, data: { status: 'INACTIVE' } });
    batch = (await promotion(`/${id}/confirm`, { method: 'POST', body: { confirm: 'PROCESS' } })).body;
    assert.equal(batch.batch.status, 'processing');
    assert.equal(item('unknown7A').status, 'excluded');

    batch = (await promotion(`/${id}/process`, { method: 'POST' })).body;
    assert.equal(batch.batch.status, 'completed');
    assert.equal(item('failed6A').status, 'failed');
    assert.match(item('failed6A').error, /no longer active/);
    assert.equal(item('passed6A').status, 'done');
    assert.equal(item('passed6A').result, 'Grade 7A');

    await prisma.section.update({ where: { id: sections.n6A.id }, data: { status: 'ACTIVE' } });
    batch = (await promotion(`/${id}/retry`, { method: 'POST' })).body;
    assert.equal(batch.batch.status, 'processing');
    // Two simultaneous process calls: each student is processed once.
    const [a, b] = await Promise.all([promotion(`/${id}/process`, { method: 'POST' }), promotion(`/${id}/process`, { method: 'POST' })]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    batch = (await promotion(`/${id}`)).body;
    assert.equal(item('failed6A').status, 'done');
    assert.equal(batch.summary.status.failed, 0);
    const nextYear = await prisma.enrollment.count({ where: { academicYearId: years.next.id, branchId: branches.A1.id } });
    // Processing again changes nothing.
    await promotion(`/${id}/process`, { method: 'POST' });
    assert.equal(await prisma.enrollment.count({ where: { academicYearId: years.next.id, branchId: branches.A1.id } }), nextYear);
    assert.ok(await prisma.auditEvent.findFirst({ where: { targetId: id, action: 'PROMOTION_PROCESSED' } }));
  });

  test('outcomes and history: promoted, repeating, graduated, transferred, pending', async () => {
    const view = async (key) => (await managerA1(`/api/manager/students/${people[key].student.id}`)).body.student;
    const promoted = await view('passed6A');
    assert.deepEqual(
      promoted.enrollments.map((e) => [e.academicYear.name, e.section.displayName, e.status, e.entry]),
      [
        ['2025/2026', 'Grade 6A', 'completed', 'new'],
        ['2026/2027', 'Grade 7A', 'active', 'promoted'],
      ],
    );
    assert.equal(promoted.enrollments[1].previousEnrollmentId, promoted.enrollments[0].id);
    assert.equal(promoted.enrollments[0].decision.decision, 'promote');

    const repeating = await view('failed6A');
    assert.deepEqual(repeating.enrollments.map((e) => [e.class.name, e.entry]), [['Grade 6', 'new'], ['Grade 6', 'repeated']]);

    const graduate = await view('passed8A');
    assert.equal(graduate.status, 'graduated');
    assert.deepEqual(graduate.enrollments.map((e) => e.status), ['graduated']);
    assert.equal((await enroll(graduate.id, sections.n8A.id)).body.code, 'STUDENT_GRADUATED');

    const leaving = await view('leaving7A');
    assert.equal(leaving.status, 'transferred_out');
    assert.deepEqual(leaving.enrollments.map((e) => e.status), ['transferred_out']);

    const pending = await view('unknown7A');
    assert.equal(pending.status, 'enrolled');
    assert.deepEqual(pending.enrollments.map((e) => [e.academicYear.name, e.status]), [['2025/2026', 'active']]);
  });

  test('a confirmed promotion cannot be changed', async () => {
    const id = batch.batch.id;
    assert.equal((await promotion(`/${id}/items`, { method: 'PATCH', body: { items: [{ id: item('unknown7A').id, decision: 'PROMOTE' }] } })).body.code, 'NOT_DRAFT');
    assert.equal((await promotion(`/${id}/confirm`, { method: 'POST', body: { confirm: 'PROCESS' } })).body.code, 'NOT_DRAFT');
  });
});

describe('larger batches are processed in chunks', () => {
  test('120 students across several calls, each once', async () => {
    const yearA = await prisma.academicYear.create({ data: { schoolId: schools.A.id, name: '2030/2031', nameKey: '2030/2031', startDate: new Date('2030-09-01'), endDate: new Date('2031-06-30'), status: 'PLANNED' } });
    const yearB = await prisma.academicYear.create({ data: { schoolId: schools.A.id, name: '2031/2032', nameKey: '2031/2032', startDate: new Date('2031-09-01'), endDate: new Date('2032-06-30'), status: 'PLANNED' } });
    const from = await prisma.section.create({ data: { schoolId: schools.A.id, branchId: branches.A2.id, classId: classes[6].id, academicYearId: yearA.id, name: 'A', nameKey: 'a' } });
    await prisma.section.create({ data: { schoolId: schools.A.id, branchId: branches.A2.id, classId: classes[7].id, academicYearId: yearB.id, name: 'A', nameKey: 'a' } });
    const rows = Array.from({ length: 120 }, (_, i) => ({
      id: randomUUID(),
      schoolId: schools.A.id,
      branchId: branches.A2.id,
      studentNumber: `BULK${tag}-${i}`,
      firstName: `Bulk${i}`,
      lastName: 'Student',
      nameKey: `bulk${i} student`,
      gender: 'MALE',
      dateOfBirth: new Date('2014-01-01'),
      guardianName: 'Guardian',
      guardianPhone: '+252 61 2345678',
      status: 'ENROLLED',
    }));
    await prisma.student.createMany({ data: rows });
    await prisma.enrollment.createMany({
      data: rows.map((s) => ({ schoolId: schools.A.id, branchId: branches.A2.id, studentId: s.id, academicYearId: yearA.id, sectionId: from.id, result: 'PASSED' })),
    });

    let res = await managerA2('/api/manager/promotions', { method: 'POST', body: { fromYearId: yearA.id, toYearId: yearB.id } });
    assert.equal(res.body.summary.decisions.PROMOTE, 120);
    const id = res.body.batch.id;
    res = await managerA2(`/api/manager/promotions/${id}/confirm`, { method: 'POST', body: { confirm: 'PROCESS' } });
    let calls = 0;
    do {
      res = await managerA2(`/api/manager/promotions/${id}/process`, { method: 'POST' });
      calls += 1;
    } while (res.body.batch.status === 'processing' && calls < 20);
    assert.equal(res.body.batch.status, 'completed');
    assert.equal(res.body.summary.status.done, 120);
    assert.equal(await prisma.enrollment.count({ where: { academicYearId: yearB.id } }), 120);
  });
});

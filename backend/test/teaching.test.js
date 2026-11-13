/*
 * Subjects, class curricula and teaching assignments (docs/business-rules.md → Subjects; Teaching
 * assignments): School Owner manages subjects and curricula, Managers read; subject and class teacher
 * assignments by the Owner (any staff, any branch of the school) and Managers (their own staff, their
 * own sections); permissions from assignments, never job titles; past days fixed; one class teacher
 * per section and no duplicate subject teacher, even under simultaneous requests; isolation between
 * schools and branches; audit; teaching shown on staff profiles (transfer warning).
 * Runs on the Neon dev branch (`npm test`); everything it creates is removed afterwards.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { calendarToday } from '../src/features/academic-calendar/calendar.service.js';
import { addDays, asDbDay } from '../src/features/academic-calendar/schoolDays.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Teaching tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const cookies = {};
const schools = {};
const branches = {};
const staff = {};
const sections = {};
const classes = {};
const subjects = {};
let year;
let server;
let base;
let today;

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
const owner = as('OWNER_A');
const ownerB = as('OWNER_B');
const manager1 = as('MANAGER_A1');
const manager2 = as('MANAGER_A2');
const assign = (who, role, body) => who(`/api/${role}/teaching-assignments`, { method: 'POST', body });
const end = (who, role, id, lastDay) => who(`/api/${role}/teaching-assignments/${id}/end`, { method: 'POST', body: { lastDay } });
const cancel = (who, role, id) => who(`/api/${role}/teaching-assignments/${id}/cancel`, { method: 'POST' });
let staffCount = 0;

async function makeStaff(key, branch, { jobTitle = 'Teacher', status = 'ACTIVE' } = {}) {
  staffCount += 1;
  const unique = randomBytes(4).toString('hex');
  staff[key] = await prisma.user.create({
    data: {
      name: `${key} ${tag}`,
      email: `test-teach-${key.toLowerCase()}-${lower}@test.edutrack.example`,
      role: 'STAFF',
      status,
      branchId: branch.id,
      staffId: `${branch.code}-ST${String(staffCount).padStart(3, '0')}`,
      jobTitle,
      phoneKey: `+998${parseInt(unique, 16)}`,
      phone: `+998${parseInt(unique, 16)}`,
    },
  });
}

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  today = await calendarToday();

  for (const key of ['A', 'B']) {
    schools[key] = await prisma.school.create({ data: { code: `TTCH${tag}-${key}`, name: `Teaching Test ${key} ${tag}`, location: 'Mogadishu', phone: '+252 61 1234567', address: 'Road 1' } });
  }
  const branch = (key, school, number) =>
    prisma.branch.create({ data: { schoolId: schools[school].id, number, code: `TTCH${tag}-${key}`, name: `Branch ${key}`, nameKey: `branch ${key.toLowerCase()} ${lower}`, address: 'Road', city: 'Mogadishu' } });
  branches.A1 = await branch('A1', 'A', 1);
  branches.A2 = await branch('A2', 'A', 2);
  branches.B = await branch('B1', 'B', 1);

  year = await prisma.academicYear.create({
    data: { schoolId: schools.A.id, name: `Y ${tag}`, nameKey: `y ${lower}`, startDate: asDbDay(addDays(today, -30)), endDate: asDbDay(addDays(today, 200)), status: 'CURRENT', startedAt: new Date() },
  });
  classes.G1 = await prisma.schoolClass.create({ data: { schoolId: schools.A.id, name: 'Grade 1', nameKey: 'grade 1', sequence: 1 } });
  classes.G2 = await prisma.schoolClass.create({ data: { schoolId: schools.A.id, name: 'Grade 2', nameKey: 'grade 2', sequence: 2 } });
  const section = (key, cls, branchKey) =>
    prisma.section.create({ data: { schoolId: schools.A.id, branchId: branches[branchKey].id, classId: classes[cls].id, academicYearId: year.id, name: 'A', nameKey: 'a' } });
  sections.G1A1 = await section('G1A1', 'G1', 'A1');
  sections.G1A2 = await section('G1A2', 'G1', 'A2');
  sections.G2A1 = await section('G2A1', 'G2', 'A1');

  await makeStaff('T1', branches.A1, { jobTitle: 'Teacher' });
  await makeStaff('ACC', branches.A1, { jobTitle: 'Accountant' });
  await makeStaff('T2', branches.A2, { jobTitle: 'Teacher' });
  await makeStaff('SUSP', branches.A1, { status: 'SUSPENDED' });
  await makeStaff('TB', branches.B);

  const people = [
    ['OWNER_A', 'OWNER', 'A'],
    ['OWNER_B', 'OWNER', 'B'],
    ['MANAGER_A1', 'MANAGER', 'A1'],
    ['MANAGER_A2', 'MANAGER', 'A2'],
    ['SUPER_ADMIN', 'SUPER_ADMIN'],
    ['STAFF', 'STAFF'],
  ];
  for (const [key, role, where] of people) {
    const password = randomBytes(12).toString('base64url');
    const email = `test-teach-${key.toLowerCase().replace('_', '-')}-${lower}@test.edutrack.example`;
    const scope = role === 'MANAGER' ? { branchId: branches[where].id } : await branchFor(role);
    const user = await prisma.user.create({ data: { name: `Test ${key} ${tag}`, email, role, ...scope, passwordHash: await hashPassword(password) } });
    if (role === 'OWNER') await prisma.school.update({ where: { id: schools[where].id }, data: { ownerId: user.id } });
    const res = await call('/api/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(res.status, 200, `${key} sign-in`);
    cookies[key] = res.cookie;
  }
});

after(async () => {
  const schoolIds = Object.values(schools).map((s) => s.id);
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  await prisma.teachingAssignment.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.classSubject.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.subject.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.section.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.schoolClass.deleteMany({ where: { schoolId: { in: schoolIds } } });
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

describe('access', () => {
  test('signed out 401; staff and Super Admins 403; Managers cannot change subjects or curricula', async () => {
    const id = randomUUID();
    for (const [method, path, body] of [
      ['GET', '/api/owner/subjects'],
      ['POST', '/api/owner/subjects', { name: 'X' }],
      ['GET', '/api/owner/teaching-assignments'],
      ['POST', '/api/manager/teaching-assignments', {}],
      ['GET', '/api/manager/teaching/teachers'],
    ]) {
      assert.equal((await call(path, { method, body })).status, 401, path);
      for (const who of ['STAFF', 'SUPER_ADMIN']) assert.equal((await as(who)(path, { method, body })).status, 403, `${who} ${path}`);
    }
    assert.equal((await manager1('/api/manager/subjects', { method: 'POST', body: { name: 'Mine' } })).status, 404);
    assert.equal((await manager1(`/api/manager/classes/${id}/subjects`, { method: 'PUT', body: { subjects: [] } })).status, 404);
    assert.equal((await manager1('/api/owner/subjects')).status, 403);
  });
});

describe('subjects (School Owner manages, Managers read)', () => {
  test('create, unique name and code (any capitalization), update; other schools never see them', async () => {
    const math = await owner('/api/owner/subjects', { method: 'POST', body: { name: '  Mathematics ', code: 'math' } });
    assert.equal(math.status, 201);
    assert.equal(math.body.subject.code, 'MATH');
    subjects.math = math.body.subject;
    subjects.eng = (await owner('/api/owner/subjects', { method: 'POST', body: { name: 'English' } })).body.subject;
    subjects.sci = (await owner('/api/owner/subjects', { method: 'POST', body: { name: 'Science', code: 'SCI' } })).body.subject;

    assert.equal((await owner('/api/owner/subjects', { method: 'POST', body: { name: 'MATHEMATICS' } })).body.code, 'NAME_TAKEN');
    assert.equal((await owner('/api/owner/subjects', { method: 'POST', body: { name: 'Maths', code: 'Math' } })).body.code, 'CODE_TAKEN');
    assert.equal((await owner('/api/owner/subjects', { method: 'POST', body: { name: 'Bad', code: 'A B' } })).status, 400);
    assert.equal((await owner('/api/owner/subjects', { method: 'POST', body: { name: 'Mine', schoolId: schools.B.id } })).status, 400);
    const renamed = await owner(`/api/owner/subjects/${subjects.eng.id}`, { method: 'PATCH', body: { description: 'Language' } });
    assert.equal(renamed.body.subject.description, 'Language');

    const list = await manager1('/api/manager/subjects?q=sci');
    assert.deepEqual(list.body.items.map((s) => s.name), ['Science']);
    assert.equal((await ownerB(`/api/owner/subjects/${subjects.math.id}`)).status, 404);
    assert.equal((await ownerB('/api/owner/subjects')).body.items.length, 0);
  });

  test('class curricula: set, read, refuse unknown or inactive subjects', async () => {
    const set = await owner(`/api/owner/classes/${classes.G1.id}/subjects`, {
      method: 'PUT',
      body: { subjects: [{ subject: subjects.math.id, weeklyLessons: 5 }, { subject: subjects.eng.id }] },
    });
    assert.equal(set.status, 200);
    assert.equal(set.body.open, false);
    assert.equal(set.body.weeklyLessons, 5);
    assert.deepEqual(set.body.items.map((i) => i.subject.name), ['English', 'Mathematics']);

    const foreign = (await ownerB('/api/owner/subjects', { method: 'POST', body: { name: 'Other school' } })).body.subject;
    const bad = await owner(`/api/owner/classes/${classes.G1.id}/subjects`, { method: 'PUT', body: { subjects: [{ subject: foreign.id }] } });
    assert.equal(bad.status, 409);
    assert.equal(bad.body.code, 'SUBJECT_UNAVAILABLE');
    assert.equal((await owner(`/api/owner/classes/${classes.G1.id}/subjects`, { method: 'PUT', body: { subjects: [{ subject: subjects.math.id, weeklyLessons: 99 }] } })).status, 400);
    assert.equal((await manager1(`/api/manager/classes/${classes.G1.id}/subjects`)).body.items.length, 2);
    assert.equal((await owner(`/api/owner/classes/${classes.G2.id}/subjects`)).body.open, true);
  });
});

describe('teaching assignments', () => {
  const ids = {};

  test('the Owner assigns any staff of the school to any section; a job title grants nothing', async () => {
    const res = await assign(owner, 'owner', { role: 'subject', teacher: staff.T1.id, section: sections.G1A1.id, subject: subjects.math.id });
    assert.equal(res.status, 201);
    assert.equal(res.body.assignment.startDate, today);
    assert.equal(res.body.assignment.state, 'active');
    assert.equal(res.body.assignment.section.displayName, 'Grade 1A');
    ids.t1math = res.body.assignment.id;

    // A teacher from branch A2 teaching in branch A1 (cross-branch, Owner only); co-teaching is allowed.
    const cross = await assign(owner, 'owner', { role: 'subject', teacher: staff.T2.id, section: sections.G1A1.id, subject: subjects.math.id });
    assert.equal(cross.status, 201);
    assert.equal(cross.body.assignment.teacher.homeBranch.id, branches.A2.id);
    ids.t2math = cross.body.assignment.id;
    // An accountant can teach if assigned: permissions come from assignments only.
    assert.equal((await assign(owner, 'owner', { role: 'subject', teacher: staff.ACC.id, section: sections.G1A1.id, subject: subjects.eng.id })).status, 201);

    const dup = await assign(owner, 'owner', { role: 'subject', teacher: staff.T1.id, section: sections.G1A1.id, subject: subjects.math.id });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'ALREADY_ASSIGNED');
    const notInClass = await assign(owner, 'owner', { role: 'subject', teacher: staff.T1.id, section: sections.G1A1.id, subject: subjects.sci.id });
    assert.equal(notInClass.body.code, 'SUBJECT_NOT_IN_CLASS');
    assert.equal((await assign(owner, 'owner', { role: 'subject', teacher: staff.T1.id, section: sections.G2A1.id, subject: subjects.sci.id })).status, 201, 'a class without a list is open');
    assert.equal((await assign(owner, 'owner', { role: 'subject', teacher: staff.SUSP.id, section: sections.G2A1.id, subject: subjects.math.id })).body.code, 'TEACHER_SUSPENDED');
    assert.equal((await assign(owner, 'owner', { role: 'subject', teacher: staff.TB.id, section: sections.G2A1.id, subject: subjects.math.id })).status, 404, 'another school');
    assert.equal((await assign(owner, 'owner', { role: 'subject', teacher: staff.T1.id, section: sections.G2A1.id })).status, 400);
    assert.equal((await assign(owner, 'owner', { role: 'class', teacher: staff.T1.id, section: sections.G2A1.id, subject: subjects.math.id })).status, 400);
  });

  test('one class teacher per section at a time, even under simultaneous requests', async () => {
    const first = await assign(owner, 'owner', { role: 'class', teacher: staff.T1.id, section: sections.G1A1.id });
    assert.equal(first.status, 201);
    ids.class = first.body.assignment.id;
    const second = await assign(owner, 'owner', { role: 'class', teacher: staff.ACC.id, section: sections.G1A1.id });
    assert.equal(second.status, 409);
    assert.equal(second.body.code, 'CLASS_TEACHER_EXISTS');
    // After the current one ends, a successor can be planned.
    assert.equal((await assign(owner, 'owner', { role: 'class', teacher: staff.ACC.id, section: sections.G1A1.id, startDate: addDays(today, 50) })).status, 409);

    const race = await Promise.all([staff.T1, staff.ACC, staff.T2].map((t) => assign(owner, 'owner', { role: 'class', teacher: t.id, section: sections.G2A1.id })));
    assert.deepEqual(race.map((r) => r.status).sort(), [201, 409, 409]);
    await assert.rejects(
      prisma.teachingAssignment.create({
        data: { schoolId: schools.A.id, academicYearId: year.id, branchId: branches.A1.id, sectionId: sections.G2A1.id, teacherId: staff.SUSP.id, role: 'CLASS_TEACHER', startDate: asDbDay(addDays(today, 5)) },
      }),
      /TeachingAssignment_one_class_teacher|exclusion|conflicting/i,
    );
  });

  test("Managers: their own staff, their own sections; read their branch's assignments, change only their staff's", async () => {
    assert.equal((await assign(manager1, 'manager', { role: 'subject', teacher: staff.T2.id, section: sections.G1A1.id, subject: subjects.eng.id })).status, 404, 'other branch staff');
    assert.equal((await assign(manager1, 'manager', { role: 'subject', teacher: staff.T1.id, section: sections.G1A2.id, subject: subjects.eng.id })).status, 404, 'other branch section');
    assert.equal((await assign(manager1, 'manager', { role: 'subject', teacher: staff.T1.id, section: sections.G1A1.id, subject: subjects.eng.id, branch: branches.A2.id })).status, 400);
    const own = await assign(manager1, 'manager', { role: 'subject', teacher: staff.T1.id, section: sections.G1A1.id, subject: subjects.eng.id, startDate: addDays(today, 3) });
    assert.equal(own.status, 201);
    assert.equal(own.body.assignment.state, 'scheduled');
    ids.scheduled = own.body.assignment.id;

    const list = await manager1('/api/manager/teaching-assignments');
    const t2 = list.body.items.find((a) => a.id === ids.t2math);
    assert.ok(t2, 'sees the cross-branch teacher in their branch');
    assert.equal(t2.canManage, false);
    assert.equal(list.body.items.find((a) => a.id === ids.t1math).canManage, true);
    assert.equal((await end(manager1, 'manager', ids.t2math, today)).status, 403);
    assert.equal((await manager2('/api/manager/teaching-assignments')).body.items.length, 0, 'branch A2 has none of its own');
    assert.equal((await manager2(`/api/manager/sections/${sections.G1A1.id}/teaching`)).status, 404);

    const teachers = await manager1('/api/manager/teaching/teachers');
    assert.deepEqual(teachers.body.items.map((t) => t.name).sort(), [`ACC ${tag}`, `T1 ${tag}`].sort(), 'active staff of the branch only');
    const ownerTeachers = (await owner('/api/owner/teaching/teachers')).body.items;
    assert.ok(ownerTeachers.some((t) => t.id === staff.T2.id) && !ownerTeachers.some((t) => t.id === staff.TB.id || t.id === staff.SUSP.id));
    assert.equal(ownerTeachers.at(-1).name, `ACC ${tag}`, 'teachers first (a suggestion only)');
  });

  test('past days are fixed: scheduled ones cancel, running ones end from today on, ended ones stay', async () => {
    assert.equal((await assign(owner, 'owner', { role: 'subject', teacher: staff.ACC.id, section: sections.G2A1.id, subject: subjects.eng.id, startDate: addDays(today, -1) })).status, 400);
    assert.equal((await assign(owner, 'owner', { role: 'subject', teacher: staff.ACC.id, section: sections.G2A1.id, subject: subjects.eng.id, endDate: addDays(today, 500) })).status, 400);

    const cancelled = await cancel(manager1, 'manager', ids.scheduled);
    assert.equal(cancelled.body.assignment.state, 'cancelled');

    // Started before today (written directly: the API never back-dates).
    const running = await prisma.teachingAssignment.create({
      data: { schoolId: schools.A.id, academicYearId: year.id, branchId: branches.A1.id, sectionId: sections.G2A1.id, teacherId: staff.ACC.id, role: 'SUBJECT_TEACHER', subjectId: subjects.math.id, startDate: asDbDay(addDays(today, -10)) },
    });
    assert.equal((await cancel(owner, 'owner', running.id)).body.code, 'ASSIGNMENT_STARTED');
    assert.equal((await end(owner, 'owner', running.id, addDays(today, -5))).status, 400, 'would change past days');
    const ended = await end(owner, 'owner', running.id, addDays(today, -1));
    assert.equal(ended.status, 200);
    assert.equal(ended.body.assignment.state, 'ended');
    assert.equal((await end(owner, 'owner', running.id, addDays(today, 5))).body.code, 'ASSIGNMENT_IN_PAST');
    // Extending or ending later is fine while the days are today or later.
    assert.equal((await end(owner, 'owner', ids.t1math, addDays(today, 20))).body.assignment.endDate, addDays(today, 20));
    assert.equal((await end(owner, 'owner', ids.t1math, null)).body.assignment.endDate, null);
  });

  test('subjects in use cannot be deactivated or removed from a class; the section view shows the teaching', async () => {
    const deact = await owner(`/api/owner/subjects/${subjects.math.id}/deactivate`, { method: 'POST' });
    assert.equal(deact.status, 409);
    assert.equal(deact.body.code, 'SUBJECT_IN_USE');
    const remove = await owner(`/api/owner/classes/${classes.G1.id}/subjects`, { method: 'PUT', body: { subjects: [{ subject: subjects.eng.id }] } });
    assert.equal(remove.body.code, 'SUBJECT_IN_USE');

    const view = await owner(`/api/owner/sections/${sections.G1A1.id}/teaching`);
    assert.equal(view.status, 200);
    assert.equal(view.body.curriculumSet, true);
    const math = view.body.subjects.find((s) => s.subject.id === subjects.math.id);
    assert.equal(math.weeklyLessons, 5);
    assert.deepEqual(math.teachers.map((t) => t.teacher.id).sort(), [staff.T1.id, staff.T2.id].sort());
    assert.equal(view.body.classTeachers[0].teacher.id, staff.T1.id);
    assert.ok((await owner(`/api/owner/sections/${sections.G2A1.id}/teaching`)).body.subjects.length >= 3, 'open class: every active subject');
  });

  test("teaching shows on staff profiles: the Owner's (before a transfer) and the home Manager's", async () => {
    const ownerView = await owner(`/api/owner/staff/${staff.T2.id}`);
    assert.equal(ownerView.status, 200);
    assert.deepEqual(ownerView.body.staff.teaching.map((a) => a.id), [ids.t2math]);
    const managerView = await manager1(`/api/manager/staff/${staff.T1.id}`);
    assert.ok(managerView.body.staff.teaching.some((a) => a.id === ids.class));
  });

  test('closed years are read only; every change is audited in the school', async () => {
    await prisma.academicYear.update({ where: { id: year.id }, data: { status: 'CLOSED', closedAt: new Date() } });
    try {
      assert.equal((await end(owner, 'owner', ids.t1math, today)).body.code, 'YEAR_CLOSED');
      assert.equal((await assign(owner, 'owner', { role: 'subject', teacher: staff.T1.id, section: sections.G2A1.id, subject: subjects.eng.id })).body.code, 'YEAR_CLOSED');
    } finally {
      await prisma.academicYear.update({ where: { id: year.id }, data: { status: 'CURRENT', closedAt: null } });
    }
    const events = await prisma.auditEvent.findMany({ where: { schoolId: schools.A.id, action: { in: ['TEACHING_ASSIGNED', 'TEACHING_ASSIGNMENT_CHANGED', 'TEACHING_ASSIGNMENT_CANCELLED', 'SUBJECT_CREATED', 'SUBJECT_UPDATED', 'CLASS_SUBJECTS_UPDATED'] } } });
    const actions = new Set(events.map((e) => e.action));
    assert.equal(actions.size, 6, [...actions].join());
    const assigned = events.find((e) => e.targetId === ids.t2math && e.action === 'TEACHING_ASSIGNED');
    assert.match(assigned.targetName, /Mathematics in Grade 1A/);
    assert.equal(assigned.change.teacherId, staff.T2.id);
  });
});

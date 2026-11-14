/*
 * Timetable builder (docs/business-rules.md → Timetable builder): access and scope, readiness checks
 * (blockers and warnings), setup rules, teacher limits, fixed lessons, generation without any
 * conflict (shared teachers, a teacher with several subjects in one class, one subject shared by two
 * teachers, lessons in another branch on another bell schedule, unavailable times, daily limits, no
 * double lessons), draft edits refused when they would break a rule, locked lessons kept when
 * generating again, the class / teacher / master views and exports, publishing (all classes or
 * none), the teacher's own week in the Staff app, audit.
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

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Timetable builder tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
const cookies = {};
const schools = {};
const branches = {};
const staff = {};
const sections = {};
const classes = {};
const subjects = {};
const bells = {};
let year;
let server;
let base;
let today;
let tomorrow;
let teacherToken;
let teacherPassword;

async function call(path, { method = 'GET', body, cookie, token, raw = false } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(method !== 'GET' && { origin: ORIGIN }),
      ...(cookie && { cookie }),
      ...(token && { authorization: `Bearer ${token}` }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return response;
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const as = (who) => (path, options = {}) => call(path, { ...options, cookie: cookies[who] });
const owner = as('OWNER_A');
const ownerB = as('OWNER_B');
const manager1 = as('MANAGER_A1');
const manager2 = as('MANAGER_A2');
const M = '/api/manager/timetable-builder';
const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

async function makeStaff(key, branch, n) {
  const unique = randomBytes(4).toString('hex');
  staff[key] = await prisma.user.create({
    data: {
      name: `${key} ${tag}`,
      email: `test-tb-${key.toLowerCase()}-${lower}@test.edutrack.example`,
      role: 'STAFF',
      branchId: branch.id,
      staffId: `${branch.code}-ST${String(n).padStart(3, '0')}`,
      jobTitle: 'Teacher',
      phoneKey: `+996${parseInt(unique, 16)}`,
      phone: `+996${parseInt(unique, 16)}`,
      ...(key === 'T1' && { passwordHash: await hashPassword(teacherPassword) }),
    },
  });
}
const teach = (teacher, section, subject) =>
  prisma.teachingAssignment.create({
    data: { schoolId: schools.A.id, academicYearId: year.id, branchId: sections[section].branchId, sectionId: sections[section].id, teacherId: staff[teacher].id, role: 'SUBJECT_TEACHER', subjectId: subjects[subject].id, startDate: asDbDay(addDays(today, -30)) },
  });
const curriculum = (cls, list) => Promise.all(list.map(([name, weekly]) => prisma.classSubject.create({ data: { schoolId: schools.A.id, classId: classes[cls].id, subjectId: subjects[name].id, weeklyLessons: weekly } })));

/** Bell times: six lessons of 40 minutes from 07:30 Monday to Friday, main break after period 3. */
const sixPeriods = [
  { kind: 'lesson', number: 1, days: WEEK, start: '07:30', end: '08:10' },
  { kind: 'lesson', number: 2, days: WEEK, start: '08:10', end: '08:50' },
  { kind: 'lesson', number: 3, days: WEEK, start: '08:50', end: '09:30' },
  { kind: 'break', name: 'Break', days: WEEK, start: '09:30', end: '10:00', mainBreak: true },
  { kind: 'lesson', number: 4, days: WEEK, start: '10:00', end: '10:40' },
  { kind: 'lesson', number: 5, days: WEEK, start: '10:40', end: '11:20' },
  { kind: 'lesson', number: 6, days: WEEK, start: '11:20', end: '12:00' },
];
/** Another branch's times: period 1 is 07:50–08:30 (overlaps periods 1 and 2 above). */
const otherTimes = [
  { kind: 'lesson', number: 1, days: WEEK, start: '07:50', end: '08:30' },
  { kind: 'lesson', number: 2, days: WEEK, start: '08:30', end: '09:10' },
];

/** Hard rules on a draft, recomputed from the API's own view of it. */
function checkDraft(draft, { maxSubjectPerDay = 2, doubles = true, teachers = {} } = {}) {
  const problems = [];
  const periodOf = (sectionId, weekday, period) => draft.sections.find((s) => s.id === sectionId).periods[weekday]?.find((p) => p.number === period);
  const seen = new Set();
  const byTeacherDay = new Map();
  const perSubjectDay = new Map();
  for (const l of draft.lessons) {
    const p = periodOf(l.sectionId, l.weekday, l.period);
    if (!p) problems.push(`no period ${l.weekday} ${l.period}`);
    const k = `${l.sectionId}|${l.weekday}|${l.period}`;
    if (seen.has(k)) problems.push(`two lessons ${k}`);
    seen.add(k);
    const sk = `${l.sectionId}|${l.subject.id}|${l.weekday}`;
    perSubjectDay.set(sk, (perSubjectDay.get(sk) ?? 0) + 1);
    if (l.teacher) byTeacherDay.set(`${l.teacher.id}|${l.weekday}`, [...(byTeacherDay.get(`${l.teacher.id}|${l.weekday}`) ?? []), { ...l, s: toMin(p.start), e: toMin(p.end) }]);
  }
  for (const [k, list] of byTeacherDay) {
    const [tid] = k.split('|');
    if (teachers[tid]?.maxPerDay && list.length > teachers[tid].maxPerDay) problems.push(`${k}: ${list.length} lessons`);
    for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) if (list[i].s < list[j].e && list[j].s < list[i].e) problems.push(`teacher clash ${k}`);
    for (const b of teachers[tid]?.blocked ?? []) for (const l of list) if (l.weekday === b.weekday && l.s < b.e && b.s < l.e) problems.push(`teacher blocked ${k} P${l.period}`);
  }
  for (const [k, n] of perSubjectDay) if (n > maxSubjectPerDay) problems.push(`subject ${k}: ${n}`);
  if (!doubles) {
    for (const s of draft.sections) {
      for (const [day, list] of Object.entries(s.periods)) {
        for (let i = 1; i < list.length; i += 1) {
          const a = draft.lessons.find((l) => l.sectionId === s.id && l.weekday === day && l.period === list[i - 1].number);
          const b = draft.lessons.find((l) => l.sectionId === s.id && l.weekday === day && l.period === list[i].number);
          if (a && b && a.subject.id === b.subject.id) problems.push(`double ${s.displayName} ${day} P${list[i].number}`);
        }
      }
    }
  }
  return problems;
}

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  today = await calendarToday();
  tomorrow = addDays(today, 1);
  teacherPassword = `Tb-${randomBytes(9).toString('base64url')}-1a`;

  for (const key of ['A', 'B']) {
    schools[key] = await prisma.school.create({ data: { code: `TTB${tag}-${key}`, name: `Builder Test ${key} ${tag}`, location: 'Mogadishu', phone: '+252 61 1234567', address: 'Road 1' } });
  }
  const branch = (key, school, number) =>
    prisma.branch.create({ data: { schoolId: schools[school].id, number, code: `TTB${tag}-${key}`, name: `Branch ${key}`, nameKey: `branch ${key.toLowerCase()} ${lower}`, address: 'Road', city: 'Mogadishu' } });
  branches.A1 = await branch('A1', 'A', 1);
  branches.A2 = await branch('A2', 'A', 2);
  branches.B = await branch('B1', 'B', 1);

  year = await prisma.academicYear.create({
    data: { schoolId: schools.A.id, name: `Y ${tag}`, nameKey: `y ${lower}`, startDate: asDbDay(addDays(today, -30)), endDate: asDbDay(addDays(today, 200)), status: 'CURRENT', startedAt: new Date() },
  });
  await prisma.academicWeekdays.create({ data: { schoolId: schools.A.id, academicYearId: year.id, days: WEEK, effectiveFrom: asDbDay(addDays(today, -30)) } });
  classes.G1 = await prisma.schoolClass.create({ data: { schoolId: schools.A.id, name: 'Grade 1', nameKey: 'grade 1', sequence: 1 } });
  classes.G2 = await prisma.schoolClass.create({ data: { schoolId: schools.A.id, name: 'Grade 2', nameKey: 'grade 2', sequence: 2 } });
  const section = (cls, branchKey, name) =>
    prisma.section.create({ data: { schoolId: schools.A.id, branchId: branches[branchKey].id, classId: classes[cls].id, academicYearId: year.id, name, nameKey: name.toLowerCase(), room: `R-${name}` } });
  sections.G1A = await section('G1', 'A1', 'A');
  sections.G1B = await section('G1', 'A1', 'B');
  sections.G2A = await section('G2', 'A1', 'A');
  sections.G1X = await section('G1', 'A2', 'X'); // another branch
  for (const name of ['Maths', 'English', 'Science', 'Somali', 'Art', 'Music']) {
    subjects[name] = await prisma.subject.create({ data: { schoolId: schools.A.id, name, nameKey: name.toLowerCase(), code: name.slice(0, 3).toUpperCase() } });
  }
  await curriculum('G1', [['Maths', 6], ['English', 5], ['Science', 5], ['Somali', 4]]);
  // Grade 2's list is set in the readiness test (first missing, then without lessons per week).

  for (const [key, b, n] of [['T1', 'A1', 1], ['T2', 'A1', 2], ['T3', 'A1', 3], ['T4', 'A1', 4], ['T5', 'A1', 5], ['T6', 'A1', 6], ['T7', 'A2', 7]]) await makeStaff(key, branches[b], n);
  // T1 teaches Maths in G1 A and B here, and in G1 X of branch A2 (published there, other times).
  await teach('T1', 'G1A', 'Maths');
  await teach('T1', 'G1B', 'Maths');
  await teach('T1', 'G1X', 'Maths');
  // English: T2 everywhere; in G1 B it is shared with T6 (lessons split).
  await teach('T2', 'G1A', 'English');
  await teach('T2', 'G1B', 'English');
  await teach('T6', 'G1B', 'English');
  await teach('T2', 'G2A', 'English');
  await teach('T3', 'G1A', 'Science');
  await teach('T3', 'G1B', 'Science');
  // T4: Somali everywhere, and also Art in G2 A (two subjects in one class).
  await teach('T4', 'G1A', 'Somali');
  await teach('T4', 'G1B', 'Somali');
  await teach('T4', 'G2A', 'Somali');
  await teach('T4', 'G2A', 'Art');
  // Maths of G2 A (T5) is assigned in the readiness test.

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
    const email = `test-tb-${key.toLowerCase().replace('_', '-')}-${lower}@test.edutrack.example`;
    const scope = role === 'MANAGER' ? { branchId: branches[where].id } : await branchFor(role);
    const user = await prisma.user.create({ data: { name: `Test ${key} ${tag}`, email, role, ...scope, passwordHash: await hashPassword(password) } });
    if (role === 'OWNER') await prisma.school.update({ where: { id: schools[where].id }, data: { ownerId: user.id } });
    const res = await call('/api/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(res.status, 200, `${key} sign-in`);
    cookies[key] = res.cookie;
  }
  const login = await call('/api/auth/login', { method: 'POST', body: { identifier: staff.T1.phone, password: teacherPassword, client: 'mobile' } });
  assert.equal(login.status, 200, 'teacher sign-in');
  teacherToken = login.body.token;

  // Bell schedules: the branch's own (A1), and another for branch A2 with different times.
  bells.A1 = (await manager1('/api/manager/bell-schedules', { method: 'POST', body: { name: 'Main day' } })).body.bellSchedule;
  assert.equal((await manager1(`/api/manager/bell-schedules/${bells.A1.id}/times`, { method: 'PUT', body: { effectiveFrom: today, periods: sixPeriods } })).status, 200);
  bells.A2 = (await manager2('/api/manager/bell-schedules', { method: 'POST', body: { name: 'Other day' } })).body.bellSchedule;
  assert.equal((await manager2(`/api/manager/bell-schedules/${bells.A2.id}/times`, { method: 'PUT', body: { effectiveFrom: today, periods: otherTimes } })).status, 200);
  // T1 teaches G1 X (branch A2) at 07:50–08:30 every day: published.
  const published = await manager2(`/api/manager/sections/${sections.G1X.id}/timetable`, {
    method: 'PUT',
    body: { effectiveFrom: today, bellSchedule: bells.A2.id, lessons: WEEK.map((weekday) => ({ weekday, period: 1, subject: subjects.Maths.id, teacher: staff.T1.id })) },
  });
  assert.equal(published.status, 200, JSON.stringify(published.body));
});

after(async () => {
  const schoolIds = Object.values(schools).map((s) => s.id);
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  await prisma.timetableDraftLesson.deleteMany({ where: { draft: { schoolId: { in: schoolIds } } } });
  await prisma.timetableDraft.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.timetableFixedLesson.deleteMany({ where: { setup: { schoolId: { in: schoolIds } } } });
  await prisma.timetableSetup.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.teacherTimetableProfile.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.timetableSlot.deleteMany({ where: { version: { schoolId: { in: schoolIds } } } });
  await prisma.timetableVersion.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.bellPeriod.deleteMany({ where: { version: { bellSchedule: { schoolId: { in: schoolIds } } } } });
  await prisma.bellScheduleVersion.deleteMany({ where: { bellSchedule: { schoolId: { in: schoolIds } } } });
  await prisma.bellSchedule.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.academicWeekdays.deleteMany({ where: { schoolId: { in: schoolIds } } });
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
  test('signed out 401; staff and Super Admins 403; the Owner names the branch; a Manager cannot', async () => {
    for (const [method, path, body] of [
      ['GET', `${M}`],
      ['PUT', `${M}/setup`, { maxSubjectPerDay: 2 }],
      ['POST', `${M}/generate`, {}],
      ['GET', '/api/owner/timetable-views/master'],
    ]) {
      assert.equal((await call(path, { method, body })).status, 401, path);
      for (const who of ['STAFF', 'SUPER_ADMIN']) assert.equal((await as(who)(path, { method, body })).status, 403, `${who} ${path}`);
    }
    assert.equal((await owner('/api/owner/timetable-builder')).status, 400, 'Owner: branch required');
    assert.equal((await manager1(`${M}?branch=${branches.A2.id}`)).status, 400, 'Manager: branch from the account');
    assert.equal((await ownerB(`/api/owner/timetable-builder?branch=${branches.A1.id}`)).status, 404, 'another school');
    const page = await manager1(M);
    assert.equal(page.status, 200);
    assert.deepEqual(page.body.sections.map((s) => s.displayName), ['Grade 1A', 'Grade 1B', 'Grade 2A']);
    assert.equal(page.body.planDate, tomorrow);
    assert.ok(page.body.sections.every((s) => s.bell?.id === bells.A1.id && s.bellSource === 'only'), 'the only bell schedule of the branch is used');
  });
});

describe('readiness', () => {
  test('blockers name what to fix and where; generation is refused until they are fixed', async () => {
    let r = await manager1(`${M}/readiness`);
    assert.equal(r.status, 200);
    assert.equal(r.body.ready, false);
    assert.ok(r.body.blockers.some((b) => b.code === 'CLASS_NO_SUBJECTS' && b.fix === 'class-subjects' && b.classId));
    const refused = await manager1(`${M}/generate`, { method: 'POST', body: {} });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'NOT_READY');

    // Grade 2: Art without lessons per week, and Maths without a teacher.
    await prisma.classSubject.create({ data: { schoolId: schools.A.id, classId: classes.G2.id, subjectId: subjects.Art.id, weeklyLessons: null } });
    await curriculum('G2', [['Maths', 6], ['English', 5], ['Somali', 4]]);
    r = await manager1(`${M}/readiness`);
    assert.ok(r.body.blockers.some((b) => b.code === 'SUBJECT_NO_WEEKLY' && b.subjectId === subjects.Art.id));
    assert.ok(r.body.blockers.some((b) => b.code === 'SUBJECT_NO_TEACHER' && b.subjectId === subjects.Maths.id && b.sectionId === sections.G2A.id));

    await prisma.classSubject.updateMany({ where: { classId: classes.G2.id, subjectId: subjects.Art.id }, data: { weeklyLessons: 2 } });
    await teach('T5', 'G2A', 'Maths');
    r = await manager1(`${M}/readiness`);
    // By default every period needs a lesson: these classes have fewer lessons than periods.
    const under = r.body.blockers.filter((b) => b.code === 'SECTION_UNDERFILLED');
    assert.deepEqual(under.map((b) => [b.sectionId, b.missing]).sort(), [[sections.G1A.id, 10], [sections.G1B.id, 10], [sections.G2A.id, 13]].sort());
    assert.ok(under[0].message.includes('Every period needs a lesson'));
    // This school lets classes have free periods (at the end of the day).
    assert.equal((await manager1(`${M}/setup`, { method: 'PUT', body: { fillAllPeriods: false } })).status, 200);
    r = await manager1(`${M}/readiness`);
    assert.equal(r.body.ready, true, JSON.stringify(r.body.blockers));
    assert.ok(r.body.warnings.some((w) => w.code === 'SHARED_SUBJECT' && w.message.includes('English in Grade 1B')));
    assert.ok(r.body.warnings.some((w) => w.code === 'TEACHERS_ELSEWHERE' && w.message.includes(staff.T1.name)));
    assert.equal(r.body.summary.lessons, 20 + 20 + 17);
    const t1 = r.body.teachers.find((t) => t.teacherId === staff.T1.id);
    assert.equal(t1.lessons, 12);
    assert.equal(t1.busy, 5, 'their lessons in branch A2');
  });

  test('impossible loads are blockers: a class with more lessons than periods; a teacher with more lessons than periods they can teach', async () => {
    await prisma.classSubject.updateMany({ where: { classId: classes.G2.id, subjectId: subjects.Art.id }, data: { weeklyLessons: 20 } });
    let r = await manager1(`${M}/readiness`);
    assert.ok(r.body.blockers.some((b) => b.code === 'SECTION_OVERLOAD' && b.sectionId === sections.G2A.id));
    assert.ok(r.body.blockers.some((b) => b.code === 'SUBJECT_DAILY_LIMIT'));
    await prisma.classSubject.updateMany({ where: { classId: classes.G2.id, subjectId: subjects.Art.id }, data: { weeklyLessons: 2 } });
    // T4 (Somali ×3 classes + Art = 14 lessons) unavailable all week but Monday.
    const blocked = await manager1(`${M}/teachers/${staff.T4.id}`, { method: 'PUT', body: { unavailable: ['TUE', 'WED', 'THU', 'FRI'].map((weekday) => ({ weekday, start: '07:00', end: '13:00' })) } });
    assert.equal(blocked.status, 200);
    r = await manager1(`${M}/readiness`);
    assert.ok(r.body.blockers.some((b) => b.code === 'TEACHER_OVERLOAD' && b.teacherId === staff.T4.id));
    assert.equal((await manager1(`${M}/teachers/${staff.T4.id}`, { method: 'PUT', body: { unavailable: [] } })).status, 200);
    assert.equal((await manager1(`${M}/readiness`)).body.ready, true);
  });
});

describe('setup, teacher limits and fixed lessons', () => {
  test('rules are validated and audited; a bell schedule of another branch is refused', async () => {
    assert.equal((await manager1(`${M}/setup`, { method: 'PUT', body: { maxSubjectPerDay: 9 } })).status, 400);
    assert.equal((await manager1(`${M}/setup`, { method: 'PUT', body: { defaultBellSchedule: bells.A2.id } })).status, 400);
    assert.equal((await manager1(`${M}/setup`, { method: 'PUT', body: { searchSeconds: 2 } })).status, 400);
    assert.equal((await manager1(`${M}/setup`, { method: 'PUT', body: {} })).status, 400);
    const saved = await manager1(`${M}/setup`, { method: 'PUT', body: { maxSubjectPerDay: 2, allowDoubleLessons: false, morningSubjects: [subjects.Maths.id], searchSeconds: 5 } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.setup.allowDoubleLessons, false);
    const event = await prisma.auditEvent.findFirst({ where: { schoolId: schools.A.id, action: 'TIMETABLE_SETUP_CHANGED', description: { contains: 'Double lessons' } } });
    assert.ok(event, 'audited with the changed rule named');
  });

  test('teacher limits: Managers set their own staff’s; another branch’s staff are refused', async () => {
    assert.equal((await manager1(`${M}/teachers/${staff.T7.id}`, { method: 'PUT', body: { maxPerDay: 3 } })).status, 403);
    assert.equal((await manager1(`${M}/teachers/${staff.T2.id}`, { method: 'PUT', body: { maxPerDay: 30 } })).status, 400);
    assert.equal((await manager1(`${M}/teachers/${staff.T2.id}`, { method: 'PUT', body: { unavailable: [{ weekday: 'MON', start: '10:00', end: '09:00' }] } })).status, 400);
    const ok = await manager1(`${M}/teachers/${staff.T2.id}`, { method: 'PUT', body: { maxPerDay: 3 } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.maxPerDay, 3);
    // T5 cannot teach on Monday mornings.
    assert.equal((await manager1(`${M}/teachers/${staff.T5.id}`, { method: 'PUT', body: { unavailable: [{ weekday: 'MON', start: '07:00', end: '09:30' }] } })).status, 200);
    const list = await manager1(`${M}/teachers`);
    const t1 = list.body.items.find((t) => t.id === staff.T1.id);
    assert.equal(t1.busyElsewhere.length, 5);
    assert.equal(t1.canEdit, true);
    assert.equal(await prisma.auditEvent.count({ where: { schoolId: schools.A.id, action: 'TEACHER_TIMETABLE_LIMITS_CHANGED' } }) >= 3, true);
  });

  test('fixed lessons: on the class’s subject list, taught by the named teacher, one per period', async () => {
    const add = (body) => manager1(`${M}/fixed-lessons`, { method: 'POST', body });
    assert.equal((await add({ section: sections.G2A.id, weekday: 'MON', period: 1, subject: subjects.Music.id })).status, 400, 'not on the list');
    assert.equal((await add({ section: sections.G2A.id, weekday: 'MON', period: 1, subject: subjects.Art.id, teacher: staff.T1.id })).status, 400, 'not their subject');
    const ok = await add({ section: sections.G2A.id, weekday: 'MON', period: 6, subject: subjects.Art.id, teacher: staff.T4.id });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.fixedLessons.length, 1);
    assert.equal((await add({ section: sections.G2A.id, weekday: 'MON', period: 6, subject: subjects.Somali.id })).body.code, 'FIXED_EXISTS');
    assert.equal((await add({ section: sections.G1X.id, weekday: 'MON', period: 1, subject: subjects.Maths.id })).status, 404, 'another branch');
  });
});

let draft;

describe('generation', () => {
  test('every lesson placed with no conflict, all rules kept', async () => {
    const res = await manager1(`${M}/generate`, { method: 'POST', body: { seed: 11 } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    draft = res.body.draft;
    assert.deepEqual(draft.unplaced, [], JSON.stringify(draft.unplaced));
    assert.equal(draft.lessons.length, 57);
    const problems = checkDraft(draft, {
      doubles: false,
      teachers: {
        [staff.T2.id]: { maxPerDay: 3 },
        // T1 teaches in branch A2 07:50–08:30; T5 is unavailable Monday 07:00–09:30.
        [staff.T1.id]: { blocked: WEEK.map((weekday) => ({ weekday, s: toMin('07:50'), e: toMin('08:30') })) },
        [staff.T5.id]: { blocked: [{ weekday: 'MON', s: toMin('07:00'), e: toMin('09:30') }] },
      },
    });
    assert.deepEqual(problems, []);
    // The fixed lesson is where it was set.
    assert.ok(draft.lessons.some((l) => l.sectionId === sections.G2A.id && l.weekday === 'MON' && l.period === 6 && l.subject.id === subjects.Art.id && l.fixed));
    // Lessons per week per class and subject; English of G1 B shared 3 / 2.
    const count = (sectionId, subject, teacher) => draft.lessons.filter((l) => l.sectionId === sectionId && l.subject.id === subjects[subject].id && (!teacher || l.teacher.id === staff[teacher].id)).length;
    assert.equal(count(sections.G1A.id, 'Maths'), 6);
    assert.equal(count(sections.G2A.id, 'Art'), 2);
    assert.equal(count(sections.G2A.id, 'Art', 'T4') + count(sections.G2A.id, 'Somali', 'T4'), 6, 'one teacher, two subjects in one class');
    assert.deepEqual([count(sections.G1B.id, 'English', 'T2'), count(sections.G1B.id, 'English', 'T6')].sort(), [2, 3]);
    // Nothing is published by generating.
    assert.equal(await prisma.timetableVersion.count({ where: { branchId: branches.A1.id, cancelledAt: null } }), 0);
  });

  test('draft edits: a move that breaks a rule is refused with the reason; stale revisions too; fixed lessons do not move', async () => {
    const edit = (body) => manager1(`${M}/drafts/${draft.id}/edit`, { method: 'POST', body: { revision: draft.revision, ...body } });
    // Move one of T1's Grade 1 A lessons to a period where T1 teaches Grade 1 B.
    const a = draft.lessons.find((l) => l.sectionId === sections.G1A.id && l.teacher?.id === staff.T1.id);
    const b = draft.lessons.find((l) => l.sectionId === sections.G1B.id && l.teacher?.id === staff.T1.id && !(l.weekday === a.weekday && l.period === a.period));
    const clash = await edit({ action: 'move', section: sections.G1A.id, from: { weekday: a.weekday, period: a.period }, to: { weekday: b.weekday, period: b.period } });
    assert.equal(clash.status, 409);
    assert.ok(['DRAFT_CONFLICT'].includes(clash.body.code), JSON.stringify(clash.body));
    const fixed = draft.lessons.find((l) => l.fixed);
    assert.equal((await edit({ action: 'move', section: fixed.sectionId, from: { weekday: fixed.weekday, period: fixed.period }, to: { weekday: 'TUE', period: 1 } })).body.code, 'FIXED_LESSON');

    // Lock a lesson, remove another and place it back.
    const locked = draft.lessons.find((l) => !l.fixed && l.sectionId === sections.G1A.id);
    let res = await edit({ action: 'lock', lesson: locked.id });
    assert.equal(res.status, 200);
    draft = res.body.draft;
    assert.equal((await manager1(`${M}/drafts/${draft.id}/edit`, { method: 'POST', body: { revision: draft.revision - 1, action: 'unlock', lesson: locked.id } })).body.code, 'STALE_DRAFT');
    const removed = draft.lessons.find((l) => !l.fixed && !l.locked && l.sectionId === sections.G1B.id);
    res = await manager1(`${M}/drafts/${draft.id}/edit`, { method: 'POST', body: { revision: draft.revision, action: 'remove', lesson: removed.id } });
    draft = res.body.draft;
    assert.equal(draft.unplaced.reduce((n, u) => n + u.count, 0), 1);
    res = await manager1(`${M}/drafts/${draft.id}/edit`, { method: 'POST', body: { revision: draft.revision, action: 'place', section: sections.G1B.id, subject: removed.subject.id, teacher: removed.teacher.id, to: { weekday: removed.weekday, period: removed.period } } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    draft = res.body.draft;
    assert.deepEqual(draft.unplaced, []);
    assert.equal((await manager1(`${M}/drafts/${draft.id}/edit`, { method: 'POST', body: { revision: draft.revision, action: 'place', section: sections.G1B.id, subject: removed.subject.id, to: { weekday: 'MON', period: 1 } } })).status >= 400, true, 'a subject already complete or a period taken');

    // Generate again: the locked lesson stays exactly where it was.
    const again = await manager1(`${M}/generate`, { method: 'POST', body: { seed: 99, keepLocked: true } });
    assert.equal(again.status, 201);
    draft = again.body.draft;
    assert.ok(draft.lessons.some((l) => l.sectionId === locked.sectionId && l.weekday === locked.weekday && l.period === locked.period && l.subject.id === locked.subject.id && l.locked));
    assert.deepEqual(checkDraft(draft, { doubles: false, teachers: { [staff.T2.id]: { maxPerDay: 3 } } }), []);
    assert.equal(await prisma.timetableDraft.count({ where: { branchId: branches.A1.id, status: 'DRAFT' } }), 1, 'one open draft');
  });
});

describe('views and exports', () => {
  test('master, class and teacher timetables of the draft; Excel and PDF', async () => {
    const master = await manager1(`/api/manager/timetable-views/master?source=draft`);
    assert.equal(master.status, 200);
    assert.equal(master.body.sections.length, 3);
    assert.deepEqual(master.body.days, WEEK);
    const cls = await manager1(`/api/manager/timetable-views/sections/${sections.G1A.id}?source=draft`);
    assert.equal(cls.body.lessons.length, 20);
    const teacher = await manager1(`/api/manager/timetable-views/teachers/${staff.T1.id}?source=draft`);
    assert.equal(teacher.status, 200);
    assert.equal(teacher.body.lessons.filter((l) => !l.elsewhere).length, 12);
    assert.equal(teacher.body.lessons.filter((l) => l.elsewhere).length, 5, 'their lessons in branch A2 show as elsewhere');
    assert.equal((await manager1(`/api/manager/timetable-views/teachers/${staff.T7.id}`)).status, 404, 'another branch’s teacher who does not teach here');
    assert.equal((await owner(`/api/owner/timetable-views/master?source=draft&branch=${branches.A1.id}`)).status, 200);

    for (const path of [`/api/manager/timetable-views/master/export.xlsx?source=draft`, `/api/manager/timetable-views/teachers/${staff.T1.id}/export.xlsx?source=draft`]) {
      const res = await call(path, { cookie: cookies.MANAGER_A1, raw: true });
      const buf = Buffer.from(await res.arrayBuffer());
      assert.equal(res.status, 200, path);
      assert.equal(buf.subarray(0, 2).toString(), 'PK');
    }
    for (const path of [`/api/manager/timetable-views/master/export.pdf?source=draft`, `/api/manager/timetable-views/sections/${sections.G1A.id}/export.pdf?source=draft`]) {
      const res = await call(path, { cookie: cookies.MANAGER_A1, raw: true });
      const buf = Buffer.from(await res.arrayBuffer());
      assert.equal(res.status, 200, path);
      assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
      assert.match(res.headers.get('content-disposition'), /timetable-(master|section)-.*\.pdf/);
    }
  });
});

describe('publishing', () => {
  test('all classes or none: a clash that appeared after generating refuses the whole publish', async () => {
    // A lesson of T3 in the draft; T3 is then booked in branch A2 at that time (written directly).
    const l = draft.lessons.find((x) => x.teacher?.id === staff.T3.id);
    const p = draft.sections.find((s) => s.id === l.sectionId).periods[l.weekday].find((x) => x.number === l.period);
    const other = await prisma.bellSchedule.create({ data: { schoolId: schools.A.id, branchId: branches.A2.id, name: `Clash ${tag}`, nameKey: `clash ${lower}` } });
    await prisma.bellScheduleVersion.create({ data: { bellScheduleId: other.id, effectiveFrom: asDbDay(today), periods: { create: [{ kind: 'LESSON', number: 1, days: WEEK, startMinute: toMin(p.start), endMinute: toMin(p.end) }] } } });
    await prisma.teachingAssignment.create({ data: { schoolId: schools.A.id, academicYearId: year.id, branchId: branches.A2.id, sectionId: sections.G1X.id, teacherId: staff.T3.id, role: 'SUBJECT_TEACHER', subjectId: subjects.Science.id, startDate: asDbDay(today) } });
    const sneaky = await prisma.timetableVersion.create({ data: { schoolId: schools.A.id, academicYearId: year.id, branchId: branches.A2.id, sectionId: sections.G1X.id, bellScheduleId: other.id, effectiveFrom: asDbDay(tomorrow), slots: { create: [{ weekday: l.weekday, periodNumber: 1, subjectId: subjects.Science.id, teacherId: staff.T3.id }] } } });

    const refused = await manager1(`${M}/drafts/${draft.id}/publish`, { method: 'POST', body: { revision: draft.revision, effectiveFrom: tomorrow } });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'TEACHER_CLASH', JSON.stringify(refused.body));
    assert.equal(await prisma.timetableVersion.count({ where: { branchId: branches.A1.id } }), 0, 'nothing published');
    assert.equal((await prisma.timetableDraft.findUnique({ where: { id: draft.id } })).status, 'DRAFT');
    // Remove the clash again.
    await prisma.timetableSlot.deleteMany({ where: { versionId: sneaky.id } });
    await prisma.timetableVersion.delete({ where: { id: sneaky.id } });
  });

  test('with “every period has a lesson”, a draft with empty periods cannot be published', async () => {
    assert.equal((await manager1(`${M}/setup`, { method: 'PUT', body: { fillAllPeriods: true } })).status, 200);
    const refused = await manager1(`${M}/drafts/${draft.id}/publish`, { method: 'POST', body: { revision: draft.revision, effectiveFrom: tomorrow } });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'DRAFT_INCOMPLETE');
    assert.equal(refused.body.details.classes.length, 3);
    assert.equal(await prisma.timetableVersion.count({ where: { branchId: branches.A1.id } }), 0);
    assert.equal((await manager1(`${M}/setup`, { method: 'PUT', body: { fillAllPeriods: false } })).status, 200);
  });

  test('publishes every class from the chosen day; views and the Staff app show it; audited', async () => {
    assert.equal((await manager1(`${M}/drafts/${draft.id}/publish`, { method: 'POST', body: { revision: draft.revision, effectiveFrom: addDays(today, -1) } })).status, 409, 'not in the past');
    const res = await manager1(`${M}/drafts/${draft.id}/publish`, { method: 'POST', body: { revision: draft.revision, effectiveFrom: tomorrow } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.changed, 3);
    for (const key of ['G1A', 'G1B', 'G2A']) {
      const t = await manager1(`/api/manager/sections/${sections[key].id}/timetable`);
      assert.equal(t.body.versions.length, 1);
      assert.equal(t.body.versions[0].effectiveFrom, tomorrow);
    }
    assert.equal((await manager1(`${M}/drafts/${draft.id}/publish`, { method: 'POST', body: { revision: draft.revision + 1, effectiveFrom: tomorrow } })).body.code, 'DRAFT_CLOSED');
    const master = await manager1(`/api/manager/timetable-views/master?date=${tomorrow}`);
    assert.equal(master.body.sections.reduce((n, s) => n + s.lessons.length, 0), 57);
    assert.equal((await manager1(`/api/manager/timetable-views/master`)).body.sections.reduce((n, s) => n + s.lessons.length, 0), 0, 'today keeps its (empty) timetable');
    const events = await prisma.auditEvent.findMany({ where: { schoolId: schools.A.id, action: { in: ['TIMETABLE_PUBLISHED', 'TIMETABLE_CHANGED'] } } });
    assert.equal(events.filter((e) => e.action === 'TIMETABLE_PUBLISHED').length, 1);
    assert.ok(events.filter((e) => e.action === 'TIMETABLE_CHANGED' && e.description.includes('timetable builder')).length >= 3);

    // The teacher's own week in the Staff app: here and in branch A2.
    const week = await call(`/api/teacher/timetable?date=${tomorrow}`, { token: teacherToken });
    assert.equal(week.status, 200, JSON.stringify(week.body));
    assert.equal(week.body.total, 17);
    assert.ok(week.body.lessons.some((l) => l.section.branch.id === branches.A2.id));
    assert.equal((await call('/api/teacher/timetable', { token: 'nope' })).status, 401);
  });

  test('another school sees nothing; random ids are not found', async () => {
    assert.equal((await ownerB(`/api/owner/timetable-builder/drafts/${draft.id}/discard`, { method: 'POST', body: { revision: 1 } })).status, 404);
    assert.equal((await manager1(`${M}/drafts/${randomUUID()}/edit`, { method: 'POST', body: { revision: 1, action: 'lock', lesson: randomUUID() } })).status, 404);
    assert.equal((await ownerB(`/api/owner/timetable-views/sections/${sections.G1A.id}`)).status, 404);
  });
});

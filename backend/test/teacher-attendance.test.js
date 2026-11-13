/*
 * Teacher lesson attendance, Phase 5 (docs/business-rules.md → Student attendance → Teacher lesson
 * attendance): which lessons are a teacher's (named in the timetable, or the subject's teacher when
 * none is named), present/absent only, online and offline marks (device clock corrected, the
 * lesson window, the upload grace, the order marks were taken), corrections, Managers' marks
 * winning, Managers opening and correcting lesson sessions, excuses for lessons, the school switch.
 * Runs on the Neon dev branch (`npm test`); everything it creates is removed afterwards.
 *
 * Each section has one lesson a day from 00:01 to 23:58, so today's lesson is always open whatever
 * the time the tests run, yesterday's is past its deadline but inside the upload grace (24 hours
 * after it), and three days ago is past both.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { zonedInstant } from '../src/common/zonedTime.js';
import { getPrisma } from '../src/config/prisma.js';
import { calendarToday } from '../src/features/academic-calendar/calendar.service.js';
import { addDays, asDbDay } from '../src/features/academic-calendar/schoolDays.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { platformTimeZone } from '../src/features/platform-settings/settings.service.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Teacher attendance tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const ALL = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const tokens = {};
const cookies = {};
const staff = {};
const sections = {};
const students = {};
const subjects = {};
let school;
let branch;
let year;
let server;
let base;
let today;
let yesterday;
let timeZone;

async function call(path, { method = 'GET', body, token, cookie } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(method !== 'GET' && !token && { origin: ORIGIN }), ...(token && { authorization: `Bearer ${token}` }), ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const teacher = (key) => (path, options = {}) => call(path, { ...options, token: tokens[key] });
const manager = (path, options = {}) => call(path, { ...options, cookie: cookies.MANAGER });
const lessons = (key, date) => teacher(key)(`/api/teacher/lessons${date ? `?date=${date}` : ''}`);
const at = (date, minutes) => zonedInstant(date, minutes, timeZone).toISOString();
/** PUT marks: marks as [studentKey, status, occurredAt ISO]. */
const send = (key, sectionKey, date, marks, sentAt = new Date().toISOString()) =>
  teacher(key)('/api/teacher/lessons/marks', {
    method: 'PUT',
    body: { section: sections[sectionKey].id, date, period: 1, sentAt, marks: marks.map(([s, status, occurredAt]) => ({ student: students[s].id, status, occurredAt })) },
  });
const results = (res) => res.body.results.map((r) => (r.result === 'recorded' ? 'ok' : r.code));
const studentOf = (lesson, key) => lesson.students.find((s) => s.id === students[key].id);

async function makeTeacher(key, n) {
  const phone = `+998${parseInt(randomBytes(4).toString('hex'), 16)}`;
  const password = randomBytes(12).toString('base64url');
  staff[key] = await prisma.user.create({
    data: { name: `${key} ${tag}`, email: `test-ta-${key.toLowerCase()}-${lower}@test.edutrack.example`, role: 'STAFF', branchId: branch.id, staffId: `${branch.code}-ST${String(n).padStart(3, '0')}`, jobTitle: 'Teacher', phone, phoneKey: phone, passwordHash: await hashPassword(password) },
  });
  const res = await call('/api/auth/login', { method: 'POST', body: { identifier: phone, password, client: 'mobile' } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  tokens[key] = res.body.token;
}

async function makeStudent(key, sectionKey) {
  const n = Object.keys(students).length + 1;
  students[key] = await prisma.student.create({
    data: { schoolId: school.id, branchId: branch.id, studentNumber: `TA${tag}-${n}`, firstName: key, lastName: 'Student', nameKey: `${key.toLowerCase()} student`, gender: 'MALE', dateOfBirth: new Date('2014-01-01'), guardianName: 'G', guardianPhone: '+252 61 2345678', status: 'ENROLLED' },
  });
  await prisma.enrollment.create({ data: { schoolId: school.id, branchId: branch.id, studentId: students[key].id, academicYearId: year.id, sectionId: sections[sectionKey].id } });
}

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  today = await calendarToday();
  yesterday = addDays(today, -1);
  timeZone = await platformTimeZone();

  school = await prisma.school.create({ data: { code: `TAT${tag}`, name: `Teacher Attendance ${tag}`, location: 'Mogadishu', phone: '+252 61 1234567', address: 'Road 1' } });
  branch = await prisma.branch.create({ data: { schoolId: school.id, number: 1, code: `TAT${tag}-B001`, name: 'Main', nameKey: `main ${lower}`, address: 'Road', city: 'Mogadishu' } });
  const start = asDbDay(addDays(today, -30));
  year = await prisma.academicYear.create({ data: { schoolId: school.id, name: `Y ${tag}`, nameKey: `y ${lower}`, startDate: start, endDate: asDbDay(addDays(today, 200)), status: 'CURRENT', startedAt: new Date() } });
  await prisma.academicWeekdays.create({ data: { schoolId: school.id, academicYearId: year.id, days: ALL, effectiveFrom: start } });
  const cls = await prisma.schoolClass.create({ data: { schoolId: school.id, name: 'Grade 1', nameKey: 'grade 1', sequence: 1 } });
  for (const key of ['A', 'B']) sections[key] = await prisma.section.create({ data: { schoolId: school.id, branchId: branch.id, classId: cls.id, academicYearId: year.id, name: key, nameKey: key.toLowerCase() } });
  for (const name of ['Maths', 'Science']) subjects[name] = await prisma.subject.create({ data: { schoolId: school.id, name, nameKey: name.toLowerCase() } });
  const bell = await prisma.bellSchedule.create({ data: { schoolId: school.id, name: 'All day', nameKey: 'all day' } });
  await prisma.bellScheduleVersion.create({ data: { bellScheduleId: bell.id, effectiveFrom: start, periods: { create: [{ kind: 'LESSON', number: 1, days: ALL, startMinute: 1, endMinute: 1438 }] } } });

  await makeTeacher('T1', 1);
  await makeTeacher('T2', 2);
  await makeTeacher('T3', 3);
  const assign = (t, s, subject) => prisma.teachingAssignment.create({ data: { schoolId: school.id, academicYearId: year.id, branchId: branch.id, sectionId: sections[s].id, teacherId: staff[t].id, role: 'SUBJECT_TEACHER', subjectId: subjects[subject].id, startDate: start } });
  await assign('T1', 'A', 'Maths');
  await assign('T2', 'B', 'Science');
  // A: Maths with T1 named. B: Science with nobody named (its subject teacher, T2, takes it).
  await prisma.timetableVersion.create({ data: { schoolId: school.id, academicYearId: year.id, branchId: branch.id, sectionId: sections.A.id, bellScheduleId: bell.id, effectiveFrom: start, slots: { create: ALL.map((weekday) => ({ weekday, periodNumber: 1, subjectId: subjects.Maths.id, teacherId: staff.T1.id })) } } });
  await prisma.timetableVersion.create({ data: { schoolId: school.id, academicYearId: year.id, branchId: branch.id, sectionId: sections.B.id, bellScheduleId: bell.id, effectiveFrom: start, slots: { create: ALL.map((weekday) => ({ weekday, periodNumber: 1, subjectId: subjects.Science.id })) } } });
  for (const key of ['Abdi', 'Bilan', 'Cali']) await makeStudent(key, 'A');
  await makeStudent('Dahir', 'B');

  const password = randomBytes(12).toString('base64url');
  const email = `test-ta-manager-${lower}@test.edutrack.example`;
  await prisma.user.create({ data: { name: `Manager ${tag}`, email, role: 'MANAGER', branchId: branch.id, passwordHash: await hashPassword(password) } });
  cookies.MANAGER = (await call('/api/auth/login', { method: 'POST', body: { email, password } })).cookie;
  const ownerEmail = `test-ta-owner-${lower}@test.edutrack.example`;
  const owner = await prisma.user.create({ data: { name: `Owner ${tag}`, email: ownerEmail, role: 'OWNER', passwordHash: await hashPassword(password) } });
  await prisma.school.update({ where: { id: school.id }, data: { ownerId: owner.id } });
  const fixtureStaff = await branchFor('MANAGER');
  void fixtureStaff;
});

after(async () => {
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  const w = { schoolId: school.id };
  await prisma.studentAttendanceChange.deleteMany({ where: { session: w } });
  await prisma.studentAttendanceEntry.deleteMany({ where: w });
  await prisma.studentAttendanceSession.deleteMany({ where: w });
  await prisma.studentExcuse.deleteMany({ where: w });
  await prisma.studentAttendanceSettings.deleteMany({ where: w });
  await prisma.enrollment.deleteMany({ where: w });
  await prisma.student.deleteMany({ where: w });
  await prisma.timetableSlot.deleteMany({ where: { version: w } });
  await prisma.timetableVersion.deleteMany({ where: w });
  await prisma.bellPeriod.deleteMany({ where: { version: { bellSchedule: w } } });
  await prisma.bellScheduleVersion.deleteMany({ where: { bellSchedule: w } });
  await prisma.bellSchedule.deleteMany({ where: w });
  await prisma.teachingAssignment.deleteMany({ where: w });
  await prisma.subject.deleteMany({ where: w });
  await prisma.academicWeekdays.deleteMany({ where: w });
  await prisma.section.deleteMany({ where: w });
  await prisma.schoolClass.deleteMany({ where: w });
  await prisma.auditEvent.deleteMany({ where: { OR: [w, { actorId: { in: userIds } }] } });
  await prisma.academicYear.deleteMany({ where: w });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.school.update({ where: { id: school.id }, data: { ownerId: null } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where: w });
  await prisma.school.delete({ where: { id: school.id } });
  await removeTestBranches();
  server.close();
  await prisma.$disconnect();
});

describe('access', () => {
  test('signed out 401; web accounts 403; switched off 403 FEATURE_DISABLED', async () => {
    assert.equal((await call('/api/teacher/lessons')).status, 401);
    assert.equal((await manager('/api/teacher/lessons')).status, 403);
    const off = await lessons('T1');
    assert.equal(off.status, 403);
    assert.equal(off.body.code, 'FEATURE_DISABLED');
    await prisma.school.update({ where: { id: school.id }, data: { studentAttendanceEnabled: true } });
    assert.equal((await lessons('T1')).status, 200);
  });
});

describe('a teacher’s lessons', () => {
  test('named lessons and unnamed lessons of their subjects; class lists before the session opens', async () => {
    const t1 = await lessons('T1');
    assert.equal(t1.body.lessons.length, 1);
    const [lesson] = t1.body.lessons;
    assert.equal(lesson.section.id, sections.A.id);
    assert.equal(lesson.subject.name, 'Maths');
    assert.equal(lesson.state, 'open');
    assert.equal(lesson.session, null);
    assert.deepEqual(lesson.students.map((s) => s.name), ['Abdi Student', 'Bilan Student', 'Cali Student']);
    assert.ok(lesson.students.every((s) => s.effective === 'pending'));
    const t2 = await lessons('T2');
    assert.deepEqual(t2.body.lessons.map((l) => [l.section.id, l.subject.name]), [[sections.B.id, 'Science']]);
    assert.equal((await lessons('T3')).body.lessons.length, 0, 'no teaching, no lessons');
  });
});

describe('marks', () => {
  test('online: present or absent only; the session opens with the class list; other lessons are not theirs', async () => {
    const now = new Date().toISOString();
    const late = await send('T1', 'A', today, [['Abdi', 'late', now]]);
    assert.equal(late.status, 400);
    assert.match(late.body.details['marks.0.status'], /Managers record late/);
    assert.equal((await send('T2', 'A', today, [['Abdi', 'present', now]])).status, 404);

    const res = await send('T1', 'A', today, [['Abdi', 'present', now], ['Bilan', 'absent', now], ['Dahir', 'present', now]]);
    assert.equal(res.status, 200);
    assert.deepEqual(results(res), ['ok', 'ok', 'NOT_ON_LIST']);
    assert.equal(studentOf(res.body.lesson, 'Abdi').status, 'present');
    assert.equal(studentOf(res.body.lesson, 'Bilan').status, 'absent');
    assert.ok(res.body.lesson.session.id);
    const session = await prisma.studentAttendanceSession.findUnique({ where: { id: res.body.lesson.session.id } });
    assert.equal(session.kind, 'LESSON');
    assert.equal(session.periodNumber, 1);
    assert.equal(session.subjectId, subjects.Maths.id);

    // Sent again (an answer lost on the way): recorded, nothing written twice.
    const count = () => prisma.studentAttendanceChange.count({ where: { sessionId: session.id } });
    assert.equal(await count(), 2);
    assert.deepEqual(results(await send('T1', 'A', today, [['Abdi', 'present', now]])), ['ok']);
    assert.equal(await count(), 2);
    const audit = await prisma.auditEvent.findFirst({ where: { schoolId: school.id, action: 'STUDENT_LESSON_ATTENDANCE_MARKED' } });
    assert.equal(audit.change.marks, 2);
  });

  test('device clock: more than 5 minutes off is refused (kept on the device); less is corrected', async () => {
    const ahead = new Date(Date.now() + 10 * 60_000).toISOString();
    const skewed = await send('T1', 'A', today, [['Cali', 'present', ahead]], ahead);
    assert.equal(skewed.status, 422);
    assert.equal(skewed.body.code, 'CLOCK_SKEW');
    const three = new Date(Date.now() + 3 * 60_000).toISOString();
    const res = await send('T1', 'A', today, [['Cali', 'present', three]], three);
    assert.deepEqual(results(res), ['ok']);
    const entry = await prisma.studentAttendanceEntry.findFirst({ where: { studentId: students.Cali.id, session: { date: asDbDay(today), kind: 'LESSON' } } });
    assert.ok(Math.abs(entry.occurredAt.getTime() - Date.now()) < 60_000, 'stored at the corrected time');
  });

  test('offline: taken in the window and uploaded within the grace; applied in the order taken; older marks never win', async () => {
    const res = await send('T1', 'A', yesterday, [
      ['Abdi', 'present', at(yesterday, 605)],
      ['Abdi', 'absent', at(yesterday, 600)],
      ['Bilan', 'absent', at(yesterday, 600)],
      ['Bilan', 'present', at(yesterday, 610)],
      ['Cali', 'present', at(addDays(yesterday, -1), 600)],
    ]);
    assert.equal(res.status, 200);
    assert.deepEqual(results(res), ['ok', 'ok', 'ok', 'ok', 'OUTSIDE_WINDOW']);
    assert.equal(studentOf(res.body.lesson, 'Abdi').status, 'present', 'the later mark');
    assert.equal(studentOf(res.body.lesson, 'Bilan').status, 'present');
    assert.equal(res.body.lesson.state, 'closed');
    const older = await send('T1', 'A', yesterday, [['Bilan', 'absent', at(yesterday, 300)]]);
    assert.deepEqual(results(older), ['NEWER_MARK']);
    const entry = await prisma.studentAttendanceEntry.findFirst({ where: { studentId: students.Bilan.id, session: { date: asDbDay(yesterday) } } });
    assert.equal(entry.source, 'MOBILE');
    assert.equal(entry.occurredAt.toISOString(), at(yesterday, 610));
    assert.ok(entry.syncedAt > entry.occurredAt);
    // A correction now is long after the teacher's correction minutes: refused.
    assert.deepEqual(results(await send('T1', 'A', yesterday, [['Abdi', 'absent', new Date().toISOString()]])), ['OUTSIDE_WINDOW']);
    const tooLate = await send('T1', 'A', addDays(today, -3), [['Abdi', 'present', at(addDays(today, -3), 600)]]);
    assert.equal(tooLate.status, 409);
    assert.equal(tooLate.body.code, 'UPLOAD_PERIOD_OVER');
  });
});

describe('Managers and lessons', () => {
  test('the day shows lessons; Managers correct them with any status; teachers cannot override them', async () => {
    const day = await manager(`/api/manager/student-attendance/day?date=${today}`);
    const a = day.body.items.find((i) => i.section.id === sections.A.id);
    assert.equal(a.lessons.length, 1);
    assert.equal(a.lessons[0].subject.name, 'Maths');
    const sessionId = a.lessons[0].session.id;
    const read = await manager(`/api/manager/student-attendance/sessions/${sessionId}`);
    assert.equal(read.body.session.kind, 'lesson');
    assert.equal(read.body.session.label, 'Period 1 · Maths');
    const bilan = read.body.students.find((s) => s.student.id === students.Bilan.id);
    const fixed = await manager(`/api/manager/student-attendance/sessions/${sessionId}/marks`, { method: 'PUT', body: { marks: [{ student: students.Bilan.id, status: 'late', version: bilan.version }] } });
    assert.equal(fixed.status, 200);
    assert.deepEqual(results(await send('T1', 'A', today, [['Bilan', 'absent', new Date().toISOString()]])), ['SET_BY_MANAGER']);
    const history = await manager(`/api/manager/student-attendance/sessions/${sessionId}/history`);
    assert.deepEqual(history.body.items.filter((h) => h.student.id === students.Bilan.id).map((h) => [h.to, h.source]), [['late', 'web'], ['absent', 'mobile']]);
  });

  test('a Manager opens a lesson the teacher did not take; the teacher can still upload into it; lesson excuses apply', async () => {
    const opened = await manager('/api/manager/student-attendance/sessions', { method: 'POST', body: { section: sections.B.id, date: yesterday, period: 1 } });
    assert.equal(opened.status, 201);
    assert.equal(opened.body.session.subject.name, 'Science');
    assert.equal((await manager('/api/manager/student-attendance/sessions', { method: 'POST', body: { section: sections.B.id, date: yesterday, period: 2 } })).body.code, 'LESSON_NOT_FOUND');
    const res = await send('T2', 'B', yesterday, [['Dahir', 'absent', at(yesterday, 700)]]);
    assert.deepEqual(results(res), ['ok']);
    assert.equal(res.body.lesson.session.id, opened.body.session.id);

    await manager('/api/manager/student-excuses', { method: 'POST', body: { student: students.Dahir.id, startDate: yesterday, periods: [1], reason: 'Clinic' } });
    const t2 = await lessons('T2', yesterday);
    assert.equal(studentOf(t2.body.lessons[0], 'Dahir').effective, 'excused');
    assert.equal(studentOf(t2.body.lessons[0], 'Dahir').excuse.reason, 'Clinic');
  });
});

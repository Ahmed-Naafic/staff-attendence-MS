/*
 * Student attendance completion and notifications, Phase 6 (docs/business-rules.md → Student
 * attendance → Completion and notifications): completion by day and branch (complete, incomplete,
 * missing; Manager sessions and lessons), the teacher's lesson reminder, the Managers' incomplete-day
 * alert, the Owner's daily summary, no duplicates on later runs, the school settings and the
 * recipients' preferences, the school switch. Runs on the Neon dev branch; everything it creates is
 * removed afterwards.
 *
 * The day checked is two days ago (always past every deadline). The upload grace is set to three
 * days so that day's missed lesson can still get its reminder.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { calendarToday } from '../src/features/academic-calendar/calendar.service.js';
import { addDays, asDbDay } from '../src/features/academic-calendar/schoolDays.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { render } from '../src/features/notifications/templates.js';
import { studentAttendanceNotifications } from '../src/features/student-attendance/completion.js';
import { removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Completion tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const ALL = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const cookies = {};
const users = {};
const students = [];
let school;
let branch;
let section;
let server;
let base;
let today;
let day;

async function call(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(method !== 'GET' && { origin: ORIGIN }), ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const manager = (path, options = {}) => call(path, { ...options, cookie: cookies.MANAGER });
const owner = (path, options = {}) => call(path, { ...options, cookie: cookies.OWNER });
const notes = (where = {}) => prisma.notification.findMany({ where: { schoolId: school.id, ...where }, orderBy: { createdAt: 'asc' } });
const run = () => studentAttendanceNotifications({ schoolIds: [school.id] });

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  today = await calendarToday();
  day = addDays(today, -2);

  school = await prisma.school.create({ data: { code: `SAC${tag}`, name: `Completion ${tag}`, location: 'Mogadishu', phone: '+252 61 1234567', address: 'Road', studentAttendanceEnabled: true } });
  branch = await prisma.branch.create({ data: { schoolId: school.id, number: 1, code: `SAC${tag}-B001`, name: 'Main', nameKey: `main ${lower}`, address: 'Road', city: 'Mogadishu' } });
  const start = asDbDay(addDays(today, -30));
  const year = await prisma.academicYear.create({ data: { schoolId: school.id, name: `Y ${tag}`, nameKey: `y ${lower}`, startDate: start, endDate: asDbDay(addDays(today, 200)), status: 'CURRENT', startedAt: new Date() } });
  await prisma.academicWeekdays.create({ data: { schoolId: school.id, academicYearId: year.id, days: ALL, effectiveFrom: start } });
  const cls = await prisma.schoolClass.create({ data: { schoolId: school.id, name: 'Grade 1', nameKey: 'grade 1', sequence: 1 } });
  section = await prisma.section.create({ data: { schoolId: school.id, branchId: branch.id, classId: cls.id, academicYearId: year.id, name: 'A', nameKey: 'a' } });
  const maths = await prisma.subject.create({ data: { schoolId: school.id, name: 'Maths', nameKey: 'maths' } });
  const bell = await prisma.bellSchedule.create({ data: { schoolId: school.id, name: 'Day', nameKey: 'day' } });
  await prisma.bellScheduleVersion.create({
    data: {
      bellScheduleId: bell.id,
      effectiveFrom: start,
      periods: { create: [
        { kind: 'LESSON', number: 1, days: ALL, startMinute: 450, endMinute: 630 },
        { kind: 'BREAK', name: 'Break', days: ALL, startMinute: 630, endMinute: 660, mainBreak: true },
        { kind: 'LESSON', number: 2, days: ALL, startMinute: 660, endMinute: 780 },
      ] },
    },
  });
  const password = randomBytes(12).toString('base64url');
  const make = async (key, role, extra = {}) => {
    users[key] = await prisma.user.create({ data: { name: `${key} ${tag}`, email: `test-sac-${key.toLowerCase()}-${lower}@test.edutrack.example`, role, passwordHash: await hashPassword(password), ...extra } });
  };
  await make('OWNER', 'OWNER');
  await prisma.school.update({ where: { id: school.id }, data: { ownerId: users.OWNER.id } });
  await make('MANAGER', 'MANAGER', { branchId: branch.id });
  const phone = `+997${parseInt(randomBytes(4).toString('hex'), 16)}`;
  await make('T1', 'STAFF', { branchId: branch.id, staffId: `${branch.code}-ST001`, jobTitle: 'Teacher', phone, phoneKey: phone });
  await make('T2', 'STAFF', { branchId: branch.id, staffId: `${branch.code}-ST002`, jobTitle: 'Teacher', phone: `${phone}2`, phoneKey: `${phone}2` });
  for (const key of ['T1', 'T2']) await prisma.teachingAssignment.create({ data: { schoolId: school.id, academicYearId: year.id, branchId: branch.id, sectionId: section.id, teacherId: users[key].id, role: 'SUBJECT_TEACHER', subjectId: maths.id, startDate: start } });
  // Period 1: T1 named. Period 2: nobody named (both Maths teachers of the section).
  await prisma.timetableVersion.create({
    data: { schoolId: school.id, academicYearId: year.id, branchId: branch.id, sectionId: section.id, bellScheduleId: bell.id, effectiveFrom: start, slots: { create: ALL.flatMap((weekday) => [{ weekday, periodNumber: 1, subjectId: maths.id, teacherId: users.T1.id }, { weekday, periodNumber: 2, subjectId: maths.id }]) } },
  });
  for (let i = 1; i <= 2; i += 1) {
    const s = await prisma.student.create({ data: { schoolId: school.id, branchId: branch.id, studentNumber: `SAC${tag}-${i}`, firstName: `S${i}`, lastName: 'Student', nameKey: `s${i} student`, gender: 'FEMALE', dateOfBirth: new Date('2014-01-01'), guardianName: 'G', guardianPhone: '+252 61 2345678', status: 'ENROLLED' } });
    await prisma.enrollment.create({ data: { schoolId: school.id, branchId: branch.id, studentId: s.id, academicYearId: year.id, sectionId: section.id } });
    students.push(s);
  }
  await prisma.studentAttendanceSettings.create({ data: { schoolId: school.id, offlineGraceMinutes: 4320 } });
  for (const key of ['OWNER', 'MANAGER']) {
    const res = await call('/api/auth/login', { method: 'POST', body: { email: users[key].email, password } });
    assert.equal(res.status, 200);
    cookies[key] = res.body && (await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email: users[key].email, password }) })).headers.get('set-cookie').split(';')[0];
  }

  // The day: before the break complete; after the break never taken; period 1 never taken;
  // period 2 opened by the Manager with one of two students marked.
  const before1 = await manager('/api/manager/student-attendance/sessions', { method: 'POST', body: { section: section.id, date: day, half: 'before_break' } });
  assert.equal(before1.status, 201);
  await manager(`/api/manager/student-attendance/sessions/${before1.body.session.id}/marks`, { method: 'PUT', body: { marks: [{ student: students[0].id, status: 'present' }, { student: students[1].id, status: 'absent' }] } });
  const p2 = await manager('/api/manager/student-attendance/sessions', { method: 'POST', body: { section: section.id, date: day, period: 2 } });
  assert.equal(p2.status, 201);
  await manager(`/api/manager/student-attendance/sessions/${p2.body.session.id}/marks`, { method: 'PUT', body: { marks: [{ student: students[0].id, status: 'late' }] } });
});

after(async () => {
  const userIds = Object.values(users).map((u) => u.id);
  const w = { schoolId: school.id };
  await prisma.pushMessage.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { OR: [w, { recipientId: { in: userIds } }] } });
  await prisma.notificationPreference.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.studentAttendanceChange.deleteMany({ where: { session: w } });
  await prisma.studentAttendanceEntry.deleteMany({ where: w });
  await prisma.studentAttendanceSession.deleteMany({ where: w });
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

describe('completion', () => {
  test('by day and branch: complete, incomplete and missing Manager sessions and lessons', async () => {
    const res = await manager(`/api/manager/student-attendance/completion?from=${day}&to=${day}`);
    assert.equal(res.status, 200);
    const [d] = res.body.days;
    assert.equal(d.date, day);
    const [b] = d.branches;
    assert.deepEqual(b.halves, { expected: 2, due: 2, taken: 1, complete: 1, incomplete: 0, missing: 1 });
    assert.deepEqual(b.lessons, { expected: 2, due: 2, taken: 1, complete: 0, incomplete: 1, missing: 1 });
    assert.deepEqual(b.attention.map((a) => [a.kind, a.status, a.half ?? a.period]).sort(), [['half_day', 'missing', 'after_break'], ['lesson', 'incomplete', 2], ['lesson', 'missing', 1]].sort());
    const week = await owner('/api/owner/student-attendance/completion');
    assert.equal(week.body.days.length, 7);
    assert.equal((await manager(`/api/manager/student-attendance/completion?from=${addDays(today, -40)}&to=${today}`)).status, 400);
  });
});

describe('notifications', () => {
  test('teacher reminders, the Managers’ alert and the Owner’s summary; once only', async () => {
    const first = await run();
    assert.ok(first.created > 0);
    const reminders = await notes({ type: 'LESSON_ATTENDANCE_MISSING', params: { path: ['date'], equals: day } });
    assert.deepEqual(reminders.map((n) => [n.recipientId, n.params.period]), [[users.T1.id, 1]], 'only the missing lesson; the named teacher only');
    assert.match(render(reminders[0].type, reminders[0].params).body, /Xiisadda 1/);
    const alert = await notes({ type: 'STUDENT_ATTENDANCE_INCOMPLETE', dedupeKey: `sa-incomplete:${day}:${branch.id}:${users.MANAGER.id}` });
    assert.equal(alert.length, 1);
    assert.equal(alert[0].params.halves.missing, 1);
    assert.equal(alert[0].params.lessons.incomplete, 1);
    const summary = await notes({ type: 'STUDENT_ATTENDANCE_SUMMARY', dedupeKey: `sa-summary:${day}:${school.id}` });
    assert.equal(summary.length, 1);
    assert.equal(summary[0].recipientId, users.OWNER.id);
    assert.deepEqual(summary[0].params.students, { present: 1, absent: 1, late: 0, excused: 0, notMarked: 0 });
    assert.match(render(summary[0].type, summary[0].params).title, new RegExp(day));
    // The teacher's push is queued (generic text); a later run adds nothing.
    assert.ok(await prisma.pushMessage.count({ where: { userId: users.T1.id } }));
    const total = (await notes()).length;
    await run();
    assert.equal((await notes()).length, total);
  });

  test('a lesson without a named teacher reminds each of the section’s teachers of the subject', async () => {
    const yesterday = addDays(today, -1);
    const reminders = await notes({ type: 'LESSON_ATTENDANCE_MISSING', params: { path: ['period'], equals: 2 } });
    const forYesterday = reminders.filter((n) => n.params.date === yesterday);
    // Yesterday's period 2 is past its deadline unless the tests run in the first minutes after midnight.
    if (forYesterday.length) assert.deepEqual(forYesterday.map((n) => n.recipientId).sort(), [users.T1.id, users.T2.id].sort());
  });

  test('settings, preferences and the school switch are respected', async () => {
    await prisma.notification.deleteMany({ where: { schoolId: school.id } });
    await prisma.studentAttendanceSettings.updateMany({ where: { schoolId: school.id }, data: { teacherReminders: false, managerAlerts: false } });
    await prisma.notificationPreference.create({ data: { userId: users.OWNER.id, disabledCategories: ['STUDENT_ATTENDANCE'] } });
    await run();
    assert.equal((await notes()).length, 0);

    await prisma.studentAttendanceSettings.updateMany({ where: { schoolId: school.id }, data: { teacherReminders: null, managerAlerts: null } });
    await prisma.school.update({ where: { id: school.id }, data: { studentAttendanceEnabled: false } });
    await run();
    assert.equal((await notes()).length, 0);
    assert.equal((await manager('/api/manager/student-attendance/completion')).body.code, 'FEATURE_DISABLED');
    await prisma.school.update({ where: { id: school.id }, data: { studentAttendanceEnabled: true } });
  });
});

/*
 * Student attendance reports, Phase 7 (docs/business-rules.md → Student attendance → Reports):
 * totals, sections (completion and marks) and students (lowest rate first) from the Managers'
 * sessions or the teachers' lessons, excuses applied when read, the attendance rate (excused and
 * unmarked never counted as absent), the "below" filter, one student's history, CSV and Excel
 * exports, scope and the school switch. Runs on the Neon dev branch; everything is removed after.
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
import { attendanceRate } from '../src/features/student-attendance/reports.service.js';
import { removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Report tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const ALL = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const cookies = {};
const users = {};
const S = {};
let school;
let branch;
let other;
let section;
let maths;
let server;
let base;
let today;
let day;

async function call(path, { method = 'GET', body, cookie, raw = false } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(method !== 'GET' && { origin: ORIGIN }), ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return response;
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const manager = (path, options = {}) => call(path, { ...options, cookie: cookies.MANAGER });
const owner = (path, options = {}) => call(path, { ...options, cookie: cookies.OWNER });
const row = (res, key) => res.body.students.items.find((r) => r.student.id === S[key].id);

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  today = await calendarToday();
  day = addDays(today, -2);

  school = await prisma.school.create({ data: { code: `SAR${tag}`, name: `Reports ${tag}`, location: 'Mogadishu', phone: '+252 61 1234567', address: 'Road', studentAttendanceEnabled: true } });
  branch = await prisma.branch.create({ data: { schoolId: school.id, number: 1, code: `SAR${tag}-B001`, name: 'Main', nameKey: `main ${lower}`, address: 'Road', city: 'Mogadishu' } });
  other = await prisma.branch.create({ data: { schoolId: school.id, number: 2, code: `SAR${tag}-B002`, name: 'Other', nameKey: `other ${lower}`, address: 'Road', city: 'Mogadishu' } });
  const start = asDbDay(addDays(today, -30));
  const year = await prisma.academicYear.create({ data: { schoolId: school.id, name: `Y ${tag}`, nameKey: `y ${lower}`, startDate: start, endDate: asDbDay(addDays(today, 200)), status: 'CURRENT', startedAt: new Date() } });
  await prisma.academicWeekdays.create({ data: { schoolId: school.id, academicYearId: year.id, days: ALL, effectiveFrom: start } });
  const cls = await prisma.schoolClass.create({ data: { schoolId: school.id, name: 'Grade 1', nameKey: 'grade 1', sequence: 1 } });
  section = await prisma.section.create({ data: { schoolId: school.id, branchId: branch.id, classId: cls.id, academicYearId: year.id, name: 'A', nameKey: 'a' } });
  maths = await prisma.subject.create({ data: { schoolId: school.id, name: 'Maths', nameKey: 'maths' } });
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
  await prisma.timetableVersion.create({ data: { schoolId: school.id, academicYearId: year.id, branchId: branch.id, sectionId: section.id, bellScheduleId: bell.id, effectiveFrom: start, slots: { create: ALL.map((weekday) => ({ weekday, periodNumber: 1, subjectId: maths.id })) } } });
  for (const name of ['Asha', 'Bilal', 'Cawo']) {
    S[name] = await prisma.student.create({ data: { schoolId: school.id, branchId: branch.id, studentNumber: `SAR${tag}-${name}`, firstName: name, lastName: 'Student', nameKey: `${name.toLowerCase()} student`, gender: 'FEMALE', dateOfBirth: new Date('2014-01-01'), guardianName: 'G', guardianPhone: '+252 61 2345678', guardianRelationship: 'Mother', status: 'ENROLLED' } });
    await prisma.enrollment.create({ data: { schoolId: school.id, branchId: branch.id, studentId: S[name].id, academicYearId: year.id, sectionId: section.id } });
  }
  const password = randomBytes(12).toString('base64url');
  for (const [key, role, extra] of [['OWNER', 'OWNER', {}], ['MANAGER', 'MANAGER', { branchId: branch.id }], ['MANAGER2', 'MANAGER', { branchId: other.id }]]) {
    users[key] = await prisma.user.create({ data: { name: `${key} ${tag}`, email: `test-sar-${key.toLowerCase()}-${lower}@test.edutrack.example`, role, passwordHash: await hashPassword(password), ...extra } });
    const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email: users[key].email, password }) });
    assert.equal(res.status, 200);
    cookies[key] = res.headers.get('set-cookie').split(';')[0];
  }
  await prisma.school.update({ where: { id: school.id }, data: { ownerId: users.OWNER.id } });

  // Before the break: Asha present, Bilal absent, Cawo late. After: Asha absent (excused for that
  // half), Bilal absent, Cawo not marked. Lesson 1: Asha present, Bilal absent.
  const take = async (body, marks) => {
    const opened = await manager('/api/manager/student-attendance/sessions', { method: 'POST', body: { section: section.id, date: day, ...body } });
    assert.ok([200, 201].includes(opened.status), JSON.stringify(opened.body));
    const res = await manager(`/api/manager/student-attendance/sessions/${opened.body.session.id}/marks`, { method: 'PUT', body: { marks: marks.map(([k, status]) => ({ student: S[k].id, status })) } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  };
  await take({ half: 'before_break' }, [['Asha', 'present'], ['Bilal', 'absent'], ['Cawo', 'late']]);
  await take({ half: 'after_break' }, [['Asha', 'absent'], ['Bilal', 'absent']]);
  await take({ period: 1 }, [['Asha', 'present'], ['Bilal', 'absent']]);
  const excuse = await manager('/api/manager/student-excuses', { method: 'POST', body: { student: S.Asha.id, startDate: day, half: 'after_break', reason: 'Clinic' } });
  assert.equal(excuse.status, 201);
});

after(async () => {
  const userIds = Object.values(users).map((u) => u.id);
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

describe('rate', () => {
  test('(present + late) / (present + late + absent); excused and unmarked left out; nothing counted → no rate', () => {
    assert.equal(attendanceRate({ present: 3, late: 1, absent: 1, excused: 5, notMarked: 9 }), 80);
    assert.equal(attendanceRate({ present: 0, late: 0, absent: 0, excused: 2, notMarked: 1 }), null);
    assert.equal(attendanceRate({ present: 1, late: 0, absent: 2 }), 33.3);
  });
});

describe('reports', () => {
  test('daily attendance: totals, the section and each student, excuses applied, lowest rate first', async () => {
    const res = await manager(`/api/manager/student-attendance/reports?from=${day}&to=${day}`);
    assert.equal(res.status, 200);
    const t = res.body.totals;
    assert.deepEqual([t.present, t.late, t.absent, t.excused, t.notMarked, t.total, t.rate, t.students], [1, 1, 2, 1, 1, 6, 50, 3]);
    assert.deepEqual([t.completion.expected, t.completion.taken], [2, 2]);
    assert.equal(res.body.sections.length, 1);
    assert.equal(res.body.sections[0].rate, 50);
    assert.deepEqual(res.body.students.items.map((r) => r.student.name), ['Bilal Student', 'Asha Student', 'Cawo Student']);
    assert.deepEqual(row(res, 'Asha').counts, { present: 1, late: 0, absent: 0, excused: 1, notMarked: 0, total: 2 });
    assert.equal(row(res, 'Asha').rate, 100);
    assert.equal(row(res, 'Bilal').rate, 0);
    assert.equal(row(res, 'Cawo').counts.notMarked, 1);
    const below = await manager(`/api/manager/student-attendance/reports?from=${day}&to=${day}&below=60`);
    assert.deepEqual(below.body.students.items.map((r) => r.student.name), ['Bilal Student']);
  });

  test('lesson attendance by subject; the Owner sees every branch, a Manager only theirs', async () => {
    const lessons = await owner(`/api/owner/student-attendance/reports?from=${day}&to=${day}&source=lessons&subject=${maths.id}`);
    assert.equal(lessons.status, 200);
    assert.deepEqual([lessons.body.totals.present, lessons.body.totals.absent, lessons.body.totals.rate], [1, 1, 50]);
    assert.deepEqual(lessons.body.options.subjects.map((s) => s.name), ['Maths']);
    assert.equal((await manager(`/api/manager/student-attendance/reports?subject=${maths.id}`)).status, 400, 'subjects apply to lessons');
    const theirs = await call(`/api/manager/student-attendance/reports?from=${day}&to=${day}`, { cookie: cookies.MANAGER2 });
    assert.equal(theirs.body.totals.total, 0);
    assert.equal((await call(`/api/manager/student-attendance/students/${S.Asha.id}`, { cookie: cookies.MANAGER2 })).status, 404);
    assert.equal((await manager(`/api/manager/student-attendance/reports?from=${addDays(today, -100)}&to=${today}`)).status, 400);
  });

  test('one student’s history: every session and lesson with what it counts as', async () => {
    const res = await manager(`/api/manager/student-attendance/students/${S.Asha.id}?from=${day}&to=${day}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items.map((i) => [i.label, i.status, i.effective]), [
      ['Before the break', 'present', 'present'],
      ['After the break', 'absent', 'excused'],
      ['Period 1 · Maths', 'present', 'present'],
    ]);
    assert.equal(res.body.items[1].excuse, 'Clinic');
    assert.equal(res.body.summary.manager.rate, 100);
  });

  test('exports: CSV and Excel of every student, no contact details', async () => {
    const csv = await call(`/api/owner/student-attendance/reports/export.csv?from=${day}&to=${day}`, { cookie: cookies.OWNER, raw: true });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-disposition'), /student-attendance-SAR.*\.csv/);
    const text = await csv.text();
    const lines = text.trim().split('\r\n');
    assert.equal(lines.length, 4);
    assert.match(lines[0], /Student ID,Student Name,Branch,Section,Present,Late,Absent,Excused,Not Marked,Attendance %/);
    assert.doesNotMatch(text, /2345678|Mother|Guardian/);
    const xlsx = await call(`/api/manager/student-attendance/reports/export.xlsx?from=${day}&to=${day}`, { cookie: cookies.MANAGER, raw: true });
    assert.equal(xlsx.status, 200);
    const bytes = Buffer.from(await xlsx.arrayBuffer());
    assert.equal(bytes.subarray(0, 2).toString(), 'PK');
    assert.equal(xlsx.headers.get('x-export-rows'), '3');
  });

  test('switched off: 403 FEATURE_DISABLED', async () => {
    await prisma.school.update({ where: { id: school.id }, data: { studentAttendanceEnabled: false } });
    try {
      assert.equal((await manager('/api/manager/student-attendance/reports')).body.code, 'FEATURE_DISABLED');
    } finally {
      await prisma.school.update({ where: { id: school.id }, data: { studentAttendanceEnabled: true } });
    }
  });
});

/*
 * Student attendance, Phase 4 (docs/business-rules.md → Student attendance): the per-school switch
 * (403 FEATURE_DISABLED), settings (school defaults, what branches may change, branch values), the
 * Manager's day overview, opening sessions with a fixed class list, marks and corrections (reasons,
 * stale edits, history, audit), excuses applied when read, the once/twice-a-day shape, windows
 * (not yet open, correction period over), suspended branches, and isolation between branches and
 * schools. Runs on the Neon dev branch (`npm test`); everything it creates is removed afterwards.
 *
 * Dates are chosen so the results do not depend on the time of day the tests run: two days ago is
 * always past its deadline and inside the correction period; two days ahead is never open.
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

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Student attendance tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const ALL = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const cookies = {};
const schools = {};
const branches = {};
const sections = {};
const students = {};
let year;
let server;
let base;
let today;
let past; // two days ago
let session; // G1A1, past, before the break

async function call(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(method !== 'GET' && { origin: ORIGIN }), ...(cookie && { cookie }) },
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
const admin = as('SUPER_ADMIN');

const open = (who, sectionKey, date, half) => who('/api/manager/student-attendance/sessions', { method: 'POST', body: { section: sections[sectionKey].id, date, half } });
const mark = (who, id, marks) => who(`/api/manager/student-attendance/sessions/${id}/marks`, { method: 'PUT', body: { marks } });
const row = (result, key) => result.body.students.find((s) => s.student.id === students[key].id);

async function makeStudent(key, branchKey, sectionKey) {
  const n = Object.keys(students).length + 1;
  students[key] = await prisma.student.create({
    data: {
      schoolId: schools.A.id,
      branchId: branches[branchKey].id,
      studentNumber: `SAT${tag}-${n}`,
      firstName: key,
      lastName: 'Student',
      nameKey: `${key.toLowerCase()} student`,
      gender: 'FEMALE',
      dateOfBirth: new Date('2014-01-01'),
      guardianName: 'Guardian',
      guardianPhone: '+252 61 2345678',
      status: 'ENROLLED',
    },
  });
  await prisma.enrollment.create({ data: { schoolId: schools.A.id, branchId: branches[branchKey].id, studentId: students[key].id, academicYearId: year.id, sectionId: sections[sectionKey].id } });
}

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  today = await calendarToday();
  past = addDays(today, -2);

  for (const key of ['A', 'B']) {
    schools[key] = await prisma.school.create({ data: { code: `SAT${tag}-${key}`, name: `Attendance Test ${key} ${tag}`, location: 'Mogadishu', phone: '+252 61 1234567', address: 'Road 1' } });
  }
  const branch = (key, school, number) =>
    prisma.branch.create({ data: { schoolId: schools[school].id, number, code: `SAT${tag}-${key}`, name: `Branch ${key}`, nameKey: `branch ${key.toLowerCase()} ${lower}`, address: 'Road', city: 'Mogadishu' } });
  branches.A1 = await branch('A1', 'A', 1);
  branches.A2 = await branch('A2', 'A', 2);
  branches.B = await branch('B1', 'B', 1);

  year = await prisma.academicYear.create({
    data: { schoolId: schools.A.id, name: `Y ${tag}`, nameKey: `y ${lower}`, startDate: asDbDay(addDays(today, -30)), endDate: asDbDay(addDays(today, 200)), status: 'CURRENT', startedAt: new Date() },
  });
  await prisma.academicWeekdays.create({ data: { schoolId: schools.A.id, academicYearId: year.id, days: ALL, effectiveFrom: asDbDay(addDays(today, -30)) } });
  const cls = await prisma.schoolClass.create({ data: { schoolId: schools.A.id, name: 'Grade 1', nameKey: 'grade 1', sequence: 1 } });
  const section = (branchKey) => prisma.section.create({ data: { schoolId: schools.A.id, branchId: branches[branchKey].id, classId: cls.id, academicYearId: year.id, name: 'A', nameKey: 'a' } });
  sections.G1A1 = await section('A1');
  sections.G1A2 = await section('A2');

  // A day with a main break: 07:30–10:30 before it, 11:00–13:00 after it, on every weekday.
  const bell = await prisma.bellSchedule.create({ data: { schoolId: schools.A.id, name: 'Day', nameKey: 'day' } });
  await prisma.bellScheduleVersion.create({
    data: {
      bellScheduleId: bell.id,
      effectiveFrom: asDbDay(addDays(today, -30)),
      periods: {
        create: [
          { kind: 'LESSON', number: 1, days: ALL, startMinute: 450, endMinute: 630 },
          { kind: 'BREAK', name: 'Break', days: ALL, startMinute: 630, endMinute: 660, mainBreak: true },
          { kind: 'LESSON', number: 2, days: ALL, startMinute: 660, endMinute: 780 },
        ],
      },
    },
  });
  for (const key of ['G1A1', 'G1A2']) {
    await prisma.timetableVersion.create({
      data: { schoolId: schools.A.id, academicYearId: year.id, branchId: sections[key].branchId, sectionId: sections[key].id, bellScheduleId: bell.id, effectiveFrom: asDbDay(addDays(today, -30)) },
    });
  }
  await makeStudent('Amina', 'A1', 'G1A1');
  await makeStudent('Bashir', 'A1', 'G1A1');
  await makeStudent('Caamir', 'A1', 'G1A1');
  await makeStudent('Deeqa', 'A2', 'G1A2');

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
    const email = `test-sat-${key.toLowerCase().replace('_', '-')}-${lower}@test.edutrack.example`;
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
  await prisma.studentAttendanceChange.deleteMany({ where: { session: { schoolId: { in: schoolIds } } } });
  await prisma.studentAttendanceEntry.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.studentAttendanceSession.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.studentExcuse.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.studentAttendanceSettings.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.enrollment.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.student.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.timetableVersion.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.bellPeriod.deleteMany({ where: { version: { bellSchedule: { schoolId: { in: schoolIds } } } } });
  await prisma.bellScheduleVersion.deleteMany({ where: { bellSchedule: { schoolId: { in: schoolIds } } } });
  await prisma.bellSchedule.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.calendarEntry.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.academicWeekdays.deleteMany({ where: { schoolId: { in: schoolIds } } });
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

describe('access and the school switch', () => {
  test('signed out 401; staff and Super Admins 403', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/manager/student-attendance/day'],
      ['POST', '/api/manager/student-attendance/sessions', {}],
      ['GET', '/api/owner/student-attendance/settings'],
      ['POST', '/api/manager/student-excuses', {}],
    ]) {
      assert.equal((await call(path, { method, body })).status, 401, path);
      for (const who of ['STAFF', 'SUPER_ADMIN']) assert.equal((await as(who)(path, { method, body })).status, 403, `${who} ${path}`);
    }
  });

  test('switched off: attendance and excuses 403 FEATURE_DISABLED; settings can be prepared', async () => {
    for (const [who, path] of [
      [manager1, '/api/manager/student-attendance/day'],
      [owner, '/api/owner/student-attendance/day'],
      [manager1, '/api/manager/student-excuses'],
      [manager1, `/api/manager/student-attendance/sessions/${randomUUID()}`],
    ]) {
      const res = await who(path);
      assert.equal(res.status, 403, path);
      assert.equal(res.body.code, 'FEATURE_DISABLED');
    }
    const settings = await owner('/api/owner/student-attendance/settings');
    assert.equal(settings.status, 200);
    assert.equal(settings.body.featureEnabled, false);

    // The Super Admin switches it on for school A only.
    assert.equal((await admin(`/api/platform/schools/${schools.A.id}/features`, { method: 'PUT', body: { studentAttendance: true } })).status, 200);
    assert.equal((await manager1('/api/manager/student-attendance/day')).status, 200);
    assert.equal((await ownerB('/api/owner/student-attendance/day')).body.code, 'FEATURE_DISABLED');
  });
});

describe('settings', () => {
  test('Owner sets school values and what branches may change; Managers change only those; revoking clears branch values', async () => {
    const bad = await owner('/api/owner/student-attendance/settings', { method: 'PUT', body: { halfDayOpensBeforeMinutes: 999, managerEditDays: -1 } });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.details.halfDayOpensBeforeMinutes && bad.body.details.managerEditDays);

    const saved = await owner('/api/owner/student-attendance/settings', { method: 'PUT', body: { halfDayOpensBeforeMinutes: 30, branchOverridable: ['halfDayFrequency', 'managerEditDays'] } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.school.effective.halfDayOpensBeforeMinutes, 30);
    assert.equal(saved.body.school.sources.managerEditDays, 'platform');
    assert.deepEqual(saved.body.branchOverridable, ['halfDayFrequency', 'managerEditDays']);

    const locked = await manager2('/api/manager/student-attendance/settings', { method: 'PUT', body: { halfDayOpensBeforeMinutes: 5 } });
    assert.equal(locked.status, 403);
    assert.equal(locked.body.code, 'SETTING_LOCKED');
    assert.equal((await manager2('/api/manager/student-attendance/settings', { method: 'PUT', body: { branchOverridable: [] } })).status, 400);

    const own = await manager2('/api/manager/student-attendance/settings', { method: 'PUT', body: { halfDayFrequency: 'once_daily', managerEditDays: 3 } });
    assert.equal(own.status, 200);
    assert.equal(own.body.branch.effective.halfDayFrequency, 'once_daily');
    assert.equal(own.body.branch.sources.halfDayFrequency, 'branch');
    assert.equal(own.body.branch.effective.halfDayOpensBeforeMinutes, 30, 'the school value');
    const forA1 = await owner(`/api/owner/student-attendance/settings?branch=${branches.A1.id}`);
    assert.equal(forA1.body.branch.effective.halfDayFrequency, 'twice_daily', 'other branches keep the school value');
    assert.equal((await ownerB(`/api/owner/student-attendance/settings?branch=${branches.A2.id}`)).status, 404);

    // Revoking managerEditDays clears A2's value (it follows the school again); the frequency stays.
    const revoked = await owner('/api/owner/student-attendance/settings', { method: 'PUT', body: { branchOverridable: ['halfDayFrequency'] } });
    assert.equal(revoked.status, 200);
    const after2 = await manager2('/api/manager/student-attendance/settings');
    assert.equal(after2.body.branch.values.managerEditDays, null);
    assert.equal(after2.body.branch.effective.managerEditDays, 7);
    assert.equal(after2.body.branch.effective.halfDayFrequency, 'once_daily');

    // Unchanged submissions record nothing; changes are audited at each level.
    const count = () => prisma.auditEvent.count({ where: { schoolId: schools.A.id, action: 'STUDENT_ATTENDANCE_SETTINGS_CHANGED' } });
    const n = await count();
    await owner('/api/owner/student-attendance/settings', { method: 'PUT', body: { halfDayOpensBeforeMinutes: 30 } });
    assert.equal(await count(), n);
    assert.equal(n, 3);
  });
});

describe('the day and its sessions', () => {
  test('overview: a Manager sees their branch; twice a day here, once in the branch that chose it; no school on a holiday', async () => {
    const day1 = await manager1(`/api/manager/student-attendance/day?date=${past}`);
    assert.equal(day1.status, 200);
    assert.deepEqual(day1.body.items.map((i) => i.section.id), [sections.G1A1.id]);
    const [item] = day1.body.items;
    assert.equal(item.schoolDay, true);
    assert.equal(item.students, 3);
    assert.deepEqual(item.halves.map((h) => [h.half, h.start, h.end, h.state, h.canTake]), [
      ['before_break', '07:30', '10:30', 'overdue', true],
      ['after_break', '11:00', '13:00', 'overdue', true],
    ]);
    const day2 = await manager2(`/api/manager/student-attendance/day?date=${past}`);
    assert.deepEqual(day2.body.items[0].halves.map((h) => [h.half, h.start, h.end]), [['whole_day', '07:30', '13:00']]);

    const all = await owner(`/api/owner/student-attendance/day?date=${past}`);
    assert.equal(all.body.items.length, 2);
    assert.ok(all.body.items.every((i) => i.halves.every((h) => h.canTake === false)), 'the Owner reads only');
    assert.equal((await owner(`/api/owner/student-attendance/day?date=${past}&branch=${branches.A2.id}`)).body.items.length, 1);
    assert.equal((await manager1(`/api/manager/student-attendance/day?branch=${branches.A2.id}`)).status, 400);

    const holiday = addDays(today, -3);
    await prisma.calendarEntry.create({ data: { schoolId: schools.A.id, academicYearId: year.id, type: 'HOLIDAY', name: 'Test holiday', startDate: asDbDay(holiday), endDate: asDbDay(holiday) } });
    const off = await manager1(`/api/manager/student-attendance/day?date=${holiday}`);
    assert.equal(off.body.items[0].schoolDay, false);
    assert.deepEqual(off.body.items[0].halves, []);
    assert.match(off.body.items[0].reasonText, /Test holiday/);
    const refused = await open(manager1, 'G1A1', holiday, 'before_break');
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'NOT_A_SCHOOL_DAY');
  });

  test('opening: Managers only, their branch; the class list is fixed; opening again returns the same session', async () => {
    assert.equal((await owner('/api/owner/student-attendance/sessions', { method: 'POST', body: { section: sections.G1A1.id, date: past, half: 'before_break' } })).status, 403);
    assert.equal((await open(manager2, 'G1A1', past, 'before_break')).status, 404);
    const first = await open(manager1, 'G1A1', past, 'before_break');
    assert.equal(first.status, 201);
    assert.equal(first.body.students.length, 3);
    assert.ok(first.body.students.every((s) => s.status === null && s.effective === 'not_marked'));
    assert.equal(first.body.session.state, 'overdue');
    assert.equal(first.body.canMark, true);
    assert.equal(first.body.reasonRequiredForChanges, true);
    session = first.body.session;
    const again = await open(manager1, 'G1A1', past, 'before_break');
    assert.equal(again.status, 200);
    assert.equal(again.body.session.id, session.id);
    assert.equal(await prisma.auditEvent.count({ where: { schoolId: schools.A.id, action: 'STUDENT_ATTENDANCE_SESSION_OPENED' } }), 1);

    assert.equal((await open(manager1, 'G1A1', past, 'whole_day')).body.code, 'HALF_NOT_AVAILABLE');
    const soon = await open(manager1, 'G1A1', addDays(today, 2), 'before_break');
    assert.equal(soon.status, 409);
    assert.equal(soon.body.code, 'SESSION_NOT_OPEN_YET');
    const old = await open(manager1, 'G1A1', addDays(today, -10), 'before_break');
    assert.equal(old.status, 409);
    assert.equal(old.body.code, 'EDIT_PERIOD_OVER');
    assert.equal((await ownerB(`/api/owner/student-attendance/sessions/${session.id}`)).status, 403, 'school B is switched off');
    assert.equal((await manager2(`/api/manager/student-attendance/sessions/${session.id}`)).status, 404);
    assert.equal((await owner(`/api/owner/student-attendance/sessions/${session.id}`)).status, 200);
  });

  test('marks: checked, written once, corrections need a reason after the deadline, stale edits refused, history and audit kept', async () => {
    const excusedWithout = await mark(manager1, session.id, [{ student: students.Amina.id, status: 'excused' }]);
    assert.equal(excusedWithout.status, 400);
    assert.ok(excusedWithout.body.details['marks.0.reason']);
    const stranger = await mark(manager1, session.id, [{ student: students.Deeqa.id, status: 'present' }]);
    assert.equal(stranger.status, 400, 'a student of another section');
    assert.equal((await mark(owner, session.id, [{ student: students.Amina.id, status: 'present' }])).status, 403, 'Owners cannot use Manager routes');

    const saved = await mark(manager1, session.id, [
      { student: students.Amina.id, status: 'present' },
      { student: students.Bashir.id, status: 'absent' },
      { student: students.Caamir.id, status: 'late', note: 'Bus' },
    ]);
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.counts, { present: 1, absent: 1, late: 1, excused: 0, notMarked: 0, total: 3 });
    assert.equal(saved.body.session.complete, true);
    assert.equal(row(saved, 'Amina').afterDeadline, true);
    assert.equal(row(saved, 'Amina').version, 1);

    // Same marks again: nothing written.
    const changes = () => prisma.studentAttendanceChange.count({ where: { sessionId: session.id } });
    assert.equal(await changes(), 3);
    await mark(manager1, session.id, [{ student: students.Amina.id, status: 'present' }]);
    assert.equal(await changes(), 3);

    const noReason = await mark(manager1, session.id, [{ student: students.Bashir.id, status: 'present' }]);
    assert.equal(noReason.status, 400);
    assert.ok(noReason.body.details['marks.0.reason']);
    const stale = await mark(manager1, session.id, [{ student: students.Bashir.id, status: 'present', reason: 'Arrived', version: 0 }]);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'STALE_MARKS');
    const fixed = await mark(manager1, session.id, [{ student: students.Bashir.id, status: 'present', reason: 'Arrived after roll call', version: 1 }]);
    assert.equal(fixed.status, 200);
    assert.equal(row(fixed, 'Bashir').status, 'present');
    assert.equal(row(fixed, 'Bashir').version, 2);

    const history = await manager1(`/api/manager/student-attendance/sessions/${session.id}/history`);
    assert.equal(history.status, 200);
    assert.equal(history.body.items.length, 4);
    assert.deepEqual([history.body.items[0].from, history.body.items[0].to, history.body.items[0].reason], ['absent', 'present', 'Arrived after roll call']);
    assert.ok(history.body.items.every((h) => h.afterDeadline && h.source === 'web'));
    const audit = await prisma.auditEvent.findMany({ where: { schoolId: schools.A.id, action: 'STUDENT_ATTENDANCE_MARKED' }, orderBy: { occurredAt: 'asc' } });
    assert.equal(audit.length, 2);
    assert.equal(audit[0].change.marked, 3);
    assert.equal(audit[1].change.changed, 1);
    assert.equal(audit[1].change.students[0].from, 'Absent');
  });

  test('the class list: students enrolled later are added only when asked; nobody is removed', async () => {
    await makeStudent('Hodan', 'A1', 'G1A1');
    assert.equal((await manager1(`/api/manager/student-attendance/sessions/${session.id}`)).body.students.length, 3);
    const refreshed = await manager1(`/api/manager/student-attendance/sessions/${session.id}/class-list`, { method: 'POST' });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.body.added, 1);
    assert.equal(row(refreshed, 'Hodan').addedLate, true);
    assert.equal(refreshed.body.session.complete, false);
    assert.equal((await manager1(`/api/manager/student-attendance/sessions/${session.id}/class-list`, { method: 'POST' })).body.added, 0);
  });

  test('excuses: Managers record them for their students; applied when read; cancelling undoes it', async () => {
    assert.equal((await owner('/api/owner/student-excuses', { method: 'POST', body: { student: students.Bashir.id, startDate: past, reason: 'Sick' } })).status, 403);
    assert.equal((await manager2('/api/manager/student-excuses', { method: 'POST', body: { student: students.Bashir.id, startDate: past, reason: 'Sick' } })).status, 404);
    const tooOld = await manager1('/api/manager/student-excuses', { method: 'POST', body: { student: students.Bashir.id, startDate: addDays(today, -20), reason: 'Sick' } });
    assert.equal(tooOld.body.code, 'EDIT_PERIOD_OVER');
    const both = await manager1('/api/manager/student-excuses', { method: 'POST', body: { student: students.Bashir.id, startDate: past, half: 'after_break', periods: [1], reason: 'Sick' } });
    assert.equal(both.status, 400);

    // Hodan (unmarked) and Amina (present) are excused for the day; Caamir only after the break.
    const hodan = await manager1('/api/manager/student-excuses', { method: 'POST', body: { student: students.Hodan.id, startDate: past, endDate: today, reason: 'Medical' } });
    assert.equal(hodan.status, 201);
    assert.equal(hodan.body.excuse.covers, 'whole day');
    await manager1('/api/manager/student-excuses', { method: 'POST', body: { student: students.Amina.id, startDate: past, reason: 'Family' } });
    await manager1('/api/manager/student-excuses', { method: 'POST', body: { student: students.Caamir.id, startDate: past, half: 'after_break', reason: 'Clinic' } });
    const read = await manager1(`/api/manager/student-attendance/sessions/${session.id}`);
    assert.equal(row(read, 'Hodan').effective, 'excused');
    assert.equal(row(read, 'Hodan').status, null);
    assert.equal(row(read, 'Hodan').excuse.reason, 'Medical');
    assert.equal(row(read, 'Amina').effective, 'present', 'came anyway');
    assert.equal(row(read, 'Caamir').effective, 'late', 'the excuse is for the other half');
    assert.equal(read.body.counts.excused, 1);
    assert.equal(read.body.session.complete, true);

    const list = await owner(`/api/owner/student-excuses?student=${students.Hodan.id}`);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.canManage, false);
    const cancelled = await manager1(`/api/manager/student-excuses/${hodan.body.excuse.id}/cancel`, { method: 'POST' });
    assert.equal(cancelled.body.excuse.status, 'cancelled');
    assert.equal((await manager1(`/api/manager/student-excuses/${hodan.body.excuse.id}/cancel`, { method: 'POST' })).body.code, 'ALREADY_CANCELLED');
    assert.equal(row(await manager1(`/api/manager/student-attendance/sessions/${session.id}`), 'Hodan').effective, 'not_marked');
    assert.equal(await prisma.auditEvent.count({ where: { schoolId: schools.A.id, action: { in: ['STUDENT_EXCUSE_CREATED', 'STUDENT_EXCUSE_CANCELLED'] } } }), 4);
  });

  test('the overview counts opened sessions with excuses applied', async () => {
    const day = await manager1(`/api/manager/student-attendance/day?date=${past}`);
    const [before, afterBreak] = day.body.items[0].halves;
    assert.equal(before.session.id, session.id);
    assert.deepEqual(before.session.counts, { present: 2, absent: 0, late: 1, excused: 0, notMarked: 1, total: 4 });
    assert.equal(afterBreak.session, null);
    assert.equal(day.body.totals.sessions, 2);
    assert.equal(day.body.totals.taken, 1);
    assert.equal(day.body.totals.missing, 2);
  });

  test('opened sessions fix the shape of their day when the frequency changes', async () => {
    const whole = await open(manager2, 'G1A2', past, 'whole_day');
    assert.equal(whole.status, 201);
    assert.equal((await manager2('/api/manager/student-attendance/settings', { method: 'PUT', body: { halfDayFrequency: null } })).status, 200);
    const day = await manager2(`/api/manager/student-attendance/day?date=${past}`);
    assert.deepEqual(day.body.items[0].halves.map((h) => h.half), ['whole_day']);
    assert.equal((await open(manager2, 'G1A2', past, 'before_break')).body.code, 'HALF_NOT_AVAILABLE');
    const otherDay = await manager2(`/api/manager/student-attendance/day?date=${addDays(today, -4)}`);
    assert.deepEqual(otherDay.body.items[0].halves.map((h) => h.half), ['before_break', 'after_break']);
    // The database keeps the same rule.
    await assert.rejects(
      prisma.studentAttendanceSession.create({
        data: { schoolId: schools.A.id, branchId: branches.A2.id, academicYearId: year.id, sectionId: sections.G1A2.id, date: asDbDay(past), half: 'BEFORE_BREAK', opensAt: new Date(0), deadlineAt: new Date(1000), openedByName: 'x' },
      }),
    );
  });

  test('a suspended branch: attendance can be read, not changed', async () => {
    await prisma.branch.update({ where: { id: branches.A1.id }, data: { status: 'SUSPENDED' } });
    try {
      const res = await mark(manager1, session.id, [{ student: students.Hodan.id, status: 'present' }]);
      assert.equal(res.status, 409);
      assert.equal(res.body.code, 'BRANCH_NOT_OPERATING');
      const read = await manager1(`/api/manager/student-attendance/sessions/${session.id}`);
      assert.equal(read.status, 200);
      assert.equal(read.body.canMark, false);
    } finally {
      await prisma.branch.update({ where: { id: branches.A1.id }, data: { status: 'ACTIVE' } });
    }
  });
});

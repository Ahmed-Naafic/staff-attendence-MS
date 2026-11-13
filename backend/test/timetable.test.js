/*
 * Bell schedules, section timetables and the lessons of a day (docs/business-rules.md → Bell
 * schedules; Timetables), and extra school days in the calendar: Owner and Manager scope (school-wide
 * schedules are the Owner's; Managers their branch's), versions from today (a day under way keeps its
 * times), replacing and cancelling scheduled versions, period/subject/teacher checks, teacher clashes
 * across sections, branches and bell schedules (also when bell times change), the halves of a day,
 * make-up days following another weekday's timetable, isolation between schools, audit.
 * Runs on the Neon dev branch (`npm test`); everything it creates is removed afterwards.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { calendarToday } from '../src/features/academic-calendar/calendar.service.js';
import { addDays, asDbDay, weekdayOf } from '../src/features/academic-calendar/schoolDays.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Timetable tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const ALL = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
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

/** A standard day on every weekday: 1 07:30–08:15, 2 08:15–09:00, main break 09:00–09:30, 3 09:30–10:15. */
const standard = [
  { kind: 'lesson', number: 1, days: ALL, start: '07:30', end: '08:15' },
  { kind: 'lesson', number: 2, days: ALL, start: '08:15', end: '09:00' },
  { kind: 'break', name: 'Break', days: ALL, start: '09:00', end: '09:30', mainBreak: true },
  { kind: 'lesson', number: 3, days: ALL, start: '09:30', end: '10:15' },
];
const setTimes = (who, role, id, periods, effectiveFrom = today) => who(`/api/${role}/bell-schedules/${id}/times`, { method: 'PUT', body: { effectiveFrom, periods } });
const saveTimetable = (who, role, sectionId, body) => who(`/api/${role}/sections/${sectionId}/timetable`, { method: 'PUT', body: { effectiveFrom: today, ...body } });
const lesson = (weekday, period, subject, teacher) => ({ weekday, period, subject: subjects[subject].id, ...(teacher && { teacher: staff[teacher].id }) });

async function makeStaff(key, branch, n) {
  const unique = randomBytes(4).toString('hex');
  staff[key] = await prisma.user.create({
    data: {
      name: `${key} ${tag}`,
      email: `test-tt-${key.toLowerCase()}-${lower}@test.edutrack.example`,
      role: 'STAFF',
      branchId: branch.id,
      staffId: `${branch.code}-ST${String(n).padStart(3, '0')}`,
      jobTitle: 'Teacher',
      phoneKey: `+997${parseInt(unique, 16)}`,
      phone: `+997${parseInt(unique, 16)}`,
    },
  });
}

const teach = (teacher, section, subject) =>
  prisma.teachingAssignment.create({
    data: { schoolId: schools.A.id, academicYearId: year.id, branchId: sections[section].branchId, sectionId: sections[section].id, teacherId: staff[teacher].id, role: 'SUBJECT_TEACHER', subjectId: subjects[subject].id, startDate: asDbDay(addDays(today, -30)) },
  });

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  today = await calendarToday();
  tomorrow = addDays(today, 1);

  for (const key of ['A', 'B']) {
    schools[key] = await prisma.school.create({ data: { code: `TTT${tag}-${key}`, name: `Timetable Test ${key} ${tag}`, location: 'Mogadishu', phone: '+252 61 1234567', address: 'Road 1' } });
  }
  const branch = (key, school, number) =>
    prisma.branch.create({ data: { schoolId: schools[school].id, number, code: `TTT${tag}-${key}`, name: `Branch ${key}`, nameKey: `branch ${key.toLowerCase()} ${lower}`, address: 'Road', city: 'Mogadishu' } });
  branches.A1 = await branch('A1', 'A', 1);
  branches.A2 = await branch('A2', 'A', 2);
  branches.B = await branch('B1', 'B', 1);

  year = await prisma.academicYear.create({
    data: { schoolId: schools.A.id, name: `Y ${tag}`, nameKey: `y ${lower}`, startDate: asDbDay(addDays(today, -30)), endDate: asDbDay(addDays(today, 200)), status: 'CURRENT', startedAt: new Date() },
  });
  // School every day of the week, so the tests do not depend on today's weekday.
  await prisma.academicWeekdays.create({ data: { schoolId: schools.A.id, academicYearId: year.id, days: ALL, effectiveFrom: asDbDay(addDays(today, -30)) } });
  classes.G1 = await prisma.schoolClass.create({ data: { schoolId: schools.A.id, name: 'Grade 1', nameKey: 'grade 1', sequence: 1 } });
  classes.G2 = await prisma.schoolClass.create({ data: { schoolId: schools.A.id, name: 'Grade 2', nameKey: 'grade 2', sequence: 2 } });
  const section = (cls, branchKey) =>
    prisma.section.create({ data: { schoolId: schools.A.id, branchId: branches[branchKey].id, classId: classes[cls].id, academicYearId: year.id, name: 'A', nameKey: 'a', room: 'R1' } });
  sections.G1A1 = await section('G1', 'A1');
  sections.G2A1 = await section('G2', 'A1');
  sections.G1A2 = await section('G1', 'A2');
  for (const name of ['Maths', 'Science', 'Art']) {
    subjects[name] = await prisma.subject.create({ data: { schoolId: schools.A.id, name, nameKey: name.toLowerCase() } });
  }
  // Grade 1 studies Maths and Science only; Grade 2 has no list (any active subject).
  for (const name of ['Maths', 'Science']) await prisma.classSubject.create({ data: { schoolId: schools.A.id, classId: classes.G1.id, subjectId: subjects[name].id, weeklyLessons: 5 } });

  await makeStaff('T1', branches.A1, 1);
  await makeStaff('T2', branches.A1, 2);
  await makeStaff('T3', branches.A2, 3);
  await teach('T1', 'G1A1', 'Maths');
  await teach('T1', 'G2A1', 'Maths');
  await teach('T1', 'G1A2', 'Maths');
  await teach('T2', 'G1A1', 'Science');
  await teach('T3', 'G1A2', 'Science');

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
    const email = `test-tt-${key.toLowerCase().replace('_', '-')}-${lower}@test.edutrack.example`;
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
  await prisma.timetableSlot.deleteMany({ where: { version: { schoolId: { in: schoolIds } } } });
  await prisma.timetableVersion.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.bellPeriod.deleteMany({ where: { version: { bellSchedule: { schoolId: { in: schoolIds } } } } });
  await prisma.bellScheduleVersion.deleteMany({ where: { bellSchedule: { schoolId: { in: schoolIds } } } });
  await prisma.bellSchedule.deleteMany({ where: { schoolId: { in: schoolIds } } });
  await prisma.calendarEntry.deleteMany({ where: { schoolId: { in: schoolIds } } });
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
  test('signed out 401; staff and Super Admins 403', async () => {
    for (const [method, path, body] of [
      ['GET', '/api/owner/bell-schedules'],
      ['POST', '/api/manager/bell-schedules', { name: 'X' }],
      ['GET', '/api/owner/timetables'],
      ['PUT', `/api/manager/sections/${randomUUID()}/timetable`, {}],
    ]) {
      assert.equal((await call(path, { method, body })).status, 401, path);
      for (const who of ['STAFF', 'SUPER_ADMIN']) assert.equal((await as(who)(path, { method, body })).status, 403, `${who} ${path}`);
    }
  });
});

describe('bell schedules', () => {
  test('Owner: school-wide; Manager: their branch only; names unique per level; other schools and branches see nothing', async () => {
    const created = await owner('/api/owner/bell-schedules', { method: 'POST', body: { name: '  Morning ' } });
    assert.equal(created.status, 201);
    assert.equal(created.body.bellSchedule.level, 'school');
    assert.equal(created.body.bellSchedule.name, 'Morning');
    bells.morning = created.body.bellSchedule;
    assert.equal((await owner('/api/owner/bell-schedules', { method: 'POST', body: { name: 'MORNING' } })).body.code, 'NAME_TAKEN');

    const own = await manager1('/api/manager/bell-schedules', { method: 'POST', body: { name: 'Morning' } });
    assert.equal(own.status, 201, 'the same name at another level is fine');
    assert.equal(own.body.bellSchedule.level, 'branch');
    assert.equal(own.body.bellSchedule.branch.id, branches.A1.id);
    bells.branchA1 = own.body.bellSchedule;
    assert.equal((await manager1('/api/manager/bell-schedules', { method: 'POST', body: { name: 'X', branch: branches.A2.id } })).status, 400);

    const list1 = await manager1('/api/manager/bell-schedules');
    assert.deepEqual(new Set(list1.body.items.map((b) => b.id)), new Set([bells.morning.id, bells.branchA1.id]));
    assert.equal(list1.body.items.find((b) => b.id === bells.morning.id).canManage, false);
    assert.equal((await manager2(`/api/manager/bell-schedules/${bells.branchA1.id}`)).status, 404);
    assert.equal((await ownerB(`/api/owner/bell-schedules/${bells.morning.id}`)).status, 404);
    assert.equal((await manager1(`/api/manager/bell-schedules/${bells.morning.id}`, { method: 'PATCH', body: { name: 'Mine' } })).status, 403);
    assert.equal((await setTimes(manager1, 'manager', bells.morning.id, standard)).status, 403);
    assert.equal((await owner(`/api/owner/bell-schedules/${bells.branchA1.id}`, { method: 'PATCH', body: { description: 'Owner can edit branch ones' } })).status, 200);
  });

  test('times: checked per weekday; from today; a day under way keeps its times; same date replaces', async () => {
    const bad = await setTimes(owner, 'owner', bells.morning.id, [
      { kind: 'lesson', number: 1, days: ['MON'], start: '07:30', end: '08:15' },
      { kind: 'lesson', number: 2, days: ['MON'], start: '08:00', end: '08:45' },
      { kind: 'break', number: 3, days: ['MON'], start: '09:00', end: '09:10' },
    ]);
    assert.equal(bad.status, 400);
    assert.ok(bad.body.details['periods.2'], 'a break has no number');
    const overlap = await setTimes(owner, 'owner', bells.morning.id, standard.map((p, i) => (i === 1 ? { ...p, start: '08:00' } : p)));
    assert.match(overlap.body.details['periods.1'], /overlaps/);
    assert.equal((await setTimes(owner, 'owner', bells.morning.id, standard, addDays(today, -1))).status, 400, 'not before today');

    const saved = await setTimes(owner, 'owner', bells.morning.id, standard);
    assert.equal(saved.status, 200);
    assert.equal(saved.body.bellSchedule.current.summary.MON.halves, 2);
    assert.equal(saved.body.bellSchedule.current.summary.MON.lessons, 3);
    // Started today: a correction for today replaces it.
    const fixed = await setTimes(owner, 'owner', bells.morning.id, [...standard, { kind: 'lesson', number: 4, days: ALL, start: '10:15', end: '11:00' }]);
    assert.equal(fixed.status, 200);
    assert.deepEqual(fixed.body.bellSchedule.versions.map((v) => v.state), ['cancelled', 'current']);
    // Unchanged: nothing written.
    const again = await setTimes(owner, 'owner', bells.morning.id, [...standard, { kind: 'lesson', number: 4, days: ALL, start: '10:15', end: '11:00' }]);
    assert.equal(again.body.bellSchedule.versions.length, 2);

    // A schedule whose times started before today: changes start tomorrow at the earliest.
    const old = await manager1(`/api/manager/bell-schedules`, { method: 'POST', body: { name: 'Old' } });
    const v = await prisma.bellScheduleVersion.create({ data: { bellScheduleId: old.body.bellSchedule.id, effectiveFrom: asDbDay(addDays(today, -3)) } });
    await prisma.bellPeriod.create({ data: { versionId: v.id, kind: 'LESSON', number: 1, days: ALL, startMinute: 420, endMinute: 465 } });
    const todayChange = await setTimes(manager1, 'manager', old.body.bellSchedule.id, standard);
    assert.equal(todayChange.status, 400);
    assert.match(todayChange.body.details.effectiveFrom, new RegExp(tomorrow));
    const later = await setTimes(manager1, 'manager', old.body.bellSchedule.id, standard, addDays(today, 5));
    assert.equal(later.status, 200);
    const scheduled = later.body.bellSchedule.versions.find((x) => x.state === 'scheduled');
    assert.equal((await manager1(`/api/manager/bell-schedules/${old.body.bellSchedule.id}/times/${v.id}/cancel`, { method: 'POST' })).body.code, 'VERSION_IN_EFFECT');
    const cancelled = await manager1(`/api/manager/bell-schedules/${old.body.bellSchedule.id}/times/${scheduled.id}/cancel`, { method: 'POST' });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.bellSchedule.versions.find((x) => x.id === scheduled.id).state, 'cancelled');

    const audits = await prisma.auditEvent.count({ where: { schoolId: schools.A.id, action: { in: ['BELL_TIMES_CHANGED', 'BELL_TIMES_CHANGE_CANCELLED'] } } });
    assert.equal(audits, 4);
  });
});

describe('timetables', () => {
  test('periods, subjects and teachers are checked; a teacher must teach the subject in the section', async () => {
    const noTimes = await saveTimetable(manager1, 'manager', sections.G1A1.id, { bellSchedule: bells.branchA1.id, lessons: [] });
    assert.equal(noTimes.body.code, 'BELL_TIMES_MISSING');
    const res = await saveTimetable(manager1, 'manager', sections.G1A1.id, {
      bellSchedule: bells.morning.id,
      lessons: [lesson('MON', 9, 'Maths'), lesson('MON', 1, 'Art'), lesson('TUE', 1, 'Science', 'T1'), lesson('WED', 1, 'Maths', 'T1')],
    });
    assert.equal(res.status, 400);
    assert.match(res.body.details['lessons.0'], /no period 9/);
    assert.match(res.body.details['lessons.1'], /not one of Grade 1's subjects/);
    assert.match(res.body.details['lessons.2'], /does not teach Science/);
    assert.equal(res.body.details['lessons.3'], undefined);
    assert.equal((await saveTimetable(manager1, 'manager', sections.G1A1.id, { bellSchedule: bells.morning.id, lessons: [lesson('MON', 1, 'Maths'), lesson('MON', 1, 'Science')] })).status, 400, 'one lesson per period');
  });

  test('Manager sets their section’s timetable; other branches and schools cannot see it; the overview lists it', async () => {
    const lessons = ALL.flatMap((d) => [lesson(d, 1, 'Maths', 'T1'), lesson(d, 2, 'Science', 'T2'), lesson(d, 3, 'Maths')]);
    const res = await saveTimetable(manager1, 'manager', sections.G1A1.id, { bellSchedule: bells.morning.id, lessons });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.selected.lessons.length, 21);
    assert.equal(res.body.selected.state, 'current');
    assert.equal(res.body.subjects.find((s) => s.subject.name === 'Maths').timetabled, 14);
    assert.equal(res.body.subjects.find((s) => s.subject.name === 'Maths').weeklyLessons, 5);
    assert.equal((await manager2(`/api/manager/sections/${sections.G1A1.id}/timetable`)).status, 404);
    assert.equal((await ownerB(`/api/owner/sections/${sections.G1A1.id}/timetable`)).status, 404);
    const overview = await owner(`/api/owner/timetables?branch=${branches.A1.id}`);
    const row = overview.body.items.find((i) => i.section.id === sections.G1A1.id);
    assert.equal(row.timetable.lessons, 21);
    assert.equal(row.timetable.bellSchedule.name, 'Morning');
    assert.equal(overview.body.items.find((i) => i.section.id === sections.G2A1.id).timetable, null);
    assert.equal(await prisma.auditEvent.count({ where: { schoolId: schools.A.id, action: 'TIMETABLE_CHANGED' } }), 1);
  });

  test('a teacher cannot be in two sections at once — across sections, branches and bell schedules', async () => {
    const clash = await saveTimetable(manager1, 'manager', sections.G2A1.id, { bellSchedule: bells.morning.id, lessons: [lesson('MON', 1, 'Maths', 'T1')] });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.code, 'TEACHER_CLASH');
    assert.match(clash.body.error, /T1/);
    assert.equal(clash.body.details.clashes[0].a.sectionId, sections.G2A1.id);

    // Another branch's bell schedule with different times: 08:00–08:40 overlaps period 1 and 2 of Morning.
    const a2 = await owner('/api/owner/bell-schedules', { method: 'POST', body: { name: 'Shifted', branch: branches.A2.id } });
    bells.shifted = a2.body.bellSchedule;
    await setTimes(owner, 'owner', bells.shifted.id, [
      { kind: 'lesson', number: 1, days: ALL, start: '11:00', end: '11:40' },
      { kind: 'lesson', number: 2, days: ALL, start: '11:40', end: '12:20' },
    ]);
    const ok = await saveTimetable(owner, 'owner', sections.G1A2.id, { bellSchedule: bells.shifted.id, lessons: [lesson('MON', 1, 'Maths', 'T1'), lesson('MON', 2, 'Science', 'T3')] });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    // Manager 1 cannot use another branch's schedule.
    assert.equal((await saveTimetable(manager1, 'manager', sections.G2A1.id, { bellSchedule: bells.shifted.id, lessons: [] })).status, 404);

    // Moving Shifted earlier from next week would put T1 in two places on Mondays.
    const next = addDays(today, 7);
    const moved = await setTimes(owner, 'owner', bells.shifted.id, [{ kind: 'lesson', number: 1, days: ALL, start: '08:00', end: '08:40' }], next);
    assert.equal(moved.status, 409);
    assert.equal(moved.body.code, 'TEACHER_CLASH');
    assert.equal(moved.body.details.clashes[0].from, next);
    // Dropping period 2 is allowed, with a warning about the lessons that no longer take place.
    const dropped = await setTimes(owner, 'owner', bells.shifted.id, [{ kind: 'lesson', number: 1, days: ALL, start: '11:00', end: '11:40' }], next);
    assert.equal(dropped.status, 200);
    assert.equal(dropped.body.warnings.length, 1);
    assert.match(dropped.body.warnings[0].message, /1 lesson/);
  });

  test('scheduled versions: from tomorrow when today’s started earlier, replace on the same date, cancel before they start', async () => {
    // Make today's version have started yesterday.
    const current = await prisma.timetableVersion.findFirst({ where: { sectionId: sections.G1A1.id, cancelledAt: null } });
    await prisma.timetableVersion.update({ where: { id: current.id }, data: { effectiveFrom: asDbDay(addDays(today, -1)) } });

    const sameDay = await saveTimetable(manager1, 'manager', sections.G1A1.id, { bellSchedule: bells.morning.id, lessons: [] });
    assert.equal(sameDay.status, 400);
    assert.match(sameDay.body.details.effectiveFrom, new RegExp(tomorrow));
    const first = await saveTimetable(manager1, 'manager', sections.G1A1.id, { effectiveFrom: addDays(today, 3), bellSchedule: bells.morning.id, lessons: [lesson('MON', 1, 'Maths', 'T1')] });
    assert.equal(first.status, 200);
    const second = await saveTimetable(manager1, 'manager', sections.G1A1.id, { effectiveFrom: addDays(today, 3), bellSchedule: bells.morning.id, lessons: [lesson('MON', 1, 'Maths')] });
    assert.equal(second.status, 200);
    const states = second.body.versions.map((v) => v.state);
    assert.deepEqual(states, ['current', 'cancelled', 'scheduled']);
    const scheduled = second.body.versions.find((v) => v.state === 'scheduled');
    assert.equal(second.body.versions.find((v) => v.state === 'current').to, addDays(today, 2));

    assert.equal((await manager1(`/api/manager/sections/${sections.G1A1.id}/timetable/${current.id}/cancel`, { method: 'POST' })).body.code, 'VERSION_IN_EFFECT');
    const cancelled = await manager1(`/api/manager/sections/${sections.G1A1.id}/timetable/${scheduled.id}/cancel`, { method: 'POST' });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.versions.find((v) => v.state === 'current').to, toDayEnd());
    assert.equal((await manager2(`/api/manager/sections/${sections.G1A1.id}/timetable/${scheduled.id}/cancel`, { method: 'POST' })).status, 404);
  });

  test('simultaneous saves for the same date leave one active version', async () => {
    const date = addDays(today, 10);
    const body = { effectiveFrom: date, bellSchedule: bells.morning.id, lessons: [] };
    const results = await Promise.all([saveTimetable(manager1, 'manager', sections.G2A1.id, body), saveTimetable(owner, 'owner', sections.G2A1.id, { ...body, lessons: [lesson('TUE', 1, 'Art')] })]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 200]);
    assert.equal(await prisma.timetableVersion.count({ where: { sectionId: sections.G2A1.id, effectiveFrom: asDbDay(date), cancelledAt: null } }), 1);
  });

  test('a bell schedule in use cannot be deactivated', async () => {
    const res = await owner(`/api/owner/bell-schedules/${bells.morning.id}/deactivate`, { method: 'POST' });
    assert.equal(res.body.code, 'BELL_SCHEDULE_IN_USE');
    const unused = await manager1(`/api/manager/bell-schedules/${bells.branchA1.id}/deactivate`, { method: 'POST' });
    assert.equal(unused.status, 200);
    assert.equal(unused.body.bellSchedule.status, 'inactive');
    assert.equal((await saveTimetable(manager1, 'manager', sections.G2A1.id, { effectiveFrom: addDays(today, 20), bellSchedule: bells.branchA1.id, lessons: [] })).body.code, 'BELL_SCHEDULE_INACTIVE');
  });
});

const toDayEnd = () => addDays(today, 200);

describe('lessons of a day and extra school days', () => {
  test('a section’s days: bell times, the two halves, lessons with their teachers', async () => {
    const res = await manager1(`/api/manager/sections/${sections.G1A1.id}/lessons?from=${today}&to=${today}`);
    assert.equal(res.status, 200);
    const [day] = res.body.days;
    assert.equal(day.schoolDay, true);
    assert.equal(day.timetableDay, weekdayOf(today));
    assert.deepEqual(day.halves.map((h) => [h.half, h.start, h.end]), [['before_break', '07:30', '09:00'], ['after_break', '09:30', '11:00']]);
    const p1 = day.periods.find((p) => p.number === 1);
    assert.equal(p1.lesson.subject.name, 'Maths');
    assert.equal(p1.lesson.teacher.id, staff.T1.id);
    assert.equal(day.periods.find((p) => p.number === 3).lesson.teacher, null);
  });

  test('a make-up day follows the weekday it names; a closure has no lessons; Managers add their branch’s own', async () => {
    const target = addDays(today, 1);
    // Use a weekday that has a different lesson: only MON has lessons in G1A2's timetable.
    const res = await manager2(`/api/manager/academic-years/${year.id}/calendar-entries`, { method: 'POST', body: { type: 'school_day', name: 'Make-up day', startDate: target, endDate: target, timetableDay: 'MON' } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.entry.timetableDay, 'MON');
    const days = await manager2(`/api/manager/sections/${sections.G1A2.id}/lessons?from=${target}&to=${target}`);
    assert.equal(days.body.days[0].timetableDay, 'MON');
    assert.equal(days.body.days[0].extraDay.level, 'branch');
    assert.equal(days.body.days[0].periods.find((p) => p.number === 1).lesson.subject.name, 'Maths');
    // Only an extra school day names a weekday; overlapping ones at one level are refused.
    assert.equal((await manager2(`/api/manager/academic-years/${year.id}/calendar-entries`, { method: 'POST', body: { type: 'closure', name: 'X', startDate: target, endDate: target, timetableDay: 'MON' } })).status, 400);
    assert.equal((await manager2(`/api/manager/academic-years/${year.id}/calendar-entries`, { method: 'POST', body: { type: 'school_day', name: 'Again', startDate: target, endDate: target, timetableDay: 'TUE' } })).body.code, 'DATES_OVERLAP');
    // The School Owner's school-wide one is not the Manager's to change.
    const school = await owner(`/api/owner/academic-years/${year.id}/calendar-entries`, { method: 'POST', body: { type: 'school_day', name: 'School swap', startDate: target, endDate: target, timetableDay: 'WED' } });
    assert.equal(school.status, 201);
    assert.equal(school.body.entry.branch, null);
    assert.equal((await manager2(`/api/manager/calendar-entries/${school.body.entry.id}/cancel`, { method: 'POST' })).status, 403);
    // Branch A1 has no own extra day, so it follows the school's (WED).
    const a1 = await manager1(`/api/manager/sections/${sections.G1A1.id}/lessons?from=${target}&to=${target}`);
    assert.equal(a1.body.days[0].timetableDay, 'WED');

    await manager2(`/api/manager/academic-years/${year.id}/calendar-entries`, { method: 'POST', body: { type: 'closure', name: 'Flood', startDate: target, endDate: target } });
    const closed = await manager2(`/api/manager/sections/${sections.G1A2.id}/lessons?from=${target}&to=${target}`);
    assert.deepEqual([closed.body.days[0].schoolDay, closed.body.days[0].reason, closed.body.days[0].periods.length], [false, 'closure', 0]);
  });

  test('a teacher’s lessons across branches (Owner), only in the branch for its Manager', async () => {
    const monday = (() => {
      let d = today;
      while (weekdayOf(d) !== 'MON') d = addDays(d, 1);
      return d;
    })();
    const all = await owner(`/api/owner/teachers/${staff.T1.id}/lessons?from=${monday}&to=${monday}`);
    assert.equal(all.status, 200);
    const where = new Set(all.body.lessons.map((l) => l.section.branch.id));
    assert.ok(where.has(branches.A1.id) && where.has(branches.A2.id), 'both branches');
    const mine = await manager1(`/api/manager/teachers/${staff.T1.id}/lessons?from=${monday}&to=${monday}`);
    assert.ok(mine.body.lessons.every((l) => l.section.branch.id === branches.A1.id));
    assert.equal((await manager2(`/api/manager/teachers/${staff.T1.id}/lessons`)).status, 404, 'not their staff');
    assert.equal((await owner(`/api/owner/teachers/${staff.T1.id}/lessons?from=${today}&to=${addDays(today, 60)}`)).status, 400, 'at most 42 days');
  });
});

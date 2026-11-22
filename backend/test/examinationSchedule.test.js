/*
 * Examinations, phase 2 (docs/business-rules.md → Examinations → Examinations): drafts with papers
 * from the curriculum, scheduling onto the academic calendar, lessons stopping for the classes sitting
 * a scheduled examination that stops lessons (only in the branches holding it), overlaps, papers,
 * past days fixed (end early instead of cancel), Managers limited to their branch, isolation, audit.
 * Runs on the Neon dev branch (`npm test`); everything it creates is removed afterwards. It does not
 * change platform settings.
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
import { examActions, examState } from '../src/features/examinations/examinations.service.js';
import { loadSectionDays } from '../src/features/timetable/lessons.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Examination tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const cookies = {};
const schools = {};
const branches = {};
const classes = {};
const subjects = {};
const sections = {};
const types = {};
let year;
let period;
let server;
let base;
let today;
const T = (n) => addDays(today, n);

async function call(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(method !== 'GET' && { origin: ORIGIN }), ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const as = (who) => (path, options = {}) => call(path, { ...options, cookie: cookies[who] });
const owner = as('OWNER_A');
const ownerB = as('OWNER_B');
const manager1 = as('MANAGER_A1');
const manager2 = as('MANAGER_A2');
const staff = as('STAFF');
const O = '/api/owner/exams/examinations';
const M = '/api/manager/exams/examinations';

/** The day of `section` on `date` from the one place that decides lessons. */
async function dayOf(section, date) {
  const days = await loadSectionDays(schools.A.id, [{ id: section.id, branchId: section.branchId }], date, date);
  return days.get(section.id)[0];
}
const lessonsOf = (day) => day.periods.filter((p) => p.kind === 'LESSON' && p.lesson).length;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  today = await calendarToday();
  for (const key of ['A', 'B']) {
    schools[key] = await prisma.school.create({
      data: { code: `TEXS${tag}-${key}`, name: `Exam Schedule ${key} ${tag}`, location: 'Mogadishu', phone: '+252 61 1234567', address: 'Road 1', examinationsEnabled: key === 'A' },
    });
  }
  const branch = (key, school, number) =>
    prisma.branch.create({ data: { schoolId: schools[school].id, number, code: `TEXS${tag}-${key}`, name: `Branch ${key}`, nameKey: `branch ${key.toLowerCase()} ${lower}`, address: 'Road', city: 'Mogadishu' } });
  branches.A1 = await branch('A1', 'A', 1);
  branches.A2 = await branch('A2', 'A', 2);
  branches.B = await branch('B1', 'B', 1);
  const yearStart = T(-30);
  year = await prisma.academicYear.create({
    data: { schoolId: schools.A.id, name: `Y ${tag}`, nameKey: `y ${lower}`, startDate: asDbDay(yearStart), endDate: asDbDay(T(300)), status: 'CURRENT', startedAt: new Date() },
  });
  // Every day is a school day, so exam days are easy to pick.
  await prisma.academicWeekdays.create({ data: { schoolId: schools.A.id, academicYearId: year.id, days: ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'], effectiveFrom: asDbDay(yearStart) } });
  period = await prisma.academicPeriod.create({ data: { schoolId: schools.A.id, academicYearId: year.id, name: 'Term 1', nameKey: 'term 1', sequence: 1, startDate: asDbDay(yearStart), endDate: asDbDay(T(100)) } });
  types.mid = await prisma.examType.create({ data: { schoolId: schools.A.id, name: 'Mid-Term', nameKey: 'mid-term', defaultMaxMarks: 100, stopsLessons: true } });
  types.quiz = await prisma.examType.create({ data: { schoolId: schools.A.id, name: 'Quiz', nameKey: 'quiz', defaultMaxMarks: 20, stopsLessons: false } });
  for (const [key, seq] of [['G7', 1], ['G8', 2], ['G9', 3]]) {
    classes[key] = await prisma.schoolClass.create({ data: { schoolId: schools.A.id, name: `Grade ${key}`, nameKey: `grade ${key.toLowerCase()}`, sequence: seq } });
  }
  classes.OTHER = await prisma.schoolClass.create({ data: { schoolId: schools.B.id, name: 'Other', nameKey: 'other', sequence: 1 } });
  for (const key of ['Math', 'English', 'Science']) subjects[key] = await prisma.subject.create({ data: { schoolId: schools.A.id, name: key, nameKey: key.toLowerCase() } });
  await prisma.classSubject.createMany({
    data: [
      { schoolId: schools.A.id, classId: classes.G7.id, subjectId: subjects.Math.id },
      { schoolId: schools.A.id, classId: classes.G7.id, subjectId: subjects.English.id },
      { schoolId: schools.A.id, classId: classes.G8.id, subjectId: subjects.Math.id },
    ],
  });
  const section = (cls, branchKey, name) =>
    prisma.section.create({ data: { schoolId: schools.A.id, branchId: branches[branchKey].id, classId: classes[cls].id, academicYearId: year.id, name, nameKey: name.toLowerCase() } });
  sections.G7A = await section('G7', 'A1', 'A');
  sections.G7B = await section('G7', 'A2', 'B');
  sections.G8A = await section('G8', 'A1', 'A');
  // One lesson a day (period 1, Mathematics) in each section, under one school-wide bell schedule.
  const bell = await prisma.bellSchedule.create({ data: { schoolId: schools.A.id, name: 'Day', nameKey: 'day' } });
  await prisma.bellScheduleVersion.create({
    data: { bellScheduleId: bell.id, effectiveFrom: asDbDay(yearStart), periods: { create: [{ kind: 'LESSON', number: 1, days: ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'], startMinute: 480, endMinute: 525 }] } },
  });
  for (const s of Object.values(sections)) {
    await prisma.timetableVersion.create({
      data: {
        schoolId: schools.A.id,
        academicYearId: year.id,
        branchId: s.branchId,
        sectionId: s.id,
        bellScheduleId: bell.id,
        effectiveFrom: asDbDay(yearStart),
        slots: { create: ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'].map((weekday) => ({ weekday, periodNumber: 1, subjectId: subjects.Math.id })) },
      },
    });
  }
  const student = await prisma.student.create({
    data: { schoolId: schools.A.id, branchId: branches.A1.id, studentNumber: `TEXS${tag}-1`, firstName: 'Amina', lastName: 'Hassan', nameKey: `amina hassan ${lower}`, gender: 'FEMALE', dateOfBirth: asDbDay('2012-01-01'), guardianName: 'Guardian', guardianPhone: '+252 61 7654321', status: 'ENROLLED' },
  });
  await prisma.enrollment.create({ data: { schoolId: schools.A.id, branchId: branches.A1.id, studentId: student.id, academicYearId: year.id, sectionId: sections.G7A.id } });

  for (const [key, role, where] of [['OWNER_A', 'OWNER', 'A'], ['OWNER_B', 'OWNER', 'B'], ['MANAGER_A1', 'MANAGER', 'A1'], ['MANAGER_A2', 'MANAGER', 'A2'], ['STAFF', 'STAFF']]) {
    const password = randomBytes(12).toString('base64url');
    const email = `test-exsched-${key.toLowerCase().replace('_', '-')}-${lower}@test.edutrack.example`;
    const scope = role === 'MANAGER' ? { branchId: branches[where].id } : await branchFor(role);
    const user = await prisma.user.create({ data: { name: `Test ${key} ${tag}`, email, role, ...scope, passwordHash: await hashPassword(password) } });
    if (role === 'OWNER') await prisma.school.update({ where: { id: schools[where].id }, data: { ownerId: user.id } });
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 200, `${key} sign-in`);
    cookies[key] = login.headers.get('set-cookie')?.split(';')[0];
  }
});

after(async () => {
  const schoolIds = Object.values(schools).map((s) => s.id);
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  const where = { schoolId: { in: schoolIds } };
  await prisma.examPaper.deleteMany({ where });
  await prisma.examinationClass.deleteMany({ where: { examination: where } });
  await prisma.examination.deleteMany({ where });
  await prisma.timetableSlot.deleteMany({ where: { version: where } });
  await prisma.timetableVersion.deleteMany({ where });
  await prisma.bellPeriod.deleteMany({ where: { version: { bellSchedule: where } } });
  await prisma.bellScheduleVersion.deleteMany({ where: { bellSchedule: where } });
  await prisma.bellSchedule.deleteMany({ where });
  await prisma.enrollment.deleteMany({ where });
  await prisma.student.deleteMany({ where });
  await prisma.section.deleteMany({ where });
  await prisma.classSubject.deleteMany({ where });
  await prisma.subject.deleteMany({ where });
  await prisma.schoolClass.deleteMany({ where });
  await prisma.academicWeekdays.deleteMany({ where });
  await prisma.academicPeriod.deleteMany({ where });
  await prisma.examType.deleteMany({ where });
  await prisma.examSettings.deleteMany({ where });
  await prisma.auditEvent.deleteMany({ where: { OR: [where, { actorId: { in: userIds } }] } });
  await prisma.academicYear.deleteMany({ where });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.school.updateMany({ where: { id: { in: schoolIds } }, data: { ownerId: null } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await removeTestBranches();
  server.close();
  await prisma.$disconnect();
});

describe('rules (pure)', () => {
  test('state from status and today; past days fixed', () => {
    const d = '2026-11-22';
    assert.equal(examState({ status: 'DRAFT', startDate: '2026-11-01', endDate: '2026-11-02' }, d), 'draft');
    assert.equal(examState({ status: 'SCHEDULED', startDate: '2026-11-23', endDate: '2026-11-25' }, d), 'planned');
    assert.equal(examState({ status: 'SCHEDULED', startDate: '2026-11-22', endDate: '2026-11-25' }, d), 'active');
    assert.equal(examState({ status: 'SCHEDULED', startDate: '2026-11-10', endDate: '2026-11-21' }, d), 'completed');
    assert.equal(examState({ status: 'CANCELLED', startDate: '2026-11-23', endDate: '2026-11-25' }, d), 'cancelled');

    const planned = examActions({ status: 'SCHEDULED', startDate: '2026-11-22', endDate: '2026-11-25' }, d, true);
    assert.deepEqual([planned.cancel, planned.unschedule, planned.locked.length], ['cancel', true, 0], 'starting today: still editable (today is not fixed)');
    const running = examActions({ status: 'SCHEDULED', startDate: '2026-11-20', endDate: '2026-11-25' }, d, true);
    assert.deepEqual([running.cancel, running.unschedule], ['end', false]);
    assert.ok(running.locked.includes('classes') && running.locked.includes('startDate') && !running.locked.includes('endDate'));
    const over = examActions({ status: 'SCHEDULED', startDate: '2026-11-10', endDate: '2026-11-21' }, d, true);
    assert.equal(over.cancel, null);
    assert.ok(over.locked.includes('endDate'));
    assert.equal(examActions({ status: 'DRAFT', startDate: '2026-11-23', endDate: '2026-11-24' }, d, false).edit, false, 'not theirs: read only');
  });
});

let mid;

describe('drafts', () => {
  test('a draft takes its papers from the curriculum; name from type and period; checks dates', async () => {
    const r = await owner(O, { method: 'POST', body: { examType: types.mid.id, period: period.id, startDate: T(10), endDate: T(14), classes: [classes.G7.id, classes.G8.id] } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    mid = r.body.examination;
    assert.equal(mid.name, 'Mid-Term – Term 1');
    assert.equal(mid.status, 'draft');
    assert.equal(mid.state, 'draft');
    assert.equal(mid.level, 'school');
    assert.equal(mid.stopsLessons, true, 'from the type');
    assert.equal(mid.papers, 3);
    const g7 = r.body.classes.find((c) => c.id === classes.G7.id);
    assert.deepEqual(g7.papers.map((p) => p.subject.name).sort(), ['English', 'Math']);
    assert.equal(g7.papers[0].maxMarks, 100);
    assert.equal(g7.papers[0].durationMinutes, 120, 'the paper length setting');
    assert.equal(g7.sections, 2);
    assert.equal(g7.students, 1);
    assert.ok(mid.actions.schedule && mid.actions.edit);

    const again = await owner(O, { method: 'POST', body: { examType: types.mid.id, period: period.id, startDate: T(40), endDate: T(41) } });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'NAME_TAKEN');
    const past = await owner(O, { method: 'POST', body: { name: 'Past', examType: types.mid.id, startDate: T(-1), endDate: T(2) } });
    assert.equal(past.status, 400);
    assert.match(past.body.details.startDate, /fixed/);
    const outside = await owner(O, { method: 'POST', body: { name: 'Outside', examType: types.mid.id, period: period.id, startDate: T(99), endDate: T(102) } });
    assert.equal(outside.status, 400);
    assert.match(outside.body.details.endDate, /Term 1/);
    const foreign = await owner(O, { method: 'POST', body: { name: 'Foreign', examType: types.mid.id, startDate: T(50), endDate: T(51), classes: [classes.OTHER.id] } });
    assert.equal(foreign.status, 400, 'another school’s class');
    const order = await owner(O, { method: 'POST', body: { name: 'Order', examType: types.mid.id, startDate: T(51), endDate: T(50) } });
    assert.equal(order.status, 400);
  });

  test('a draft changes nothing: lessons go on', async () => {
    assert.equal(lessonsOf(await dayOf(sections.G7A, T(10))), 1);
    const cal = await owner(`/api/owner/academic-years/${year.id}/calendar`);
    assert.equal(cal.status, 200);
    assert.equal(cal.body.examinations.length, 0);
  });

  test('scheduling needs a paper for every class', async () => {
    const r = await owner(O, { method: 'POST', body: { name: 'Science only', examType: types.mid.id, startDate: T(60), endDate: T(61), classes: [classes.G9.id] } });
    assert.equal(r.status, 201);
    assert.equal(r.body.examination.papers, 0, 'G9 has no curriculum');
    const s = await owner(`${O}/${r.body.examination.id}/schedule`, { method: 'POST' });
    assert.equal(s.status, 409);
    assert.equal(s.body.code, 'NO_PAPERS');
    const add = await owner(`${O}/${r.body.examination.id}/papers`, { method: 'POST', body: { class: classes.G9.id, subject: subjects.Science.id, maxMarks: 50 } });
    assert.equal(add.status, 201);
    assert.equal(add.body.classes[0].papers[0].maxMarks, 50);
    const cancel = await owner(`${O}/${r.body.examination.id}/cancel`, { method: 'POST', body: { reason: 'Not needed' } });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.examination.status, 'cancelled');
    const edit = await owner(`${O}/${r.body.examination.id}`, { method: 'PATCH', body: { name: 'Again' } });
    assert.equal(edit.status, 409, 'a cancelled examination stays as it is');
    // Its name is free again.
    const reuse = await owner(O, { method: 'POST', body: { name: 'Science only', examType: types.quiz.id, startDate: T(62), endDate: T(62) } });
    assert.equal(reuse.status, 201);
    await owner(`${O}/${reuse.body.examination.id}/cancel`, { method: 'POST', body: {} });
  });
});

describe('scheduled: calendar and lessons', () => {
  test('scheduling puts it on the calendar and stops its classes’ lessons on its days, in every branch', async () => {
    const r = await owner(`${O}/${mid.id}/schedule`, { method: 'POST' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.examination.status, 'scheduled');
    assert.equal(r.body.examination.state, 'planned');

    const g7a = await dayOf(sections.G7A, T(10));
    assert.equal(g7a.schoolDay, true, 'still a school day');
    assert.equal(lessonsOf(g7a), 0);
    assert.equal(g7a.examination.name, mid.name);
    assert.equal(g7a.periods[0].stoppedLesson.subject.name, 'Math', 'the stopped lesson is kept for display');
    assert.equal(lessonsOf(await dayOf(sections.G7B, T(14))), 0, 'school-wide: the other branch too');
    assert.equal(lessonsOf(await dayOf(sections.G7A, T(9))), 1, 'the day before: lessons');
    assert.equal(lessonsOf(await dayOf(sections.G7A, T(15))), 1, 'the day after: lessons');

    const days = await owner(`/api/owner/calendar/days?branch=${branches.A1.id}&from=${T(9)}&to=${T(11)}`);
    assert.equal(days.status, 200, JSON.stringify(days.body));
    assert.deepEqual(days.body.days.map((d) => d.examinations.length), [0, 1, 1]);
  });

  test('a class never sits two scheduled examinations at once', async () => {
    const r = await owner(O, { method: 'POST', body: { name: 'Clash', examType: types.quiz.id, startDate: T(12), endDate: T(13), classes: [classes.G7.id] } });
    assert.equal(r.status, 201);
    const s = await owner(`${O}/${r.body.examination.id}/schedule`, { method: 'POST' });
    assert.equal(s.status, 409);
    assert.equal(s.body.code, 'EXAM_OVERLAP');
    const moved = await owner(`${O}/${r.body.examination.id}`, { method: 'PATCH', body: { startDate: T(20), endDate: T(20) } });
    assert.equal(moved.status, 200);
    const ok = await owner(`${O}/${r.body.examination.id}/schedule`, { method: 'POST' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.examination.stopsLessons, false, 'a quiz does not stop lessons');
    assert.equal(lessonsOf(await dayOf(sections.G7A, T(20))), 1);
    const back = await owner(`${O}/${r.body.examination.id}/unschedule`, { method: 'POST' });
    assert.equal(back.status, 200);
    assert.equal(back.body.examination.status, 'draft');
  });

  test('papers: change, limits, one kept per class while scheduled', async () => {
    const detail = await owner(`${O}/${mid.id}`);
    const g8 = detail.body.classes.find((c) => c.id === classes.G8.id);
    const paper = g8.papers[0];
    const tooMany = await owner(`${O}/${mid.id}/papers/${paper.id}`, { method: 'PATCH', body: { maxMarks: 500 } });
    assert.equal(tooMany.status, 400, 'above the highest marks setting (100)');
    const changed = await owner(`${O}/${mid.id}/papers/${paper.id}`, { method: 'PATCH', body: { maxMarks: 80, durationMinutes: 90 } });
    assert.equal(changed.status, 200);
    assert.deepEqual([changed.body.classes.find((c) => c.id === classes.G8.id).papers[0].maxMarks, changed.body.classes.find((c) => c.id === classes.G8.id).papers[0].durationMinutes], [80, 90]);
    const last = await owner(`${O}/${mid.id}/papers/${paper.id}`, { method: 'DELETE' });
    assert.equal(last.status, 409);
    assert.equal(last.body.code, 'LAST_PAPER');
    const dup = await owner(`${O}/${mid.id}/papers`, { method: 'POST', body: { class: classes.G8.id, subject: subjects.Math.id } });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.code, 'PAPER_EXISTS');
    const notSitting = await owner(`${O}/${mid.id}/papers`, { method: 'POST', body: { class: classes.G9.id, subject: subjects.Math.id } });
    assert.equal(notSitting.status, 400);
    const added = await owner(`${O}/${mid.id}/papers`, { method: 'POST', body: { class: classes.G8.id, subject: subjects.English.id } });
    assert.equal(added.status, 201);
    const removed = await owner(`${O}/${mid.id}/papers/${added.body.classes.find((c) => c.id === classes.G8.id).papers.find((p) => p.subject.name === 'English').id}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
  });

  test('the calendar lists scheduled examinations (read only)', async () => {
    const cal = await owner(`/api/owner/academic-years/${year.id}/calendar`);
    assert.equal(cal.status, 200);
    assert.deepEqual(cal.body.examinations.map((e) => e.name), [mid.name]);
    assert.deepEqual(cal.body.examinations[0].classes, ['Grade G7', 'Grade G8']);
  });
});

describe('Managers and branches', () => {
  let branchExam;
  test('a Manager creates their branch’s examination; it stops lessons only in that branch', async () => {
    const withBranch = await manager1(M, { method: 'POST', body: { name: 'Branch test', examType: types.mid.id, startDate: T(30), endDate: T(31), branch: branches.A2.id } });
    assert.equal(withBranch.status, 400, 'a Manager does not choose the branch');
    const r = await manager1(M, { method: 'POST', body: { name: 'Branch test', examType: types.mid.id, startDate: T(30), endDate: T(31), classes: [classes.G7.id] } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    branchExam = r.body.examination;
    assert.equal(branchExam.level, 'branch');
    assert.equal(branchExam.branch.id, branches.A1.id);
    assert.equal(r.body.classes[0].sections, 1, 'its branch’s sections only');
    assert.equal((await manager1(`${M}/${branchExam.id}/schedule`, { method: 'POST' })).status, 200);
    assert.equal(lessonsOf(await dayOf(sections.G7A, T(30))), 0);
    assert.equal(lessonsOf(await dayOf(sections.G7B, T(30))), 1, 'the other branch keeps its lessons');
  });

  test('Managers see school-wide examinations and their own branch’s only, and change only their own', async () => {
    const list2 = await manager2(M);
    assert.equal(list2.status, 200);
    assert.ok(list2.body.items.some((i) => i.id === mid.id));
    assert.ok(!list2.body.items.some((i) => i.id === branchExam.id));
    assert.equal((await manager2(`${M}/${branchExam.id}`)).status, 404);
    const own = await manager1(M);
    const school = own.body.items.find((i) => i.id === mid.id);
    assert.equal(school.actions.edit, false, 'school-wide: read only for a Manager');
    assert.equal((await manager1(`${M}/${mid.id}`, { method: 'PATCH', body: { name: 'Renamed' } })).status, 403);
    // Two branches may use the same name.
    const same = await manager2(M, { method: 'POST', body: { name: 'Branch test', examType: types.quiz.id, startDate: T(30), endDate: T(30) } });
    assert.equal(same.status, 201);
    const sameAgain = await manager1(M, { method: 'POST', body: { name: 'branch TEST', examType: types.quiz.id, startDate: T(32), endDate: T(32) } });
    assert.equal(sameAgain.status, 409);
  });

  test('the school can keep examinations to the School Owner', async () => {
    const off = await owner('/api/owner/exams/settings', { method: 'PUT', body: { values: { managersCreateExams: false } } });
    assert.equal(off.status, 200);
    const create = await manager1(M, { method: 'POST', body: { name: 'Refused', examType: types.quiz.id, startDate: T(33), endDate: T(33) } });
    assert.equal(create.status, 403);
    const list = await manager1(M);
    assert.equal(list.body.canCreate, false);
    assert.equal(list.body.items.find((i) => i.id === branchExam.id).actions.edit, false);
    await owner('/api/owner/exams/settings', { method: 'PUT', body: { values: { managersCreateExams: null } } });
  });
});

describe('days before today are fixed', () => {
  let running;
  before(async () => {
    // A scheduled examination that started two days ago (created directly: the API never back-dates).
    running = await prisma.examination.create({
      data: {
        schoolId: schools.A.id,
        academicYearId: year.id,
        examTypeId: types.mid.id,
        name: 'Running',
        nameKey: 'running',
        startDate: asDbDay(T(-2)),
        endDate: asDbDay(T(3)),
        stopsLessons: true,
        status: 'SCHEDULED',
        scheduledAt: new Date(),
        classes: { create: [{ classId: classes.G8.id }] },
        papers: { create: [{ schoolId: schools.A.id, classId: classes.G8.id, subjectId: subjects.Math.id, maxMarks: 100, durationMinutes: 120 }] },
      },
    });
  });

  test('a running examination keeps its classes and first day, cannot be cancelled, and ends early', async () => {
    assert.equal(lessonsOf(await dayOf(sections.G8A, T(-1))), 0);
    const classesChange = await owner(`${O}/${running.id}`, { method: 'PATCH', body: { classes: [classes.G7.id, classes.G8.id] } });
    assert.equal(classesChange.status, 409);
    assert.equal(classesChange.body.code, 'EXAM_STARTED');
    const rename = await owner(`${O}/${running.id}`, { method: 'PATCH', body: { name: 'Running exam' } });
    assert.equal(rename.status, 200, 'names can always be fixed');
    const tooEarly = await owner(`${O}/${running.id}`, { method: 'PATCH', body: { endDate: T(-2) } });
    assert.equal(tooEarly.status, 400);
    assert.equal((await owner(`${O}/${running.id}/cancel`, { method: 'POST', body: {} })).body.code, 'EXAM_STARTED');
    assert.equal((await owner(`${O}/${running.id}/unschedule`, { method: 'POST' })).status, 409);
    const end = await owner(`${O}/${running.id}/end`, { method: 'POST', body: { reason: 'Rain' } });
    assert.equal(end.status, 200);
    assert.equal(end.body.examination.endDate, T(-1));
    assert.equal(end.body.examination.state, 'completed');
    assert.equal(lessonsOf(await dayOf(sections.G8A, T(-1))), 0, 'past exam days stay without lessons');
    assert.equal(lessonsOf(await dayOf(sections.G8A, T(0))), 1, 'today’s lessons are back');
    const after = await owner(`${O}/${running.id}`, { method: 'PATCH', body: { endDate: T(5) } });
    assert.equal(after.status, 409, 'over: only its name and description change');
  });
});

describe('lists, overview, isolation and audit', () => {
  test('list filters and counts', async () => {
    const all = await owner(O);
    assert.equal(all.status, 200);
    assert.ok(all.body.counts.planned >= 2 && all.body.counts.completed === 1 && all.body.counts.cancelled === 2);
    const planned = await owner(`${O}?state=planned&scope=school`);
    assert.ok(planned.body.items.every((i) => i.state === 'planned' && i.level === 'school'));
    const search = await owner(`${O}?q=mid-term`);
    assert.deepEqual(search.body.items.map((i) => i.id), [mid.id]);
    const byBranch = await owner(`${O}?branch=${branches.A2.id}`);
    assert.ok(byBranch.body.items.every((i) => !i.branch || i.branch.id === branches.A2.id));
    assert.equal((await owner(`${O}?state=soon`)).status, 400);
    const options = await owner(`${O}/options`);
    assert.equal(options.status, 200);
    assert.deepEqual(options.body.types.map((t) => t.name), ['Mid-Term', 'Quiz']);
    assert.equal(options.body.classes.find((c) => c.id === classes.G7.id).curriculumSubjects, 2);
  });

  test('the overview counts examinations and shows the next one', async () => {
    const o = await owner('/api/owner/exams/overview');
    assert.equal(o.status, 200);
    assert.ok(o.body.examinations.planned >= 2);
    assert.equal(o.body.current.id, mid.id);
  });

  test('other schools, staff and a school without the module', async () => {
    assert.equal((await ownerB(O)).status, 403, 'module off for school B');
    await prisma.school.update({ where: { id: schools.B.id }, data: { examinationsEnabled: true } });
    assert.equal((await ownerB(`${O}/${mid.id}`)).status, 404);
    assert.equal((await ownerB(O)).body.items.length, 0);
    await prisma.school.update({ where: { id: schools.B.id }, data: { examinationsEnabled: false } });
    assert.equal((await staff(O)).status, 403);
    assert.equal((await call(O)).status, 401);
  });

  test('every change is audited in the school', async () => {
    const events = await prisma.auditEvent.findMany({ where: { schoolId: schools.A.id, targetType: 'examination' }, select: { action: true } });
    const actions = new Set(events.map((e) => e.action));
    for (const a of ['EXAMINATION_CREATED', 'EXAMINATION_UPDATED', 'EXAMINATION_SCHEDULED', 'EXAMINATION_UNSCHEDULED', 'EXAMINATION_CANCELLED', 'EXAMINATION_ENDED', 'EXAM_PAPERS_CHANGED']) {
      assert.ok(actions.has(a), a);
    }
  });
});

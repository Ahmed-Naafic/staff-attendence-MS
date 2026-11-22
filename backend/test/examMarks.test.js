/*
 * Examinations, phases 4–5 (docs/business-rules.md → Examinations → Attendance; Marks): invigilators
 * take their room's attendance on the day (Staff app API), the School Owner corrects it; subject
 * teachers enter marks (absent and excused from attendance get none), submit them, the School Owner
 * returns (the teacher is told) or approves them; deadlines; seats with attendance stay.
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
import { setStorageTransport } from '../src/common/supabaseStorage.js';
import { env } from '../src/config/env.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Examination tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const cookies = {};
const tokens = {};
const staff = {};
const students = [];
const ctx = {};
let server;
let base;
let today;
const T = (n) => addDays(today, n);

async function raw(path, cookie) {
  const response = await fetch(base + path, { headers: { cookie } });
  return { status: response.status, type: response.headers.get('content-type'), disposition: response.headers.get('content-disposition'), buffer: Buffer.from(await response.arrayBuffer()) };
}

async function call(path, { method = 'GET', body, cookie, token } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(method !== 'GET' && !token && { origin: ORIGIN }), ...(token && { authorization: `Bearer ${token}` }), ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const owner = (path, o = {}) => call(path, { ...o, cookie: cookies.OWNER });
const teacher = (key) => (path, o = {}) => call(path, { ...o, token: tokens[key] });
const O = '/api/owner/exams';

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  today = await calendarToday();
  const school = await prisma.school.create({ data: { code: `TEXM${tag}`, name: `Exam Marks ${tag}`, location: 'Mogadishu', phone: '+252 61 1234567', address: 'Road 1', examinationsEnabled: true } });
  ctx.school = school;
  ctx.branch = await prisma.branch.create({ data: { schoolId: school.id, number: 1, code: `TEXM${tag}-B`, name: 'Main', nameKey: `main ${lower}`, address: 'Road', city: 'Mogadishu' } });
  const yearStart = T(-30);
  ctx.year = await prisma.academicYear.create({ data: { schoolId: school.id, name: `Y ${tag}`, nameKey: `y ${lower}`, startDate: asDbDay(yearStart), endDate: asDbDay(T(300)), status: 'CURRENT', startedAt: new Date() } });
  await prisma.academicWeekdays.create({ data: { schoolId: school.id, academicYearId: ctx.year.id, days: ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'], effectiveFrom: asDbDay(yearStart) } });
  const scale = await prisma.gradingScale.create({ data: { schoolId: school.id, name: 'Letters', nameKey: 'letters', isDefault: true } });
  await prisma.gradeBand.createMany({
    data: [['A', 80, 100, true], ['B', 65, 79.99, true], ['C', 50, 64.99, true], ['F', 0, 49.99, false]].map(([label, minPercent, maxPercent, passes]) => ({ scaleId: scale.id, label, minPercent, maxPercent, passes })),
  });
  ctx.type = await prisma.examType.create({ data: { schoolId: school.id, name: 'Mid-Term', nameKey: 'mid-term', defaultMaxMarks: 50, stopsLessons: false } });
  ctx.class = await prisma.schoolClass.create({ data: { schoolId: school.id, name: 'Grade 7', nameKey: 'grade 7', sequence: 1 } });
  ctx.math = await prisma.subject.create({ data: { schoolId: school.id, name: 'Math', nameKey: 'math' } });
  ctx.english = await prisma.subject.create({ data: { schoolId: school.id, name: 'English', nameKey: 'english' } });
  await prisma.classSubject.createMany({ data: [ctx.math, ctx.english].map((s) => ({ schoolId: school.id, classId: ctx.class.id, subjectId: s.id })) });
  ctx.section = await prisma.section.create({ data: { schoolId: school.id, branchId: ctx.branch.id, classId: ctx.class.id, academicYearId: ctx.year.id, name: 'A', nameKey: 'a' } });
  for (let i = 1; i <= 6; i += 1) {
    const s = await prisma.student.create({
      data: { schoolId: school.id, branchId: ctx.branch.id, studentNumber: `TEXM${tag}-${i}`, firstName: `S${i}`, lastName: 'Test', nameKey: `s${i} ${lower}`, gender: 'MALE', dateOfBirth: asDbDay('2012-01-01'), guardianName: 'G', guardianPhone: '+252 61 7654321', status: 'ENROLLED' },
    });
    await prisma.enrollment.create({ data: { schoolId: school.id, branchId: ctx.branch.id, studentId: s.id, academicYearId: ctx.year.id, sectionId: ctx.section.id } });
    students.push(s);
  }
  ctx.room = await prisma.examRoom.create({ data: { schoolId: school.id, branchId: ctx.branch.id, name: 'R1', nameKey: 'r1', defaultCapacity: 10 } });
  for (const [i, key] of ['t1', 't2'].entries()) {
    const phone = `+998${parseInt(randomBytes(4).toString('hex'), 16)}`;
    const password = randomBytes(12).toString('base64url');
    staff[key] = await prisma.user.create({ data: { name: `Teacher ${key} ${tag}`, email: `test-exmk-${key}-${lower}@test.edutrack.example`, role: 'STAFF', branchId: ctx.branch.id, staffId: `TEXM${tag}-ST${i}`, jobTitle: 'Teacher', phone, phoneKey: phone, passwordHash: await hashPassword(password) } });
    const res = await call('/api/auth/login', { method: 'POST', body: { identifier: phone, password, client: 'mobile' } });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[key] = res.body.token;
  }
  // t1 teaches Math and English to Grade 7A.
  for (const subject of [ctx.math, ctx.english]) await prisma.teachingAssignment.create({ data: { schoolId: school.id, academicYearId: ctx.year.id, branchId: ctx.branch.id, sectionId: ctx.section.id, teacherId: staff.t1.id, role: 'SUBJECT_TEACHER', subjectId: subject.id, startDate: asDbDay(yearStart) } });
  const password = randomBytes(12).toString('base64url');
  const email = `test-exmk-owner-${lower}@test.edutrack.example`;
  const o = await prisma.user.create({ data: { name: `Owner ${tag}`, email, role: 'OWNER', passwordHash: await hashPassword(password) } });
  await prisma.school.update({ where: { id: school.id }, data: { ownerId: o.id } });
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, password }) });
  cookies.OWNER = login.headers.get('set-cookie')?.split(';')[0];

  // A scheduled examination with a timetable; Math is sat today, English tomorrow.
  const created = await owner(`${O}/examinations`, { method: 'POST', body: { examType: ctx.type.id, startDate: T(0), endDate: T(3), classes: [ctx.class.id] } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  ctx.exam = created.body.examination;
  const gen = await owner(`${O}/examinations/${ctx.exam.id}/timetable/generate?branch=${ctx.branch.id}`, { method: 'POST', body: { shifts: [{ name: 'Morning', start: '08:00', sessions: 1 }], rooms: [{ room: ctx.room.id }] } });
  assert.equal(gen.status, 200, JSON.stringify(gen.body));
  const sessionOf = (name) => gen.body.sessions.find((s) => s.papers.some((p) => p.subject.name === name));
  ctx.mathSession = sessionOf('Math');
  ctx.englishSession = sessionOf('English');
  await prisma.examSession.update({ where: { id: ctx.mathSession.id }, data: { date: asDbDay(T(0)) } });
  await prisma.examSession.update({ where: { id: ctx.englishSession.id }, data: { date: asDbDay(T(1)) } });
  // Both teachers invigilate the room in both sessions (set by hand).
  for (const s of [ctx.mathSession, ctx.englishSession]) {
    const r = await owner(`${O}/examinations/${ctx.exam.id}/timetable/sessions/${s.id}/invigilators?branch=${ctx.branch.id}`, { method: 'PUT', body: { room: ctx.room.id, staff: [staff.t2.id] } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  assert.equal((await owner(`${O}/examinations/${ctx.exam.id}/schedule`, { method: 'POST' })).status, 200);
  const detail = await owner(`${O}/examinations/${ctx.exam.id}`);
  ctx.papers = Object.fromEntries(detail.body.classes[0].papers.map((p) => [p.subject.name, p]));
});

after(async () => {
  const where = { schoolId: ctx.school.id };
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  await prisma.pushMessage.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { recipientId: { in: userIds } } });
  await prisma.examResult.deleteMany({ where: { resultSet: where } });
  await prisma.examResultRevision.deleteMany({ where: { resultSet: where } });
  await prisma.examResultSet.deleteMany({ where });
  await prisma.examPaperFile.deleteMany({ where });
  await prisma.examMark.deleteMany({ where: { sheet: where } });
  await prisma.examMarkSheet.deleteMany({ where });
  await prisma.examInvigilation.deleteMany({ where: { session: where } });
  await prisma.examSeat.deleteMany({ where: { session: where } });
  await prisma.examSitting.deleteMany({ where: { session: where } });
  await prisma.examSession.deleteMany({ where });
  await prisma.examTimetable.deleteMany({ where });
  await prisma.examPaper.deleteMany({ where });
  await prisma.examinationClass.deleteMany({ where: { examination: where } });
  await prisma.examination.deleteMany({ where });
  await prisma.examRoom.deleteMany({ where });
  await prisma.teachingAssignment.deleteMany({ where });
  await prisma.enrollment.deleteMany({ where });
  await prisma.student.deleteMany({ where });
  await prisma.section.deleteMany({ where });
  await prisma.classSubject.deleteMany({ where });
  await prisma.subject.deleteMany({ where });
  await prisma.schoolClass.deleteMany({ where });
  await prisma.academicWeekdays.deleteMany({ where });
  await prisma.examType.deleteMany({ where });
  await prisma.gradeBand.deleteMany({ where: { scale: where } });
  await prisma.gradingScale.deleteMany({ where });
  await prisma.examSettings.deleteMany({ where });
  await prisma.auditEvent.deleteMany({ where: { OR: [where, { actorId: { in: userIds } }] } });
  await prisma.academicYear.deleteMany({ where });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.school.update({ where: { id: ctx.school.id }, data: { ownerId: null } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where });
  await prisma.school.delete({ where: { id: ctx.school.id } });
  server.close();
  await prisma.$disconnect();
});

const marksOf = (sheet, i) => sheet.students.find((s) => s.student.id === students[i].id);

describe('attendance', () => {
  test('an invigilator sees today’s duty and takes the room’s attendance', async () => {
    const duties = await teacher('t2')('/api/teacher/exams/duties');
    assert.equal(duties.status, 200, JSON.stringify(duties.body));
    const todays = duties.body.duties.find((d) => d.session.id === ctx.mathSession.id);
    assert.equal(todays.canMark, true);
    assert.equal(todays.summary.students, 6);
    assert.equal(duties.body.duties.find((d) => d.session.id === ctx.englishSession.id).canMark, false, 'tomorrow');
    const room = await teacher('t2')(`/api/teacher/exams/duties/${ctx.mathSession.id}/rooms/${ctx.room.id}`);
    assert.equal(room.body.seats.length, 6);
    const marks = students.map((s, i) => ({ student: s.id, status: i === 0 ? 'absent' : i === 1 ? 'excused' : i === 2 ? 'late' : 'present' }));
    const saved = await teacher('t2')('/api/teacher/exams/attendance', { method: 'PUT', body: { session: ctx.mathSession.id, room: ctx.room.id, marks } });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.deepEqual(saved.body.summary, { students: 6, present: 3, absent: 1, late: 1, excused: 1, notTaken: 0 });
    const early = await teacher('t2')('/api/teacher/exams/attendance', { method: 'PUT', body: { session: ctx.englishSession.id, room: ctx.room.id, marks: marks.slice(0, 1) } });
    assert.equal(early.status, 403, 'not before the day');
    const notMine = await teacher('t1')(`/api/teacher/exams/duties/${ctx.mathSession.id}/rooms/${ctx.room.id}`);
    assert.equal(notMine.status, 404);
  });

  test('the School Owner corrects it; not before the day; seats with attendance stay', async () => {
    const path = `${O}/examinations/${ctx.exam.id}/sessions/${ctx.mathSession.id}/attendance`;
    const r = await owner(path);
    assert.equal(r.status, 200);
    assert.equal(r.body.canEdit, true);
    assert.equal(r.body.rooms[0].invigilators[0].id, staff.t2.id);
    const fixed = await owner(path, { method: 'PUT', body: { marks: [{ student: students[3].id, status: 'present', note: 'Arrived on time' }] } });
    assert.equal(fixed.status, 200);
    const future = await owner(`${O}/examinations/${ctx.exam.id}/sessions/${ctx.englishSession.id}/attendance`, { method: 'PUT', body: { marks: [{ student: students[0].id, status: 'present' }] } });
    assert.equal(future.body.code, 'TOO_EARLY');
    const stranger = await owner(path, { method: 'PUT', body: { marks: [{ student: staff.t1.id, status: 'present' }] } });
    assert.equal(stranger.status, 400);
    const timetable = await owner(`${O}/examinations/${ctx.exam.id}/timetable?branch=${ctx.branch.id}`);
    const sitting = timetable.body.sessions.find((s) => s.id === ctx.mathSession.id).papers[0].sittingId;
    const move = await owner(`${O}/examinations/${ctx.exam.id}/timetable/sittings/${sitting}/move?branch=${ctx.branch.id}`, { method: 'POST', body: { session: ctx.englishSession.id } });
    assert.equal(move.status, 409);
  });
});

describe('marks', () => {
  const sheetPath = (subject) => `/api/teacher/exams/marks/${ctx.papers[subject].id}/${ctx.section.id}`;
  test('the teacher’s sheets: open once the paper is sat', async () => {
    const r = await teacher('t1')('/api/teacher/exams/marks');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const bySubject = Object.fromEntries(r.body.items.map((i) => [i.paper.subject.name, i]));
    assert.equal(bySubject.Math.opened, true);
    assert.equal(bySubject.English.opened, false);
    assert.equal(bySubject.Math.canEdit, true);
    const early = await teacher('t1')(sheetPath('English'), { method: 'PUT', body: { marks: [{ student: students[5].id, marks: 10 }] } });
    assert.equal(early.body.code, 'NOT_OPEN');
    assert.equal((await teacher('t2')(sheetPath('Math'))).status, 404, 'not their subject');
  });

  test('absent and excused get no marks; limits; incomplete sheets are not submitted', async () => {
    const path = sheetPath('Math');
    const sheet = await teacher('t1')(path);
    assert.equal(marksOf(sheet.body, 0).absent, true);
    assert.equal(marksOf(sheet.body, 1).excused, true);
    const absentMarked = await teacher('t1')(path, { method: 'PUT', body: { marks: [{ student: students[0].id, marks: 10 }] } });
    assert.equal(absentMarked.status, 400);
    const tooHigh = await teacher('t1')(path, { method: 'PUT', body: { marks: [{ student: students[2].id, marks: 51 }] } });
    assert.equal(tooHigh.status, 400, 'out of 50');
    const some = await teacher('t1')(path, { method: 'PUT', body: { marks: [{ student: students[2].id, marks: 40.5 }, { student: students[3].id, marks: 30 }] } });
    assert.equal(some.status, 200, JSON.stringify(some.body));
    assert.equal(some.body.actions.submit, false);
    assert.equal((await teacher('t1')(`${path}/submit`, { method: 'POST' })).body.code, 'MARKS_INCOMPLETE');
    const rest = await teacher('t1')(path, { method: 'PUT', body: { marks: [{ student: students[4].id, marks: 20 }, { student: students[5].id, marks: 10 }] } });
    assert.deepEqual([rest.body.stats.entered, rest.body.stats.average], [6, 25.13]);
    const submitted = await teacher('t1')(`${path}/submit`, { method: 'POST' });
    assert.equal(submitted.body.status, 'submitted');
    assert.equal((await teacher('t1')(path, { method: 'PUT', body: { marks: [{ student: students[5].id, marks: 11 }] } })).body.code, 'SHEET_SUBMITTED');
  });

  test('the School Owner returns (the teacher is told), the teacher corrects, the Owner approves', async () => {
    const list = await owner(`${O}/examinations/${ctx.exam.id}/marks?branch=${ctx.branch.id}`);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.deepEqual(list.body.counts, { draft: 1, submitted: 1, approved: 0, returned: 0 });
    assert.deepEqual(list.body.items.find((i) => i.paper.subject.name === 'Math').teachers.map((t) => t.id), [staff.t1.id]);
    const web = `${O}/marks/${ctx.papers.Math.id}/${ctx.section.id}`;
    assert.equal((await owner(`${web}/return`, { method: 'POST', body: { reason: '' } })).status, 400);
    const returned = await owner(`${web}/return`, { method: 'POST', body: { reason: 'S6 should be 12' } });
    assert.equal(returned.body.status, 'returned');
    const note = await prisma.notification.findFirst({ where: { recipientId: staff.t1.id, type: 'EXAM_MARKS_RETURNED' } });
    assert.equal(note.params.reason, 'S6 should be 12');
    const again = await teacher('t1')(sheetPath('Math'), { method: 'PUT', body: { marks: [{ student: students[5].id, marks: 12 }] } });
    assert.equal(again.body.returnedReason, 'S6 should be 12');
    assert.equal((await teacher('t1')(`${sheetPath('Math')}/submit`, { method: 'POST' })).body.status, 'submitted');
    const approved = await owner(`${web}/approve`, { method: 'POST' });
    assert.equal(approved.body.status, 'approved');
    assert.equal(approved.body.approvedBy, `Owner ${tag}`);
    assert.equal((await owner(web, { method: 'PUT', body: { marks: [{ student: students[5].id, marks: 13 }] } })).body.code, 'SHEET_APPROVED');
  });

  test('after the deadline only the School Owner or Manager enters marks', async () => {
    await prisma.examSession.update({ where: { id: ctx.englishSession.id }, data: { date: asDbDay(T(-1)) } });
    await owner(`${O}/settings`, { method: 'PUT', body: { values: { markEntryDays: 0 } } });
    const late = await teacher('t1')(sheetPath('English'), { method: 'PUT', body: { marks: [{ student: students[5].id, marks: 10 }] } });
    assert.equal(late.body.code, 'DEADLINE_PASSED');
    const web = await owner(`${O}/marks/${ctx.papers.English.id}/${ctx.section.id}`, { method: 'PUT', body: { marks: students.map((s, i) => ({ student: s.id, marks: i === 0 ? null : 25, absent: i === 0 })) } });
    assert.equal(web.status, 200, JSON.stringify(web.body));
    assert.equal(web.body.stats.absent, 1, 'entered as absent: no attendance was taken for English');
    assert.equal((await owner(`${O}/marks/${ctx.papers.English.id}/${ctx.section.id}/approve`, { method: 'POST' })).body.status, 'approved', 'approved directly when complete');
  });

  test('audit and the switch', async () => {
    const actions = new Set((await prisma.auditEvent.findMany({ where: { schoolId: ctx.school.id }, select: { action: true } })).map((e) => e.action));
    for (const a of ['EXAM_ATTENDANCE_RECORDED', 'EXAM_MARKS_SAVED', 'EXAM_MARKS_SUBMITTED', 'EXAM_MARKS_RETURNED', 'EXAM_MARKS_APPROVED']) assert.ok(actions.has(a), a);
    await prisma.school.update({ where: { id: ctx.school.id }, data: { examinationsEnabled: false } });
    assert.equal((await teacher('t1')('/api/teacher/exams/marks')).body.code, 'FEATURE_DISABLED');
    await prisma.school.update({ where: { id: ctx.school.id }, data: { examinationsEnabled: true } });
  });
});

describe('documents (Unicode PDFs)', () => {
  test('timetable, duties, seating lists, registers and mark sheets download as PDFs', async () => {
    const exam = `${O}/examinations/${ctx.exam.id}/documents`;
    for (const path of [`${exam}/timetable?branch=${ctx.branch.id}`, `${exam}/duties?branch=${ctx.branch.id}`, `${exam}/seating?session=${ctx.mathSession.id}`, `${exam}/register?session=${ctx.mathSession.id}`, `${O}/marks/${ctx.papers.Math.id}/${ctx.section.id}/pdf`, `${O}/marks/${ctx.papers.Math.id}/${ctx.section.id}/pdf?blank=true`]) {
      const r = await raw(path, cookies.OWNER);
      assert.equal(r.status, 200, path);
      assert.equal(r.type, 'application/pdf');
      assert.match(r.disposition, /attachment; filename=/);
      assert.equal(r.buffer.subarray(0, 8).toString('latin1'), '%PDF-1.7');
      assert.match(r.buffer.toString('latin1'), /\/Encoding \/Identity-H/);
    }
    assert.equal((await raw(`${exam}/seating`, cookies.OWNER)).status, 400, 'a session is needed');
    assert.equal((await raw(`${exam}/report`, cookies.OWNER)).status, 404);
  });
});

describe('results', () => {
  const R = () => `${O}/examinations/${ctx.exam.id}/results`;
  const of = (body, i) => body.students.find((x) => x.student.id === students[i].id);
  test('draft results are calculated live from the approved marks; approving stores them and fixes marks and attendance', async () => {
    const list = await owner(R());
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.deepEqual(list.body.counts, { draft: 1, approved: 0, published: 0 });
    assert.equal(list.body.items[0].actions.approve, true);
    const live = await owner(`${R()}/${ctx.section.id}`);
    assert.equal(live.body.live, true);
    assert.deepEqual([of(live.body, 2).percent, of(live.body, 2).grade, of(live.body, 2).rank], [65.5, 'B', 1]);
    assert.deepEqual([of(live.body, 1).percent, of(live.body, 1).passed], [50, true], 'excused Math left out');
    assert.deepEqual([of(live.body, 0).percent, of(live.body, 0).passed], [0, false], 'absent counts as zero');
    assert.equal(live.body.summary.passed, 3);
    const approved = await owner(`${R()}/${ctx.section.id}/approve`, { method: 'POST' });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.status, 'approved');
    assert.equal(approved.body.students.length, 6);
    const marks = await owner(`${O}/marks/${ctx.papers.Math.id}/${ctx.section.id}/return`, { method: 'POST', body: { reason: 'Recheck' } });
    assert.equal(marks.body.code, 'RESULTS_PUBLISHED', 'marks are fixed');
    const att = await owner(`${O}/examinations/${ctx.exam.id}/sessions/${ctx.mathSession.id}/attendance`, { method: 'PUT', body: { marks: [{ student: students[0].id, status: 'present' }] } });
    assert.equal(att.body.code, 'RESULTS_PUBLISHED', 'attendance is fixed');
    assert.equal((await owner(`${R()}/${ctx.section.id}/reopen`, { method: 'POST' })).body.status, 'draft');
    assert.equal((await owner(`${R()}/${ctx.section.id}/approve`, { method: 'POST' })).body.status, 'approved');
  });

  test('publishing records a revision; report cards print; a correction is a new revision', async () => {
    const published = await owner(`${R()}/publish-all`, { method: 'POST' });
    assert.equal(published.status, 200, JSON.stringify(published.body));
    assert.equal(published.body.published, 1);
    const one = await owner(`${R()}/${ctx.section.id}`);
    assert.deepEqual([one.body.status, one.body.revision, one.body.revisions.length, one.body.actions.correct], ['published', 1, 1, true]);
    const cards = await raw(`${R()}/${ctx.section.id}/report-cards`, cookies.OWNER);
    assert.equal(cards.status, 200);
    assert.equal(cards.type, 'application/pdf');
    assert.equal((cards.buffer.toString('latin1').match(/\/Type \/Page /g) ?? []).length, 6, 'one page per student');
    assert.equal((await owner(`${R()}/${ctx.section.id}/correct`, { method: 'POST', body: { reason: 'x' } })).status, 400);
    const reopened = await owner(`${R()}/${ctx.section.id}/correct`, { method: 'POST', body: { reason: 'S6 Math remarked' } });
    assert.deepEqual([reopened.body.status, reopened.body.correctionReason], ['draft', 'S6 Math remarked']);
    await owner(`${O}/marks/${ctx.papers.Math.id}/${ctx.section.id}/return`, { method: 'POST', body: { reason: 'Remark S6' } });
    await owner(`${O}/marks/${ctx.papers.Math.id}/${ctx.section.id}`, { method: 'PUT', body: { marks: [{ student: students[5].id, marks: 30 }] } });
    await owner(`${O}/marks/${ctx.papers.Math.id}/${ctx.section.id}/approve`, { method: 'POST' });
    await owner(`${R()}/${ctx.section.id}/approve`, { method: 'POST' });
    const again = await owner(`${R()}/${ctx.section.id}/publish`, { method: 'POST' });
    assert.deepEqual([again.body.revision, again.body.revisions.length, again.body.revisions[0].reason], [2, 2, 'S6 Math remarked']);
    assert.equal(of(again.body, 5).percent, 55);
    const old = await prisma.examResult.count({ where: { studentId: students[5].id, revision: 1 } });
    assert.equal(old, 1, 'the first revision is kept');
  });

  test('the year’s final results are handed to Promotion', async () => {
    const final = await owner(`${O}/final-results?section=${ctx.section.id}`);
    assert.equal(final.status, 200, JSON.stringify(final.body));
    assert.equal(final.body.examinations.length, 1);
    const s2 = final.body.students.find((x) => x.student.id === students[2].id);
    assert.deepEqual([s2.percent, s2.grade, s2.passed, s2.enrollmentResult], [65.5, 'B', true, null]);
    const handed = await owner('/api/owner/exams/final-results/hand-over', { method: 'POST', body: { section: ctx.section.id } });
    assert.deepEqual(handed.body, { set: 6, kept: 0, none: 0 });
    const enrollment = await prisma.enrollment.findFirst({ where: { studentId: students[0].id } });
    assert.equal(enrollment.result, 'FAILED');
    await prisma.enrollment.update({ where: { id: enrollment.id }, data: { result: 'PASSED' } });
    const kept = await owner('/api/owner/exams/final-results/hand-over', { method: 'POST', body: { section: ctx.section.id } });
    assert.deepEqual(kept.body, { set: 0, kept: 6, none: 0 }, 'results already recorded (by hand too) stay');
    assert.equal((await prisma.enrollment.findUnique({ where: { id: enrollment.id } })).result, 'PASSED');
    const forced = await owner('/api/owner/exams/final-results/hand-over', { method: 'POST', body: { section: ctx.section.id, overwrite: true } });
    assert.deepEqual(forced.body, { set: 6, kept: 0, none: 0 });
    assert.equal((await prisma.enrollment.findUnique({ where: { id: enrollment.id } })).result, 'FAILED');
    const actions = new Set((await prisma.auditEvent.findMany({ where: { schoolId: ctx.school.id }, select: { action: true } })).map((e) => e.action));
    for (const a of ['EXAM_RESULTS_APPROVED', 'EXAM_RESULTS_REOPENED', 'EXAM_RESULTS_PUBLISHED', 'EXAM_RESULTS_CORRECTION_OPENED', 'EXAM_FINAL_RESULTS_HANDED_OVER']) assert.ok(actions.has(a), a);
  });
});

describe('analytics', () => {
  test('basic, then advanced by setting', async () => {
    const basic = await owner(`${O}/examinations/${ctx.exam.id}/analytics`);
    assert.equal(basic.status, 200, JSON.stringify(basic.body));
    assert.equal(basic.body.level, 'basic');
    assert.deepEqual([basic.body.overall.students, basic.body.overall.passed, basic.body.provisional], [6, 4, false], 'after the correction S6 passes');
    assert.deepEqual(basic.body.subjects.map((x) => x.subject), ['English', 'Math']);
    assert.equal(basic.body.branches, undefined);
    await owner(`${O}/settings`, { method: 'PUT', body: { values: { analyticsLevel: 'advanced' } } });
    const advanced = await owner(`${O}/examinations/${ctx.exam.id}/analytics`);
    assert.equal(advanced.body.level, 'advanced');
    assert.equal(advanced.body.top[0].student.id, students[2].id);
    assert.equal(advanced.body.spread.reduce((n, b) => n + b.count, 0), 6);
    assert.equal(advanced.body.branches.length, 1);
  });
});

describe('paper files (private storage)', () => {
  const KEY = `test-service-key-${tag}`;
  const objects = new Map();
  const calls = [];
  let bucket = null;
  const files = () => `${O}/papers/${ctx.papers.Math.id}/files`;
  before(() => {
    // A stand-in for Supabase Storage: buckets, signed upload links, objects, signed download links.
    setStorageTransport(async (url, init) => {
      const path = url.replace('https://storage.test/storage/v1', '');
      calls.push({ method: init.method, path, auth: init.headers.authorization });
      const json = (status, data) => ({ status, ok: status < 300, headers: new Map(), text: async () => JSON.stringify(data) });
      if (init.method === 'GET' && path.startsWith('/bucket/')) return bucket ? json(200, bucket) : json(404, { error: 'not found' });
      if (init.method === 'POST' && path === '/bucket') {
        bucket = JSON.parse(init.body);
        return json(200, { name: bucket.id });
      }
      if (init.method === 'POST' && path.startsWith('/object/upload/sign/')) return json(200, { url: `${path}?token=up` });
      if (init.method === 'HEAD') {
        const key = decodeURIComponent(path.replace(/^\/object\/authenticated\/[^/]+\//, ''));
        return objects.has(key) ? { status: 200, ok: true, headers: new Map([['content-length', String(objects.get(key))]]) } : { status: 404, ok: false, headers: new Map() };
      }
      if (init.method === 'POST' && path.startsWith('/object/sign/')) return json(200, { signedURL: `${path}?token=down` });
      if (init.method === 'DELETE') {
        for (const key of JSON.parse(init.body).prefixes) objects.delete(key);
        return json(200, []);
      }
      return json(400, { error: 'unexpected' });
    });
  });
  after(() => {
    setStorageTransport(null);
    env.supabaseUrl = undefined;
    env.supabaseServiceKey = undefined;
  });

  test('not set up: the list says so and uploads are refused', async () => {
    env.supabaseUrl = undefined;
    env.supabaseServiceKey = undefined;
    const list = await owner(files());
    assert.equal(list.status, 200);
    assert.equal(list.body.configured, false);
    const start = await owner(files(), { method: 'POST', body: { kind: 'question_paper', fileName: 'math.pdf', contentType: 'application/pdf', size: 1000 } });
    assert.equal(start.status, 503);
    assert.equal(start.body.code, 'STORAGE_NOT_CONFIGURED');
  });

  test('upload through a signed link, confirm by size, download (audited), remove (record kept)', async () => {
    env.supabaseUrl = 'https://storage.test';
    env.supabaseServiceKey = KEY;
    const bad = await owner(files(), { method: 'POST', body: { kind: 'question_paper', fileName: 'run.exe', contentType: 'application/x-msdownload', size: 10 } });
    assert.equal(bad.status, 400);
    const big = await owner(files(), { method: 'POST', body: { kind: 'question_paper', fileName: 'big.pdf', contentType: 'application/pdf', size: 30 * 1024 * 1024 } });
    assert.equal(big.status, 400);
    const start = await owner(files(), { method: 'POST', body: { kind: 'question_paper', fileName: 'Xisaab – Mid-Term.pdf', contentType: 'application/pdf', size: 1234 } });
    assert.equal(start.status, 201, JSON.stringify(start.body));
    assert.equal(bucket.public, false, 'the bucket is created private');
    assert.match(start.body.upload.url, /^https:\/\/storage\.test\/storage\/v1\/object\/upload\/sign\/exam-papers\/.+\?token=up$/);
    assert.ok(!JSON.stringify(start.body).includes(KEY), 'the service key never reaches the browser');
    const fileId = start.body.file.id;
    const key = (await prisma.examPaperFile.findUnique({ where: { id: fileId } })).storageKey;
    assert.ok(key.startsWith(`${ctx.school.id}/${ctx.exam.id}/${ctx.papers.Math.id}/`));
    assert.equal((await owner(`${files()}/${fileId}/confirm`, { method: 'POST' })).body.code, 'UPLOAD_INCOMPLETE', 'nothing stored yet');
    objects.set(key, 1000);
    assert.equal((await owner(`${files()}/${fileId}/confirm`, { method: 'POST' })).body.code, 'UPLOAD_INCOMPLETE', 'wrong size');
    objects.set(key, 1234);
    const ready = await owner(`${files()}/${fileId}/confirm`, { method: 'POST' });
    assert.equal(ready.body.file.status, 'ready');
    const link = await owner(`${files()}/${fileId}/download`, { method: 'POST' });
    assert.equal(link.status, 200);
    assert.match(link.body.url, /token=down&download=Xisaab/);
    assert.ok(Date.parse(link.body.expiresAt) - Date.now() <= 120_000);
    const removed = await owner(`${files()}/${fileId}/remove`, { method: 'POST' });
    assert.equal(removed.body.file.status, 'removed');
    assert.equal(objects.has(key), false, 'the stored file is deleted');
    const list = await owner(files());
    assert.deepEqual(list.body.files.map((f) => f.status), ['removed'], 'the record stays');
    assert.ok(calls.every((c) => c.auth === `Bearer ${KEY}`));
    const actions = new Set((await prisma.auditEvent.findMany({ where: { schoolId: ctx.school.id }, select: { action: true } })).map((e) => e.action));
    for (const a of ['EXAM_PAPER_FILE_UPLOADED', 'EXAM_PAPER_FILE_DOWNLOADED', 'EXAM_PAPER_FILE_REMOVED']) assert.ok(actions.has(a), a);
  });
});

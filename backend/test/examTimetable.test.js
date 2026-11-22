/*
 * Examinations, phase 3 (docs/business-rules.md → Examinations → Timetable): generating a branch's
 * timetable (papers in sessions, proportional seating, invigilators), moving papers, replacing
 * invigilators, seat lists, publishing with notifications, keeping the timetable consistent when
 * papers and dates change, Managers limited to their branch, isolation and audit.
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
const rooms = {};
const staff = {};
let year;
let type;
let exam;
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
const O = '/api/owner/exams/examinations';
const M = '/api/manager/exams/examinations';
const tt = (who, path = '', branch = branches.A1.id) => `${who === 'owner' ? O : M}/${exam.id}/timetable${path}${who === 'owner' ? `?branch=${branch}` : ''}`;
const GENERATE = () => ({ shifts: [{ name: 'Morning', start: '08:00', sessions: 2 }], gapMinutes: 30, rooms: Object.keys(rooms).filter((k) => k.startsWith('A1')).map((k) => ({ room: rooms[k].id })) });

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  today = await calendarToday();
  for (const key of ['A', 'B']) {
    schools[key] = await prisma.school.create({ data: { code: `TEXT${tag}-${key}`, name: `Exam Timetable ${key} ${tag}`, location: 'Mogadishu', phone: '+252 61 1234567', address: 'Road 1', examinationsEnabled: true } });
  }
  const branch = (key, school, number) =>
    prisma.branch.create({ data: { schoolId: schools[school].id, number, code: `TEXT${tag}-${key}`, name: `Branch ${key}`, nameKey: `branch ${key.toLowerCase()} ${lower}`, address: 'Road', city: 'Mogadishu' } });
  branches.A1 = await branch('A1', 'A', 1);
  branches.A2 = await branch('A2', 'A', 2);
  branches.B = await branch('B1', 'B', 1);
  const yearStart = T(-30);
  year = await prisma.academicYear.create({ data: { schoolId: schools.A.id, name: `Y ${tag}`, nameKey: `y ${lower}`, startDate: asDbDay(yearStart), endDate: asDbDay(T(300)), status: 'CURRENT', startedAt: new Date() } });
  await prisma.academicWeekdays.create({ data: { schoolId: schools.A.id, academicYearId: year.id, days: ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'], effectiveFrom: asDbDay(yearStart) } });
  type = await prisma.examType.create({ data: { schoolId: schools.A.id, name: 'Mid-Term', nameKey: 'mid-term', defaultMaxMarks: 100, stopsLessons: true } });
  for (const [key, seq] of [['G7', 1], ['G8', 2]]) classes[key] = await prisma.schoolClass.create({ data: { schoolId: schools.A.id, name: `Grade ${key}`, nameKey: `grade ${key.toLowerCase()}`, sequence: seq } });
  for (const key of ['Math', 'English', 'Science']) subjects[key] = await prisma.subject.create({ data: { schoolId: schools.A.id, name: key, nameKey: key.toLowerCase() } });
  await prisma.classSubject.createMany({
    data: [
      { schoolId: schools.A.id, classId: classes.G7.id, subjectId: subjects.Math.id },
      { schoolId: schools.A.id, classId: classes.G7.id, subjectId: subjects.English.id },
      { schoolId: schools.A.id, classId: classes.G8.id, subjectId: subjects.Math.id },
    ],
  });
  const section = (cls, branchKey, name) => prisma.section.create({ data: { schoolId: schools.A.id, branchId: branches[branchKey].id, classId: classes[cls].id, academicYearId: year.id, name, nameKey: name.toLowerCase() } });
  sections.G7A = await section('G7', 'A1', 'A');
  sections.G8A = await section('G8', 'A1', 'A');
  sections.G7B = await section('G7', 'A2', 'B');
  let n = 0;
  const enrol = async (key, count, branchKey) => {
    for (let i = 0; i < count; i += 1) {
      n += 1;
      const student = await prisma.student.create({
        data: { schoolId: schools.A.id, branchId: branches[branchKey].id, studentNumber: `TEXT${tag}-${n}`, firstName: `S${String(n).padStart(2, '0')}`, lastName: key, nameKey: `s${n} ${lower}`, gender: n % 2 ? 'MALE' : 'FEMALE', dateOfBirth: asDbDay('2012-01-01'), guardianName: 'G', guardianPhone: '+252 61 7654321', status: 'ENROLLED' },
      });
      await prisma.enrollment.create({ data: { schoolId: schools.A.id, branchId: branches[branchKey].id, studentId: student.id, academicYearId: year.id, sectionId: sections[key].id } });
    }
  };
  await enrol('G7A', 12, 'A1');
  await enrol('G8A', 8, 'A1');
  await enrol('G7B', 5, 'A2');
  for (const [key, branchKey, cap] of [['A1-R1', 'A1', 10], ['A1-R2', 'A1', 10], ['A1-R3', 'A1', 6], ['A2-R1', 'A2', 20]]) {
    rooms[key] = await prisma.examRoom.create({ data: { schoolId: schools.A.id, branchId: branches[branchKey].id, name: key.slice(3), nameKey: key.slice(3).toLowerCase(), defaultCapacity: cap } });
  }
  for (const [i, key] of ['t1', 't2', 't3', 't4'].entries()) {
    staff[key] = await prisma.user.create({ data: { name: `Teacher ${key} ${tag}`, email: `test-extt-${key}-${lower}@test.edutrack.example`, role: 'STAFF', branchId: branches.A1.id, staffId: `TEXT${tag}-ST${i}`, phoneKey: `+998${parseInt(randomBytes(4).toString('hex'), 16)}` } });
  }
  staff.a2 = await prisma.user.create({ data: { name: `Teacher a2 ${tag}`, email: `test-extt-a2-${lower}@test.edutrack.example`, role: 'STAFF', branchId: branches.A2.id, staffId: `TEXT${tag}-ST9`, phoneKey: `+998${parseInt(randomBytes(4).toString('hex'), 16)}` } });
  // t1 teaches Mathematics to Grade 7A.
  await prisma.teachingAssignment.create({ data: { schoolId: schools.A.id, academicYearId: year.id, branchId: branches.A1.id, sectionId: sections.G7A.id, teacherId: staff.t1.id, role: 'SUBJECT_TEACHER', subjectId: subjects.Math.id, startDate: asDbDay(yearStart) } });

  for (const [key, role, where] of [['OWNER_A', 'OWNER', 'A'], ['OWNER_B', 'OWNER', 'B'], ['MANAGER_A1', 'MANAGER', 'A1'], ['MANAGER_A2', 'MANAGER', 'A2']]) {
    const password = randomBytes(12).toString('base64url');
    const email = `test-extt-${key.toLowerCase().replace('_', '-')}-${lower}@test.edutrack.example`;
    const user = await prisma.user.create({ data: { name: `Test ${key} ${tag}`, email, role, ...(role === 'MANAGER' && { branchId: branches[where].id }), passwordHash: await hashPassword(password) } });
    if (role === 'OWNER') await prisma.school.update({ where: { id: schools[where].id }, data: { ownerId: user.id } });
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 200, `${key} sign-in`);
    cookies[key] = login.headers.get('set-cookie')?.split(';')[0];
  }
  const created = await owner(O, { method: 'POST', body: { examType: type.id, startDate: T(10), endDate: T(12), classes: [classes.G7.id, classes.G8.id] } });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  exam = created.body.examination;
  await owner('/api/owner/exams/settings', { method: 'PUT', body: { values: { avoidOwnSubject: true } } });
});

after(async () => {
  const schoolIds = Object.values(schools).map((s) => s.id);
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  const where = { schoolId: { in: schoolIds } };
  await prisma.pushMessage.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { recipientId: { in: userIds } } });
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
  await prisma.examSettings.deleteMany({ where });
  await prisma.auditEvent.deleteMany({ where: { OR: [where, { actorId: { in: userIds } }] } });
  await prisma.academicYear.deleteMany({ where });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.school.updateMany({ where: { id: { in: schoolIds } }, data: { ownerId: null } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  server.close();
  await prisma.$disconnect();
});

let timetable;
const sessionWith = (subject, className) => timetable.sessions.find((s) => s.papers.some((p) => p.subject.name === subject && (!className || p.class.name === className)));

describe('generating', () => {
  test('options: the branch’s rooms, staff, students and school days', async () => {
    const r = await owner(tt('owner', '/options'));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.rooms.length, 3);
    assert.equal(r.body.staff.length, 4);
    assert.equal(r.body.students, 20);
    assert.equal(r.body.days.filter((d) => d.schoolDay).length, 3);
    assert.equal((await owner(`${O}/${exam.id}/timetable`)).status, 400, 'a school-wide examination: the Owner names the branch');
  });

  test('papers of a subject together, everyone seated once, rooms shared in proportion, invigilators', async () => {
    const r = await owner(tt('owner', '/generate'), { method: 'POST', body: GENERATE() });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    timetable = r.body;
    assert.deepEqual(r.body.report, { unplaced: [], unseated: 0, shortfall: 0 });
    assert.deepEqual(r.body.unscheduled, []);
    const math = sessionWith('Math');
    assert.equal(math.papers.length, 2, 'Grade 7 and Grade 8 Mathematics together');
    assert.equal(math.students, 20);
    assert.deepEqual(math.rooms.map((x) => x.room.name), ['R1', 'R2'], 'the fewest rooms that seat everyone');
    for (const room of math.rooms) {
      assert.deepEqual(room.sections.map((s) => s.count).sort(), [4, 6], 'each room: 6 of Grade 7A and 4 of Grade 8A');
      assert.equal(room.invigilators.length, 1);
      assert.ok(!room.invigilators.some((i) => i.id === staff.t1.id), 'not the Mathematics teacher of Grade 7A');
    }
    assert.notEqual(sessionWith('English').date + sessionWith('English').start, math.date + math.start);
    assert.equal(await prisma.examSeat.count({ where: { session: { examinationId: exam.id } } }), 12 * 2 + 8);
    assert.equal(r.body.timetable.publishedAt, null);
    assert.equal(r.body.actions.publish, false, 'a draft is not published');
  });

  test('rooms and branches: a Manager prepares their own branch only', async () => {
    const own = await manager2(tt('manager', '/generate'), { method: 'POST', body: { ...GENERATE(), rooms: [{ room: rooms['A2-R1'].id }] } });
    assert.equal(own.status, 200, JSON.stringify(own.body));
    assert.equal(own.body.branch.id, branches.A2.id);
    assert.equal(own.body.summary.students, 5);
    assert.equal(own.body.report.shortfall, 0);
    assert.deepEqual(own.body.sessions.flatMap((x) => x.rooms.flatMap((r) => r.invigilators.map((i) => i.id))).filter((v, i, a) => a.indexOf(v) === i), [staff.a2.id], 'its own staff only');
    const foreign = await manager2(tt('manager', '/generate'), { method: 'POST', body: GENERATE() });
    assert.equal(foreign.status, 400, 'rooms of another branch');
    const seen = await manager1(tt('manager'));
    assert.equal(seen.body.branch.id, branches.A1.id);
    assert.equal(seen.body.sessions.length, timetable.sessions.length);
    assert.equal((await ownerB(tt('owner'))).status, 404);
  });

  test('bad choices are refused', async () => {
    const midnight = await owner(tt('owner', '/generate'), { method: 'POST', body: { ...GENERATE(), shifts: [{ name: 'Late', start: '23:00', sessions: 1 }] } });
    assert.equal(midnight.status, 400);
    assert.match(midnight.body.details.shifts, /midnight/);
    const order = await owner(tt('owner', '/generate'), { method: 'POST', body: { ...GENERATE(), shifts: [{ name: 'B', start: '12:00', sessions: 1 }, { name: 'A', start: '08:00', sessions: 1 }] } });
    assert.equal(order.status, 400);
  });
});

describe('adjusting', () => {
  test('seat lists alternate classes', async () => {
    const math = sessionWith('Math');
    const r = await owner(`${O}/${exam.id}/timetable/sessions/${math.id}/seats?branch=${branches.A1.id}`);
    assert.equal(r.status, 200);
    const r1 = r.body.rooms[0];
    assert.equal(r1.seats.length, 10);
    assert.notEqual(r1.seats[0].section.id, r1.seats[1].section.id);
  });

  test('moving a paper re-seats both sessions; a class sits one paper per session', async () => {
    const math = sessionWith('Math');
    const g8 = math.papers.find((p) => p.class.name === 'Grade G8');
    const r = await owner(`${O}/${exam.id}/timetable/sittings/${g8.sittingId}/move?branch=${branches.A1.id}`, { method: 'POST', body: { date: T(12), start: '13:00' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    timetable = r.body;
    const moved = timetable.sessions.find((s) => s.date === T(12) && s.start === '13:00');
    assert.equal(moved.students, 8);
    assert.equal(moved.rooms.length, 1);
    assert.equal(moved.rooms[0].invigilators.length, 1);
    assert.equal(sessionWith('Math', 'Grade G7').students, 12);
    const english = sessionWith('English');
    const clash = await owner(`${O}/${exam.id}/timetable/sittings/${english.papers[0].sittingId}/move?branch=${branches.A1.id}`, { method: 'POST', body: { session: sessionWith('Math', 'Grade G7').id } });
    assert.equal(clash.status, 409);
    assert.equal(clash.body.code, 'CLASS_BUSY');
    const outside = await owner(`${O}/${exam.id}/timetable/sittings/${g8.sittingId}/move?branch=${branches.A1.id}`, { method: 'POST', body: { date: T(20), start: '08:00' } });
    assert.equal(outside.status, 400);
    assert.equal(await prisma.examSeat.count({ where: { session: { examinationId: exam.id, branchId: branches.A1.id } } }), 32);
  });

  test('replacing invigilators: one room at a time per person', async () => {
    const math = sessionWith('Math', 'Grade G7');
    const room = math.rooms[0];
    const r = await owner(`${O}/${exam.id}/timetable/sessions/${math.id}/invigilators?branch=${branches.A1.id}`, { method: 'PUT', body: { room: room.room.id, staff: [staff.t3.id, staff.t4.id] } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const after = r.body.sessions.find((s) => s.id === math.id).rooms.find((x) => x.room.id === room.room.id);
    assert.deepEqual(after.invigilators.map((i) => i.id).sort(), [staff.t3.id, staff.t4.id].sort());
    const outsider = await owner(`${O}/${exam.id}/timetable/sessions/${math.id}/invigilators?branch=${branches.A1.id}`, { method: 'PUT', body: { room: room.room.id, staff: [staff.a2.id] } });
    assert.equal(outsider.status, 400, 'staff of another branch');
    timetable = r.body;
  });

  test('invigilator matrix: staff × days, every room with its session time; filters; PDF and Excel exports', async () => {
    const url = (who, query = '') => `${tt(who, '/invigilators')}${who === 'owner' ? '&' : '?'}${query}`;
    const m = await owner(url('owner'));
    assert.equal(m.status, 200, JSON.stringify(m.body));
    const expected = timetable.sessions.reduce((n, s) => n + s.rooms.reduce((k, r) => k + r.invigilators.length, 0), 0);
    assert.equal(m.body.summary.duties, expected, 'every invigilation is in the matrix');
    assert.deepEqual(m.body.days.map((d) => d.date), [...new Set(timetable.sessions.map((s) => s.date))].sort());
    for (const d of m.body.days) assert.equal(d.weekday, ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${d.date}T00:00:00Z`).getUTCDay()]);
    const math = sessionWith('Math', 'Grade G7');
    const t3 = m.body.rows.find((r) => r.staff.id === staff.t3.id);
    const duty = t3.cells[math.date].find((x) => x.sessionId === math.id);
    assert.deepEqual({ room: duty.room.id, start: duty.start, end: duty.end, sequence: duty.sequence }, { room: math.rooms[0].room.id, start: math.start, end: math.end, sequence: math.sequence }, 'the session time stays with the room');
    assert.deepEqual(m.body.options.shifts, ['Morning']);
    // Filters: one session of the day, dates; a Manager sees their branch.
    const second = await owner(url('owner', 'session=2'));
    const seconds = timetable.sessions.filter((s) => s.sequence === 2);
    assert.equal(second.body.summary.sessions, seconds.length);
    assert.ok(second.body.rows.every((r) => Object.values(r.cells).flat().every((x) => x.sequence === 2)));
    const firstDay = m.body.days[0].date;
    const oneDay = await owner(url('owner', `from=${firstDay}&to=${firstDay}`));
    assert.deepEqual(oneDay.body.days.map((d) => d.date), [firstDay]);
    assert.equal((await owner(url('owner', 'session=0'))).status, 400);
    assert.equal((await owner(url('owner', `from=${T(5)}&to=${T(1)}`))).status, 400);
    const mine = await manager1(url('manager'));
    assert.equal(mine.status, 200);
    assert.equal(mine.body.summary.duties, expected);
    // Exports carry the same filters.
    const raw = async (path) => {
      const r = await fetch(base + path, { headers: { cookie: cookies.OWNER_A } });
      return { status: r.status, type: r.headers.get('content-type'), bytes: Buffer.from(await r.arrayBuffer()) };
    };
    const pdf = await raw(`${tt('owner', '/invigilators/export')}&format=pdf&session=1`);
    assert.equal(pdf.status, 200);
    assert.equal(pdf.type, 'application/pdf');
    assert.equal(pdf.bytes.subarray(0, 5).toString(), '%PDF-');
    const xlsx = await raw(`${tt('owner', '/invigilators/export')}&format=xlsx`);
    assert.equal(xlsx.status, 200);
    assert.match(xlsx.type, /spreadsheetml/);
    assert.equal(xlsx.bytes.subarray(0, 2).toString(), 'PK');
    assert.equal((await raw(`${tt('owner', '/invigilators/export')}&format=doc`)).status, 400);
  });
});

describe('papers and dates keep the timetable consistent', () => {
  test('a longer paper lengthens its session; a removed paper leaves the timetable; a new one waits', async () => {
    const detail = await owner(`${O}/${exam.id}`);
    const g7 = detail.body.classes.find((c) => c.id === classes.G7.id);
    const english = g7.papers.find((p) => p.subject.name === 'English');
    const longer = await owner(`${O}/${exam.id}/papers/${english.id}`, { method: 'PATCH', body: { durationMinutes: 150 } });
    assert.equal(longer.status, 200, JSON.stringify(longer.body));
    const t1 = await owner(tt('owner'));
    const s = t1.body.sessions.find((x) => x.papers.some((p) => p.subject.name === 'English'));
    assert.equal(Number(s.end.slice(0, 2)) * 60 + Number(s.end.slice(3)) - (Number(s.start.slice(0, 2)) * 60 + Number(s.start.slice(3))), 150);
    const added = await owner(`${O}/${exam.id}/papers`, { method: 'POST', body: { class: classes.G8.id, subject: subjects.Science.id } });
    assert.equal(added.status, 201);
    const t2 = await owner(tt('owner'));
    assert.deepEqual(t2.body.unscheduled.map((u) => u.subject.name), ['Science']);
    const removed = await owner(`${O}/${exam.id}/papers/${english.id}`, { method: 'DELETE' });
    assert.equal(removed.status, 200);
    const t3 = await owner(tt('owner'));
    assert.ok(!t3.body.sessions.some((x) => x.papers.some((p) => p.subject.name === 'English')), 'its session went with it');
    const dates = await owner(`${O}/${exam.id}`, { method: 'PATCH', body: { endDate: T(11) } });
    assert.equal(dates.status, 409);
    assert.equal(dates.body.code, 'TIMETABLE_OUTSIDE');
    const where = await owner(`${O}/${exam.id}`, { method: 'PATCH', body: { branch: branches.A1.id } });
    assert.equal(where.body.code, 'TIMETABLE_EXISTS');
  });
});

describe('publishing', () => {
  test('only a scheduled examination, every paper timetabled, every room staffed; invigilators are told', async () => {
    const draft = await owner(tt('owner', '/publish'), { method: 'POST' });
    assert.equal(draft.body.code, 'NOT_SCHEDULED');
    assert.equal((await owner(`${O}/${exam.id}/schedule`, { method: 'POST' })).status, 200);
    const missing = await owner(tt('owner', '/publish'), { method: 'POST' });
    assert.equal(missing.body.code, 'PAPERS_NOT_TIMETABLED');
    const regenerated = await owner(tt('owner', '/generate'), { method: 'POST', body: GENERATE() });
    assert.equal(regenerated.status, 200);
    assert.deepEqual(regenerated.body.unscheduled, []);
    const r = await owner(tt('owner', '/publish'), { method: 'POST' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.timetable.publishedAt);
    assert.equal(r.body.timetable.changedSincePublish, false);
    const invigilators = new Set(r.body.sessions.flatMap((s) => s.rooms.flatMap((x) => x.invigilators.map((i) => i.id))));
    const notes = await prisma.notification.findMany({ where: { type: 'EXAM_DUTIES', recipientId: { in: Object.values(staff).map((s) => s.id) } } });
    assert.equal(notes.length, invigilators.size);
    assert.ok(notes.every((n) => n.params.examination === exam.name && n.params.duties.length > 0));
    // A change after publishing shows; publishing again tells them again.
    const s = r.body.sessions[0];
    const changed = await owner(`${O}/${exam.id}/timetable/sessions/${s.id}/invigilators?branch=${branches.A1.id}`, { method: 'PUT', body: { room: s.rooms[0].room.id, staff: [staff.t2.id] } });
    assert.equal(changed.body.timetable.changedSincePublish, true);
    await owner(tt('owner', '/publish'), { method: 'POST' });
    assert.ok((await prisma.notification.count({ where: { type: 'EXAM_DUTIES', recipientId: { in: Object.values(staff).map((x) => x.id) } } })) > notes.length);
  });

  test('clearing, and the audit', async () => {
    const cleared = await manager2(tt('manager', '/clear'), { method: 'POST' });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.timetable, null);
    assert.equal(cleared.body.sessions.length, 0);
    const actions = new Set((await prisma.auditEvent.findMany({ where: { schoolId: schools.A.id, targetId: exam.id }, select: { action: true } })).map((e) => e.action));
    for (const a of ['EXAM_TIMETABLE_GENERATED', 'EXAM_TIMETABLE_CHANGED', 'EXAM_TIMETABLE_PUBLISHED', 'EXAM_TIMETABLE_CLEARED']) assert.ok(actions.has(a), a);
  });
});

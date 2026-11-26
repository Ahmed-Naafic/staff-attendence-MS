/*
 * School Owner and Manager dashboards (GET /api/owner/dashboard, /api/manager/dashboard), end to end
 * through the API: figures from the records (students, staff, classes, sections, branches), fee figures
 * equal to Fee Management's own overview and branch report, today's attendance from the sessions,
 * examinations, alerts; the Owner's branch filter; a Manager only ever sees their branch (a branch in
 * the request is ignored); other roles and other schools are refused.
 * Runs on the Neon dev branch (`npm test`); everything it creates is removed afterwards.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { calendarToday } from '../src/features/academic-calendar/calendar.service.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { addDays, addMonths, monthOf } from '../src/features/fees/feeRules.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Dashboard tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const PASSWORD = `Dash-${randomBytes(9).toString('base64url')}-9a`;
const cookies = {};
const ctx = {};
let server;
let base;
let today;

async function call(path, { as, query } = {}) {
  const url = new URL(base + path);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  const response = await fetch(url, { headers: { ...(as && { cookie: cookies[as] }) } });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const ok = (res, status = 200) => assert.equal(res.status, status, JSON.stringify(res.body));
const day = (d) => new Date(`${d}T00:00:00Z`);

async function login(key, email) {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, password: PASSWORD }) });
  assert.equal(res.status, 200, `login ${key}`);
  cookies[key] = res.headers.get('set-cookie')?.split(';')[0];
}
const userEmail = (key) => `test-dash-${key}-${lower}@test.edutrack.example`;
const makeUser = async (key, role, branchId, extra = {}) => prisma.user.create({ data: { name: `${key} ${tag}`, email: userEmail(key), role, ...(branchId && { branchId }), passwordHash: await hashPassword(PASSWORD), ...extra } });
// Staff accounts carry a staff ID and a phone (their sign-in on the mobile app).
let phone = 0;
const staffExtra = () => {
  phone += 1;
  return { staffId: `TDSH${tag}-S${phone}`, phoneKey: `+999${parseInt(tag, 16)}${phone}` };
};

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  today = await calendarToday();
  const month = monthOf(today);
  const yearStart = addMonths(month, -2);
  const school = await prisma.school.create({ data: { code: `TDSH${tag}`, name: `Dashboard ${tag}`, location: 'Mogadishu', feesEnabled: true, examinationsEnabled: true, studentAttendanceEnabled: true } });
  ctx.school = school;
  ctx.b1 = await prisma.branch.create({ data: { schoolId: school.id, number: 1, code: `TDSH${tag}-B001`, name: 'Main', nameKey: `main ${lower}`, address: 'Road', city: 'Mogadishu' } });
  ctx.b2 = await prisma.branch.create({ data: { schoolId: school.id, number: 2, code: `TDSH${tag}-B002`, name: 'North', nameKey: `north ${lower}`, address: 'Road', city: 'Mogadishu' } });
  ctx.year = await prisma.academicYear.create({ data: { schoolId: school.id, name: `Y ${tag}`, nameKey: `y ${lower}`, startDate: day(yearStart), endDate: day(addDays(addMonths(month, 8), -1)), status: 'CURRENT', startedAt: new Date() } });
  await prisma.academicWeekdays.create({ data: { schoolId: school.id, academicYearId: ctx.year.id, days: ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'], effectiveFrom: day(yearStart) } });
  ctx.class = await prisma.schoolClass.create({ data: { schoolId: school.id, name: 'Grade 7', nameKey: 'grade 7', sequence: 1 } });
  ctx.secA = await prisma.section.create({ data: { schoolId: school.id, branchId: ctx.b1.id, classId: ctx.class.id, academicYearId: ctx.year.id, name: 'A', nameKey: 'a' } });
  ctx.secN = await prisma.section.create({ data: { schoolId: school.id, branchId: ctx.b2.id, classId: ctx.class.id, academicYearId: ctx.year.id, name: 'N', nameKey: 'n' } });

  const students = {};
  const student = async (key, branch, section, status = 'ENROLLED') => {
    const s = await prisma.student.create({ data: { schoolId: school.id, branchId: branch.id, studentNumber: `TDSH${tag}-${key}`, firstName: key, lastName: 'Test', nameKey: `${key} ${lower}`, gender: 'FEMALE', dateOfBirth: day('2012-01-01'), guardianName: 'Guardian', guardianPhone: '+252 61 7654321', status } });
    const enrollment = section ? await prisma.enrollment.create({ data: { schoolId: school.id, branchId: branch.id, studentId: s.id, academicYearId: ctx.year.id, sectionId: section.id, enrolledAt: new Date(`${yearStart}T08:00:00Z`) } }) : null;
    students[key] = { ...s, enrollment };
  };
  await student('s1', ctx.b1, ctx.secA);
  await student('s2', ctx.b1, ctx.secA);
  await student('s3', ctx.b2, ctx.secN);
  await student('p1', ctx.b1, null, 'PENDING_ENROLLMENT');
  ctx.students = students;

  const owner = await makeUser('owner', 'OWNER');
  await prisma.school.update({ where: { id: school.id }, data: { ownerId: owner.id } });
  ctx.manager = await makeUser('manager', 'MANAGER', ctx.b1.id);
  await makeUser('manager2', 'MANAGER', ctx.b2.id);
  await makeUser('accountant', 'ACCOUNTANT', ctx.b1.id);
  await makeUser('staff1', 'STAFF', ctx.b1.id, staffExtra());
  await makeUser('staff2', 'STAFF', ctx.b1.id, staffExtra());
  await makeUser('staff3', 'STAFF', ctx.b2.id, staffExtra());
  await makeUser('gone', 'STAFF', ctx.b1.id, { ...staffExtra(), status: 'SUSPENDED' });

  // Fees of this month: s1 paid in full (with a payment), s2 half, s3 nothing and overdue.
  const fee = (s, branch, section, net, paid, due) =>
    prisma.feeObligation.create({ data: { schoolId: school.id, branchId: branch.id, studentId: s.id, enrollmentId: s.enrollment.id, academicYearId: ctx.year.id, classId: ctx.class.id, sectionId: section.id, kind: 'MONTHLY', billingMonth: day(month), title: 'Monthly fee', standardAmount: net, amount: net, netAmount: net, paidAmount: paid, status: paid >= net ? 'PAID' : 'OPEN', dueDate: day(due), source: 'GENERATED' } });
  const o1 = await fee(students.s1, ctx.b1, ctx.secA, 1000, 1000, today);
  const o2 = await fee(students.s2, ctx.b1, ctx.secA, 1000, 500, today);
  await fee(students.s3, ctx.b2, ctx.secN, 2000, 0, addDays(today, -40));
  const pay = async (s, o, amount) => {
    const p = await prisma.feePayment.create({ data: { schoolId: school.id, branchId: ctx.b1.id, studentId: s.id, amount, receivedAt: new Date(), recordedById: ctx.manager.id, recordedByName: ctx.manager.name, recordedByRole: 'MANAGER' } });
    await prisma.feeAllocation.create({ data: { paymentId: p.id, obligationId: o.id, amount } });
    return p;
  };
  ctx.p1 = await pay(students.s1, o1, 1000);
  ctx.p2 = await pay(students.s2, o2, 500);

  // Today's attendance in section A: s1 present, s2 late.
  const now = new Date();
  const session = await prisma.studentAttendanceSession.create({ data: { schoolId: school.id, branchId: ctx.b1.id, academicYearId: ctx.year.id, sectionId: ctx.secA.id, kind: 'HALF_DAY', date: day(today), half: 'WHOLE_DAY', opensAt: new Date(now.getTime() - 3_600_000), deadlineAt: new Date(now.getTime() + 3_600_000), openedAt: now, openedById: ctx.manager.id, openedByName: ctx.manager.name } });
  for (const [key, status] of [['s1', 'PRESENT'], ['s2', 'LATE']]) {
    await prisma.studentAttendanceEntry.create({ data: { sessionId: session.id, schoolId: school.id, branchId: ctx.b1.id, studentId: students[key].id, enrollmentId: students[key].enrollment.id, status, markedAt: now, markedById: ctx.manager.id, markedByName: ctx.manager.name, markedByRole: 'MANAGER', occurredAt: now, syncedAt: now, source: 'WEB', version: 1 } });
  }

  // A school-wide examination in five days (planned) and a draft.
  ctx.examType = await prisma.examType.create({ data: { schoolId: school.id, name: 'Mid-Term', nameKey: 'mid-term', defaultMaxMarks: 50, stopsLessons: false } });
  ctx.exam = await prisma.examination.create({ data: { schoolId: school.id, academicYearId: ctx.year.id, examTypeId: ctx.examType.id, name: 'Mid-Term', nameKey: 'mid-term', startDate: day(addDays(today, 5)), endDate: day(addDays(today, 9)), stopsLessons: false, status: 'SCHEDULED', scheduledAt: new Date() } });
  await prisma.examination.create({ data: { schoolId: school.id, academicYearId: ctx.year.id, examTypeId: ctx.examType.id, branchId: ctx.b2.id, name: 'North quiz', nameKey: 'north quiz', startDate: day(addDays(today, 20)), endDate: day(addDays(today, 21)), stopsLessons: false } });

  for (const key of ['owner', 'manager', 'manager2', 'accountant']) await login(key, userEmail(key));
  // Another school, to check isolation.
  ctx.school2 = await prisma.school.create({ data: { code: `TDSX${tag}`, name: `Other ${tag}`, location: 'Hargeisa' } });
  ctx.other = await prisma.branch.create({ data: { schoolId: ctx.school2.id, number: 1, code: `TDSX${tag}-B001`, name: 'Other', nameKey: `other ${lower}`, address: 'Road', city: 'Hargeisa' } });
  const otherOwner = await makeUser('owner2', 'OWNER');
  await prisma.school.update({ where: { id: ctx.school2.id }, data: { ownerId: otherOwner.id } });
  await login('owner2', userEmail('owner2'));
});

after(async () => {
  try {
    await cleanUp();
  } finally {
    server.close();
    await prisma.$disconnect();
  }
});

async function cleanUp() {
  const schoolIds = [ctx.school?.id, ctx.school2?.id].filter(Boolean);
  const leftovers = (await prisma.school.findMany({ where: { code: { in: [`TDSH${tag}`, `TDSX${tag}`] } }, select: { id: true } })).map((x) => x.id);
  for (const id of leftovers) if (!schoolIds.includes(id)) schoolIds.push(id);
  const where = { schoolId: { in: schoolIds } };
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  await prisma.studentAttendanceEntry.deleteMany({ where });
  await prisma.studentAttendanceSession.deleteMany({ where });
  await prisma.feeAllocation.deleteMany({ where: { payment: where } });
  await prisma.feeReceipt.deleteMany({ where });
  await prisma.feePayment.deleteMany({ where });
  await prisma.feeObligation.deleteMany({ where });
  await prisma.feeGenerationRun.deleteMany({ where });
  await prisma.feeSettings.deleteMany({ where });
  await prisma.examination.deleteMany({ where });
  await prisma.examType.deleteMany({ where });
  await prisma.enrollment.deleteMany({ where });
  await prisma.student.deleteMany({ where });
  await prisma.section.deleteMany({ where });
  await prisma.schoolClass.deleteMany({ where });
  await prisma.academicWeekdays.deleteMany({ where });
  await prisma.auditEvent.deleteMany({ where: { OR: [where, { actorId: { in: userIds } }] } });
  await prisma.academicYear.deleteMany({ where });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.school.updateMany({ where: { id: { in: schoolIds } }, data: { ownerId: null } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
}

describe('Owner and Manager dashboards', () => {
  test('the School Owner sees the whole school, from the records', async () => {
    const res = await call('/api/owner/dashboard', { as: 'owner' });
    ok(res);
    const d = res.body;
    assert.equal(d.role, 'OWNER');
    assert.equal(d.branch, null);
    assert.deepEqual(d.filters.branches.map((b) => b.name), ['Main', 'North']);
    assert.equal(d.kpis.students.value, 3);
    assert.equal(d.kpis.staff.value, 3, 'active staff only');
    assert.equal(d.kpis.classes.value, 1);
    assert.equal(d.kpis.sections.value, 2);
    assert.equal(d.kpis.branches.value, 2);
    assert.deepEqual(d.studentsByBranch.map((b) => [b.name, b.students]), [['Main', 2], ['North', 1]]);
    assert.ok(d.alerts.some((a) => a.key === 'pending-enrollment' && a.count === 1));
    assert.ok(d.alerts.some((a) => a.key === 'overdue' && a.count === 1), JSON.stringify(d.alerts));
    assert.deepEqual(d.examinations.counts, { draft: 1, planned: 1, active: 0, completed: 0 });
    assert.ok(d.recentActivity.some((a) => a.type === 'payment' && a.amount === 1000));
    assert.ok(d.recentActivity.some((a) => a.type === 'examination' && a.title.includes('Mid-Term')));
  });

  test('fee figures equal Fee Management’s overview and branch report', async () => {
    const [dash, overview, report] = await Promise.all([call('/api/owner/dashboard', { as: 'owner' }), call('/api/owner/fees/overview', { as: 'owner' }), call('/api/owner/fees/reports/branches', { as: 'owner' })]);
    ok(dash);
    ok(overview);
    ok(report);
    const k = dash.body.kpis.fees;
    assert.deepEqual([k.expected, k.collected, k.outstanding, k.overdue], [4000, 1500, 2500, 2000]);
    assert.deepEqual([k.expected, k.collected, k.outstanding, k.overdue], [overview.body.kpis.expected, overview.body.kpis.collected, overview.body.kpis.outstanding, overview.body.kpis.overdue]);
    assert.equal(k.rate, overview.body.kpis.rate / 100);
    const rows = dash.body.branchPerformance.rows;
    for (const r of report.body.rows) {
      const mine = rows.find((x) => x.name === r.label);
      assert.deepEqual([mine.students, mine.expected, mine.collected, mine.outstanding, mine.overdue, mine.rate], [r.students, r.expected, r.collected, r.outstanding, r.overdue, r.rate / 100], r.label);
    }
    assert.deepEqual(dash.body.feeTrend.map((m) => [m.month, m.expected, m.collected]), overview.body.trend.map((m) => [m.month, m.expected, m.collected]));
  });

  test('the Owner’s branch filter narrows every figure to that branch', async () => {
    const res = await call('/api/owner/dashboard', { as: 'owner', query: { branch: ctx.b2.id } });
    ok(res);
    const d = res.body;
    assert.equal(d.branch.name, 'North');
    assert.equal(d.kpis.students.value, 1);
    assert.equal(d.kpis.staff.value, 1);
    assert.equal(d.kpis.sections.value, 1);
    assert.deepEqual([d.kpis.fees.expected, d.kpis.fees.collected], [2000, 0]);
    assert.deepEqual(d.studentsByBranch.map((b) => b.name), ['North']);
    assert.ok(!d.recentActivity.some((a) => a.type === 'payment'), 'payments of Main are not North’s');
    assert.equal(d.examinations.counts.draft, 1, 'North’s own draft');
    assert.ok(d.branchPerformance.rows.find((r) => r.name === 'North').selected);
  });

  test('the Manager sees only their branch, whatever the request names', async () => {
    for (const query of [{}, { branch: ctx.b2.id }]) {
      const res = await call('/api/manager/dashboard', { as: 'manager', query });
      ok(res);
      const d = res.body;
      assert.equal(d.role, 'MANAGER');
      assert.equal(d.branch.name, 'Main');
      assert.deepEqual(d.filters.branches, [], 'no branch list for Managers');
      assert.equal(d.kpis.students.value, 2);
      assert.equal(d.kpis.staff.value, 2);
      assert.equal(d.kpis.sections.value, 1);
      assert.equal(d.kpis.branches, undefined);
      assert.deepEqual([d.kpis.fees.expected, d.kpis.fees.collected, d.kpis.fees.outstanding], [2000, 1500, 500]);
      assert.deepEqual(d.recentPayments.map((p) => p.amount).sort(), [1000, 500].sort());
      assert.ok(d.recentPayments.every((p) => p.class === 'Grade 7 A'));
      assert.deepEqual([d.dailySummary.received, d.dailySummary.payments, d.dailySummary.students], [1500, 2, 2]);
      assert.equal(d.dailySummary.closing.state, 'open');
      assert.deepEqual([d.attendanceToday.present, d.attendanceToday.late, d.attendanceToday.absent, d.attendanceToday.rate], [1, 1, 0, 100]);
      assert.deepEqual(d.studentStatus.items.map((s) => [s.status, s.count]), [['enrolled', 2], ['pending_enrollment', 1], ['transferred_out', 0], ['graduated', 0]]);
      assert.equal(d.examinations.counts.draft, 0, 'North’s draft is not Main’s');
      assert.equal(d.examinations.counts.planned, 1);
      assert.equal(d.branchPerformance, undefined);
      assert.equal(d.recentActivity, undefined);
    }
    const north = await call('/api/manager/dashboard', { as: 'manager2' });
    ok(north);
    assert.equal(north.body.branch.name, 'North');
    assert.deepEqual(north.body.recentPayments, []);
    assert.equal(north.body.kpis.students.value, 1);
    assert.ok(north.body.alerts.some((a) => a.key === 'overdue' && a.count === 1));
  });

  test('filters are checked; other schools’ branches and other roles are refused', async () => {
    assert.equal((await call('/api/owner/dashboard', { as: 'owner', query: { branch: ctx.other.id } })).status, 404);
    assert.equal((await call('/api/owner/dashboard', { as: 'owner', query: { branch: 'nope' } })).status, 400);
    assert.equal((await call('/api/owner/dashboard', { as: 'owner', query: { academicYear: ctx.year.id.replace(/.$/, '0') } })).status, 404);
    assert.equal((await call('/api/owner/dashboard', { as: 'owner', query: { from: '2026-02-10', to: '2026-02-01' } })).status, 400);
    assert.equal((await call('/api/owner/dashboard', { as: 'owner', query: { from: 'yesterday' } })).status, 400);
    assert.equal((await call('/api/owner/dashboard', { as: 'manager' })).status, 403);
    assert.equal((await call('/api/manager/dashboard', { as: 'owner' })).status, 403);
    assert.equal((await call('/api/manager/dashboard', { as: 'accountant' })).status, 403);
    assert.equal((await call('/api/owner/dashboard')).status, 401);
    // The other school's owner sees their own (empty) school.
    const other = await call('/api/owner/dashboard', { as: 'owner2' });
    ok(other);
    assert.equal(other.body.kpis, null);
    assert.deepEqual(other.body.filters.branches.map((b) => b.name), ['Other']);
  });

  test('a date range narrows payments and fees by date', async () => {
    const res = await call('/api/owner/dashboard', { as: 'owner', query: { from: addDays(today, -400), to: addDays(today, -380) } });
    ok(res);
    assert.equal(res.body.kpis.fees.expected, 0);
    assert.ok(!res.body.recentActivity.some((a) => a.type === 'payment'));
  });
});

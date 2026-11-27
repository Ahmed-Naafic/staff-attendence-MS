/*
 * Fee Management (docs/business-rules.md → Fee Management), end to end through the API: the module
 * switch, accountant accounts, fee structures and monthly generation (enrollment month, duplicates,
 * failures and retries, structure changes), individual adjustments, cash payments with exact
 * allocation (part payments, repeated submissions), receipts, reversals, discounts and their
 * combination, invoices (single, bulk, status), examination fees (assignment, withdrawal, cancellation),
 * clearance and exceptions, branch transfers, independent cash closing (shortage, correction), reports,
 * audit records, permissions and school isolation.
 * Runs on the Neon dev branch (`npm test`); everything it creates is removed afterwards.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { calendarToday } from '../src/features/academic-calendar/calendar.service.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { setGenerationFault } from '../src/features/fees/feeGeneration.service.js';
import { addDays, addMonths, monthOf } from '../src/features/fees/feeRules.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Fee tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const PASSWORD = `Fee-${randomBytes(9).toString('base64url')}-9a`;
const cookies = {};
const ctx = {};
const S = {};
let server;
let base;
let today;
let month;

async function call(path, { method = 'GET', body, as } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(method !== 'GET' && { origin: ORIGIN }), ...(as && { cookie: cookies[as] }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const type = response.headers.get('content-type') ?? '';
  if (!type.includes('json')) return { status: response.status, type, buffer: Buffer.from(await response.arrayBuffer()) };
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const api = (as, prefix) => (path, o = {}) => call(`/api/${prefix}/fees${path}`, { ...o, as });
const owner = api('OWNER', 'owner');
const manager = api('MANAGER', 'manager');
const manager2 = api('MANAGER2', 'manager');
const accountant = api('ACCOUNTANT', 'accountant');
const owner2 = api('OWNER2', 'owner');
const ok = (res, status = 200) => assert.equal(res.status, status, JSON.stringify(res.body ?? res.type));

async function login(key, email) {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, password: PASSWORD }) });
  assert.equal(res.status, 200, `login ${key}`);
  cookies[key] = res.headers.get('set-cookie')?.split(';')[0];
}
const userEmail = (key) => `test-fees-${key}-${lower}@test.edutrack.example`;
async function makeUser(key, role, branchId) {
  return prisma.user.create({ data: { name: `${key} ${tag}`, email: userEmail(key), role, ...(branchId && { branchId }), passwordHash: await hashPassword(PASSWORD) } });
}
const obligationsOf = (studentId, where = {}) => prisma.feeObligation.findMany({ where: { studentId, ...where }, orderBy: [{ billingMonth: 'asc' }, { createdAt: 'asc' }] });

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  today = await calendarToday();
  month = monthOf(today);
  const yearStart = addMonths(month, -2);
  const school = await prisma.school.create({ data: { code: `TFEE${tag}`, name: `Fees ${tag}`, location: 'Mogadishu', phone: '+252 61 1234567', address: 'Road 1', examinationsEnabled: true } });
  ctx.school = school;
  ctx.b1 = await prisma.branch.create({ data: { schoolId: school.id, number: 1, code: `TFEE${tag}-B001`, name: 'Main', nameKey: `main ${lower}`, address: 'Road', city: 'Mogadishu' } });
  ctx.b2 = await prisma.branch.create({ data: { schoolId: school.id, number: 2, code: `TFEE${tag}-B002`, name: 'North', nameKey: `north ${lower}`, address: 'Road', city: 'Mogadishu' } });
  ctx.year = await prisma.academicYear.create({ data: { schoolId: school.id, name: `Y ${tag}`, nameKey: `y ${lower}`, startDate: new Date(`${yearStart}T00:00:00Z`), endDate: new Date(`${addDays(addMonths(month, 8), -1)}T00:00:00Z`), status: 'CURRENT', startedAt: new Date() } });
  await prisma.academicWeekdays.create({ data: { schoolId: school.id, academicYearId: ctx.year.id, days: ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'], effectiveFrom: new Date(`${yearStart}T00:00:00Z`) } });
  ctx.class = await prisma.schoolClass.create({ data: { schoolId: school.id, name: 'Grade 7', nameKey: 'grade 7', sequence: 1 } });
  ctx.subject = await prisma.subject.create({ data: { schoolId: school.id, name: 'Math', nameKey: 'math' } });
  await prisma.classSubject.create({ data: { schoolId: school.id, classId: ctx.class.id, subjectId: ctx.subject.id } });
  ctx.examType = await prisma.examType.create({ data: { schoolId: school.id, name: 'Mid-Term', nameKey: 'mid-term', defaultMaxMarks: 50, stopsLessons: false } });
  const scale = await prisma.gradingScale.create({ data: { schoolId: school.id, name: 'Letters', nameKey: 'letters', isDefault: true } });
  await prisma.gradeBand.create({ data: { scaleId: scale.id, label: 'A', minPercent: 0, maxPercent: 100, passes: true } });
  ctx.secA = await prisma.section.create({ data: { schoolId: school.id, branchId: ctx.b1.id, classId: ctx.class.id, academicYearId: ctx.year.id, name: 'A', nameKey: 'a' } });
  ctx.secN = await prisma.section.create({ data: { schoolId: school.id, branchId: ctx.b2.id, classId: ctx.class.id, academicYearId: ctx.year.id, name: 'N', nameKey: 'n' } });
  const student = async (key, branch, section, enrolledAt) => {
    const s = await prisma.student.create({
      data: { schoolId: school.id, branchId: branch.id, studentNumber: `TFEE${tag}-${key}`, firstName: key, lastName: 'Test', nameKey: `${key} ${lower}`, gender: 'MALE', dateOfBirth: new Date('2012-01-01T00:00:00Z'), guardianName: 'Guardian', guardianPhone: '+252 61 7654321', status: 'ENROLLED' },
    });
    await prisma.enrollment.create({ data: { schoolId: school.id, branchId: branch.id, studentId: s.id, academicYearId: ctx.year.id, sectionId: section.id, enrolledAt } });
    S[key] = s;
  };
  await student('s1', ctx.b1, ctx.secA, new Date(`${yearStart}T08:00:00Z`));
  await student('s2', ctx.b1, ctx.secA, new Date());
  await student('s3', ctx.b1, ctx.secA, new Date(`${yearStart}T08:00:00Z`));
  await student('s4', ctx.b2, ctx.secN, new Date(`${yearStart}T08:00:00Z`));
  const o = await makeUser('owner', 'OWNER');
  await prisma.school.update({ where: { id: school.id }, data: { ownerId: o.id } });
  await makeUser('manager', 'MANAGER', ctx.b1.id);
  await makeUser('manager2', 'MANAGER', ctx.b2.id);
  await login('OWNER', userEmail('owner'));
  await login('MANAGER', userEmail('manager'));
  await login('MANAGER2', userEmail('manager2'));
  // Another school, to check isolation.
  ctx.school2 = await prisma.school.create({ data: { code: `TFEX${tag}`, name: `Other ${tag}`, location: 'Hargeisa', feesEnabled: true } });
  const o2 = await makeUser('owner2', 'OWNER');
  await prisma.school.update({ where: { id: ctx.school2.id }, data: { ownerId: o2.id } });
  await login('OWNER2', userEmail('owner2'));
});

after(async () => {
  setGenerationFault(null);
  const schoolIds = [ctx.school.id, ctx.school2.id];
  const where = { schoolId: { in: schoolIds } };
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  await prisma.pushMessage.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { recipientId: { in: userIds } } });
  await prisma.feeAllocation.deleteMany({ where: { payment: where } });
  await prisma.feeReceipt.deleteMany({ where });
  await prisma.feePayment.deleteMany({ where });
  await prisma.cashClosingRevision.deleteMany({ where: { closing: where } });
  await prisma.cashClosing.deleteMany({ where });
  await prisma.feeInvoiceLine.deleteMany({ where: { invoice: where } });
  await prisma.feeInvoice.deleteMany({ where });
  await prisma.feeObligationDiscount.deleteMany({ where: { obligation: where } });
  await prisma.feeObligationChange.deleteMany({ where: { obligation: where } });
  await prisma.feeObligation.deleteMany({ where });
  await prisma.studentDiscount.deleteMany({ where });
  await prisma.feeDiscountPolicy.deleteMany({ where });
  await prisma.studentFeeAdjustment.deleteMany({ where });
  await prisma.feeStructureRate.deleteMany({ where: { structure: where } });
  await prisma.feeStructure.deleteMany({ where });
  await prisma.examFeeRate.deleteMany({ where });
  await prisma.feeClearanceException.deleteMany({ where });
  await prisma.feeReminderLog.deleteMany({ where });
  await prisma.feeGenerationRun.deleteMany({ where });
  await prisma.feeCounter.deleteMany({ where });
  await prisma.feeBranding.deleteMany({ where });
  await prisma.feeSettings.deleteMany({ where });
  await prisma.examPaper.deleteMany({ where });
  await prisma.examinationClass.deleteMany({ where: { examination: where } });
  await prisma.examination.deleteMany({ where });
  await prisma.examSettings.deleteMany({ where });
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

describe('Fee Management', () => {
  test('the module is off until the Super Admin switches it on', async () => {
    const status = await owner('/status');
    ok(status);
    assert.equal(status.body.featureEnabled, false);
    const res = await owner('/overview');
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'FEATURE_DISABLED');
    await prisma.school.update({ where: { id: ctx.school.id }, data: { feesEnabled: true } });
    const on = await owner('/status');
    assert.equal(on.body.featureEnabled, true);
    assert.equal(on.body.permissions.configure, true);
  });

  test('the School Owner creates an Accountant, who signs in to their branch only', async () => {
    const created = await owner('/accountants', { method: 'POST', body: { name: `Accountant ${tag}`, email: userEmail('accountant'), phone: '+252 61 5550000', branchId: ctx.b1.id, password: PASSWORD } });
    ok(created, 201);
    ctx.accountantId = created.body.accountant.id;
    assert.equal(created.body.accountant.passwordChangePending, true);
    await prisma.user.update({ where: { id: ctx.accountantId }, data: { mustChangePassword: false } });
    await login('ACCOUNTANT', userEmail('accountant'));
    const status = await accountant('/status');
    assert.equal(status.body.role, 'ACCOUNTANT');
    assert.equal(status.body.permissions.recordPayments, true);
    assert.equal(status.body.permissions.configure, false);
    assert.equal(status.body.permissions.reversePayments, false);
    // A Manager cannot manage accountants; an Accountant has no Manager API.
    assert.equal((await manager('/accountants')).status, 403);
    assert.equal((await call('/api/manager/students', { as: 'ACCOUNTANT' })).status, 403);
  });

  test('fee structures charge each student from their enrollment month; no duplicates', async () => {
    assert.equal((await manager('/structures', { method: 'POST', body: { class: ctx.class.id, monthlyFee: 2000 } })).status, 403);
    ok(await owner('/structures', { method: 'POST', body: { class: ctx.class.id, monthlyFee: 2000 } }), 201);
    const s1 = await obligationsOf(S.s1.id, { kind: 'MONTHLY' });
    assert.deepEqual(s1.map((o) => o.billingMonth.toISOString().slice(0, 10)), [addMonths(month, -2), addMonths(month, -1), month]);
    assert.ok(s1.every((o) => o.netAmount === 2000 && o.branchId === ctx.b1.id));
    const s2 = await obligationsOf(S.s2.id, { kind: 'MONTHLY' });
    assert.equal(s2.length, 1, 'enrolled this month: only this month');
    assert.equal(s2[0].billingMonth.toISOString().slice(0, 10), month);
    // Generating again (a manual run, as a Manager or Accountant may) creates nothing new.
    const before = await prisma.feeObligation.count({ where: { schoolId: ctx.school.id } });
    const run = await accountant('/generation/run', { method: 'POST', body: {} });
    ok(run);
    assert.equal(run.body.run.status, 'succeeded');
    assert.equal(run.body.run.created, 0);
    assert.equal(await prisma.feeObligation.count({ where: { schoolId: ctx.school.id } }), before);
    ctx.structure = (await prisma.feeStructure.findFirst({ where: { schoolId: ctx.school.id } })).id;
  });

  test('a failed generation is recorded, the Owner is told, and a retry succeeds without duplicates', async () => {
    ok(await owner('/settings', { method: 'PUT', body: { values: { generationAlertAfter: 1 } } }));
    setGenerationFault(() => {
      throw new Error('simulated database outage');
    });
    const failed = await manager('/generation/run', { method: 'POST', body: {} });
    ok(failed);
    assert.equal(failed.body.run.status, 'failed');
    assert.match(failed.body.run.error, /simulated/);
    const notice = await prisma.notification.findFirst({ where: { type: 'FEE_GENERATION_FAILED', schoolId: ctx.school.id } });
    assert.ok(notice, 'the Owner is notified');
    assert.ok(await prisma.auditEvent.findFirst({ where: { schoolId: ctx.school.id, action: 'FEE_GENERATION_FAILED' } }));
    setGenerationFault(null);
    const before = await prisma.feeObligation.count({ where: { schoolId: ctx.school.id } });
    const retry = await manager('/generation/run', { method: 'POST', body: {} });
    assert.equal(retry.body.run.status, 'succeeded');
    assert.equal(await prisma.feeObligation.count({ where: { schoolId: ctx.school.id } }), before);
    const runs = await prisma.feeGenerationRun.findMany({ where: { schoolId: ctx.school.id, trigger: 'MANUAL' } });
    assert.ok(runs.some((r) => r.status === 'FAILED') && runs.some((r) => r.status === 'SUCCEEDED'));
  });

  test('a fee change applies to months not charged yet; charged months keep their amounts', async () => {
    const same = await owner(`/structures/${ctx.structure}`, { method: 'PATCH', body: { monthlyFee: 2500, effectiveMonth: month.slice(0, 7), reason: 'New fees' } });
    assert.equal(same.status, 409);
    assert.equal(same.body.code, 'MONTH_CHARGED');
    ok(await owner(`/structures/${ctx.structure}`, { method: 'PATCH', body: { monthlyFee: 2500, effectiveMonth: addMonths(month, 1).slice(0, 7), reason: 'New fees' } }));
    const s1 = await obligationsOf(S.s1.id, { kind: 'MONTHLY' });
    assert.ok(s1.every((o) => o.netAmount === 2000), 'January–June stay at the old fee');
    const list = await owner('/structures');
    assert.equal(list.body.items[0].monthlyFee, 2000);
    assert.equal(list.body.items[0].upcoming.amount, 2500);
  });

  test('individual adjustments need a reason, keep the original and respect the Manager limit', async () => {
    const noReason = await manager(`/students/${S.s1.id}/adjustments`, { method: 'POST', body: { monthlyFee: 1500, fromMonth: month.slice(0, 7) } });
    assert.equal(noReason.status, 400);
    const tooMuch = await manager(`/students/${S.s1.id}/adjustments`, { method: 'POST', body: { monthlyFee: 500, fromMonth: month.slice(0, 7), reason: 'Hardship' } });
    assert.equal(tooMuch.status, 403);
    assert.equal((await accountant(`/students/${S.s1.id}/adjustments`, { method: 'POST', body: { monthlyFee: 1500, fromMonth: month.slice(0, 7), reason: 'Hardship' } })).status, 403);
    const adjusted = await manager(`/students/${S.s1.id}/adjustments`, { method: 'POST', body: { monthlyFee: 1500, fromMonth: month.slice(0, 7), reason: 'Hardship' } });
    ok(adjusted, 201);
    assert.equal(adjusted.body.changed, 1);
    const current = (await obligationsOf(S.s1.id, { kind: 'MONTHLY' })).at(-1);
    assert.equal(current.standardAmount, 2000);
    assert.equal(current.netAmount, 1500);
    const change = await prisma.feeObligationChange.findFirst({ where: { obligationId: current.id, type: 'ADJUSTED' } });
    assert.equal(change.fromAmount, 2000);
    assert.equal(change.toAmount, 1500);
    assert.equal(change.reason, 'Hardship');
    const adj = await prisma.studentFeeAdjustment.findFirst({ where: { studentId: S.s1.id } });
    assert.equal(adj.originalAmount, 2000);
    assert.equal(adj.createdByRole, 'MANAGER');
  });

  test('a payment pays exactly the months chosen (older ones may stay unpaid) and issues a receipt', async () => {
    const [sep, oct, nov] = await obligationsOf(S.s1.id, { kind: 'MONTHLY' });
    ctx.months = { sep, oct, nov };
    const over = await accountant('/payments', { method: 'POST', body: { student: S.s1.id, amount: 2500, allocations: [{ obligation: sep.id, amount: 2500 }] } });
    assert.equal(over.status, 400);
    const mismatch = await accountant('/payments', { method: 'POST', body: { student: S.s1.id, amount: 4000, allocations: [{ obligation: sep.id, amount: 2000 }] } });
    assert.equal(mismatch.status, 400);
    const paid = await accountant('/payments', { method: 'POST', body: { student: S.s1.id, amount: 3500, allocations: [{ obligation: sep.id, amount: 2000 }, { obligation: nov.id, amount: 1500 }], requestKey: randomUUID() } });
    ok(paid, 201);
    ctx.payment1 = paid.body.payment;
    assert.match(paid.body.payment.receipt.number, /^RCP-\d{4}-\d{5}$/);
    const [a, b, c] = await obligationsOf(S.s1.id, { kind: 'MONTHLY' });
    assert.deepEqual([a.status, b.status, c.status], ['PAID', 'OPEN', 'PAID']);
    assert.equal(b.paidAmount, 0);
    const receipt = await prisma.feeReceipt.findUnique({ where: { paymentId: ctx.payment1.id } });
    assert.equal(receipt.content.payment.amount, 3500);
    assert.equal(receipt.content.lines.length, 2);
    assert.equal(receipt.content.receivedBy.name, `Accountant ${tag}`);
    const pdf = await accountant(`/receipts/${receipt.id}/pdf`);
    ok(pdf);
    assert.equal(pdf.type, 'application/pdf');
    assert.equal(pdf.buffer.subarray(0, 5).toString(), '%PDF-');
    ok(await accountant(`/receipts/${receipt.id}/printed`, { method: 'POST' }));
  });

  test('part payments follow the policy; a repeated submission records nothing twice', async () => {
    const key = randomUUID();
    const body = { student: S.s1.id, amount: 1000, allocations: [{ obligation: ctx.months.oct.id, amount: 1000 }], requestKey: key };
    const first = await accountant('/payments', { method: 'POST', body });
    ok(first, 201);
    const again = await accountant('/payments', { method: 'POST', body });
    ok(again, 200);
    assert.equal(again.body.repeated, true);
    assert.equal(again.body.payment.id, first.body.payment.id);
    // The same request key for a different payment is refused, never treated as a repeat.
    const reused = await accountant('/payments', { method: 'POST', body: { ...body, amount: 900, allocations: [{ obligation: ctx.months.oct.id, amount: 900 }] } });
    assert.equal(reused.status, 409);
    assert.equal(reused.body.code, 'IDEMPOTENCY_CONFLICT');
    ctx.partial = first.body.payment;
    assert.equal((await prisma.feeObligation.findUnique({ where: { id: ctx.months.oct.id } })).paidAmount, 1000);
    ok(await owner('/settings', { method: 'PUT', body: { values: { allowPartialPayments: false } } }));
    const refused = await accountant('/payments', { method: 'POST', body: { student: S.s1.id, amount: 500, allocations: [{ obligation: ctx.months.oct.id, amount: 500 }] } });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error, /in full/);
    ok(await owner('/settings', { method: 'PUT', body: { values: { allowPartialPayments: true } } }));
  });

  test('reversal needs permission and a reason, keeps the payment and voids the receipt', async () => {
    assert.equal((await accountant(`/payments/${ctx.partial.id}/reverse`, { method: 'POST', body: { reason: 'Wrong student' } })).status, 403);
    assert.equal((await manager(`/payments/${ctx.partial.id}/reverse`, { method: 'POST', body: {} })).status, 400);
    const reversed = await manager(`/payments/${ctx.partial.id}/reverse`, { method: 'POST', body: { reason: 'Recorded twice by mistake' } });
    ok(reversed);
    assert.equal(reversed.body.payment.status, 'reversed');
    assert.equal(reversed.body.payment.receipt.void, true);
    const oct = await prisma.feeObligation.findUnique({ where: { id: ctx.months.oct.id } });
    assert.equal(oct.paidAmount, 0);
    assert.equal(oct.status, 'OPEN');
    const kept = await prisma.feePayment.findUnique({ where: { id: ctx.partial.id }, include: { allocations: true } });
    assert.equal(kept.allocations.length, 1, 'the original allocation is kept');
    assert.equal(kept.reversalCashUserId, ctx.accountantId, 'not closed yet: out of the recorder’s cash');
    assert.equal((await manager(`/payments/${ctx.partial.id}/reverse`, { method: 'POST', body: { reason: 'Again' } })).status, 409);
  });

  test('discount policies: the Owner creates them, Managers give them within limits, combination applies', async () => {
    assert.equal((await manager('/discount-policies', { method: 'POST', body: { name: 'X', category: 'discount', type: 'percentage', value: 1000, appliesTo: ['monthly'] } })).status, 403);
    const sibling = await owner('/discount-policies', { method: 'POST', body: { name: 'Sibling', category: 'discount', type: 'percentage', value: 1000, appliesTo: ['monthly'] } });
    ok(sibling, 201);
    const merit = await owner('/discount-policies', { method: 'POST', body: { name: 'Merit', category: 'discount', type: 'fixed', value: 500, appliesTo: ['monthly'] } });
    const full = await owner('/discount-policies', { method: 'POST', body: { name: 'Full scholarship', category: 'scholarship', type: 'percentage', value: 10000, appliesTo: ['monthly', 'exam'], managersAssign: false } });
    ok(full, 201);
    ok(await owner('/settings', { method: 'PUT', body: { values: { discountCombination: 'stack' } } }));
    const give = (policy) => manager('/student-discounts', { method: 'POST', body: { student: S.s2.id, policy, startMonth: month.slice(0, 7), reason: 'Eligible' } });
    ok(await give(sibling.body.policy.id), 201);
    ok(await give(merit.body.policy.id), 201);
    assert.equal((await give(full.body.policy.id)).status, 403);
    assert.equal((await give(merit.body.policy.id)).status, 409, 'already given');
    const [nov] = await obligationsOf(S.s2.id, { kind: 'MONTHLY' });
    assert.equal(nov.amount, 2000);
    assert.equal(nov.discountAmount, 700);
    assert.equal(nov.netAmount, 1300);
    const rows = await prisma.feeObligationDiscount.findMany({ where: { obligationId: nov.id } });
    assert.deepEqual(rows.map((r) => r.amount).sort(), [200, 500]);
    const account = await manager(`/students/${S.s2.id}`);
    ok(account);
    assert.equal(account.body.obligations.find((o) => o.id === nov.id).discounts.length, 2);
  });

  test('invoices: one per student, numbered when issued, no deadline, status follows payments', async () => {
    const inv = await manager('/invoices', { method: 'POST', body: { student: S.s1.id } });
    ok(inv, 201);
    ctx.invoice = inv.body.invoice;
    assert.match(ctx.invoice.number, /^INV-\d{4}-\d{4}$/);
    assert.equal(ctx.invoice.status, 'partially_paid');
    assert.equal(ctx.invoice.totals.total, 5500);
    assert.equal(ctx.invoice.totals.paid, 3500);
    assert.equal(ctx.invoice.totals.balance, 2000);
    const pdf = await manager(`/invoices/${ctx.invoice.id}/pdf`);
    assert.equal(pdf.type, 'application/pdf');
    // Paying October makes the invoice paid.
    ok(await accountant('/payments', { method: 'POST', body: { student: S.s1.id, amount: 2000, allocations: [{ obligation: ctx.months.oct.id, amount: 2000 }] } }), 201);
    assert.equal((await manager(`/invoices/${ctx.invoice.id}`)).body.invoice.status, 'paid');
    // A draft has no number until issued; cancelling needs a reason.
    const draft = await accountant('/invoices', { method: 'POST', body: { student: S.s2.id, issue: false } });
    ok(draft, 201);
    assert.equal(draft.body.invoice.number, null);
    assert.equal(draft.body.invoice.status, 'draft');
    const issued = await accountant(`/invoices/${draft.body.invoice.id}/issue`, { method: 'POST' });
    assert.equal(issued.body.invoice.status, 'issued');
    assert.equal((await accountant(`/invoices/${draft.body.invoice.id}/cancel`, { method: 'POST', body: {} })).status, 400);
    assert.equal((await accountant(`/invoices/${draft.body.invoice.id}/cancel`, { method: 'POST', body: { reason: 'Duplicate' } })).body.invoice.status, 'cancelled');
    // Bulk: every student of the section with something owed gets their own invoice.
    const bulk = await owner('/invoices/bulk', { method: 'POST', body: { section: ctx.secA.id } });
    ok(bulk, 201);
    assert.equal(bulk.body.created, 2, 's2 and s3 owe; s1 has paid everything');
    const batch = await prisma.feeInvoice.findMany({ where: { batchId: bulk.body.batchId } });
    assert.equal(new Set(batch.map((b) => b.number)).size, 2);
    const batchPdf = await owner(`/invoices/pdf?batch=${bulk.body.batchId}`);
    assert.equal(batchPdf.type, 'application/pdf');
  });

  test('examination fees are charged on assignment and cancelled for withdrawn students', async () => {
    ok(await owner('/exam-fees', { method: 'PUT', body: { rates: [{ class: ctx.class.id, examType: ctx.examType.id, amount: 1000 }] } }));
    const created = await call('/api/owner/exams/examinations', { method: 'POST', as: 'OWNER', body: { examType: ctx.examType.id, startDate: addDays(today, 10), endDate: addDays(today, 12), classes: [ctx.class.id] } });
    ok(created, 201);
    ctx.exam = created.body.examination;
    assert.equal(await prisma.feeObligation.count({ where: { examinationId: ctx.exam.id } }), 0, 'a draft charges nothing');
    ok(await call(`/api/owner/exams/examinations/${ctx.exam.id}/schedule`, { method: 'POST', as: 'OWNER' }));
    const fees = await prisma.feeObligation.findMany({ where: { examinationId: ctx.exam.id } });
    assert.equal(fees.length, 4);
    assert.ok(fees.every((f) => f.kind === 'EXAM' && f.netAmount === 1000 && f.status === 'OPEN'));
    // s3 withdraws: no fee for months after; the withdrawal month by policy ('none'); the examination fee cancelled.
    ok(await owner('/settings', { method: 'PUT', body: { values: { withdrawalBilling: 'none' } } }));
    ok(await call(`/api/manager/students/${S.s3.id}/transfer-out`, { method: 'POST', as: 'MANAGER', body: { reason: 'Family moved' } }));
    const s3 = await obligationsOf(S.s3.id);
    assert.equal(s3.find((o) => o.kind === 'EXAM').status, 'CANCELLED');
    assert.equal(s3.find((o) => o.kind === 'MONTHLY' && o.billingMonth.toISOString().slice(0, 10) === month).status, 'CANCELLED');
    assert.ok(s3.filter((o) => o.kind === 'MONTHLY' && o.billingMonth.toISOString().slice(0, 10) < month).every((o) => o.status === 'OPEN'), 'earlier months still owed');
  });

  test('examination clearance follows the policy; exceptions need permission and a reason', async () => {
    const view = await manager(`/clearance/exams/${ctx.exam.id}`);
    ok(view);
    const row = (id) => view.body.items.find((i) => i.student.id === id);
    assert.equal(row(S.s1.id).clearance, 'partially_cleared', 'monthly fees paid, examination fee not');
    assert.equal(row(S.s1.id).eligible, false);
    assert.equal(row(S.s2.id).clearance, 'not_cleared');
    assert.equal(view.body.removed.length, 1, 's3 was removed');
    assert.equal((await accountant('/clearance/exceptions', { method: 'POST', body: { student: S.s2.id, examination: ctx.exam.id, reason: 'Orphan support' } })).status, 403);
    assert.equal((await manager('/clearance/exceptions', { method: 'POST', body: { student: S.s2.id, examination: ctx.exam.id } })).status, 400);
    ok(await manager('/clearance/exceptions', { method: 'POST', body: { student: S.s2.id, examination: ctx.exam.id, reason: 'Orphan support' } }), 201);
    const s1fee = await prisma.feeObligation.findFirst({ where: { examinationId: ctx.exam.id, studentId: S.s1.id } });
    ok(await accountant('/payments', { method: 'POST', body: { student: S.s1.id, amount: 1000, allocations: [{ obligation: s1fee.id, amount: 1000 }] } }), 201);
    const after = await manager(`/clearance/exams/${ctx.exam.id}`);
    assert.equal(after.body.items.find((i) => i.student.id === S.s1.id).clearance, 'cleared');
    const s2 = after.body.items.find((i) => i.student.id === S.s2.id);
    assert.equal(s2.clearance, 'cleared');
    assert.equal(s2.byException, true);
    const list = await manager('/clearance');
    ok(list);
    assert.ok(list.body.items.some((i) => i.student.id === S.s1.id && i.clearance === 'cleared'));
  });

  test('cancelling an examination cancels unpaid examination fees and keeps payments', async () => {
    ok(await call(`/api/owner/exams/examinations/${ctx.exam.id}/cancel`, { method: 'POST', as: 'OWNER', body: { reason: 'Postponed' } }));
    const fees = await prisma.feeObligation.findMany({ where: { examinationId: ctx.exam.id } });
    assert.ok(fees.every((f) => f.status === 'CANCELLED'));
    const s1fee = fees.find((f) => f.studentId === S.s1.id);
    assert.equal(s1fee.paidAmount, 1000, 'the payment stays recorded against it');
    const payment = await prisma.feeAllocation.findFirst({ where: { obligationId: s1fee.id }, include: { payment: { include: { receipt: true } } } });
    assert.equal(payment.payment.status, 'RECORDED');
    assert.equal(payment.payment.receipt.voidedAt, null);
  });

  test('a student moving branch takes their whole account; history keeps its branch', async () => {
    const moved = await call(`/api/owner/students/${S.s1.id}/transfer-branch`, { method: 'POST', as: 'OWNER', body: { sectionId: ctx.secN.id, reason: 'Family moved north' } });
    ok(moved);
    assert.equal((await manager(`/students/${S.s1.id}`)).status, 404, 'the old branch no longer sees the student');
    const account = await manager2(`/students/${S.s1.id}`);
    ok(account);
    assert.ok(account.body.payments.length >= 3);
    assert.ok(account.body.payments.every((p) => p.branch.id === ctx.b1.id), 'payments keep the branch that received them');
    assert.ok(account.body.obligations.filter((o) => o.kind === 'monthly').every((o) => o.branch.id === ctx.b1.id));
    assert.equal(account.body.totals.balance, 0, 'nothing owed carries over twice');
    const charge = await manager2(`/students/${S.s1.id}/charges`, { method: 'POST', body: { title: 'Transport', amount: 800, reason: 'Bus service' } });
    ok(charge, 201);
    assert.equal((await prisma.feeObligation.findUnique({ where: { id: charge.body.id } })).branchId, ctx.b2.id);
    assert.equal((await accountant(`/students/${S.s1.id}`)).status, 404, 'an Accountant sees their own branch only');
  });

  test('cash closing: each person closes independently; a shortage needs an explanation; corrections keep revisions', async () => {
    const mine = await accountant('/closings/mine');
    ok(mine);
    // Recorded: 3500 + 1000 (reversed) + 2000 + 1000 = 7500; the reversed 1000 comes out of the accountant's cash.
    assert.equal(mine.body.open.recordedAmount, 7500);
    assert.equal(mine.body.open.reversedAmount, 1000);
    assert.equal(mine.body.open.expectedAmount, 6500);
    const unexplained = await accountant('/closings', { method: 'POST', body: { counted: 6000, expected: 6500 } });
    assert.equal(unexplained.status, 400);
    const closed = await accountant('/closings', { method: 'POST', body: { counted: 6000, expected: 6500, explanation: 'Change given wrongly' } });
    ok(closed, 201);
    assert.equal(closed.body.closing.difference, -500);
    assert.equal(closed.body.closing.result, 'shortage');
    assert.equal((await accountant('/closings/mine')).body.open.expectedAmount, 0);
    // The Manager closes on their own (nothing recorded: balanced); no approval of the other's closing.
    const m = await manager('/closings', { method: 'POST', body: { counted: 0 } });
    ok(m, 201);
    assert.equal(m.body.closing.result, 'balanced');
    const corrected = await accountant(`/closings/${closed.body.closing.id}/correct`, { method: 'POST', body: { counted: 6500, reason: 'Found the missing cash' } });
    ok(corrected);
    assert.equal(corrected.body.closing.difference, 0);
    assert.equal(corrected.body.closing.revisions.length, 2);
    assert.equal((await manager(`/closings/${closed.body.closing.id}/correct`, { method: 'POST', body: { counted: 1, reason: 'x' } })).status, 403);
    const history = await owner('/closings?role=ACCOUNTANT');
    ok(history);
    assert.equal(history.body.items.length, 1);
    const all = await owner('/closings');
    assert.equal(all.body.summary.closings, 2);
  });

  test('reports come from the records and export to PDF and Excel', async () => {
    const obligations = await prisma.feeObligation.findMany({ where: { schoolId: ctx.school.id, academicYearId: ctx.year.id, status: { not: 'CANCELLED' } } });
    const expected = obligations.reduce((n, o) => n + o.netAmount, 0);
    const paid = obligations.reduce((n, o) => n + o.paidAmount, 0);
    const collection = await owner('/reports/collection');
    ok(collection);
    assert.equal(collection.body.totals.expected, expected);
    assert.equal(collection.body.totals.collected, paid);
    const overview = await owner('/overview');
    assert.equal(overview.body.kpis.expected, expected);
    assert.equal(overview.body.kpis.outstanding, expected - paid);
    for (const name of ['outstanding', 'overdue', 'daily', 'history', 'closings', 'trends', 'classes', 'branches', 'discounts', 'performance', 'expected']) ok(await owner(`/reports/${name}`));
    const discounts = await owner('/reports/discounts');
    assert.ok(discounts.body.rows.some((r) => r.policy === 'Merit' && r.amount === 500));
    const pdf = await owner('/reports/collection.pdf');
    assert.equal(pdf.type, 'application/pdf');
    const xlsx = await owner('/reports/history.xlsx');
    assert.equal(xlsx.buffer.subarray(0, 2).toString(), 'PK');
    assert.equal((await manager('/reports/branches')).status, 403);
  });

  test('every important change is in the audit log', async () => {
    const actions = new Set((await prisma.auditEvent.findMany({ where: { schoolId: ctx.school.id }, select: { action: true } })).map((a) => a.action));
    for (const a of ['ACCOUNTANT_CREATED', 'FEE_STRUCTURE_CREATED', 'FEE_STRUCTURE_UPDATED', 'FEE_SETTINGS_CHANGED', 'FEE_GENERATION_FAILED', 'FEE_ADJUSTMENT_CREATED', 'FEE_PAYMENT_RECORDED', 'FEE_PAYMENT_REVERSED', 'FEE_DISCOUNT_POLICY_CREATED', 'FEE_DISCOUNT_ASSIGNED', 'FEE_INVOICE_ISSUED', 'FEE_INVOICE_CANCELLED', 'EXAM_FEES_CHANGED', 'FEE_CLEARANCE_EXCEPTION_GRANTED', 'CASH_CLOSING_RECORDED', 'CASH_CLOSING_CORRECTED', 'STUDENT_BRANCH_TRANSFERRED', 'FEE_CHARGE_ADDED']) {
      assert.ok(actions.has(a), `audit ${a}`);
    }
  });

  test('schools are isolated and branch roles cannot change school policies', async () => {
    assert.equal((await owner2(`/students/${S.s2.id}`)).status, 404);
    assert.equal((await owner2(`/payments/${ctx.payment1.id}`)).status, 404);
    assert.equal((await manager('/settings', { method: 'PUT', body: { values: { dueDay: 5 } } })).status, 403);
    assert.equal((await accountant('/branding', { method: 'PUT', body: { schoolName: 'X' } })).status, 403);
    assert.equal((await accountant(`/obligations/${ctx.months.oct.id}/cancel`, { method: 'POST', body: { reason: 'x' } })).status, 403);
    assert.equal((await manager2(`/payments/${ctx.payment1.id}/reverse`, { method: 'POST', body: { reason: 'Not ours' } })).status, 403, 'reversed only in the branch that received it');
  });
  test('Accountant workspace: reads of their branch work; every sensitive change and other workspaces are refused by the API', async () => {
    // Reads: school policies are visible but not editable; nothing of another branch.
    const structures = await accountant('/structures');
    ok(structures);
    assert.equal(structures.body.canEdit, false);
    const settings = await accountant('/settings');
    ok(settings);
    assert.equal(settings.body.canEdit, false);
    const policies = await accountant('/discount-policies');
    ok(policies);
    assert.equal(policies.body.canEdit, false);
    ok(await accountant('/student-discounts'));
    ok(await accountant('/overview'));
    ok(await accountant('/reports/collection'));
    const students = await accountant('/students');
    ok(students);
    const listed = JSON.stringify(students.body);
    assert.ok(listed.includes(S.s2.id), 'their branch');
    assert.ok(!listed.includes(S.s4.id), 'not another branch');
    assert.equal((await accountant(`/students/${S.s4.id}`)).status, 404);
    const closings = await accountant('/closings');
    ok(closings);
    assert.ok(closings.body.items.every((c) => !c.branch || c.branch.id === ctx.b1.id), 'closings of their branch only');

    // Changes reserved for the School Owner (or the Owner and Managers) are refused.
    const policy = await prisma.feeDiscountPolicy.findFirst({ where: { schoolId: ctx.school.id } });
    const refused = [
      ['/structures', 'POST', { class: ctx.class.id, monthlyFee: 1 }],
      [`/structures/${ctx.structure.id}`, 'PATCH', { monthlyFee: 1 }],
      ['/exam-fees', 'PUT', { rates: [] }],
      ['/settings', 'PUT', { values: { dueDay: 5 } }],
      ['/discount-policies', 'POST', { name: 'X', category: 'discount', type: 'fixed', value: 1, appliesTo: ['monthly'] }],
      [`/discount-policies/${policy.id}/deactivate`, 'POST', {}],
      ['/student-discounts', 'POST', { student: S.s2.id, policy: policy.id, startMonth: month.slice(0, 7), reason: 'x' }],
      [`/students/${S.s2.id}/charges`, 'POST', { title: 'X', amount: 100, reason: 'x' }],
      ['/accountants', 'GET', undefined],
    ];
    for (const [path, method, body] of refused) assert.equal((await accountant(path, { method, body })).status, 403, `${method} ${path}`);
    // Another person's closing (the Manager's) cannot be corrected by the Accountant.
    const managerClosing = await prisma.cashClosing.findFirst({ where: { schoolId: ctx.school.id, userRole: 'MANAGER' } });
    assert.equal((await accountant(`/closings/${managerClosing.id}/correct`, { method: 'POST', body: { counted: 1, reason: 'x' } })).status, 403);

    // No Owner or Manager workspace, whatever the URL.
    for (const path of ['/api/owner/fees/status', '/api/manager/fees/status', '/api/owner/dashboard', '/api/manager/dashboard', '/api/owner/branches']) {
      assert.equal((await call(path, { as: 'ACCOUNTANT' })).status, 403, path);
    }
    // The branch comes from the account: the Accountant's own branch and school only.
    const branch = await call('/api/accountant/branch', { as: 'ACCOUNTANT' });
    ok(branch);
    assert.equal(branch.body.branch.id, ctx.b1.id);
    assert.equal(branch.body.school.id, ctx.school.id);
  });
  test('staff Fee Management access: given by the School Owner only, the Accountant workspace of their branch, taken back at once', async () => {
    const staff = await prisma.user.create({ data: { name: `Cashier ${tag}`, email: userEmail('cashier'), role: 'STAFF', branchId: ctx.b1.id, jobTitle: 'Accountant', staffId: `TFEE${tag}-ST900`, phoneKey: `+9998${Date.now() % 1_000_000_000}`, passwordHash: await hashPassword(PASSWORD) } });
    await login('CASHIER', userEmail('cashier'));
    const cashier = api('CASHIER', 'accountant');
    // A staff member without access has no Fee Management.
    assert.equal((await cashier('/status')).status, 403);
    assert.equal((await call('/api/auth/session', { as: 'CASHIER' })).body.user.feeAccess, false);
    // Only the School Owner of their school gives access.
    assert.equal((await manager(`/staff-access/${staff.id}`, { method: 'PUT', body: { access: true } })).status, 403);
    assert.equal((await owner2(`/staff-access/${staff.id}`, { method: 'PUT', body: { access: true } })).status, 404);
    assert.equal((await owner(`/staff-access/${staff.id}`, { method: 'PUT', body: { access: 'yes' } })).status, 400);
    const list = await owner('/staff-access');
    ok(list);
    assert.ok(list.body.items.some((s) => s.id === staff.id && s.feeAccess === false));
    const granted = await owner(`/staff-access/${staff.id}`, { method: 'PUT', body: { access: true } });
    ok(granted);
    assert.equal(granted.body.staff.feeAccess, true);
    assert.ok(await prisma.auditEvent.findFirst({ where: { schoolId: ctx.school.id, action: 'FEE_ACCESS_GRANTED', targetId: staff.id } }));

    // Same sign-in: the session says so, and the Accountant workspace of their branch opens.
    const session = await call('/api/auth/session', { as: 'CASHIER' });
    assert.equal(session.body.user.role, 'STAFF');
    assert.equal(session.body.user.feeAccess, true);
    const status = await cashier('/status');
    ok(status);
    assert.equal(status.body.role, 'ACCOUNTANT');
    assert.equal(status.body.permissions.configure, false);
    assert.equal(status.body.permissions.recordPayments, true);
    assert.equal((await call('/api/accountant/branch', { as: 'CASHIER' })).body.branch.id, ctx.b1.id);
    assert.equal((await cashier(`/students/${S.s4.id}`)).status, 404, 'their branch only');
    assert.equal((await cashier('/settings', { method: 'PUT', body: { values: { dueDay: 5 } } })).status, 403);
    assert.equal((await call('/api/manager/students', { as: 'CASHIER' })).status, 403);

    // A payment recorded by them is theirs to close, as an Accountant's.
    let paid = null;
    for (const student of [S.s2, S.s3]) {
      const payable = await cashier(`/students/${student.id}/payable`);
      ok(payable);
      const item = payable.body.items[0];
      if (!item) continue;
      paid = await cashier('/payments', { method: 'POST', body: { student: student.id, amount: item.balance, allocations: [{ obligation: item.id, amount: item.balance }] } });
      ok(paid, 201);
      break;
    }
    assert.ok(paid, 'a student of the branch owed something');
    const payment = await prisma.feePayment.findFirst({ where: { recordedById: staff.id } });
    assert.equal(payment.recordedByRole, 'ACCOUNTANT');
    const mine = await cashier('/closings/mine');
    assert.equal(mine.body.open.paymentsCount, 1);
    ok(await cashier('/closings', { method: 'POST', body: { counted: mine.body.open.expectedAmount, expected: mine.body.open.expectedAmount } }), 201);

    // Taken back: refused at the next request, without signing out; unchanged again → no new event.
    ok(await owner(`/staff-access/${staff.id}`, { method: 'PUT', body: { access: false } }));
    assert.equal((await cashier('/status')).status, 403);
    ok(await owner(`/staff-access/${staff.id}`, { method: 'PUT', body: { access: false } }));
    assert.equal(await prisma.auditEvent.count({ where: { action: 'FEE_ACCESS_REVOKED', targetId: staff.id } }), 1);
    // The database keeps the access to staff members.
    await assert.rejects(prisma.user.update({ where: { id: ctx.accountantId }, data: { feeAccess: true } }));
  });
});

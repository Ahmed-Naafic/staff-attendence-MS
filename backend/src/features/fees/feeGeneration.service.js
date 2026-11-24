import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { createNotifications } from '../notifications/notify.js';
import { forbidden, HttpError } from '../../common/httpError.js';
import { actorOf, TX } from './feeAccess.js';
import { feeSettingsOf } from './feeSettings.js';
import {
  addDays,
  addMonths,
  applyDiscounts,
  asDbDate,
  chargeableMonth,
  chargeWithdrawalMonth,
  discountCovers,
  fromDbDate,
  monthLabel,
  monthlyDueDate,
  monthOf,
  monthsBetween,
} from './feeRules.js';

/*
 * Monthly fee generation and examination fees (docs/business-rules.md → Fee Management → Monthly fee
 * generation; Fee clearance). Everything here is idempotent: partial unique indexes allow one monthly
 * fee per student and month and one examination fee per student and examination (cancelled ones
 * included), inserts skip what exists, and a per-school advisory lock runs one generation at a time.
 * Obligations already created are never changed by generation.
 */

const SYSTEM = 'EduTrack';

/** Tests only: a function run inside each generation attempt (throwing simulates a failure). */
let generationFault = null;
export const setGenerationFault = (fn) => {
  generationFault = fn;
};
const lockSchool = (tx, schoolId) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fees-gen:${schoolId}`}))`;
const lockExam = (tx, examId) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fees-exam:${examId}`}))`;

/** The school's current academic year that covers `month`, or null. */
async function yearForMonth(client, schoolId, month) {
  const end = addDays(addMonths(month, 1), -1);
  return client.academicYear.findFirst({ where: { schoolId, status: 'CURRENT', startDate: { lte: asDbDate(end) }, endDate: { gte: asDbDate(month) } } });
}

/** The months of a year fees may be charged for, up to `through`, from the year start or the configured first month. */
export function chargeableMonths(year, settings, through) {
  let first = monthOf(fromDbDate(year.startDate));
  if (settings.billingStartMonth && `${settings.billingStartMonth}-01` > first) first = `${settings.billingStartMonth}-01`;
  const last = [monthOf(fromDbDate(year.endDate)), monthOf(through)].sort()[0];
  return first > last ? [] : monthsBetween(first, last);
}

/** Active discount assignments of students, with their policies: Map(studentId → [{ sd, policy }]). */
async function discountsByStudent(client, schoolId, studentIds) {
  const rows = await client.studentDiscount.findMany({ where: { schoolId, studentId: { in: studentIds }, revokedAt: null }, include: { policy: true } });
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.studentId)) map.set(r.studentId, []);
    map.get(r.studentId).push({ sd: r, policy: r.policy });
  }
  return map;
}

const policyDiscount = ({ sd, policy }) => ({ id: sd.id, name: policy.name, category: policy.category, type: policy.type, value: policy.value, maxAmount: policy.maxAmount, combinable: policy.combinable });
const discountRows = (applied, obligationId) => applied.map((d) => ({ obligationId, studentDiscountId: d.id, name: d.name, category: d.category, type: d.type, value: d.value, amount: d.amount }));

/**
 * Creates the monthly fees of `month` (and nothing else) inside `tx`, optionally for some students or
 * one class only. → { created, details }.
 */
async function createMonthlyFees(tx, schoolId, month, settings, { studentIds, classId, runId } = {}) {
  const details = { noYear: 0, noStructure: 0, excluded: 0, alreadyCharged: 0, notCharged: 0 };
  const year = await yearForMonth(tx, schoolId, month);
  if (!year) return { created: 0, details: { ...details, noYear: 1 } };
  if (settings.billingStartMonth && month < `${settings.billingStartMonth}-01`) return { created: 0, details };
  const monthEnd = addDays(addMonths(month, 1), -1);
  const enrollments = await tx.enrollment.findMany({
    where: {
      schoolId,
      academicYearId: year.id,
      enrolledAt: { lt: asDbDate(addMonths(month, 1)) },
      OR: [{ status: 'ACTIVE' }, { endedAt: { gte: asDbDate(month) } }],
      ...(studentIds && { studentId: { in: studentIds } }),
      ...(classId && { section: { classId } }),
    },
    select: { id: true, studentId: true, branchId: true, sectionId: true, status: true, enrolledAt: true, endedAt: true, section: { select: { classId: true } } },
  });
  if (!enrollments.length) return { created: 0, details };
  const existing = new Set(
    (await tx.feeObligation.findMany({ where: { schoolId, kind: 'MONTHLY', billingMonth: asDbDate(month), studentId: { in: enrollments.map((e) => e.studentId) } }, select: { studentId: true } })).map((o) => o.studentId),
  );
  const structures = await tx.feeStructure.findMany({ where: { schoolId, academicYearId: year.id, status: 'ACTIVE' }, include: { rates: { where: { effectiveMonth: { lte: asDbDate(month) } }, orderBy: { effectiveMonth: 'desc' }, take: 1 } } });
  const structureOf = new Map(structures.map((s) => [s.classId, s]));
  const ids = enrollments.map((e) => e.studentId);
  const adjustments = await tx.studentFeeAdjustment.findMany({
    where: { schoolId, academicYearId: year.id, studentId: { in: ids }, endedAt: null, fromMonth: { lte: asDbDate(month) }, OR: [{ toMonth: null }, { toMonth: { gte: asDbDate(month) } }] },
    orderBy: { createdAt: 'desc' },
  });
  const adjustmentOf = new Map();
  for (const a of adjustments) if (!adjustmentOf.has(a.studentId)) adjustmentOf.set(a.studentId, a);
  const discounts = await discountsByStudent(tx, schoolId, ids);
  const withdrawal = { policy: settings.withdrawalBilling, cutoffDay: settings.withdrawalCutoffDay };
  const rows = [];
  const applied = new Map();
  for (const e of enrollments) {
    if (existing.has(e.studentId)) {
      details.alreadyCharged += 1;
      continue;
    }
    const enrolledDay = e.enrolledAt.toISOString().slice(0, 10);
    if (!chargeableMonth(month, { enrolledDay, endedDay: e.endedAt?.toISOString().slice(0, 10) ?? null, status: e.status }, withdrawal)) {
      details.notCharged += 1;
      continue;
    }
    const structure = structureOf.get(e.section.classId);
    const rate = structure?.rates[0];
    if (!structure || !rate) {
      details.noStructure += 1;
      continue;
    }
    if (structure.excludedMonths.includes(month.slice(0, 7))) {
      details.excluded += 1;
      continue;
    }
    const adjustment = adjustmentOf.get(e.studentId);
    const amount = adjustment ? adjustment.amount : rate.amount;
    const disc = applyDiscounts(
      amount,
      (discounts.get(e.studentId) ?? []).filter((d) => discountCovers(d.sd, d.policy, { month, kind: 'MONTHLY', classId: e.section.classId, branchId: e.branchId })).map(policyDiscount),
      { combination: settings.discountCombination, maxCombinedPercent: settings.maxCombinedDiscount },
    );
    const net = amount - disc.total;
    // A student enrolled after the due day has until their enrollment day.
    const due = [monthlyDueDate(month, settings.dueDay), enrolledDay > monthEnd ? monthEnd : enrolledDay].sort().at(-1);
    rows.push({
      schoolId,
      branchId: e.branchId,
      studentId: e.studentId,
      enrollmentId: e.id,
      academicYearId: year.id,
      classId: e.section.classId,
      sectionId: e.sectionId,
      kind: 'MONTHLY',
      billingMonth: asDbDate(month),
      title: `Monthly fee · ${monthLabel(month)}`,
      standardAmount: rate.amount,
      amount,
      discountAmount: disc.total,
      netAmount: net,
      status: net === 0 ? 'PAID' : 'OPEN',
      dueDate: asDbDate(due),
      structureRateId: rate.id,
      adjustmentId: adjustment?.id ?? null,
      generationRunId: runId ?? null,
      source: 'GENERATED',
      createdByName: SYSTEM,
    });
    if (disc.applied.length) applied.set(e.studentId, disc.applied);
  }
  if (!rows.length) return { created: 0, details };
  const created = await tx.feeObligation.createManyAndReturn({ data: rows, skipDuplicates: true, select: { id: true, studentId: true } });
  const discountData = created.flatMap((o) => discountRows(applied.get(o.studentId) ?? [], o.id));
  if (discountData.length) await tx.feeObligationDiscount.createMany({ data: discountData });
  details.alreadyCharged += rows.length - created.length;
  return { created: created.length, details };
}

/**
 * One generation attempt for a school and month, recorded as a FeeGenerationRun (automatic or a
 * manual retry). Automatic attempts are retried up to twice at once; failures stay recorded, and
 * after the school's alert threshold of failed attempts in a row the School Owner is notified.
 * → the run row.
 */
export async function generateMonth(schoolId, month, { trigger = 'AUTOMATIC', user = null, now = new Date() } = {}) {
  const prisma = getPrisma();
  const settings = await feeSettingsOf(schoolId);
  const attempts = trigger === 'AUTOMATIC' ? 3 : 1;
  let run;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    run = await prisma.feeGenerationRun.create({ data: { schoolId, billingMonth: asDbDate(month), trigger, triggeredById: user?.id ?? null, triggeredByName: user?.name ?? null } });
    try {
      const result = await prisma.$transaction(async (tx) => {
        await lockSchool(tx, schoolId);
        if (generationFault) await generationFault(month);
        return createMonthlyFees(tx, schoolId, month, settings, { runId: run.id });
      }, { timeout: 120000, maxWait: 30000 });
      run = await prisma.feeGenerationRun.update({
        where: { id: run.id },
        data: { status: 'SUCCEEDED', finishedAt: new Date(), createdCount: result.created, skippedCount: Object.values(result.details).reduce((a, b) => a + b, 0), details: result.details },
      });
      if (trigger === 'MANUAL' || result.created) {
        await recordAuditEvent({
          action: AUDIT_ACTIONS.FEE_GENERATION_RUN,
          actor: user ? actorOf(user) : null,
          target: { type: 'school', id: schoolId, name: monthLabel(month) },
          schoolId,
          description: `Monthly fees of ${monthLabel(month)} generated${trigger === 'MANUAL' ? ' (run by hand)' : ''}: ${result.created} created.`,
        });
      }
      return run;
    } catch (error) {
      run = await prisma.feeGenerationRun.update({ where: { id: run.id }, data: { status: 'FAILED', finishedAt: new Date(), error: String(error.message ?? error).slice(0, 500) } });
      console.error(`[fees] generation of ${month} for school ${schoolId} failed (attempt ${attempt}):`, error.message);
      await recordAuditEvent({
        action: AUDIT_ACTIONS.FEE_GENERATION_FAILED,
        result: 'FAILURE',
        actor: user ? actorOf(user) : null,
        target: { type: 'school', id: schoolId, name: monthLabel(month) },
        schoolId,
        description: `Monthly fee generation for ${monthLabel(month)} failed${trigger === 'MANUAL' ? ' (run by hand)' : ''}. EduTrack retries automatically.`,
      }).catch(() => {});
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 400 * attempt));
    }
  }
  await alertIfFailing(schoolId, month, settings, now);
  return run;
}

/** Failed attempts since the last success of the month; at each multiple of the threshold the Owner is told. */
async function alertIfFailing(schoolId, month, settings, now) {
  const prisma = getPrisma();
  const lastSuccess = await prisma.feeGenerationRun.findFirst({ where: { schoolId, billingMonth: asDbDate(month), status: 'SUCCEEDED' }, orderBy: { startedAt: 'desc' } });
  const failures = await prisma.feeGenerationRun.count({ where: { schoolId, billingMonth: asDbDate(month), status: 'FAILED', ...(lastSuccess && { startedAt: { gt: lastSuccess.startedAt } }) } });
  if (failures < settings.generationAlertAfter) return;
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { ownerId: true, name: true } });
  if (!school?.ownerId) return;
  await createNotifications(
    [{ type: 'FEE_GENERATION_FAILED', recipientId: school.ownerId, schoolId, subjectType: 'school', subjectId: schoolId, params: { month: monthLabel(month), failures }, dedupeKey: `fee-gen-failed:${schoolId}:${month}:${Math.floor(failures / settings.generationAlertAfter)}` }],
    { now },
  );
}

/**
 * Brings a school's monthly fees up to date: every chargeable month of the current year up to today
 * without a successful run, and the current month again (cheap; picks up anything missed). Months
 * whose last attempt failed less than `backoffMs` ago wait (automatic retries back off).
 * → [{ month, status, created }].
 */
export async function catchUpSchool(schoolId, { now = new Date(), today, backoffMs = 10 * 60_000, includeCurrent = true } = {}) {
  const prisma = getPrisma();
  const settings = await feeSettingsOf(schoolId);
  if (!settings.autoGenerate) return [];
  today ??= await calendarToday();
  const current = monthOf(today);
  const year = await yearForMonth(prisma, schoolId, current);
  if (!year) return [];
  const months = chargeableMonths(year, settings, today);
  if (!months.length) return [];
  const runs = await prisma.feeGenerationRun.findMany({ where: { schoolId, billingMonth: { in: months.map(asDbDate) } }, orderBy: { startedAt: 'desc' } });
  const results = [];
  for (const month of months) {
    const mine = runs.filter((r) => fromDbDate(r.billingMonth) === month);
    const succeeded = mine.some((r) => r.status === 'SUCCEEDED');
    const last = mine[0];
    if (succeeded && !(includeCurrent && month === current)) continue;
    if (last?.status === 'RUNNING' && now - last.startedAt < 5 * 60_000) continue;
    if (!succeeded && last?.status === 'FAILED' && now - last.finishedAt < backoffMs) continue;
    const run = await generateMonth(schoolId, month, { now });
    results.push({ month, status: run.status, created: run.createdCount });
  }
  return results;
}

/** For pages: the current month generated if it never was (no waiting on later months), quietly. */
export async function ensureGenerated(schoolId) {
  try {
    const prisma = getPrisma();
    const today = await calendarToday();
    const month = monthOf(today);
    const done = await prisma.feeGenerationRun.findFirst({ where: { schoolId, billingMonth: asDbDate(month), status: 'SUCCEEDED' }, select: { id: true } });
    if (done) return;
    await catchUpSchool(schoolId, { today, includeCurrent: false });
  } catch (error) {
    console.error('[fees] generation check failed:', error.message);
  }
}

/** A manual run or retry (Owner, Manager or Accountant): the month given (default: the current one). */
export async function runGenerationByHand(scope, { month }, user) {
  const today = await calendarToday();
  const target = month ? `${month}-01` : monthOf(today);
  if (target > monthOf(today)) throw new HttpError(409, 'FUTURE_MONTH', 'Fees of a future month are generated on its first day.');
  const settings = await feeSettingsOf(scope.school.id);
  const year = await yearForMonth(getPrisma(), scope.school.id, target);
  if (!year) throw new HttpError(409, 'NO_CURRENT_YEAR', `${monthLabel(target)} is not part of the current academic year.`);
  if (!chargeableMonths(year, settings, today).includes(target)) throw new HttpError(409, 'NOT_CHARGED', `${monthLabel(target)} is before the first month your school charges fees in EduTrack.`);
  const run = await generateMonth(scope.school.id, target, { trigger: 'MANUAL', user });
  return { run: toRun(run) };
}

export const toRun = (r) => ({
  id: r.id,
  month: fromDbDate(r.billingMonth),
  trigger: r.trigger.toLowerCase(),
  status: r.status.toLowerCase(),
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
  created: r.createdCount,
  skipped: r.skippedCount,
  details: r.details,
  error: r.error,
  by: r.triggeredByName,
});

/** Generation status for the pages: the months of the year, each with its last run, and recent runs. */
export async function generationStatus(scope) {
  const prisma = getPrisma();
  const today = await calendarToday();
  const settings = await feeSettingsOf(scope.school.id);
  const year = await yearForMonth(prisma, scope.school.id, monthOf(today));
  const months = year ? chargeableMonths(year, settings, today) : [];
  const runs = await prisma.feeGenerationRun.findMany({ where: { schoolId: scope.school.id }, orderBy: { startedAt: 'desc' }, take: 60 });
  return {
    today,
    autoGenerate: settings.autoGenerate,
    academicYear: year ? { id: year.id, name: year.name } : null,
    months: months.map((m) => {
      const mine = runs.filter((r) => fromDbDate(r.billingMonth) === m);
      const success = mine.find((r) => r.status === 'SUCCEEDED');
      return { month: m, label: monthLabel(m), status: success ? 'succeeded' : mine[0] ? mine[0].status.toLowerCase() : 'pending', lastRun: mine[0] ? toRun(mine[0]) : null };
    }),
    runs: runs.slice(0, 20).map(toRun),
  };
}

// ---- hooks from other modules -------------------------------------------------------------------

/** After a student is enrolled: their monthly fees from the enrollment month to now. Never throws. */
export async function afterEnrollment(schoolId, studentId) {
  try {
    const prisma = getPrisma();
    const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { feesEnabled: true } });
    if (!school?.feesEnabled) return;
    const settings = await feeSettingsOf(schoolId);
    const today = await calendarToday();
    const year = await yearForMonth(prisma, schoolId, monthOf(today));
    if (!year) return;
    for (const month of chargeableMonths(year, settings, today)) {
      await prisma.$transaction(async (tx) => {
        await lockSchool(tx, schoolId);
        await createMonthlyFees(tx, schoolId, month, settings, { studentIds: [studentId] });
      }, TX);
    }
    await syncStudentExamFees(schoolId, studentId);
  } catch (error) {
    console.error('[fees] fees after enrollment failed:', error.message);
  }
}

/**
 * After a student withdraws (transferred out): unpaid monthly fees of months after the withdrawal are
 * cancelled, the withdrawal month follows the school's policy, and unpaid fees of examinations
 * starting after it are cancelled. Paid amounts are always kept. Never throws.
 */
export async function afterWithdrawal(schoolId, studentId) {
  try {
    const prisma = getPrisma();
    const settings = await feeSettingsOf(schoolId);
    const enrollment = await prisma.enrollment.findFirst({ where: { schoolId, studentId, status: 'TRANSFERRED_OUT', endedAt: { not: null } }, orderBy: { endedAt: 'desc' } });
    if (!enrollment) return;
    const endedDay = enrollment.endedAt.toISOString().slice(0, 10);
    const endMonth = monthOf(endedDay);
    const keepMonth = chargeWithdrawalMonth(endedDay, { policy: settings.withdrawalBilling, cutoffDay: settings.withdrawalCutoffDay });
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fee-account:${studentId}`}))`;
      const open = await tx.feeObligation.findMany({ where: { schoolId, studentId, status: 'OPEN', paidAmount: 0, OR: [{ kind: 'MONTHLY', billingMonth: { gte: asDbDate(endMonth) } }, { kind: 'EXAM', examination: { startDate: { gt: enrollment.endedAt } } }] } });
      for (const o of open) {
        if (o.kind === 'MONTHLY' && fromDbDate(o.billingMonth) === endMonth && keepMonth) continue;
        await cancelBySystem(tx, o, o.kind === 'EXAM' ? 'The student withdrew before the examination.' : 'The student withdrew; this month is not charged.');
      }
    }, TX);
  } catch (error) {
    console.error('[fees] withdrawal handling failed:', error.message);
  }
}

async function cancelBySystem(tx, o, reason) {
  await tx.feeObligation.update({ where: { id: o.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, cancelledByName: SYSTEM } });
  await tx.feeObligationChange.create({ data: { obligationId: o.id, type: 'CANCELLED', fromAmount: o.netAmount, toAmount: o.netAmount, reason, actorName: SYSTEM } });
}

// ---- examination fees -----------------------------------------------------------------------------

const REMOVED = 'Removed from the examination.';
const EXAM_CANCELLED = 'The examination was cancelled.';
const EXAM_DRAFT = 'The examination was returned to draft.';
const SYSTEM_REASONS = [REMOVED, EXAM_CANCELLED, EXAM_DRAFT];

/**
 * Brings an examination's fees in line with who sits it: a scheduled examination charges each student
 * of its classes (in its branch, or every branch) the class's fee for its type (Owner's rates); a
 * student no longer sitting it, or a cancelled or draft examination, has unpaid fees cancelled (paid
 * amounts are kept; refunds come later). A student who comes back has their cancelled fee reinstated.
 * Ended examinations are left as they are. Never throws when `quiet`. → { created, cancelled, reinstated }.
 */
export async function syncExamFees(examinationId, { quiet = true } = {}) {
  try {
    const prisma = getPrisma();
    const exam = await prisma.examination.findUnique({ where: { id: examinationId }, include: { classes: true, school: { select: { feesEnabled: true } } } });
    if (!exam || !exam.school.feesEnabled) return { created: 0, cancelled: 0, reinstated: 0 };
    const today = await calendarToday();
    const settings = await feeSettingsOf(exam.schoolId);
    return await prisma.$transaction(async (tx) => {
      await lockExam(tx, exam.id);
      const existing = await tx.feeObligation.findMany({ where: { examinationId: exam.id, kind: 'EXAM' } });
      const result = { created: 0, cancelled: 0, reinstated: 0 };
      if (exam.status !== 'SCHEDULED') {
        for (const o of existing.filter((x) => x.status !== 'CANCELLED')) {
          await cancelBySystem(tx, o, exam.status === 'CANCELLED' ? EXAM_CANCELLED : EXAM_DRAFT);
          result.cancelled += 1;
        }
        return result;
      }
      const endDay = fromDbDate(exam.endDate);
      if (endDay < today) return result;
      const enrollments = await tx.enrollment.findMany({
        where: { schoolId: exam.schoolId, academicYearId: exam.academicYearId, status: 'ACTIVE', section: { classId: { in: exam.classes.map((c) => c.classId) } }, ...(exam.branchId && { branchId: exam.branchId }) },
        select: { id: true, studentId: true, branchId: true, sectionId: true, section: { select: { classId: true } } },
      });
      const sitting = new Map(enrollments.map((e) => [e.studentId, e]));
      const byStudent = new Map(existing.map((o) => [o.studentId, o]));
      // Removed students.
      for (const o of existing) {
        if (o.status !== 'CANCELLED' && !sitting.has(o.studentId)) {
          await cancelBySystem(tx, o, REMOVED);
          result.cancelled += 1;
        }
      }
      // Students back again: their fee cancelled by EduTrack comes back.
      for (const o of existing) {
        if (o.status === 'CANCELLED' && sitting.has(o.studentId) && o.cancelledByName === SYSTEM && SYSTEM_REASONS.includes(o.cancelReason)) {
          await tx.feeObligation.update({ where: { id: o.id }, data: { status: o.paidAmount >= o.netAmount ? 'PAID' : 'OPEN', cancelledAt: null, cancelReason: null, cancelledByName: null } });
          await tx.feeObligationChange.create({ data: { obligationId: o.id, type: 'REINSTATED', fromAmount: o.netAmount, toAmount: o.netAmount, reason: 'Assigned to the examination again.', actorName: SYSTEM } });
          result.reinstated += 1;
        }
      }
      const toCharge = enrollments.filter((e) => !byStudent.has(e.studentId));
      if (!toCharge.length) return result;
      const rates = await tx.examFeeRate.findMany({ where: { academicYearId: exam.academicYearId, examTypeId: exam.examTypeId, classId: { in: [...new Set(toCharge.map((e) => e.section.classId))] } } });
      const rateOf = new Map(rates.map((r) => [r.classId, r]));
      const startDay = fromDbDate(exam.startDate);
      const month = monthOf(startDay);
      const due = [addDays(startDay, -settings.clearanceDeadlineDays), today].sort().at(-1);
      const discounts = await discountsByStudent(tx, exam.schoolId, toCharge.map((e) => e.studentId));
      const rows = [];
      const applied = new Map();
      for (const e of toCharge) {
        const rate = rateOf.get(e.section.classId);
        if (!rate) continue;
        const disc = applyDiscounts(
          rate.amount,
          (discounts.get(e.studentId) ?? []).filter((d) => discountCovers(d.sd, d.policy, { month, kind: 'EXAM', classId: e.section.classId, branchId: e.branchId })).map(policyDiscount),
          { combination: settings.discountCombination, maxCombinedPercent: settings.maxCombinedDiscount },
        );
        rows.push({
          schoolId: exam.schoolId,
          branchId: e.branchId,
          studentId: e.studentId,
          enrollmentId: e.id,
          academicYearId: exam.academicYearId,
          classId: e.section.classId,
          sectionId: e.sectionId,
          kind: 'EXAM',
          examinationId: exam.id,
          title: `Examination fee · ${exam.name}`,
          standardAmount: rate.amount,
          amount: rate.amount,
          discountAmount: disc.total,
          netAmount: rate.amount - disc.total,
          status: rate.amount - disc.total === 0 ? 'PAID' : 'OPEN',
          dueDate: asDbDate(due),
          examFeeRateId: rate.id,
          source: 'EXAM_ASSIGNMENT',
          createdByName: SYSTEM,
        });
        if (disc.applied.length) applied.set(e.studentId, disc.applied);
      }
      if (rows.length) {
        const created = await tx.feeObligation.createManyAndReturn({ data: rows, skipDuplicates: true, select: { id: true, studentId: true } });
        const discountData = created.flatMap((o) => discountRows(applied.get(o.studentId) ?? [], o.id));
        if (discountData.length) await tx.feeObligationDiscount.createMany({ data: discountData });
        result.created = created.length;
      }
      return result;
    }, TX);
  } catch (error) {
    if (!quiet) throw error;
    console.error('[fees] examination fee sync failed:', error.message);
    return { created: 0, cancelled: 0, reinstated: 0, error: error.message };
  }
}

/** Examination fees of one student's upcoming scheduled examinations (after enrollment or a branch move). */
export async function syncStudentExamFees(schoolId, studentId) {
  const today = await calendarToday();
  const exams = await getPrisma().examination.findMany({ where: { schoolId, status: 'SCHEDULED', endDate: { gte: asDbDate(today) } }, select: { id: true } });
  for (const e of exams) await syncExamFees(e.id);
  void studentId;
}

/** Every upcoming or running scheduled examination of a school, and recently cancelled ones. */
export async function syncSchoolExamFees(schoolId) {
  const today = await calendarToday();
  const exams = await getPrisma().examination.findMany({
    where: { schoolId, OR: [{ status: 'SCHEDULED', endDate: { gte: asDbDate(today) } }, { status: { in: ['CANCELLED', 'DRAFT'] }, feeObligations: { some: { status: { not: 'CANCELLED' } } } }] },
    select: { id: true },
  });
  let created = 0;
  for (const e of exams) created += (await syncExamFees(e.id)).created ?? 0;
  return created;
}

/** The fee rates or structures changed: regenerate the months they affect (only missing fees are created). */
export async function regenerateForClass(schoolId, classId) {
  try {
    const prisma = getPrisma();
    const settings = await feeSettingsOf(schoolId);
    const today = await calendarToday();
    const year = await yearForMonth(prisma, schoolId, monthOf(today));
    if (!year) return;
    for (const month of chargeableMonths(year, settings, today)) {
      await prisma.$transaction(async (tx) => {
        await lockSchool(tx, schoolId);
        await createMonthlyFees(tx, schoolId, month, settings, { classId });
      }, { timeout: 60000, maxWait: 30000 });
    }
  } catch (error) {
    console.error('[fees] regeneration after a fee change failed:', error.message);
  }
}

export const assertOwner = (scope) => {
  if (scope.role !== 'OWNER') throw forbidden('Only the School Owner changes this.');
};

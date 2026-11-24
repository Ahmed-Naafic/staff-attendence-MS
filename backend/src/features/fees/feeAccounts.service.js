import { badRequest, conflict, forbidden, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { actorOf, findScopedStudent, lockOperating, lockStudentAccount, permissions, studentScope, TX, yearOf } from './feeAccess.js';
import { clearancePolicy, feeSettingsOf } from './feeSettings.js';
import { applyDiscounts, asDbDate, discountCovers, evaluateClearance, formatMoney, fromDbDate, invoiceStatus, isOverdue, monthLabel, monthOf, monthsBetween, monthShort } from './feeRules.js';

/*
 * Student financial accounts (docs/business-rules.md → Fee Management → Student fees): every
 * obligation, payment and allocation, discount, adjustment, invoice and receipt of a student, kept for
 * good and following the student between branches. Individual adjustments need a reason and keep the
 * original amount; cancellations keep payments already made.
 */

export const fullName = (s) => [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' ');
const audit = (tx, action, scope, user, req, student, description, change) =>
  recordAuditEvent({ client: tx, action, actor: actorOf(user), target: { type: 'student', id: student.id, name: `${fullName(student)} (${student.studentNumber})` }, schoolId: scope.school.id, description, change, req });

export const toObligation = (o, today, graceDays) => ({
  id: o.id,
  kind: o.kind.toLowerCase(),
  title: o.title,
  month: fromDbDate(o.billingMonth),
  examination: o.examination ? { id: o.examination.id, name: o.examination.name } : o.examinationId ? { id: o.examinationId, name: null } : null,
  standardAmount: o.standardAmount,
  amount: o.amount,
  discountAmount: o.discountAmount,
  netAmount: o.netAmount,
  paidAmount: o.paidAmount,
  balance: o.status === 'CANCELLED' ? 0 : o.netAmount - o.paidAmount,
  status: o.status.toLowerCase(),
  paymentState: o.status === 'CANCELLED' ? 'cancelled' : o.paidAmount >= o.netAmount ? 'paid' : o.paidAmount > 0 ? 'partial' : 'unpaid',
  overdue: isOverdue({ ...o, dueDate: fromDbDate(o.dueDate) }, today, graceDays),
  dueDate: fromDbDate(o.dueDate),
  branch: o.branch ? { id: o.branch.id, name: o.branch.name } : { id: o.branchId },
  class: o.class ? { id: o.class.id, name: o.class.name } : null,
  academicYearId: o.academicYearId,
  source: o.source.toLowerCase(),
  cancelReason: o.cancelReason,
  cancelledAt: o.cancelledAt?.toISOString() ?? null,
  discounts: (o.discounts ?? []).map((d) => ({ id: d.id, name: d.name, category: d.category.toLowerCase(), type: d.type.toLowerCase(), value: d.value, amount: d.amount })),
  createdAt: o.createdAt.toISOString(),
});

const obligationInclude = { examination: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } }, class: { select: { id: true, name: true } }, discounts: true };

/** Totals of obligations (cancelled ones left out). */
export function totalsOf(obligations, today, graceDays) {
  const live = obligations.filter((o) => o.status !== 'CANCELLED');
  const sum = (list, f) => list.reduce((n, o) => n + f(o), 0);
  const monthly = live.filter((o) => o.kind === 'MONTHLY');
  const exam = live.filter((o) => o.kind === 'EXAM');
  const other = live.filter((o) => o.kind === 'OTHER');
  const due = sum(live, (o) => o.netAmount);
  const paid = sum(live, (o) => o.paidAmount);
  return {
    count: live.length,
    standard: sum(live, (o) => o.standardAmount),
    discounts: sum(live, (o) => o.discountAmount),
    adjustments: sum(live, (o) => o.standardAmount - o.amount),
    due,
    paid,
    balance: due - paid,
    overdue: sum(live.filter((o) => isOverdue({ ...o, dueDate: fromDbDate(o.dueDate) }, today, graceDays)), (o) => o.netAmount - o.paidAmount),
    monthly: { due: sum(monthly, (o) => o.netAmount), paid: sum(monthly, (o) => o.paidAmount), count: monthly.length },
    exam: { due: sum(exam, (o) => o.netAmount), paid: sum(exam, (o) => o.paidAmount), count: exam.length },
    other: { due: sum(other, (o) => o.netAmount), paid: sum(other, (o) => o.paidAmount), count: other.length },
  };
}

/** A student's fee status from their totals: cleared (nothing owed), partial (some paid), outstanding, none. */
export const accountStatus = (t) => (!t.count ? 'none' : t.balance <= 0 ? 'cleared' : t.paid > 0 ? 'partial' : 'outstanding');

// ---- list --------------------------------------------------------------------------------------------

export function readAccountsQuery(query, { role }) {
  const one = (k) => (Array.isArray(query[k]) ? query[k][0] : query[k]) || undefined;
  const errors = {};
  const out = { academicYear: one('academicYear') ?? 'current', classId: one('class'), sectionId: one('section'), branch: role === 'OWNER' ? one('branch') : undefined, q: one('q')?.trim().slice(0, 80), status: one('status') ?? 'all' };
  for (const k of ['classId', 'sectionId', 'branch']) if (out[k] && !isUuid(out[k])) errors[k] = 'Choose from the list.';
  if (!['all', 'cleared', 'partial', 'outstanding', 'overdue', 'none'].includes(out.status)) errors.status = 'Unknown status.';
  out.page = Math.max(1, Number.parseInt(one('page') ?? '1', 10) || 1);
  out.pageSize = Math.min(100, Math.max(5, Number.parseInt(one('pageSize') ?? '20', 10) || 20));
  if (Object.keys(errors).length) throw badRequest('Check the filters.', errors);
  return out;
}

/** Students of the year (enrolled in it, in the scope) with their fee totals for the year. */
export async function accountRows(scope, { academicYear, classId, sectionId, branch, q }) {
  const prisma = getPrisma();
  const year = await yearOf(prisma, scope, academicYear);
  if (!year) return { year: null, rows: [] };
  const settings = await feeSettingsOf(scope.school.id);
  const today = await calendarToday();
  const words = q ? q.split(/\s+/).filter(Boolean) : [];
  const enrollments = await prisma.enrollment.findMany({
    where: {
      schoolId: scope.school.id,
      academicYearId: year.id,
      ...(sectionId && { sectionId }),
      ...(classId && { section: { classId } }),
      student: {
        ...studentScope(scope),
        ...(branch && { branchId: branch }),
        ...(words.length && { AND: words.map((w) => ({ OR: [{ firstName: { contains: w, mode: 'insensitive' } }, { middleName: { contains: w, mode: 'insensitive' } }, { lastName: { contains: w, mode: 'insensitive' } }, { studentNumber: { contains: w, mode: 'insensitive' } }] })) }),
      },
    },
    select: {
      student: { select: { id: true, firstName: true, middleName: true, lastName: true, studentNumber: true, status: true, guardianName: true, guardianPhone: true, branch: { select: { id: true, name: true } } } },
      section: { select: { id: true, name: true, class: { select: { id: true, name: true, sequence: true } } } },
      status: true,
    },
  });
  const ids = enrollments.map((e) => e.student.id);
  const obligations = ids.length
    ? await prisma.feeObligation.findMany({
        where: { studentId: { in: ids }, academicYearId: year.id, status: { not: 'CANCELLED' } },
        select: { studentId: true, kind: true, status: true, standardAmount: true, amount: true, discountAmount: true, netAmount: true, paidAmount: true, dueDate: true },
      })
    : [];
  const byStudent = new Map();
  for (const o of obligations) {
    if (!byStudent.has(o.studentId)) byStudent.set(o.studentId, []);
    byStudent.get(o.studentId).push(o);
  }
  const rows = enrollments.map((e) => {
    const totals = totalsOf(byStudent.get(e.student.id) ?? [], today, settings.overdueGraceDays);
    return {
      student: { id: e.student.id, name: fullName(e.student), studentNumber: e.student.studentNumber, status: e.student.status.toLowerCase(), guardianName: e.student.guardianName, guardianPhone: e.student.guardianPhone },
      branch: e.student.branch,
      class: { id: e.section.class.id, name: e.section.class.name, sequence: e.section.class.sequence },
      section: { id: e.section.id, name: e.section.name, displayName: `${e.section.class.name}${e.section.name}` },
      enrollmentStatus: e.status.toLowerCase(),
      totals,
      status: accountStatus(totals),
      obligations: byStudent.get(e.student.id) ?? [],
    };
  });
  rows.sort((a, b) => a.class.sequence - b.class.sequence || a.section.name.localeCompare(b.section.name) || a.student.name.localeCompare(b.student.name));
  return { year, rows, settings, today };
}

export async function listAccounts(scope, filters) {
  const { year, rows, settings } = await accountRows(scope, filters);
  const counts = { all: rows.length, cleared: 0, partial: 0, outstanding: 0, overdue: 0, none: 0 };
  for (const r of rows) {
    counts[r.status] += 1;
    if (r.totals.overdue > 0) counts.overdue += 1;
  }
  const filtered = rows.filter((r) => filters.status === 'all' || (filters.status === 'overdue' ? r.totals.overdue > 0 : r.status === filters.status));
  const start = (filters.page - 1) * filters.pageSize;
  const sum = (f) => filtered.reduce((n, r) => n + f(r), 0);
  return {
    academicYear: year ? { id: year.id, name: year.name } : null,
    currency: settings?.currency ?? 'USD',
    counts,
    totals: { due: sum((r) => r.totals.due), paid: sum((r) => r.totals.paid), balance: sum((r) => r.totals.balance), overdue: sum((r) => r.totals.overdue) },
    total: filtered.length,
    page: filters.page,
    pageSize: filters.pageSize,
    items: filtered.slice(start, start + filters.pageSize).map(({ obligations: _o, ...r }) => r),
  };
}

// ---- one account ---------------------------------------------------------------------------------------

export const toPayment = (p) => ({
  id: p.id,
  amount: p.amount,
  method: p.method.toLowerCase(),
  receivedAt: p.receivedAt.toISOString(),
  note: p.note,
  status: p.status.toLowerCase(),
  recordedBy: { id: p.recordedById, name: p.recordedByName, role: p.recordedByRole },
  branch: p.branch ? { id: p.branch.id, name: p.branch.name } : { id: p.branchId },
  reversedAt: p.reversedAt?.toISOString() ?? null,
  reversedBy: p.reversedByName,
  reversalReason: p.reversalReason,
  closed: Boolean(p.closingId),
  receipt: p.receipt ? { id: p.receipt.id, number: p.receipt.number, void: Boolean(p.receipt.voidedAt), printCount: p.receipt.printCount } : null,
  allocations: (p.allocations ?? []).map((a) => ({ id: a.id, amount: a.amount, obligation: a.obligation ? { id: a.obligation.id, title: a.obligation.title, kind: a.obligation.kind.toLowerCase(), month: fromDbDate(a.obligation.billingMonth) } : { id: a.obligationId } })),
  student: p.student ? { id: p.student.id, name: fullName(p.student), studentNumber: p.student.studentNumber } : undefined,
});

export const paymentInclude = { branch: { select: { id: true, name: true } }, receipt: { select: { id: true, number: true, voidedAt: true, printCount: true } }, allocations: { include: { obligation: { select: { id: true, title: true, kind: true, billingMonth: true } } } } };

/** The month grid of a year: each month's monthly fee state (paid, partial, unpaid, overdue, not charged). */
function monthGrid(year, obligations, settings, today) {
  if (!year) return [];
  return monthsBetween(fromDbDate(year.startDate), fromDbDate(year.endDate)).map((m) => {
    const o = obligations.find((x) => x.kind === 'MONTHLY' && fromDbDate(x.billingMonth) === m);
    let state = 'not_charged';
    if (o) state = o.status === 'CANCELLED' ? 'cancelled' : o.paidAmount >= o.netAmount ? 'paid' : isOverdue({ ...o, dueDate: fromDbDate(o.dueDate) }, today, settings.overdueGraceDays) ? 'overdue' : o.paidAmount > 0 ? 'partial' : 'unpaid';
    else if (m > monthOf(today)) state = 'upcoming';
    return { month: m, label: monthShort(m), fullLabel: monthLabel(m), state, obligationId: o?.id ?? null, netAmount: o?.netAmount ?? null, paidAmount: o?.paidAmount ?? null };
  });
}

export async function getAccount(scope, studentId, { academicYear } = {}) {
  const prisma = getPrisma();
  const student = await findScopedStudent(prisma, scope, studentId, { branch: { select: { id: true, name: true, code: true } } });
  const [settings, today] = await Promise.all([feeSettingsOf(scope.school.id), calendarToday()]);
  const year = await yearOf(prisma, scope, academicYear);
  const enrollment = year
    ? await prisma.enrollment.findUnique({ where: { studentId_academicYearId: { studentId: student.id, academicYearId: year.id } }, include: { section: { include: { class: true } }, branch: { select: { id: true, name: true } } } })
    : null;
  const [obligations, payments, discounts, adjustments, invoices, changes, exceptions, reminders] = await Promise.all([
    prisma.feeObligation.findMany({ where: { studentId: student.id }, include: obligationInclude, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] }),
    prisma.feePayment.findMany({ where: { studentId: student.id }, include: paymentInclude, orderBy: { receivedAt: 'desc' } }),
    prisma.studentDiscount.findMany({ where: { studentId: student.id }, include: { policy: true, applied: { select: { amount: true } } }, orderBy: { createdAt: 'desc' } }),
    prisma.studentFeeAdjustment.findMany({ where: { studentId: student.id }, include: { academicYear: { select: { name: true } } }, orderBy: { createdAt: 'desc' } }),
    prisma.feeInvoice.findMany({ where: { studentId: student.id }, include: { lines: { include: { obligation: { select: { netAmount: true, paidAmount: true, status: true } } } } }, orderBy: { createdAt: 'desc' } }),
    prisma.feeObligationChange.findMany({ where: { obligation: { studentId: student.id } }, include: { obligation: { select: { title: true } } }, orderBy: { createdAt: 'desc' }, take: 200 }),
    prisma.feeClearanceException.findMany({ where: { studentId: student.id }, include: { examination: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } }),
    prisma.feeReminderLog.findMany({ where: { studentId: student.id }, orderBy: { sentAt: 'desc' }, take: 20 }),
  ]);
  const yearObligations = year ? obligations.filter((o) => o.academicYearId === year.id) : obligations;
  const totals = totalsOf(yearObligations, today, settings.overdueGraceDays);
  const allTotals = totalsOf(obligations, today, settings.overdueGraceDays);
  const clearance = evaluateClearance(
    yearObligations.map((o) => ({ ...o, dueDate: fromDbDate(o.dueDate) })),
    { policy: clearancePolicy(settings), asOf: today, exception: null },
  );
  const history = [
    ...changes.map((c) => ({ at: c.createdAt.toISOString(), type: c.type.toLowerCase(), title: c.obligation.title, description: c.reason, fromAmount: c.fromAmount, toAmount: c.toAmount, by: c.actorName })),
    ...payments.map((p) => ({ at: p.createdAt.toISOString(), type: 'payment', title: `Payment ${p.receipt?.number ?? ''}`.trim(), description: `${formatMoney(p.amount, settings.currency)} received by ${p.recordedByName}`, toAmount: p.amount, by: p.recordedByName })),
    ...payments.filter((p) => p.reversedAt).map((p) => ({ at: p.reversedAt.toISOString(), type: 'reversal', title: `Payment ${p.receipt?.number ?? ''} reversed`.trim(), description: p.reversalReason, fromAmount: p.amount, by: p.reversedByName })),
    ...obligations.map((o) => ({ at: o.createdAt.toISOString(), type: 'charged', title: o.title, description: o.source === 'MANUAL' ? 'Charged by staff' : o.source === 'EXAM_ASSIGNMENT' ? 'Assigned to the examination' : 'Generated', toAmount: o.netAmount, by: o.createdByName })),
    ...discounts.map((d) => ({ at: d.createdAt.toISOString(), type: 'discount', title: `${d.policy.name} given`, description: d.reason, by: d.assignedByName })),
    ...discounts.filter((d) => d.revokedAt).map((d) => ({ at: d.revokedAt.toISOString(), type: 'discount_revoked', title: `${d.policy.name} revoked`, description: d.revokeReason, by: d.revokedByName })),
    ...adjustments.map((a) => ({ at: a.createdAt.toISOString(), type: 'adjustment', title: `Monthly fee set to ${formatMoney(a.amount, settings.currency)}`, description: a.reason, fromAmount: a.originalAmount, toAmount: a.amount, by: a.createdByName })),
    ...invoices.filter((i) => i.issuedAt).map((i) => ({ at: i.issuedAt.toISOString(), type: 'invoice', title: `Invoice ${i.number} issued`, by: i.createdByName })),
    ...reminders.map((r) => ({ at: r.sentAt.toISOString(), type: 'reminder', title: `Reminder sent by ${r.channel.toLowerCase()}`, description: r.note, toAmount: r.amount, by: r.sentByName })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return {
    currency: settings.currency,
    today,
    student: {
      id: student.id,
      name: fullName(student),
      studentNumber: student.studentNumber,
      status: student.status.toLowerCase(),
      guardianName: student.guardianName,
      guardianPhone: student.guardianPhone,
      branch: student.branch,
    },
    academicYear: year ? { id: year.id, name: year.name } : null,
    enrollment: enrollment ? { id: enrollment.id, status: enrollment.status.toLowerCase(), section: { id: enrollment.section.id, name: enrollment.section.name, displayName: `${enrollment.section.class.name}${enrollment.section.name}` }, class: { id: enrollment.section.class.id, name: enrollment.section.class.name }, branch: enrollment.branch, enrolledAt: enrollment.enrolledAt.toISOString() } : null,
    totals,
    allTotals,
    status: accountStatus(totals),
    clearance,
    months: monthGrid(year, yearObligations, settings, today),
    obligations: obligations.map((o) => toObligation(o, today, settings.overdueGraceDays)),
    payments: payments.map(toPayment),
    discounts: discounts.map((d) => ({
      id: d.id,
      policy: { id: d.policy.id, name: d.policy.name, category: d.policy.category.toLowerCase(), type: d.policy.type.toLowerCase(), value: d.policy.value },
      startMonth: fromDbDate(d.startMonth),
      endMonth: fromDbDate(d.endMonth),
      reason: d.reason,
      assignedBy: d.assignedByName,
      createdAt: d.createdAt.toISOString(),
      active: !d.revokedAt,
      revokedAt: d.revokedAt?.toISOString() ?? null,
      revokedBy: d.revokedByName,
      revokeReason: d.revokeReason,
      totalApplied: d.applied.reduce((n, a) => n + a.amount, 0),
    })),
    adjustments: adjustments.map((a) => ({ id: a.id, academicYear: a.academicYear.name, originalAmount: a.originalAmount, amount: a.amount, fromMonth: fromDbDate(a.fromMonth), toMonth: fromDbDate(a.toMonth), reason: a.reason, createdBy: a.createdByName, createdByRole: a.createdByRole, createdAt: a.createdAt.toISOString(), active: !a.endedAt, endedAt: a.endedAt?.toISOString() ?? null, endedBy: a.endedByName, endReason: a.endReason })),
    invoices: invoices.map((i) => ({ id: i.id, number: i.number, status: i.status.toLowerCase(), issuedAt: i.issuedAt?.toISOString() ?? null, createdAt: i.createdAt.toISOString(), amount: i.lines.reduce((n, l) => n + l.amount, 0), paid: i.lines.reduce((n, l) => n + (l.obligation.status === 'CANCELLED' ? 0 : l.obligation.paidAmount), 0) })),
    exceptions: exceptions.map((e) => ({ id: e.id, examination: e.examination, reason: e.reason, grantedBy: e.grantedByName, createdAt: e.createdAt.toISOString(), active: !e.revokedAt, revokedAt: e.revokedAt?.toISOString() ?? null, revokedBy: e.revokedByName, revokeReason: e.revokeReason })),
    history: history.slice(0, 300),
    permissions: permissions(scope, settings),
  };
}

// ---- adjustments ---------------------------------------------------------------------------------------

const readReason = (body, errors, field = 'reason') => {
  const r = typeof body[field] === 'string' ? body[field].trim() : '';
  if (!r) errors[field] = 'Give a reason.';
  else if (r.length > 500) errors[field] = 'At most 500 characters.';
  return r;
};
const readMonth = (value, errors, field, { required = true } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) errors[field] = 'Choose a month.';
    return null;
  }
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    errors[field] = 'Choose a month.';
    return null;
  }
  return `${value}-01`;
};
const fail = (errors) => {
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
};

export function readStudentAdjustment(body) {
  const errors = {};
  const amount = body.monthlyFee;
  if (!Number.isInteger(amount) || amount < 0 || amount > 100_000_000) errors.monthlyFee = 'Enter the student’s monthly fee (0 or more).';
  const fromMonth = readMonth(body.fromMonth, errors, 'fromMonth');
  const toMonth = readMonth(body.toMonth, errors, 'toMonth', { required: false });
  if (fromMonth && toMonth && toMonth < fromMonth) errors.toMonth = 'The last month comes after the first.';
  const reason = readReason(body, errors);
  if (body.applyToOpen !== undefined && typeof body.applyToOpen !== 'boolean') errors.applyToOpen = 'Yes or no.';
  fail(errors);
  return { amount, fromMonth, toMonth, reason, applyToOpen: body.applyToOpen !== false };
}

/** The class rate of a month for an enrollment, or null. */
async function classRate(client, yearId, classId, month) {
  const s = await client.feeStructure.findUnique({ where: { academicYearId_classId: { academicYearId: yearId, classId } }, include: { rates: { where: { effectiveMonth: { lte: asDbDate(month) } }, orderBy: { effectiveMonth: 'desc' }, take: 1 } } });
  return s?.rates[0]?.amount ?? null;
}

/** A Manager's reduction must stay within the school's limit (percent of the standard amount). */
function checkManagerLimit(scope, settings, standard, amount) {
  if (scope.role === 'OWNER') return;
  if (amount > standard) throw forbidden('Only the School Owner can raise a fee above its standard amount.');
  const reduction = standard ? ((standard - amount) * 100) / standard : 0;
  if (reduction > settings.managerAdjustmentLimit) throw forbidden(`Managers may reduce a fee by at most ${settings.managerAdjustmentLimit}%. Ask your School Owner for a larger reduction.`);
}

/**
 * Sets a student's own monthly fee from a month (to a month), with a reason. Monthly fees generated
 * from then on use it; with applyToOpen, generated fees of those months with nothing paid yet change
 * too (each with a change record). The class amount is kept as the original amount.
 */
export async function createAdjustment(scope, studentId, values, user, req) {
  const prisma = getPrisma();
  const settings = await feeSettingsOf(scope.school.id);
  if (!permissions(scope, settings).adjust) throw forbidden('Your school does not let Managers adjust fees.');
  const result = await prisma.$transaction(async (tx) => {
    await lockOperating(tx, scope);
    const student = await findScopedStudent(tx, scope, studentId);
    await lockStudentAccount(tx, student.id);
    const year = await yearOf(tx, scope, 'current');
    if (!year) throw conflict('NO_CURRENT_YEAR', 'There is no current academic year.');
    if (values.fromMonth < monthOf(fromDbDate(year.startDate)) || values.fromMonth > fromDbDate(year.endDate)) throw conflict('OUTSIDE_YEAR', `Choose a month of ${year.name}.`);
    const enrollment = await tx.enrollment.findUnique({ where: { studentId_academicYearId: { studentId: student.id, academicYearId: year.id } }, include: { section: true } });
    if (!enrollment) throw conflict('NOT_ENROLLED', `${fullName(student)} is not enrolled in ${year.name}.`);
    const standard = await classRate(tx, year.id, enrollment.section.classId, values.fromMonth);
    if (standard === null) throw conflict('NO_STRUCTURE', 'This class has no monthly fee yet. Add its fee structure first.');
    checkManagerLimit(scope, settings, standard, values.amount);
    // One active adjustment at a time: the previous one ends.
    const previous = await tx.studentFeeAdjustment.findMany({ where: { studentId: student.id, academicYearId: year.id, endedAt: null } });
    for (const p of previous) await tx.studentFeeAdjustment.update({ where: { id: p.id }, data: { endedAt: new Date(), endedByName: user.name, endReason: 'Replaced by a new adjustment.' } });
    const adjustment = await tx.studentFeeAdjustment.create({
      data: { schoolId: scope.school.id, branchId: student.branchId, studentId: student.id, academicYearId: year.id, originalAmount: standard, amount: values.amount, fromMonth: asDbDate(values.fromMonth), toMonth: values.toMonth ? asDbDate(values.toMonth) : null, reason: values.reason, createdById: user.id, createdByName: user.name, createdByRole: user.role },
    });
    let changed = 0;
    if (values.applyToOpen) {
      const open = await tx.feeObligation.findMany({ where: { studentId: student.id, academicYearId: year.id, kind: 'MONTHLY', status: 'OPEN', paidAmount: 0, billingMonth: { gte: asDbDate(values.fromMonth), ...(values.toMonth && { lte: asDbDate(values.toMonth) }) } } });
      for (const o of open) {
        const discount = Math.min(o.discountAmount, values.amount);
        const net = values.amount - discount;
        await tx.feeObligation.update({ where: { id: o.id }, data: { amount: values.amount, discountAmount: discount, netAmount: net, adjustmentId: adjustment.id, status: net === 0 ? 'PAID' : 'OPEN' } });
        await tx.feeObligationChange.create({ data: { obligationId: o.id, type: 'ADJUSTED', fromAmount: o.netAmount, toAmount: net, reason: values.reason, actorId: user.id, actorName: user.name, actorRole: user.role } });
        changed += 1;
      }
    }
    await audit(tx, AUDIT_ACTIONS.FEE_ADJUSTMENT_CREATED, scope, user, req, student, `Monthly fee set to ${formatMoney(values.amount, settings.currency)} (standard ${formatMoney(standard, settings.currency)}) from ${monthLabel(values.fromMonth)}${values.toMonth ? ` to ${monthLabel(values.toMonth)}` : ''}${changed ? `; ${changed} unpaid month${changed === 1 ? '' : 's'} updated` : ''}. Reason: ${values.reason}`, {
      fields: [{ field: 'Monthly fee', from: formatMoney(standard, settings.currency), to: formatMoney(values.amount, settings.currency) }],
    });
    return { adjustment, changed };
  }, TX);
  return { id: result.adjustment.id, changed: result.changed };
}

export async function endAdjustment(scope, adjustmentId, { reason }, user, req) {
  if (!isUuid(adjustmentId)) throw notFound('Adjustment not found.');
  const prisma = getPrisma();
  const settings = await feeSettingsOf(scope.school.id);
  if (!permissions(scope, settings).adjust) throw forbidden('Your school does not let Managers adjust fees.');
  await prisma.$transaction(async (tx) => {
    await lockOperating(tx, scope);
    const a = await tx.studentFeeAdjustment.findFirst({ where: { id: adjustmentId, schoolId: scope.school.id } });
    if (!a) throw notFound('Adjustment not found.');
    const student = await findScopedStudent(tx, scope, a.studentId);
    if (a.endedAt) throw conflict('ALREADY_ENDED', 'This adjustment has already ended.');
    await tx.studentFeeAdjustment.update({ where: { id: a.id }, data: { endedAt: new Date(), endedByName: user.name, endReason: reason } });
    await audit(tx, AUDIT_ACTIONS.FEE_ADJUSTMENT_ENDED, scope, user, req, student, `Individual monthly fee of ${formatMoney(a.amount, settings.currency)} ended: the class fee applies to months generated from now on. Reason: ${reason}`);
  }, TX);
}

export function readObligationAdjustment(body) {
  const errors = {};
  if (!Number.isInteger(body.amount) || body.amount < 0 || body.amount > 100_000_000) errors.amount = 'Enter the new amount (0 or more).';
  const reason = readReason(body, errors);
  fail(errors);
  return { amount: body.amount, reason };
}

export function readReasonOnly(body) {
  const errors = {};
  const reason = readReason(body, errors);
  fail(errors);
  return { reason };
}

async function findScopedObligation(tx, scope, id) {
  if (!isUuid(id)) throw notFound('Fee not found.');
  const o = await tx.feeObligation.findFirst({ where: { id, schoolId: scope.school.id }, include: { student: true } });
  if (!o) throw notFound('Fee not found.');
  if (scope.branch && o.student.branchId !== scope.branch.id) throw notFound('Fee not found.');
  return o;
}

/** Changes one obligation's amount (before discounts) with a reason; never below what is already paid. */
export async function adjustObligation(scope, obligationId, { amount, reason }, user, req) {
  const prisma = getPrisma();
  const settings = await feeSettingsOf(scope.school.id);
  if (!permissions(scope, settings).adjust) throw forbidden('Your school does not let Managers adjust fees.');
  await prisma.$transaction(async (tx) => {
    await lockOperating(tx, scope);
    const found = await findScopedObligation(tx, scope, obligationId);
    await lockStudentAccount(tx, found.studentId);
    const o = await tx.feeObligation.findUnique({ where: { id: found.id } });
    if (o.status === 'CANCELLED') throw conflict('CANCELLED', 'This fee is cancelled. Reinstate it first.');
    checkManagerLimit(scope, settings, o.standardAmount, amount);
    const discount = Math.min(o.discountAmount, amount);
    const net = amount - discount;
    if (net < o.paidAmount) throw conflict('BELOW_PAID', `${formatMoney(o.paidAmount, settings.currency)} is already paid towards this fee: it cannot be less than that.`);
    if (amount === o.amount) return;
    await tx.feeObligation.update({ where: { id: o.id }, data: { amount, discountAmount: discount, netAmount: net, status: o.paidAmount >= net ? 'PAID' : 'OPEN' } });
    await tx.feeObligationChange.create({ data: { obligationId: o.id, type: 'ADJUSTED', fromAmount: o.netAmount, toAmount: net, reason, actorId: user.id, actorName: user.name, actorRole: user.role } });
    await audit(tx, AUDIT_ACTIONS.FEE_OBLIGATION_ADJUSTED, scope, user, req, found.student, `${o.title} adjusted from ${formatMoney(o.netAmount, settings.currency)} to ${formatMoney(net, settings.currency)}. Reason: ${reason}`, {
      fields: [{ field: o.title, from: formatMoney(o.netAmount, settings.currency), to: formatMoney(net, settings.currency) }],
    });
    await refreshInvoicesOf(tx, [o.id]);
  }, TX);
}

/** Cancels an obligation with a reason (payments already allocated to it are kept). */
export async function cancelObligation(scope, obligationId, { reason }, user, req) {
  const prisma = getPrisma();
  const settings = await feeSettingsOf(scope.school.id);
  if (!permissions(scope, settings).cancelObligations) throw forbidden('Only the School Owner or a Manager cancels fees.');
  await prisma.$transaction(async (tx) => {
    await lockOperating(tx, scope);
    const found = await findScopedObligation(tx, scope, obligationId);
    await lockStudentAccount(tx, found.studentId);
    const o = await tx.feeObligation.findUnique({ where: { id: found.id } });
    if (o.status === 'CANCELLED') throw conflict('CANCELLED', 'This fee is already cancelled.');
    await tx.feeObligation.update({ where: { id: o.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, cancelledByName: user.name } });
    await tx.feeObligationChange.create({ data: { obligationId: o.id, type: 'CANCELLED', fromAmount: o.netAmount, toAmount: o.netAmount, reason, actorId: user.id, actorName: user.name, actorRole: user.role } });
    await audit(tx, AUDIT_ACTIONS.FEE_OBLIGATION_CANCELLED, scope, user, req, found.student, `${o.title} (${formatMoney(o.netAmount, settings.currency)}) cancelled${o.paidAmount ? `; ${formatMoney(o.paidAmount, settings.currency)} already paid is kept` : ''}. Reason: ${reason}`);
    await refreshInvoicesOf(tx, [o.id]);
  }, TX);
}

export async function reinstateObligation(scope, obligationId, { reason }, user, req) {
  const prisma = getPrisma();
  const settings = await feeSettingsOf(scope.school.id);
  if (!permissions(scope, settings).cancelObligations) throw forbidden('Only the School Owner or a Manager reinstates fees.');
  await prisma.$transaction(async (tx) => {
    await lockOperating(tx, scope);
    const found = await findScopedObligation(tx, scope, obligationId);
    await lockStudentAccount(tx, found.studentId);
    const o = await tx.feeObligation.findUnique({ where: { id: found.id } });
    if (o.status !== 'CANCELLED') throw conflict('NOT_CANCELLED', 'This fee is not cancelled.');
    await tx.feeObligation.update({ where: { id: o.id }, data: { status: o.paidAmount >= o.netAmount ? 'PAID' : 'OPEN', cancelledAt: null, cancelReason: null, cancelledByName: null } });
    await tx.feeObligationChange.create({ data: { obligationId: o.id, type: 'REINSTATED', fromAmount: o.netAmount, toAmount: o.netAmount, reason, actorId: user.id, actorName: user.name, actorRole: user.role } });
    await audit(tx, AUDIT_ACTIONS.FEE_OBLIGATION_REINSTATED, scope, user, req, found.student, `${o.title} reinstated. Reason: ${reason}`);
    await refreshInvoicesOf(tx, [o.id]);
  }, TX);
}

export function readCharge(body) {
  const errors = {};
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) errors.title = 'Name the charge (e.g. Uniform, Transport).';
  else if (title.length > 80) errors.title = 'At most 80 characters.';
  if (!Number.isInteger(body.amount) || body.amount <= 0 || body.amount > 100_000_000) errors.amount = 'Enter an amount above 0.';
  let dueDate = null;
  if (body.dueDate !== undefined && body.dueDate !== null && body.dueDate !== '') {
    if (typeof body.dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate) || Number.isNaN(Date.parse(body.dueDate))) errors.dueDate = 'Choose a date.';
    else dueDate = body.dueDate;
  }
  const reason = readReason(body, errors);
  fail(errors);
  return { title, amount: body.amount, dueDate, reason };
}

/** Adds another charge (uniform, transport, a fine…) to a student's account for the current year. */
export async function addCharge(scope, studentId, values, user, req) {
  const prisma = getPrisma();
  const settings = await feeSettingsOf(scope.school.id);
  if (!permissions(scope, settings).charge) throw forbidden('Only the School Owner or a Manager adds charges.');
  const today = await calendarToday();
  return prisma.$transaction(async (tx) => {
    await lockOperating(tx, scope);
    const student = await findScopedStudent(tx, scope, studentId);
    await lockStudentAccount(tx, student.id);
    const year = await yearOf(tx, scope, 'current');
    if (!year) throw conflict('NO_CURRENT_YEAR', 'There is no current academic year.');
    const enrollment = await tx.enrollment.findUnique({ where: { studentId_academicYearId: { studentId: student.id, academicYearId: year.id } }, include: { section: true } });
    const month = monthOf(values.dueDate ?? today);
    const ds = await tx.studentDiscount.findMany({ where: { studentId: student.id, revokedAt: null }, include: { policy: true } });
    const disc = applyDiscounts(
      values.amount,
      ds.filter((d) => discountCovers(d, d.policy, { month, kind: 'OTHER', classId: enrollment?.section.classId, branchId: student.branchId })).map((d) => ({ id: d.id, name: d.policy.name, category: d.policy.category, type: d.policy.type, value: d.policy.value, maxAmount: d.policy.maxAmount, combinable: d.policy.combinable })),
      { combination: settings.discountCombination, maxCombinedPercent: settings.maxCombinedDiscount },
    );
    const o = await tx.feeObligation.create({
      data: {
        schoolId: scope.school.id,
        branchId: student.branchId,
        studentId: student.id,
        enrollmentId: enrollment?.id ?? null,
        academicYearId: year.id,
        classId: enrollment?.section.classId ?? null,
        sectionId: enrollment?.sectionId ?? null,
        kind: 'OTHER',
        title: values.title,
        standardAmount: values.amount,
        amount: values.amount,
        discountAmount: disc.total,
        netAmount: values.amount - disc.total,
        status: values.amount - disc.total === 0 ? 'PAID' : 'OPEN',
        dueDate: asDbDate(values.dueDate ?? today),
        source: 'MANUAL',
        createdById: user.id,
        createdByName: user.name,
        discounts: { create: disc.applied.map((d) => ({ studentDiscountId: d.id, name: d.name, category: d.category, type: d.type, value: d.value, amount: d.amount })) },
      },
    });
    await tx.feeObligationChange.create({ data: { obligationId: o.id, type: 'CHARGED', toAmount: o.netAmount, reason: values.reason, actorId: user.id, actorName: user.name, actorRole: user.role } });
    await audit(tx, AUDIT_ACTIONS.FEE_CHARGE_ADDED, scope, user, req, student, `${values.title} of ${formatMoney(values.amount, settings.currency)} charged. Reason: ${values.reason}`);
    return { id: o.id };
  }, TX);
}

/** Invoices whose lines include these obligations follow their payments (status). */
export async function refreshInvoicesOf(tx, obligationIds) {
  if (!obligationIds.length) return;
  const invoices = await tx.feeInvoice.findMany({ where: { status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] }, lines: { some: { obligationId: { in: obligationIds } } } }, include: { lines: { include: { obligation: { select: { status: true, netAmount: true, paidAmount: true } } } } } });
  for (const inv of invoices) {
    const next = invoiceStatus(inv.status, inv.lines);
    if (next !== inv.status) await tx.feeInvoice.update({ where: { id: inv.id }, data: { status: next } });
  }
}

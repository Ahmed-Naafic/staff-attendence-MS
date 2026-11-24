import { badRequest, conflict, forbidden, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { actorOf, findScopedStudent, lockOperating, permissions, studentScope, TX, yearOf } from './feeAccess.js';
import { accountRows, fullName, getAccount } from './feeAccounts.service.js';
import { syncExamFees } from './feeGeneration.service.js';
import { clearancePolicy, feeSettingsOf } from './feeSettings.js';
import { addDays, evaluateClearance, formatMoney, fromDbDate } from './feeRules.js';

/*
 * Fee clearance (docs/business-rules.md → Fee Management → Fee clearance): whether a student's fees
 * allow them to sit examinations. It has nothing to do with graduation. Monthly fees and examination
 * fees stay separate obligations; the School Owner's policy decides which count (the examination fee,
 * overdue or all due monthly fees), whether part payment qualifies, and the deadline. Authorized
 * exceptions need a reason and are audited.
 */

const STATUS_FILTERS = ['all', 'cleared', 'partially_cleared', 'not_cleared'];

export function readClearanceQuery(query, { role }) {
  const one = (k) => (Array.isArray(query[k]) ? query[k][0] : query[k]) || undefined;
  const errors = {};
  const out = { academicYear: one('academicYear') ?? 'current', classId: one('class'), sectionId: one('section'), branch: role === 'OWNER' ? one('branch') : undefined, q: one('q')?.trim().slice(0, 80), status: one('status') ?? 'all' };
  for (const k of ['classId', 'sectionId', 'branch']) if (out[k] && !isUuid(out[k])) errors[k] = 'Choose from the list.';
  if (!STATUS_FILTERS.includes(out.status)) errors.status = 'Unknown status.';
  out.page = Math.max(1, Number.parseInt(one('page') ?? '1', 10) || 1);
  out.pageSize = Math.min(200, Math.max(5, Number.parseInt(one('pageSize') ?? '25', 10) || 25));
  if (Object.keys(errors).length) throw badRequest('Check the filters.', errors);
  return out;
}

const live = (obligations) => obligations.map((o) => ({ ...o, dueDate: fromDbDate(o.dueDate) }));

/** Students' general fee clearance: every fee due by today (monthly and examination) paid. */
export async function listStudentClearance(scope, f) {
  const { year, rows, settings, today } = await accountRows(scope, { ...f, status: 'all' });
  if (!year) return { academicYear: null, counts: { all: 0, cleared: 0, partially_cleared: 0, not_cleared: 0 }, items: [], total: 0, page: 1, pageSize: f.pageSize, currency: 'USD' };
  const policy = clearancePolicy(settings);
  const items = rows.map((r) => {
    const c = evaluateClearance(live(r.obligations), { policy, asOf: today });
    return {
      student: r.student,
      branch: r.branch,
      class: r.class,
      section: r.section,
      monthly: r.totals.monthly,
      exam: r.totals.exam,
      other: r.totals.other,
      totalDue: r.totals.due,
      paid: r.totals.paid,
      balance: r.totals.balance,
      overdue: r.totals.overdue,
      dueByToday: c.required,
      paidOfDue: c.paid,
      clearance: c.status.toLowerCase(),
      explanation: c.reasons.join(' '),
    };
  });
  const counts = { all: items.length, cleared: 0, partially_cleared: 0, not_cleared: 0 };
  for (const i of items) counts[i.clearance] += 1;
  const filtered = items.filter((i) => f.status === 'all' || i.clearance === f.status);
  const start = (f.page - 1) * f.pageSize;
  return { academicYear: { id: year.id, name: year.name }, currency: settings.currency, today, counts, total: filtered.length, page: f.page, pageSize: f.pageSize, items: filtered.slice(start, start + f.pageSize) };
}

/** A student's clearance details: the account, the general clearance, and each upcoming examination's. */
export async function studentClearance(scope, studentId) {
  const account = await getAccount(scope, studentId, {});
  const prisma = getPrisma();
  const settings = await feeSettingsOf(scope.school.id);
  const today = await calendarToday();
  const policy = clearancePolicy(settings);
  const exams = await prisma.examination.findMany({
    where: { schoolId: scope.school.id, status: 'SCHEDULED', feeObligations: { some: { studentId, kind: 'EXAM' } } },
    select: { id: true, name: true, startDate: true, endDate: true },
    orderBy: { startDate: 'asc' },
  });
  const obligations = await prisma.feeObligation.findMany({ where: { studentId, status: { not: 'CANCELLED' } } });
  const exceptions = await prisma.feeClearanceException.findMany({ where: { studentId, revokedAt: null } });
  return {
    ...account,
    policy: { ...policy, deadlineDays: settings.clearanceDeadlineDays },
    examinations: exams.map((e) => {
      const start = fromDbDate(e.startDate);
      const asOf = [addDays(start, -settings.clearanceDeadlineDays), today].sort()[0];
      const exception = exceptions.find((x) => x.examinationId === e.id) ?? exceptions.find((x) => !x.examinationId) ?? null;
      const c = evaluateClearance(live(obligations), { exam: e, policy, asOf, exception });
      const fee = obligations.find((o) => o.kind === 'EXAM' && o.examinationId === e.id);
      return { id: e.id, name: e.name, startDate: start, endDate: fromDbDate(e.endDate), deadline: addDays(start, -settings.clearanceDeadlineDays), fee: fee ? { id: fee.id, netAmount: fee.netAmount, paidAmount: fee.paidAmount, status: fee.status.toLowerCase(), dueDate: fromDbDate(fee.dueDate) } : null, ...c, status: c.status.toLowerCase(), exception: exception ? { id: exception.id, reason: exception.reason, grantedBy: exception.grantedByName, examinationId: exception.examinationId } : null };
    }),
  };
}

/** Examinations to choose from in the examination clearance view (scheduled, upcoming or running, and recent ones). */
export async function clearanceExams(scope) {
  const prisma = getPrisma();
  const today = await calendarToday();
  const exams = await prisma.examination.findMany({
    where: { schoolId: scope.school.id, status: 'SCHEDULED', endDate: { gte: new Date(`${addDays(today, -60)}T00:00:00Z`) }, ...(scope.branch && { OR: [{ branchId: null }, { branchId: scope.branch.id }] }) },
    include: { examType: { select: { name: true } }, _count: { select: { feeObligations: true } } },
    orderBy: { startDate: 'asc' },
  });
  return { items: exams.map((e) => ({ id: e.id, name: e.name, type: e.examType.name, startDate: fromDbDate(e.startDate), endDate: fromDbDate(e.endDate), fees: e._count.feeObligations, upcoming: fromDbDate(e.endDate) >= today })) };
}

/**
 * Examination clearance: each student assigned to the examination (its fee obligations; the fees are
 * synced first) with their examination fee, monthly balances and clearance under the policy, judged on
 * the clearance deadline (or today, before it).
 */
export async function examClearance(scope, examId, f) {
  if (!isUuid(examId)) throw notFound('Examination not found.');
  const prisma = getPrisma();
  const exam = await prisma.examination.findFirst({ where: { id: examId, schoolId: scope.school.id }, include: { examType: { select: { name: true } }, classes: { include: { class: { select: { id: true, name: true } } } } } });
  if (!exam) throw notFound('Examination not found.');
  await syncExamFees(exam.id);
  const settings = await feeSettingsOf(scope.school.id);
  const today = await calendarToday();
  const policy = clearancePolicy(settings);
  const start = fromDbDate(exam.startDate);
  const deadline = addDays(start, -settings.clearanceDeadlineDays);
  const asOf = [deadline, today].sort()[0];
  const fees = await prisma.feeObligation.findMany({
    where: { examinationId: exam.id, kind: 'EXAM', student: { ...studentScope(scope), ...(f.branch && { branchId: f.branch }) }, ...(f.classId && { classId: f.classId }), ...(f.sectionId && { sectionId: f.sectionId }) },
    include: { student: { include: { branch: { select: { id: true, name: true } } } }, section: { select: { id: true, name: true } }, class: { select: { id: true, name: true, sequence: true } } },
  });
  const ids = [...new Set(fees.map((x) => x.studentId))];
  const [obligations, exceptions] = await Promise.all([
    ids.length ? prisma.feeObligation.findMany({ where: { studentId: { in: ids }, status: { not: 'CANCELLED' } } }) : [],
    ids.length ? prisma.feeClearanceException.findMany({ where: { studentId: { in: ids }, revokedAt: null, OR: [{ examinationId: exam.id }, { examinationId: null }] } }) : [],
  ]);
  const words = f.q ? f.q.toLowerCase().split(/\s+/).filter(Boolean) : [];
  let items = fees.map((fee) => {
    const mine = obligations.filter((o) => o.studentId === fee.studentId);
    const exception = exceptions.find((x) => x.studentId === fee.studentId && x.examinationId === exam.id) ?? exceptions.find((x) => x.studentId === fee.studentId && !x.examinationId) ?? null;
    const c = evaluateClearance(live(mine), { exam, policy, asOf, exception });
    const monthly = mine.filter((o) => o.kind !== 'EXAM');
    const overdueMonthly = monthly.filter((o) => addDays(fromDbDate(o.dueDate), settings.overdueGraceDays) < asOf);
    return {
      student: { id: fee.student.id, name: fullName(fee.student), studentNumber: fee.student.studentNumber },
      branch: fee.student.branch,
      class: fee.class,
      section: fee.section ? { id: fee.section.id, name: fee.section.name, displayName: `${fee.class?.name ?? ''}${fee.section.name}` } : null,
      examFee: { id: fee.id, netAmount: fee.netAmount, paidAmount: fee.paidAmount, status: fee.status.toLowerCase(), cancelReason: fee.cancelReason },
      removed: fee.status === 'CANCELLED',
      monthlyDue: monthly.filter((o) => fromDbDate(o.dueDate) <= asOf).reduce((n, o) => n + o.netAmount - o.paidAmount, 0),
      monthlyOverdue: overdueMonthly.reduce((n, o) => n + o.netAmount - o.paidAmount, 0),
      required: c.required,
      paid: c.paid,
      outstanding: c.outstanding,
      clearance: c.status.toLowerCase(),
      eligible: c.eligible,
      byException: c.byException,
      exception: exception ? { id: exception.id, reason: exception.reason, grantedBy: exception.grantedByName, forAll: !exception.examinationId } : null,
      explanation: c.reasons.join(' '),
    };
  });
  items = items.filter((i) => !words.length || words.every((w) => i.student.name.toLowerCase().includes(w) || i.student.studentNumber.toLowerCase().includes(w)));
  items.sort((a, b) => (a.class?.sequence ?? 0) - (b.class?.sequence ?? 0) || (a.section?.name ?? '').localeCompare(b.section?.name ?? '') || a.student.name.localeCompare(b.student.name));
  const active = items.filter((i) => !i.removed);
  const counts = { all: active.length, cleared: 0, partially_cleared: 0, not_cleared: 0, eligible: 0, removed: items.length - active.length };
  for (const i of active) {
    counts[i.clearance] += 1;
    if (i.eligible) counts.eligible += 1;
  }
  const filtered = f.status === 'all' ? active : active.filter((i) => i.clearance === f.status);
  const start2 = (f.page - 1) * f.pageSize;
  return {
    currency: settings.currency,
    examination: { id: exam.id, name: exam.name, type: exam.examType.name, startDate: start, endDate: fromDbDate(exam.endDate), status: exam.status.toLowerCase(), classes: exam.classes.map((c) => c.class) },
    deadline,
    asOf,
    policy: { ...policy, deadlineDays: settings.clearanceDeadlineDays },
    counts,
    total: filtered.length,
    page: f.page,
    pageSize: f.pageSize,
    items: filtered.slice(start2, start2 + f.pageSize),
    removed: items.filter((i) => i.removed),
    canGrant: permissions(scope, settings).grantExceptions,
  };
}

export function readException(body) {
  const errors = {};
  if (!isUuid(body.student)) errors.student = 'Choose the student.';
  if (body.examination !== undefined && body.examination !== null && !isUuid(body.examination)) errors.examination = 'Choose an examination.';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) errors.reason = 'Give a reason for the exception.';
  else if (reason.length > 500) errors.reason = 'At most 500 characters.';
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return { studentId: body.student, examinationId: body.examination ?? null, reason };
}

export async function grantException(scope, values, user, req) {
  const prisma = getPrisma();
  const settings = await feeSettingsOf(scope.school.id);
  if (!permissions(scope, settings).grantExceptions) throw forbidden('Your school does not let your role grant clearance exceptions.');
  return prisma.$transaction(async (tx) => {
    await lockOperating(tx, scope);
    const student = await findScopedStudent(tx, scope, values.studentId);
    let exam = null;
    if (values.examinationId) {
      exam = await tx.examination.findFirst({ where: { id: values.examinationId, schoolId: scope.school.id } });
      if (!exam) throw notFound('Examination not found.');
    }
    const existing = await tx.feeClearanceException.findFirst({ where: { studentId: student.id, examinationId: values.examinationId, revokedAt: null } });
    if (existing) throw conflict('EXCEPTION_EXISTS', 'This student already has this exception.');
    const created = await tx.feeClearanceException.create({ data: { schoolId: scope.school.id, studentId: student.id, examinationId: values.examinationId, reason: values.reason, grantedById: user.id, grantedByName: user.name, grantedByRole: user.role } });
    const balance = await tx.feeObligation.findMany({ where: { studentId: student.id, status: 'OPEN' }, select: { netAmount: true, paidAmount: true } });
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.FEE_CLEARANCE_EXCEPTION_GRANTED,
      actor: actorOf(user),
      target: { type: 'student', id: student.id, name: `${fullName(student)} (${student.studentNumber})` },
      schoolId: scope.school.id,
      description: `Fee clearance exception granted for ${exam ? exam.name : 'every examination'} with ${formatMoney(balance.reduce((n, o) => n + o.netAmount - o.paidAmount, 0), settings.currency)} still owed. Reason: ${values.reason}`,
      req,
    });
    return { id: created.id };
  }, TX);
}

export async function revokeException(scope, id, { reason }, user, req) {
  if (!isUuid(id)) throw notFound('Exception not found.');
  const prisma = getPrisma();
  const settings = await feeSettingsOf(scope.school.id);
  if (!permissions(scope, settings).grantExceptions) throw forbidden('Your school does not let your role change clearance exceptions.');
  await prisma.$transaction(async (tx) => {
    await lockOperating(tx, scope);
    const x = await tx.feeClearanceException.findFirst({ where: { id, schoolId: scope.school.id }, include: { examination: { select: { name: true } } } });
    if (!x) throw notFound('Exception not found.');
    const student = await findScopedStudent(tx, scope, x.studentId);
    if (x.revokedAt) throw conflict('ALREADY_REVOKED', 'This exception is already revoked.');
    await tx.feeClearanceException.update({ where: { id: x.id }, data: { revokedAt: new Date(), revokedByName: user.name, revokeReason: reason } });
    await recordAuditEvent({ client: tx, action: AUDIT_ACTIONS.FEE_CLEARANCE_EXCEPTION_REVOKED, actor: actorOf(user), target: { type: 'student', id: student.id, name: `${fullName(student)} (${student.studentNumber})` }, schoolId: scope.school.id, description: `Fee clearance exception for ${x.examination?.name ?? 'every examination'} revoked. Reason: ${reason}`, req });
  }, TX);
}

export { yearOf };

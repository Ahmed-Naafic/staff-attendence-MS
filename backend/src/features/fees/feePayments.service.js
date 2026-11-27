import { badRequest, conflict, forbidden, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { actorOf, findScopedStudent, lockOperating, lockStudentAccount, permissions, studentScope, TX } from './feeAccess.js';
import { fullName, paymentInclude, refreshInvoicesOf, toPayment } from './feeAccounts.service.js';
import { currentBranding, feeSettingsOf } from './feeSettings.js';
import { checkAllocations, counterKey, formatMoney, formatNumber, fromDbDate, monthLabel, statusAfterPayment } from './feeRules.js';

/*
 * Payments (docs/business-rules.md → Fee Management → Payments). Version 1: cash only. The staff
 * member chooses exactly which fees a payment pays (any unpaid month, older ones may stay unpaid); the
 * amounts allocated add up to the amount received; nothing is moved to other fees automatically. Each
 * payment issues a receipt (printing is optional). A mistake is reversed with a reason: the payment
 * and its allocations are kept, balances go back up, the receipt is marked VOID.
 */

/** The next document number of a kind ('receipt' | 'invoice') in `tx` (the counter row is locked by the update). */
export async function nextNumber(tx, schoolId, kind, format, day, branchNumber) {
  const key = counterKey(kind, format, day);
  const [row] = await tx.$queryRaw`
    INSERT INTO "FeeCounter" ("schoolId", "key", "value") VALUES (${schoolId}, ${key}, 1)
    ON CONFLICT ("schoolId", "key") DO UPDATE SET "value" = "FeeCounter"."value" + 1
    RETURNING "value"`;
  return formatNumber(format, { sequence: Number(row.value), day, branchNumber });
}

export function readPayment(body) {
  const errors = {};
  if (!isUuid(body.student)) errors.student = 'Choose the student.';
  if (!Number.isInteger(body.amount) || body.amount <= 0 || body.amount > 100_000_000) errors.amount = 'Enter the amount received.';
  if (body.method !== undefined && body.method !== 'cash') errors.method = 'Only cash payments are recorded in this version.';
  if (!Array.isArray(body.allocations) || !body.allocations.length || body.allocations.length > 60) errors.allocations = 'Choose what this payment pays.';
  const allocations = [];
  for (const a of Array.isArray(body.allocations) ? body.allocations : []) {
    if (!isUuid(a?.obligation) || !Number.isInteger(a?.amount)) errors.allocations = 'Each fee chosen needs its amount.';
    else allocations.push({ obligationId: a.obligation, amount: a.amount });
  }
  let note = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== 'string' || body.note.length > 300) errors.note = 'At most 300 characters.';
    else note = body.note.trim() || null;
  }
  let requestKey = null;
  if (body.requestKey !== undefined) {
    if (!isUuid(body.requestKey)) errors.requestKey = 'Invalid request.';
    else requestKey = body.requestKey;
  }
  if (Object.keys(errors).length) throw badRequest('Check the payment.', errors);
  return { studentId: body.student, amount: body.amount, allocations, note, requestKey };
}

/** What a receipt prints, as issued (kept unchanged afterwards). */
function receiptContent({ number, school, branding, branch, student, enrollment, payment, lines, currency, receivedBy, balanceAfter }) {
  return {
    number,
    currency,
    school: { name: branding?.schoolName ?? school.name, address: branding?.address ?? school.address, phone: branding?.phone ?? school.phone, email: branding?.email ?? school.email, website: branding?.website ?? school.website, footer: branding?.footer ?? null, showSignature: branding?.showSignature ?? true, signatureLabel: branding?.signatureLabel ?? 'Received by' },
    branch: { name: branch.name, code: branch.code },
    student: { name: fullName(student), studentNumber: student.studentNumber, class: enrollment ? `${enrollment.section.class.name}${enrollment.section.name}` : null, guardianName: student.guardianName },
    payment: { amount: payment.amount, method: 'Cash', receivedAt: payment.receivedAt.toISOString(), note: payment.note },
    lines,
    receivedBy,
    balanceAfter,
  };
}

/**
 * Records a cash payment and its receipt. Checks (feeRules.checkAllocations): the fees chosen belong to
 * the student and are open, no allocation exceeds a fee's balance, the allocations add up to the amount
 * received, and the partial payment policy. A repeated submission (same requestKey) returns the first
 * payment. Received where the staff member works (the student's branch for the School Owner).
 */
export async function recordPayment(scope, values, user, req) {
  const prisma = getPrisma();
  const settings = await feeSettingsOf(scope.school.id);
  const earlier = await repeatedPayment(scope, values);
  if (earlier) return earlier;
  const today = await calendarToday();
  let payment;
  try {
    payment = await prisma.$transaction(async (tx) => {
      await lockOperating(tx, scope);
      const student = await findScopedStudent(tx, scope, values.studentId);
      await lockStudentAccount(tx, student.id);
      const obligations = await tx.feeObligation.findMany({ where: { id: { in: values.allocations.map((a) => a.obligationId) }, studentId: student.id } });
      const map = new Map(obligations.map((o) => [o.id, o]));
      const { problems } = checkAllocations(values.amount, values.allocations, map, { allowPartial: settings.allowPartialPayments, minimumPartial: settings.minimumPartialPayment, currency: settings.currency });
      if (Object.keys(problems).length) throw badRequest(Object.values(problems)[0], problems);
      const branchId = scope.branch?.id ?? student.branchId;
      const now = new Date();
      const created = await tx.feePayment.create({
        data: { schoolId: scope.school.id, branchId, studentId: student.id, amount: values.amount, receivedAt: now, note: values.note, requestKey: values.requestKey, recordedById: user.id, recordedByName: user.name, recordedByRole: user.role },
      });
      for (const a of values.allocations) {
        const o = map.get(a.obligationId);
        await tx.feeAllocation.create({ data: { paymentId: created.id, obligationId: o.id, amount: a.amount } });
        // Guarded update: never beyond the balance even under a race (the account lock also prevents it).
        const updated = await tx.feeObligation.updateMany({ where: { id: o.id, status: 'OPEN', paidAmount: o.paidAmount }, data: { paidAmount: o.paidAmount + a.amount, status: statusAfterPayment(o, o.paidAmount + a.amount) } });
        if (updated.count !== 1) throw conflict('BALANCE_CHANGED', 'This account changed while the payment was being recorded. Open it again and retry.');
      }
      const [school, branch, branding, enrollment, remaining] = await Promise.all([
        tx.school.findUnique({ where: { id: scope.school.id } }),
        tx.branch.findUnique({ where: { id: branchId } }),
        currentBranding(scope.school.id, tx),
        tx.enrollment.findFirst({ where: { studentId: student.id, status: 'ACTIVE' }, include: { section: { include: { class: true } } }, orderBy: { enrolledAt: 'desc' } }),
        tx.feeObligation.findMany({ where: { studentId: student.id, status: 'OPEN' }, select: { netAmount: true, paidAmount: true } }),
      ]);
      const number = await nextNumber(tx, scope.school.id, 'receipt', settings.receiptNumberFormat, today, branch.number);
      const lines = values.allocations.map((a) => {
        const o = map.get(a.obligationId);
        return { title: o.title, kind: o.kind.toLowerCase(), period: o.billingMonth ? monthLabel(fromDbDate(o.billingMonth)) : o.title, due: o.netAmount, paid: a.amount, balance: o.netAmount - o.paidAmount - a.amount };
      });
      const content = receiptContent({ number, school, branding, branch, student, enrollment, payment: created, lines, currency: settings.currency, receivedBy: { name: user.name, role: user.role }, balanceAfter: remaining.reduce((n, o) => n + o.netAmount - o.paidAmount, 0) });
      await tx.feeReceipt.create({ data: { schoolId: scope.school.id, branchId, paymentId: created.id, number, brandingId: branding?.id ?? null, content } });
      await refreshInvoicesOf(tx, values.allocations.map((a) => a.obligationId));
      await recordAuditEvent({
        client: tx,
        action: AUDIT_ACTIONS.FEE_PAYMENT_RECORDED,
        actor: actorOf(user),
        target: { type: 'student', id: student.id, name: `${fullName(student)} (${student.studentNumber})` },
        schoolId: scope.school.id,
        description: `Cash payment of ${formatMoney(values.amount, settings.currency)} recorded (receipt ${number}) for ${lines.map((l) => l.period).join(', ')}.`,
        req,
      });
      return tx.feePayment.findUnique({ where: { id: created.id }, include: paymentInclude });
    }, TX);
  } catch (error) {
    // The same request sent twice at once (e.g. a mobile retry): the second meets the unique key.
    const first = error?.code === 'P2002' ? await repeatedPayment(scope, values) : null;
    if (first) return first;
    throw error;
  }
  return { payment: toPayment(payment), repeated: false };
}

/**
 * The payment already recorded for this request key, or null. The same key with a different student
 * or amount is refused: it is a different payment, never the repeat of one.
 */
async function repeatedPayment(scope, values) {
  if (!values.requestKey) return null;
  const existing = await getPrisma().feePayment.findUnique({ where: { schoolId_requestKey: { schoolId: scope.school.id, requestKey: values.requestKey } }, include: paymentInclude });
  if (!existing) return null;
  if (existing.studentId !== values.studentId || existing.amount !== values.amount) {
    throw conflict('IDEMPOTENCY_CONFLICT', 'This payment request was already used for a different payment. Start a new payment.');
  }
  return { payment: toPayment(existing), repeated: true };
}

async function findScopedPayment(client, scope, id) {
  if (!isUuid(id)) throw notFound('Payment not found.');
  const p = await client.feePayment.findFirst({ where: { id, schoolId: scope.school.id, ...(scope.branch && { OR: [{ branchId: scope.branch.id }, { student: { branchId: scope.branch.id } }] }) }, include: { ...paymentInclude, student: true } });
  if (!p) throw notFound('Payment not found.');
  return p;
}

export async function getPayment(scope, id) {
  const p = await findScopedPayment(getPrisma(), scope, id);
  return { payment: toPayment(p) };
}

/**
 * Reverses a payment with a reason (the roles the school allows). The payment, its allocations and
 * receipt are kept; the receipt is marked VOID; each fee it paid goes back up by its allocation.
 * The cash comes out of the recorder's drawer while the payment is not in a closing, else the reverser's.
 */
export async function reversePayment(scope, id, { reason }, user, req) {
  const prisma = getPrisma();
  const settings = await feeSettingsOf(scope.school.id);
  if (!permissions(scope, settings).reversePayments) throw forbidden('Your school does not let your role reverse payments.');
  const result = await prisma.$transaction(async (tx) => {
    await lockOperating(tx, scope);
    const found = await findScopedPayment(tx, scope, id);
    if (scope.branch && found.branchId !== scope.branch.id) throw forbidden('Payments are reversed in the branch that received them.');
    await lockStudentAccount(tx, found.studentId);
    const p = await tx.feePayment.findUnique({ where: { id: found.id }, include: { allocations: true, receipt: true } });
    if (p.status === 'REVERSED') throw conflict('ALREADY_REVERSED', 'This payment is already reversed.');
    const now = new Date();
    await tx.feePayment.update({
      where: { id: p.id },
      data: { status: 'REVERSED', reversedAt: now, reversedById: user.id, reversedByName: user.name, reversedByRole: user.role, reversalReason: reason, reversalCashUserId: p.closingId ? user.id : p.recordedById },
    });
    for (const a of p.allocations) {
      const o = await tx.feeObligation.findUnique({ where: { id: a.obligationId } });
      const paid = o.paidAmount - a.amount;
      await tx.feeObligation.update({ where: { id: o.id }, data: { paidAmount: paid, status: o.status === 'CANCELLED' ? 'CANCELLED' : paid >= o.netAmount ? 'PAID' : 'OPEN' } });
      await tx.feeObligationChange.create({ data: { obligationId: o.id, type: 'PAYMENT_REVERSED', fromAmount: o.paidAmount, toAmount: paid, reason, actorId: user.id, actorName: user.name, actorRole: user.role } });
    }
    if (p.receipt) await tx.feeReceipt.update({ where: { id: p.receipt.id }, data: { voidedAt: now, voidReason: reason } });
    await refreshInvoicesOf(tx, p.allocations.map((a) => a.obligationId));
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.FEE_PAYMENT_REVERSED,
      actor: actorOf(user),
      target: { type: 'student', id: found.student.id, name: `${fullName(found.student)} (${found.student.studentNumber})` },
      schoolId: scope.school.id,
      description: `Payment of ${formatMoney(p.amount, settings.currency)} (receipt ${p.receipt?.number ?? '—'}) reversed; the receipt is void. Reason: ${reason}`,
      req,
    });
    return tx.feePayment.findUnique({ where: { id: p.id }, include: paymentInclude });
  }, TX);
  return { payment: toPayment(result) };
}

// ---- list -------------------------------------------------------------------------------------------

export function readPaymentsQuery(query, { role }) {
  const one = (k) => (Array.isArray(query[k]) ? query[k][0] : query[k]) || undefined;
  const errors = {};
  const out = { from: one('from'), to: one('to'), status: one('status') ?? 'all', q: one('q')?.trim().slice(0, 80), branch: role === 'OWNER' ? one('branch') : undefined, classId: one('class'), recordedBy: one('recordedBy'), student: one('student') };
  for (const k of ['from', 'to']) if (out[k] && !/^\d{4}-\d{2}-\d{2}$/.test(out[k])) errors[k] = 'Choose a date.';
  for (const k of ['branch', 'classId', 'recordedBy', 'student']) if (out[k] && !isUuid(out[k])) errors[k] = 'Choose from the list.';
  if (!['all', 'recorded', 'reversed'].includes(out.status)) errors.status = 'Unknown status.';
  out.page = Math.max(1, Number.parseInt(one('page') ?? '1', 10) || 1);
  out.pageSize = Math.min(100, Math.max(5, Number.parseInt(one('pageSize') ?? '20', 10) || 20));
  if (Object.keys(errors).length) throw badRequest('Check the filters.', errors);
  return out;
}

/** The date range as instants in the platform day boundaries (dates are UTC days here, as elsewhere in reports). */
export const dayRange = (from, to) => ({ ...(from && { gte: new Date(`${from}T00:00:00Z`) }), ...(to && { lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000) }) });

export function paymentWhere(scope, f) {
  const words = f.q ? f.q.split(/\s+/).filter(Boolean) : [];
  return {
    schoolId: scope.school.id,
    ...(scope.branch && { branchId: scope.branch.id }),
    ...(f.branch && { branchId: f.branch }),
    ...((f.from || f.to) && { receivedAt: dayRange(f.from, f.to) }),
    ...(f.status !== 'all' && { status: f.status.toUpperCase() }),
    ...(f.recordedBy && { recordedById: f.recordedBy }),
    ...(f.student && { studentId: f.student }),
    ...(f.classId && { allocations: { some: { obligation: { classId: f.classId } } } }),
    ...(words.length && {
      OR: [
        { receipt: { number: { contains: f.q, mode: 'insensitive' } } },
        { student: { AND: words.map((w) => ({ OR: [{ firstName: { contains: w, mode: 'insensitive' } }, { lastName: { contains: w, mode: 'insensitive' } }, { studentNumber: { contains: w, mode: 'insensitive' } }] })) } },
      ],
    }),
  };
}

export async function listPayments(scope, f) {
  const prisma = getPrisma();
  const where = paymentWhere(scope, f);
  const [total, items, sums, settings, recorders] = await Promise.all([
    prisma.feePayment.count({ where }),
    prisma.feePayment.findMany({ where, include: { ...paymentInclude, student: { select: { id: true, firstName: true, middleName: true, lastName: true, studentNumber: true } } }, orderBy: { receivedAt: 'desc' }, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    prisma.feePayment.groupBy({ by: ['status'], where, _sum: { amount: true }, _count: { _all: true } }),
    feeSettingsOf(scope.school.id),
    prisma.feePayment.findMany({ where: { schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) }, distinct: ['recordedById'], select: { recordedById: true, recordedByName: true, recordedByRole: true } }),
  ]);
  const sumOf = (s) => sums.find((x) => x.status === s);
  return {
    currency: settings.currency,
    total,
    page: f.page,
    pageSize: f.pageSize,
    summary: { recorded: sumOf('RECORDED')?._sum.amount ?? 0, recordedCount: sumOf('RECORDED')?._count._all ?? 0, reversed: sumOf('REVERSED')?._sum.amount ?? 0, reversedCount: sumOf('REVERSED')?._count._all ?? 0 },
    recorders: recorders.map((r) => ({ id: r.recordedById, name: r.recordedByName, role: r.recordedByRole })),
    items: items.map(toPayment),
  };
}

/** Students to pay for: search by name or Student ID in the scope (current enrollment and balance). */
export async function searchPayers(scope, { q }) {
  const prisma = getPrisma();
  const words = (q ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 5);
  if (!words.length) return { items: [] };
  const students = await prisma.student.findMany({
    where: { ...studentScope(scope), AND: words.map((w) => ({ OR: [{ firstName: { contains: w, mode: 'insensitive' } }, { middleName: { contains: w, mode: 'insensitive' } }, { lastName: { contains: w, mode: 'insensitive' } }, { studentNumber: { contains: w, mode: 'insensitive' } }] })) },
    include: { enrollments: { where: { status: 'ACTIVE' }, include: { section: { include: { class: true } } }, take: 1 }, branch: { select: { id: true, name: true } } },
    take: 12,
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
  });
  const balances = students.length
    ? await prisma.feeObligation.groupBy({ by: ['studentId'], where: { studentId: { in: students.map((s) => s.id) }, status: 'OPEN' }, _sum: { netAmount: true, paidAmount: true } })
    : [];
  return {
    items: students.map((s) => {
      const b = balances.find((x) => x.studentId === s.id);
      const e = s.enrollments[0];
      return { id: s.id, name: fullName(s), studentNumber: s.studentNumber, status: s.status.toLowerCase(), branch: s.branch, class: e ? `${e.section.class.name}${e.section.name}` : null, balance: (b?._sum.netAmount ?? 0) - (b?._sum.paidAmount ?? 0) };
    }),
  };
}

/** The open fees of a student to choose from when recording a payment (oldest due first). */
export async function payableObligations(scope, studentId) {
  const prisma = getPrisma();
  const student = await findScopedStudent(prisma, scope, studentId);
  const [settings, today] = await Promise.all([feeSettingsOf(scope.school.id), calendarToday()]);
  const open = await prisma.feeObligation.findMany({ where: { studentId: student.id, status: 'OPEN' }, include: { examination: { select: { id: true, name: true } } }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] });
  const items = open
    .filter((o) => o.netAmount > o.paidAmount)
    .map((o) => ({
      id: o.id,
      kind: o.kind.toLowerCase(),
      title: o.title,
      period: o.billingMonth ? monthLabel(fromDbDate(o.billingMonth)) : (o.examination?.name ?? o.title),
      month: fromDbDate(o.billingMonth),
      dueDate: fromDbDate(o.dueDate),
      netAmount: o.netAmount,
      paidAmount: o.paidAmount,
      balance: o.netAmount - o.paidAmount,
      overdue: fromDbDate(o.dueDate) < today,
    }));
  return {
    currency: settings.currency,
    policy: { allowPartial: settings.allowPartialPayments, minimumPartial: settings.minimumPartialPayment },
    student: { id: student.id, name: fullName(student), studentNumber: student.studentNumber },
    items,
    totals: { outstanding: items.reduce((n, o) => n + o.balance, 0), overdue: items.filter((o) => o.overdue).reduce((n, o) => n + o.balance, 0), partlyPaid: items.filter((o) => o.paidAmount > 0).length },
  };
}

// ---- receipts ---------------------------------------------------------------------------------------

export async function findScopedReceipt(scope, id) {
  if (!isUuid(id)) throw notFound('Receipt not found.');
  const r = await getPrisma().feeReceipt.findFirst({
    where: { id, schoolId: scope.school.id, ...(scope.branch && { OR: [{ branchId: scope.branch.id }, { payment: { student: { branchId: scope.branch.id } } }] }) },
    include: { branding: true, payment: { select: { status: true, reversalReason: true, reversedAt: true } } },
  });
  if (!r) throw notFound('Receipt not found.');
  return r;
}

/** A receipt printed or downloaded again: counted, and a reprint (after the first print) is in the audit log. */
export async function markReceiptPrinted(scope, id, user, req) {
  const r = await findScopedReceipt(scope, id);
  await getPrisma().feeReceipt.update({ where: { id: r.id }, data: { printCount: { increment: 1 }, lastPrintedAt: new Date() } });
  if (r.printCount >= 1) {
    await recordAuditEvent({ action: AUDIT_ACTIONS.FEE_RECEIPT_REPRINTED, actor: actorOf(user), target: { type: 'receipt', id: r.id, name: r.number }, schoolId: scope.school.id, description: `Receipt ${r.number} printed again (copy ${r.printCount + 1}).`, req });
  }
  return { printCount: r.printCount + 1 };
}

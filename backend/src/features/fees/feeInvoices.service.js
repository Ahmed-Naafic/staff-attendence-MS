import { randomUUID } from 'node:crypto';
import { badRequest, conflict, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { actorOf, lockOperating, studentScope, TX, yearOf } from './feeAccess.js';
import { fullName } from './feeAccounts.service.js';
import { nextNumber } from './feePayments.service.js';
import { currentBranding, feeSettingsOf, toBranding } from './feeSettings.js';
import { formatMoney, fromDbDate, invoiceStatus, monthLabel, monthOf } from './feeRules.js';

/*
 * Invoices (docs/business-rules.md → Fee Management → Invoices): made when needed, for one student or
 * in bulk (a class, a section, or chosen students), each student their own invoice and number. An
 * invoice lists the fees of a period (and, optionally, earlier unpaid ones) with discounts, previous
 * payments and the remaining balance. It has NO payment deadline and is never overdue; its status
 * (Issued, Partially Paid, Paid) follows the payments of its fees. Draft → Issued (numbered) →
 * Cancelled (with a reason). Making an invoice records no payment.
 */

const lineOf = (o, i) => ({
  obligationId: o.id,
  description: o.kind === 'MONTHLY' ? 'Monthly fee' : o.kind === 'EXAM' ? 'Examination fee' : o.title,
  period: o.billingMonth ? monthLabel(fromDbDate(o.billingMonth)) : o.kind === 'EXAM' ? (o.examination?.name ?? o.title.replace(/^Examination fee · /, '')) : fromDbDate(o.dueDate),
  standardAmount: o.amount,
  discountAmount: o.discountAmount,
  amount: o.netAmount,
  sortOrder: i,
});

export function readInvoiceRequest(body, { bulk }) {
  const errors = {};
  const out = {};
  if (bulk) {
    for (const k of ['class', 'section']) if (body[k] !== undefined && body[k] !== null && !isUuid(body[k])) errors[k] = 'Choose from the list.';
    if (body.students !== undefined && (!Array.isArray(body.students) || body.students.length > 1000 || body.students.some((s) => !isUuid(s)))) errors.students = 'Choose students.';
    out.classId = body.class ?? null;
    out.sectionId = body.section ?? null;
    out.studentIds = body.students ?? null;
    if (!out.classId && !out.sectionId && !out.studentIds?.length) errors.students = 'Choose a class, a section or students.';
    if (body.onlyWithBalance !== undefined && typeof body.onlyWithBalance !== 'boolean') errors.onlyWithBalance = 'Yes or no.';
    out.onlyWithBalance = body.onlyWithBalance !== false;
  } else {
    if (!isUuid(body.student)) errors.student = 'Choose the student.';
    out.studentId = body.student;
  }
  const month = (v, k) => {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) {
      errors[k] = 'Choose a month.';
      return null;
    }
    return `${v}-01`;
  };
  out.from = month(body.from, 'from');
  out.to = month(body.to, 'to');
  if (out.from && out.to && out.to < out.from) errors.to = 'The last month comes after the first.';
  for (const k of ['includeEarlier', 'includeExam', 'includeOther', 'issue']) {
    if (body[k] !== undefined && typeof body[k] !== 'boolean') errors[k] = 'Yes or no.';
  }
  out.includeEarlier = body.includeEarlier !== false;
  out.includeExam = body.includeExam !== false;
  out.includeOther = body.includeOther !== false;
  out.issue = body.issue !== false;
  if (body.note !== undefined && body.note !== null && (typeof body.note !== 'string' || body.note.length > 300)) errors.note = 'At most 300 characters.';
  out.note = typeof body.note === 'string' ? body.note.trim() || null : null;
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return out;
}

/** The fees an invoice of the period lists: charged in the period (by month or due date), plus earlier ones still owed. */
async function invoiceObligations(tx, studentId, yearId, { from, to, includeEarlier, includeExam, includeOther }) {
  const all = await tx.feeObligation.findMany({ where: { studentId, status: { not: 'CANCELLED' } }, include: { examination: { select: { name: true } } }, orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }] });
  return all.filter((o) => {
    if (o.kind === 'EXAM' && !includeExam) return false;
    if (o.kind === 'OTHER' && !includeOther) return false;
    const month = o.billingMonth ? fromDbDate(o.billingMonth) : monthOf(fromDbDate(o.dueDate));
    const inYear = !yearId || o.academicYearId === yearId;
    const inPeriod = inYear && (!from || month >= from) && (!to || month <= to);
    const earlierOwed = includeEarlier && from && month < from && o.netAmount > o.paidAmount;
    return inPeriod || earlierOwed;
  });
}

async function createOne(tx, scope, student, enrollment, values, { user, settings, branding, school, today, batchId }) {
  const year = enrollment?.academicYear ?? null;
  const obligations = await invoiceObligations(tx, student.id, year?.id ?? null, values);
  if (!obligations.length) return null;
  const branch = await tx.branch.findUnique({ where: { id: student.branchId } });
  const number = values.issue ? await nextNumber(tx, scope.school.id, 'invoice', settings.invoiceNumberFormat, today, branch.number) : null;
  const content = {
    school: { ...toBranding(branding, school), logo: undefined },
    branch: { name: branch.name },
    student: { name: fullName(student), studentNumber: student.studentNumber, class: enrollment ? `${enrollment.section.class.name}${enrollment.section.name}` : null, guardianName: student.guardianName, guardianPhone: student.guardianPhone },
    academicYear: year?.name ?? null,
    currency: settings.currency,
    note: values.note ?? settings.invoiceNote,
    periodLabel: values.from || values.to ? `${values.from ? monthLabel(values.from) : 'Start'} – ${values.to ? monthLabel(values.to) : 'today'}` : 'All fees',
  };
  const invoice = await tx.feeInvoice.create({
    data: {
      schoolId: scope.school.id,
      branchId: student.branchId,
      studentId: student.id,
      academicYearId: year?.id ?? null,
      number,
      status: values.issue ? 'ISSUED' : 'DRAFT',
      periodFrom: values.from ? new Date(`${values.from}T00:00:00Z`) : null,
      periodTo: values.to ? new Date(`${values.to}T00:00:00Z`) : null,
      note: values.note,
      brandingId: branding?.id ?? null,
      content,
      batchId,
      issuedAt: values.issue ? new Date() : null,
      createdById: user.id,
      createdByName: user.name,
      lines: { create: obligations.map(lineOf) },
    },
    include: { lines: { include: { obligation: true } } },
  });
  if (values.issue) {
    const status = invoiceStatus('ISSUED', invoice.lines);
    if (status !== 'ISSUED') await tx.feeInvoice.update({ where: { id: invoice.id }, data: { status } });
  }
  return invoice;
}

async function contextOf(tx, scope) {
  const [settings, branding, school, today] = await Promise.all([feeSettingsOf(scope.school.id, tx), currentBranding(scope.school.id, tx), tx.school.findUnique({ where: { id: scope.school.id } }), calendarToday()]);
  return { settings, branding, school, today };
}

const enrollmentInclude = { section: { include: { class: true } }, academicYear: true };

export async function createInvoice(scope, values, user, req) {
  const prisma = getPrisma();
  const invoice = await prisma.$transaction(async (tx) => {
    await lockOperating(tx, scope);
    const student = await tx.student.findFirst({ where: { id: values.studentId, ...studentScope(scope) } });
    if (!student) throw notFound('Student not found.');
    const ctx = await contextOf(tx, scope);
    const year = await yearOf(tx, scope, 'current');
    const enrollment = year ? await tx.enrollment.findUnique({ where: { studentId_academicYearId: { studentId: student.id, academicYearId: year.id } }, include: enrollmentInclude }) : null;
    const created = await createOne(tx, scope, student, enrollment, values, { ...ctx, user });
    if (!created) throw conflict('NOTHING_TO_INVOICE', `${fullName(student)} has no fees in this period.`);
    await recordAuditEvent({ client: tx, action: values.issue ? AUDIT_ACTIONS.FEE_INVOICE_ISSUED : AUDIT_ACTIONS.FEE_INVOICE_CREATED, actor: actorOf(user), target: { type: 'student', id: student.id, name: `${fullName(student)} (${student.studentNumber})` }, schoolId: scope.school.id, description: values.issue ? `Invoice ${created.number} issued.` : 'Draft invoice created.', req });
    return created;
  }, TX);
  return getInvoice(scope, invoice.id);
}

/** One invoice per student of a class, a section or a list (in the scope). Students with nothing to invoice are skipped. */
export async function createBulkInvoices(scope, values, user, req) {
  const prisma = getPrisma();
  const batchId = randomUUID();
  const year = await yearOf(prisma, scope, 'current');
  if (!year) throw conflict('NO_CURRENT_YEAR', 'There is no current academic year.');
  const enrollments = await prisma.enrollment.findMany({
    where: { academicYearId: year.id, status: 'ACTIVE', student: studentScope(scope), ...(values.sectionId && { sectionId: values.sectionId }), ...(values.classId && { section: { classId: values.classId } }), ...(values.studentIds?.length && { studentId: { in: values.studentIds } }) },
    include: { ...enrollmentInclude, student: true },
    orderBy: [{ section: { name: 'asc' } }, { student: { firstName: 'asc' } }],
  });
  if (!enrollments.length) throw conflict('NO_STUDENTS', 'No enrolled students match.');
  let created = 0;
  let skipped = 0;
  // In chunks, so a large class does not hold one long transaction.
  for (let i = 0; i < enrollments.length; i += 40) {
    const chunk = enrollments.slice(i, i + 40);
    await prisma.$transaction(async (tx) => {
      await lockOperating(tx, scope);
      const ctx = await contextOf(tx, scope);
      for (const e of chunk) {
        if (values.onlyWithBalance) {
          const owed = await tx.feeObligation.findFirst({ where: { studentId: e.studentId, status: 'OPEN' }, select: { id: true } });
          if (!owed) {
            skipped += 1;
            continue;
          }
        }
        const inv = await createOne(tx, scope, e.student, e, values, { ...ctx, user, batchId });
        if (inv) created += 1;
        else skipped += 1;
      }
    }, { timeout: 60000, maxWait: 15000 });
  }
  await recordAuditEvent({ action: values.issue ? AUDIT_ACTIONS.FEE_INVOICE_ISSUED : AUDIT_ACTIONS.FEE_INVOICE_CREATED, actor: actorOf(user), target: { type: 'school', id: scope.school.id, name: 'Bulk invoices' }, schoolId: scope.school.id, description: `${created} invoice${created === 1 ? '' : 's'} ${values.issue ? 'issued' : 'created as drafts'} in bulk (${skipped} student${skipped === 1 ? '' : 's'} with nothing to invoice skipped).`, req });
  return { batchId, created, skipped };
}

async function findScopedInvoice(client, scope, id) {
  if (!isUuid(id)) throw notFound('Invoice not found.');
  const inv = await client.feeInvoice.findFirst({ where: { id, schoolId: scope.school.id, ...(scope.branch && { OR: [{ branchId: scope.branch.id }, { student: { branchId: scope.branch.id } }] }) }, include: { lines: { include: { obligation: { include: { allocations: { include: { payment: { select: { status: true, receivedAt: true, receipt: { select: { number: true } } } } } } } } }, orderBy: { sortOrder: 'asc' } }, branding: true, student: true } });
  if (!inv) throw notFound('Invoice not found.');
  return inv;
}

/** An invoice for display, PDF and sharing: lines, discounts, previous payments, remaining balance (live). */
export function invoiceView(inv) {
  const lines = inv.lines.map((l) => {
    const cancelled = l.obligation.status === 'CANCELLED';
    return { id: l.id, obligationId: l.obligationId, description: l.description, period: l.period, standardAmount: l.standardAmount, discountAmount: l.discountAmount, amount: l.amount, cancelled, paid: cancelled ? 0 : l.obligation.paidAmount, currentAmount: cancelled ? 0 : l.obligation.netAmount };
  });
  const subtotal = lines.reduce((n, l) => n + l.standardAmount, 0);
  const discounts = lines.reduce((n, l) => n + l.discountAmount, 0);
  const total = lines.reduce((n, l) => n + l.currentAmount, 0);
  const paid = lines.reduce((n, l) => n + l.paid, 0);
  const payments = [];
  for (const l of inv.lines) for (const a of l.obligation.allocations) if (a.payment.status === 'RECORDED') payments.push({ date: a.payment.receivedAt.toISOString(), receipt: a.payment.receipt?.number ?? null, amount: a.amount, for: l.period });
  payments.sort((a, b) => a.date.localeCompare(b.date));
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status.toLowerCase(),
    issuedAt: inv.issuedAt?.toISOString() ?? null,
    createdAt: inv.createdAt.toISOString(),
    createdBy: inv.createdByName,
    cancelledAt: inv.cancelledAt?.toISOString() ?? null,
    cancelReason: inv.cancelReason,
    batchId: inv.batchId,
    periodFrom: fromDbDate(inv.periodFrom),
    periodTo: fromDbDate(inv.periodTo),
    content: inv.content,
    branding: inv.branding ? toBranding(inv.branding, {}) : null,
    student: { id: inv.studentId, name: inv.content?.student?.name ?? fullName(inv.student), studentNumber: inv.student.studentNumber },
    lines,
    totals: { subtotal, discounts, total, paid, balance: total - paid },
    payments,
  };
}

export async function getInvoice(scope, id) {
  const inv = await findScopedInvoice(getPrisma(), scope, id);
  const settings = await feeSettingsOf(scope.school.id);
  return { currency: settings.currency, invoice: invoiceView(inv), share: shareText(invoiceView(inv), settings.currency) };
}

/** A short message for sharing an invoice (WhatsApp or SMS from the staff member's phone). */
export function shareText(view, currency) {
  const name = view.content?.school?.schoolName ?? 'School';
  return [
    `${name}: invoice ${view.number ?? '(draft)'} for ${view.student.name} (${view.student.studentNumber}).`,
    `Total ${formatMoney(view.totals.total, currency)}, paid ${formatMoney(view.totals.paid, currency)}, balance ${formatMoney(view.totals.balance, currency)}.`,
    view.content?.note ?? '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function readInvoicesQuery(query, { role }) {
  const one = (k) => (Array.isArray(query[k]) ? query[k][0] : query[k]) || undefined;
  const errors = {};
  const out = { status: one('status') ?? 'all', classId: one('class'), sectionId: one('section'), branch: role === 'OWNER' ? one('branch') : undefined, q: one('q')?.trim().slice(0, 80), batch: one('batch'), from: one('from'), to: one('to') };
  if (!['all', 'draft', 'issued', 'partially_paid', 'paid', 'cancelled', 'unpaid'].includes(out.status)) errors.status = 'Unknown status.';
  for (const k of ['classId', 'sectionId', 'branch', 'batch']) if (out[k] && !isUuid(out[k])) errors[k] = 'Choose from the list.';
  out.page = Math.max(1, Number.parseInt(one('page') ?? '1', 10) || 1);
  out.pageSize = Math.min(100, Math.max(5, Number.parseInt(one('pageSize') ?? '20', 10) || 20));
  if (Object.keys(errors).length) throw badRequest('Check the filters.', errors);
  return out;
}

export async function listInvoices(scope, f) {
  const prisma = getPrisma();
  const words = f.q ? f.q.split(/\s+/).filter(Boolean) : [];
  const base = {
    schoolId: scope.school.id,
    ...(scope.branch && { branchId: scope.branch.id }),
    ...(f.branch && { branchId: f.branch }),
    ...(f.batch && { batchId: f.batch }),
    ...(f.sectionId && { student: { enrollments: { some: { sectionId: f.sectionId, status: 'ACTIVE' } } } }),
    ...(f.classId && !f.sectionId && { student: { enrollments: { some: { section: { classId: f.classId }, status: 'ACTIVE' } } } }),
    ...((f.from || f.to) && { createdAt: { ...(f.from && { gte: new Date(`${f.from}T00:00:00Z`) }), ...(f.to && { lt: new Date(new Date(`${f.to}T00:00:00Z`).getTime() + 86_400_000) }) } }),
    ...(words.length && { OR: [{ number: { contains: f.q, mode: 'insensitive' } }, { student: { AND: words.map((w) => ({ OR: [{ firstName: { contains: w, mode: 'insensitive' } }, { lastName: { contains: w, mode: 'insensitive' } }, { studentNumber: { contains: w, mode: 'insensitive' } }] })) } }] }),
  };
  const where = { ...base, ...(f.status === 'unpaid' ? { status: 'ISSUED' } : f.status !== 'all' && { status: f.status.toUpperCase() }) };
  const [counts, total, items, settings] = await Promise.all([
    prisma.feeInvoice.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
    prisma.feeInvoice.count({ where }),
    prisma.feeInvoice.findMany({ where, include: { lines: { include: { obligation: { include: { allocations: { include: { payment: { select: { status: true, receivedAt: true, receipt: { select: { number: true } } } } } } } } }, orderBy: { sortOrder: 'asc' } }, branding: true, student: { include: { enrollments: { where: { status: 'ACTIVE' }, include: { section: { include: { class: true } } }, take: 1 } } } }, orderBy: [{ createdAt: 'desc' }], skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
    feeSettingsOf(scope.school.id),
  ]);
  const count = (s) => counts.find((c) => c.status === s)?._count._all ?? 0;
  return {
    currency: settings.currency,
    counts: { all: counts.reduce((n, c) => n + c._count._all, 0), draft: count('DRAFT'), issued: count('ISSUED'), partially_paid: count('PARTIALLY_PAID'), paid: count('PAID'), cancelled: count('CANCELLED') },
    total,
    page: f.page,
    pageSize: f.pageSize,
    items: items.map((inv) => {
      const v = invoiceView(inv);
      const e = inv.student.enrollments[0];
      return { id: v.id, number: v.number, status: v.status, issuedAt: v.issuedAt, createdAt: v.createdAt, student: { ...v.student, class: e ? `${e.section.class.name}${e.section.name}` : v.content?.student?.class }, totals: v.totals, periodLabel: v.content?.periodLabel, batchId: v.batchId };
    }),
  };
}

export async function issueInvoice(scope, id, user, req) {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await lockOperating(tx, scope);
    const inv = await findScopedInvoice(tx, scope, id);
    if (inv.status !== 'DRAFT') throw conflict('NOT_A_DRAFT', 'Only a draft invoice is issued.');
    const ctx = await contextOf(tx, scope);
    const branch = await tx.branch.findUnique({ where: { id: inv.branchId } });
    const number = await nextNumber(tx, scope.school.id, 'invoice', ctx.settings.invoiceNumberFormat, ctx.today, branch.number);
    await tx.feeInvoice.update({ where: { id: inv.id }, data: { number, status: invoiceStatus('ISSUED', inv.lines), issuedAt: new Date(), brandingId: ctx.branding?.id ?? inv.brandingId, content: { ...inv.content, school: { ...toBranding(ctx.branding, ctx.school), logo: undefined } } } });
    await recordAuditEvent({ client: tx, action: AUDIT_ACTIONS.FEE_INVOICE_ISSUED, actor: actorOf(user), target: { type: 'student', id: inv.studentId, name: inv.content?.student?.name ?? fullName(inv.student) }, schoolId: scope.school.id, description: `Invoice ${number} issued.`, req });
  }, TX);
  return getInvoice(scope, id);
}

export async function cancelInvoice(scope, id, { reason }, user, req) {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await lockOperating(tx, scope);
    const inv = await findScopedInvoice(tx, scope, id);
    if (inv.status === 'CANCELLED') throw conflict('ALREADY_CANCELLED', 'This invoice is already cancelled.');
    await tx.feeInvoice.update({ where: { id: inv.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, cancelledByName: user.name } });
    await recordAuditEvent({ client: tx, action: AUDIT_ACTIONS.FEE_INVOICE_CANCELLED, actor: actorOf(user), target: { type: 'student', id: inv.studentId, name: inv.content?.student?.name ?? fullName(inv.student) }, schoolId: scope.school.id, description: `Invoice ${inv.number ?? '(draft)'} cancelled; the fees it listed are unchanged. Reason: ${reason}`, req });
  }, TX);
  return getInvoice(scope, id);
}

/** Full invoice rows for a PDF of several invoices (a bulk batch, or chosen ids), in the scope. */
export async function invoicesForPdf(scope, { batch, ids }) {
  const prisma = getPrisma();
  const where = { schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }), ...(batch ? { batchId: batch } : { id: { in: ids } }) };
  const list = await prisma.feeInvoice.findMany({ where, include: { lines: { include: { obligation: { include: { allocations: { include: { payment: { select: { status: true, receivedAt: true, receipt: { select: { number: true } } } } } } } } }, orderBy: { sortOrder: 'asc' } }, branding: true, student: true }, orderBy: { createdAt: 'asc' }, take: 500 });
  if (!list.length) throw notFound('No invoices found.');
  return list;
}

export { findScopedInvoice };

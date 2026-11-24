import { badRequest, conflict, forbidden, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { actorOf, lockOperating, TX } from './feeAccess.js';
import { fullName } from './feeAccounts.service.js';
import { feeSettingsOf } from './feeSettings.js';
import { asDbDate, formatMoney, fromDbDate } from './feeRules.js';

/*
 * Cash closing (docs/business-rules.md → Fee Management → Cash closing). Every staff member who takes
 * cash (Accountants, Managers, the School Owner) closes their own cash independently; nobody approves
 * another's. A closing takes the payments they recorded since their last closing and the reversals
 * whose cash comes out of their drawer, compares the expected cash with what they counted, and keeps
 * the difference: a shortage or surplus needs an explanation. Closings are never deleted; a correction
 * keeps the first values as a revision.
 */

const roleLabel = { OWNER: 'School Owner', MANAGER: 'Manager', ACCOUNTANT: 'Accountant' };

export const toClosing = (c) => ({
  id: c.id,
  user: { id: c.userId, name: c.userName, role: c.userRole, roleLabel: roleLabel[c.userRole] ?? c.userRole },
  branch: c.branch ? { id: c.branch.id, name: c.branch.name } : null,
  closingDate: fromDbDate(c.closingDate),
  closedAt: c.closedAt.toISOString(),
  paymentsCount: c.paymentsCount,
  reversalsCount: c.reversalsCount,
  recordedAmount: c.recordedAmount,
  reversedAmount: c.reversedAmount,
  expectedAmount: c.expectedAmount,
  countedAmount: c.countedAmount,
  difference: c.difference,
  result: c.difference === 0 ? 'balanced' : c.difference < 0 ? 'shortage' : 'surplus',
  explanation: c.explanation,
  correctedAt: c.correctedAt?.toISOString() ?? null,
  revisions: (c.revisions ?? []).map((r) => ({ id: r.id, countedAmount: r.countedAmount, difference: r.difference, explanation: r.explanation, reason: r.reason, by: r.actorName, at: r.createdAt.toISOString() })),
});

/** What the user's next closing would contain: their unclosed payments and reversals. */
async function openPeriod(client, scope, userId) {
  const [payments, reversals, last] = await Promise.all([
    client.feePayment.findMany({ where: { schoolId: scope.school.id, recordedById: userId, closingId: null }, select: { id: true, amount: true, receivedAt: true, status: true, student: { select: { firstName: true, middleName: true, lastName: true, studentNumber: true } }, receipt: { select: { number: true } } }, orderBy: { receivedAt: 'asc' } }),
    client.feePayment.findMany({ where: { schoolId: scope.school.id, reversalCashUserId: userId, reversalClosingId: null }, select: { id: true, amount: true, reversedAt: true, reversalReason: true, receipt: { select: { number: true } } }, orderBy: { reversedAt: 'asc' } }),
    client.cashClosing.findFirst({ where: { schoolId: scope.school.id, userId }, orderBy: { closedAt: 'desc' } }),
  ]);
  const recorded = payments.reduce((n, p) => n + p.amount, 0);
  const reversed = reversals.reduce((n, p) => n + p.amount, 0);
  return { payments, reversals, recorded, reversed, expected: recorded - reversed, since: last?.closedAt ?? null };
}

/** "My closing": the open period of the signed-in user, their last closing, and today's closings in the scope. */
export async function myClosing(scope, user) {
  const prisma = getPrisma();
  const [settings, today, period] = await Promise.all([feeSettingsOf(scope.school.id), calendarToday(), openPeriod(prisma, scope, user.id)]);
  const recent = await prisma.cashClosing.findMany({ where: { schoolId: scope.school.id, userId: user.id }, include: { branch: { select: { id: true, name: true } }, revisions: { orderBy: { createdAt: 'asc' } } }, orderBy: { closedAt: 'desc' }, take: 5 });
  return {
    currency: settings.currency,
    today,
    open: {
      since: period.since?.toISOString() ?? null,
      paymentsCount: period.payments.length,
      reversalsCount: period.reversals.length,
      recordedAmount: period.recorded,
      reversedAmount: period.reversed,
      expectedAmount: period.expected,
      payments: period.payments.map((p) => ({ id: p.id, amount: p.amount, receivedAt: p.receivedAt.toISOString(), status: p.status.toLowerCase(), student: `${fullName(p.student)} (${p.student.studentNumber})`, receipt: p.receipt?.number ?? null })),
      reversals: period.reversals.map((p) => ({ id: p.id, amount: p.amount, reversedAt: p.reversedAt.toISOString(), reason: p.reversalReason, receipt: p.receipt?.number ?? null })),
    },
    closedToday: recent.some((c) => fromDbDate(c.closingDate) === today),
    recent: recent.map(toClosing),
  };
}

export function readClosing(body) {
  const errors = {};
  if (!Number.isInteger(body.counted) || body.counted < 0 || body.counted > 1_000_000_000) errors.counted = 'Enter the cash you counted.';
  const explanation = typeof body.explanation === 'string' ? body.explanation.trim() : '';
  if (explanation.length > 500) errors.explanation = 'At most 500 characters.';
  if (body.expected !== undefined && !Number.isInteger(body.expected)) errors.expected = 'Invalid.';
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return { counted: body.counted, explanation: explanation || null, expected: body.expected };
}

/**
 * Closes the user's cash. `expected` (what the screen showed) must still be right: a payment recorded
 * meanwhile asks for a recount (409 EXPECTED_CHANGED). A difference needs an explanation.
 */
export async function closeCash(scope, values, user, req) {
  const prisma = getPrisma();
  const settings = await feeSettingsOf(scope.school.id);
  const today = await calendarToday();
  const closing = await prisma.$transaction(async (tx) => {
    await lockOperating(tx, scope);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cash-closing:${user.id}`}))`;
    const period = await openPeriod(tx, scope, user.id);
    if (values.expected !== undefined && values.expected !== period.expected) throw conflict('EXPECTED_CHANGED', `The expected cash is now ${formatMoney(period.expected, settings.currency)} (payments changed). Count again and close.`);
    const difference = values.counted - period.expected;
    if (difference !== 0 && !values.explanation) throw badRequest(`Explain the ${difference < 0 ? 'shortage' : 'surplus'} of ${formatMoney(Math.abs(difference), settings.currency)}.`, { explanation: 'Explain the difference.' });
    const c = await tx.cashClosing.create({
      data: {
        schoolId: scope.school.id,
        branchId: scope.branch?.id ?? null,
        userId: user.id,
        userName: user.name,
        userRole: user.role,
        closingDate: asDbDate(today),
        paymentsCount: period.payments.length,
        reversalsCount: period.reversals.length,
        recordedAmount: period.recorded,
        reversedAmount: period.reversed,
        expectedAmount: period.expected,
        countedAmount: values.counted,
        difference,
        explanation: values.explanation,
      },
    });
    if (period.payments.length) await tx.feePayment.updateMany({ where: { id: { in: period.payments.map((p) => p.id) }, closingId: null }, data: { closingId: c.id } });
    if (period.reversals.length) await tx.feePayment.updateMany({ where: { id: { in: period.reversals.map((p) => p.id) }, reversalClosingId: null }, data: { reversalClosingId: c.id } });
    await tx.cashClosingRevision.create({ data: { closingId: c.id, countedAmount: values.counted, difference, explanation: values.explanation, reason: null, actorName: user.name, actorRole: user.role } });
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.CASH_CLOSING_RECORDED,
      actor: actorOf(user),
      target: { type: 'cashClosing', id: c.id, name: `${user.name} · ${today}` },
      schoolId: scope.school.id,
      description: `Cash closed: ${period.payments.length} payment${period.payments.length === 1 ? '' : 's'} (${formatMoney(period.recorded, settings.currency)}), reversals ${formatMoney(period.reversed, settings.currency)}, expected ${formatMoney(period.expected, settings.currency)}, counted ${formatMoney(values.counted, settings.currency)}${difference ? `, ${difference < 0 ? 'shortage' : 'surplus'} ${formatMoney(Math.abs(difference), settings.currency)}: ${values.explanation}` : ', balanced'}.`,
      req,
    });
    return tx.cashClosing.findUnique({ where: { id: c.id }, include: { branch: { select: { id: true, name: true } }, revisions: { orderBy: { createdAt: 'asc' } } } });
  }, TX);
  return { closing: toClosing(closing) };
}

export function readCorrection(body) {
  const errors = {};
  if (!Number.isInteger(body.counted) || body.counted < 0) errors.counted = 'Enter the corrected count.';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) errors.reason = 'Give the reason for the correction.';
  const explanation = typeof body.explanation === 'string' ? body.explanation.trim() : '';
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return { counted: body.counted, reason, explanation: explanation || null };
}

/** Corrects a closing's count (its own user, or the School Owner); the earlier values stay as revisions. */
export async function correctClosing(scope, id, values, user, req) {
  if (!isUuid(id)) throw notFound('Closing not found.');
  const prisma = getPrisma();
  const settings = await feeSettingsOf(scope.school.id);
  const closing = await prisma.$transaction(async (tx) => {
    await lockOperating(tx, scope);
    const c = await tx.cashClosing.findFirst({ where: { id, schoolId: scope.school.id } });
    if (!c) throw notFound('Closing not found.');
    if (c.userId !== user.id && scope.role !== 'OWNER') throw forbidden('Only the person who closed, or the School Owner, corrects a closing.');
    const difference = values.counted - c.expectedAmount;
    const explanation = values.explanation ?? (difference === 0 ? null : c.explanation);
    if (difference !== 0 && !explanation) throw badRequest(`Explain the ${difference < 0 ? 'shortage' : 'surplus'}.`, { explanation: 'Explain the difference.' });
    await tx.cashClosing.update({ where: { id: c.id }, data: { countedAmount: values.counted, difference, explanation, correctedAt: new Date() } });
    await tx.cashClosingRevision.create({ data: { closingId: c.id, countedAmount: values.counted, difference, explanation, reason: values.reason, actorName: user.name, actorRole: user.role } });
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.CASH_CLOSING_CORRECTED,
      actor: actorOf(user),
      target: { type: 'cashClosing', id: c.id, name: `${c.userName} · ${fromDbDate(c.closingDate)}` },
      schoolId: scope.school.id,
      description: `Cash closing corrected: counted ${formatMoney(c.countedAmount, settings.currency)} → ${formatMoney(values.counted, settings.currency)} (difference ${formatMoney(difference, settings.currency)}). Reason: ${values.reason}`,
      change: { fields: [{ field: 'Cash counted', from: formatMoney(c.countedAmount, settings.currency), to: formatMoney(values.counted, settings.currency) }] },
      req,
    });
    return tx.cashClosing.findUnique({ where: { id: c.id }, include: { branch: { select: { id: true, name: true } }, revisions: { orderBy: { createdAt: 'asc' } } } });
  }, TX);
  return { closing: toClosing(closing) };
}

export function readClosingsQuery(query, { role }) {
  const one = (k) => (Array.isArray(query[k]) ? query[k][0] : query[k]) || undefined;
  const errors = {};
  const out = { role: one('role') ?? 'all', from: one('from'), to: one('to'), branch: role === 'OWNER' ? one('branch') : undefined, user: one('user'), result: one('result') ?? 'all' };
  if (!['all', 'ACCOUNTANT', 'MANAGER', 'OWNER'].includes(out.role)) errors.role = 'Unknown role.';
  if (!['all', 'balanced', 'shortage', 'surplus'].includes(out.result)) errors.result = 'Unknown result.';
  for (const k of ['from', 'to']) if (out[k] && !/^\d{4}-\d{2}-\d{2}$/.test(out[k])) errors[k] = 'Choose a date.';
  for (const k of ['branch', 'user']) if (out[k] && !isUuid(out[k])) errors[k] = 'Choose from the list.';
  if (Object.keys(errors).length) throw badRequest('Check the filters.', errors);
  return out;
}

export const closingWhere = (scope, f) => ({
  schoolId: scope.school.id,
  ...(scope.branch && { branchId: scope.branch.id }),
  ...(f.branch && { branchId: f.branch }),
  ...(f.role !== 'all' && { userRole: f.role }),
  ...(f.user && { userId: f.user }),
  ...(f.result === 'balanced' && { difference: 0 }),
  ...(f.result === 'shortage' && { difference: { lt: 0 } }),
  ...(f.result === 'surplus' && { difference: { gt: 0 } }),
  ...((f.from || f.to) && { closingDate: { ...(f.from && { gte: asDbDate(f.from) }), ...(f.to && { lte: asDbDate(f.to) }) } }),
});

/**
 * Closing history (Accountant closings, Manager closings or all) and the combined summary of the same
 * filter: totals per day across everyone, which never replaces the individual closings.
 */
export async function listClosings(scope, f) {
  const prisma = getPrisma();
  const where = closingWhere(scope, f);
  const [items, settings, people] = await Promise.all([
    prisma.cashClosing.findMany({ where, include: { branch: { select: { id: true, name: true } }, revisions: { orderBy: { createdAt: 'asc' } } }, orderBy: { closedAt: 'desc' }, take: 500 }),
    feeSettingsOf(scope.school.id),
    prisma.cashClosing.findMany({ where: { schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) }, distinct: ['userId'], select: { userId: true, userName: true, userRole: true } }),
  ]);
  const byDay = new Map();
  for (const c of items) {
    const day = fromDbDate(c.closingDate);
    const d = byDay.get(day) ?? { date: day, closings: 0, recorded: 0, reversed: 0, expected: 0, counted: 0, difference: 0, shortages: 0, surpluses: 0, byRole: {} };
    d.closings += 1;
    d.recorded += c.recordedAmount;
    d.reversed += c.reversedAmount;
    d.expected += c.expectedAmount;
    d.counted += c.countedAmount;
    d.difference += c.difference;
    if (c.difference < 0) d.shortages += 1;
    if (c.difference > 0) d.surpluses += 1;
    d.byRole[c.userRole] = (d.byRole[c.userRole] ?? 0) + c.countedAmount;
    byDay.set(day, d);
  }
  const sum = (k) => items.reduce((n, c) => n + c[k], 0);
  return {
    currency: settings.currency,
    people: people.map((p) => ({ id: p.userId, name: p.userName, role: p.userRole })),
    items: items.map(toClosing),
    summary: {
      closings: items.length,
      recorded: sum('recordedAmount'),
      reversed: sum('reversedAmount'),
      expected: sum('expectedAmount'),
      counted: sum('countedAmount'),
      difference: sum('difference'),
      shortages: items.filter((c) => c.difference < 0).reduce((n, c) => n + c.difference, 0),
      surpluses: items.filter((c) => c.difference > 0).reduce((n, c) => n + c.difference, 0),
      days: [...byDay.values()].sort((a, b) => b.date.localeCompare(a.date)),
    },
  };
}

export async function getClosing(scope, id) {
  if (!isUuid(id)) throw notFound('Closing not found.');
  const c = await getPrisma().cashClosing.findFirst({
    where: { id, schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) },
    include: {
      branch: { select: { id: true, name: true } },
      revisions: { orderBy: { createdAt: 'asc' } },
      payments: { include: { student: { select: { firstName: true, middleName: true, lastName: true, studentNumber: true } }, receipt: { select: { number: true } } }, orderBy: { receivedAt: 'asc' } },
      reversals: { include: { receipt: { select: { number: true } } }, orderBy: { reversedAt: 'asc' } },
    },
  });
  if (!c) throw notFound('Closing not found.');
  const settings = await feeSettingsOf(scope.school.id);
  return {
    currency: settings.currency,
    closing: {
      ...toClosing(c),
      payments: c.payments.map((p) => ({ id: p.id, amount: p.amount, status: p.status.toLowerCase(), receivedAt: p.receivedAt.toISOString(), student: `${fullName(p.student)} (${p.student.studentNumber})`, receipt: p.receipt?.number ?? null })),
      reversals: c.reversals.map((p) => ({ id: p.id, amount: p.amount, reversedAt: p.reversedAt?.toISOString() ?? null, reason: p.reversalReason, receipt: p.receipt?.number ?? null })),
    },
  };
}

/** Today's closing status per cash-taking person of the scope (for the overview). */
export async function closingStatusToday(scope) {
  const prisma = getPrisma();
  const today = await calendarToday();
  const [closings, open] = await Promise.all([
    prisma.cashClosing.findMany({ where: { schoolId: scope.school.id, closingDate: asDbDate(today), ...(scope.branch && { branchId: scope.branch.id }) }, include: { branch: { select: { id: true, name: true } } }, orderBy: { closedAt: 'desc' } }),
    prisma.feePayment.groupBy({ by: ['recordedById', 'recordedByName', 'recordedByRole'], where: { schoolId: scope.school.id, closingId: null, ...(scope.branch && { branchId: scope.branch.id }) }, _sum: { amount: true }, _count: { _all: true } }),
  ]);
  return {
    today,
    closings: closings.map(toClosing),
    notClosed: open.map((o) => ({ user: { id: o.recordedById, name: o.recordedByName, role: o.recordedByRole, roleLabel: roleLabel[o.recordedByRole] }, payments: o._count._all, amount: o._sum.amount ?? 0 })),
  };
}

import { badRequest, conflict, forbidden, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { actorOf, findScopedStudent, lockOperating, lockStudentAccount, permissions, studentScope, TX } from './feeAccess.js';
import { fullName, refreshInvoicesOf } from './feeAccounts.service.js';
import { assertOwner } from './feeGeneration.service.js';
import { feeSettingsOf } from './feeSettings.js';
import { applyDiscounts, asDbDate, discountCovers, formatMoney, formatPercent, fromDbDate, monthLabel, monthOf } from './feeRules.js';

/*
 * Discounts and scholarships (docs/business-rules.md → Fee Management → Discounts & scholarships).
 * The School Owner creates policies (percentage or fixed, scholarships up to 100%, eligibility,
 * dates, limits, classes and branches); Managers assign existing policies to eligible students within
 * those limits. A discount reduces fees as they are charged; given for months already charged, it can
 * also reduce those fees not paid at all yet. Fees keep their original amount and each discount.
 */

const KINDS = ['MONTHLY', 'EXAM', 'OTHER'];

export const toPolicy = (p, extra = {}) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  category: p.category.toLowerCase(),
  type: p.type.toLowerCase(),
  value: p.value,
  appliesTo: p.appliesTo.map((k) => k.toLowerCase()),
  classIds: p.classIds,
  branchIds: p.branchIds,
  eligibility: p.eligibility,
  startDate: fromDbDate(p.startDate),
  endDate: fromDbDate(p.endDate),
  maxAmount: p.maxAmount,
  maxStudents: p.maxStudents,
  combinable: p.combinable,
  managersAssign: p.managersAssign,
  status: p.status.toLowerCase(),
  createdAt: p.createdAt.toISOString(),
  ...extra,
});

const fold = (s) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

export async function listPolicies(scope, { status = 'all' } = {}) {
  const prisma = getPrisma();
  const policies = await prisma.feeDiscountPolicy.findMany({ where: { schoolId: scope.school.id, ...(status !== 'all' && { status: status.toUpperCase() }) }, orderBy: [{ status: 'asc' }, { name: 'asc' }] });
  const holders = policies.length ? await prisma.studentDiscount.groupBy({ by: ['policyId'], where: { policyId: { in: policies.map((p) => p.id) }, revokedAt: null }, _count: { _all: true } }) : [];
  const applied = policies.length
    ? await prisma.$queryRaw`SELECT sd."policyId" AS "policyId", COALESCE(SUM(d."amount"), 0)::int AS "amount" FROM "FeeObligationDiscount" d JOIN "StudentDiscount" sd ON sd."id" = d."studentDiscountId" JOIN "FeeObligation" o ON o."id" = d."obligationId" WHERE sd."schoolId" = ${scope.school.id} AND o."status" <> 'CANCELLED' GROUP BY sd."policyId"`
    : [];
  const settings = await feeSettingsOf(scope.school.id);
  return {
    currency: settings.currency,
    combination: settings.discountCombination,
    maxCombined: settings.maxCombinedDiscount,
    canEdit: scope.role === 'OWNER',
    items: policies.map((p) => toPolicy(p, { students: holders.find((h) => h.policyId === p.id)?._count._all ?? 0, totalApplied: applied.find((a) => a.policyId === p.id)?.amount ?? 0 })),
  };
}

export function readPolicy(body, { creating }) {
  const errors = {};
  const out = {};
  const text = (k, max, required) => {
    if (body[k] === undefined && !creating) return;
    const v = typeof body[k] === 'string' ? body[k].trim() : body[k] === null || body[k] === undefined ? '' : undefined;
    if (v === undefined) errors[k] = 'Text only.';
    else if (required && !v) errors[k] = 'Required.';
    else if (v.length > max) errors[k] = `At most ${max} characters.`;
    else out[k] = v || null;
  };
  text('name', 60, true);
  text('description', 300, false);
  text('eligibility', 500, false);
  if (body.category !== undefined || creating) {
    if (!['discount', 'scholarship'].includes(body.category)) errors.category = 'Discount or scholarship.';
    else out.category = body.category.toUpperCase();
  }
  if (body.type !== undefined || creating) {
    if (!['percentage', 'fixed'].includes(body.type)) errors.type = 'Percentage or fixed amount.';
    else out.type = body.type.toUpperCase();
  }
  if (body.value !== undefined || creating) {
    if (!Number.isInteger(body.value) || body.value <= 0) errors.value = 'Enter a value above 0.';
    else out.value = body.value;
  }
  if (out.type === 'PERCENTAGE' && out.value > 10000) errors.value = 'At most 100%.';
  if (body.appliesTo !== undefined || creating) {
    if (!Array.isArray(body.appliesTo) || !body.appliesTo.length || body.appliesTo.some((k) => !KINDS.includes(String(k).toUpperCase()))) errors.appliesTo = 'Choose the fees it reduces.';
    else out.appliesTo = [...new Set(body.appliesTo.map((k) => k.toUpperCase()))];
  }
  for (const k of ['classIds', 'branchIds']) {
    if (body[k] === undefined) {
      if (creating) out[k] = [];
      continue;
    }
    if (!Array.isArray(body[k]) || body[k].some((v) => !isUuid(v))) errors[k] = 'Choose from the list.';
    else out[k] = [...new Set(body[k])];
  }
  for (const k of ['startDate', 'endDate']) {
    if (body[k] === undefined) continue;
    if (body[k] === null || body[k] === '') out[k] = null;
    else if (typeof body[k] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body[k])) errors[k] = 'Choose a date.';
    else out[k] = body[k];
  }
  if (out.startDate && out.endDate && out.endDate < out.startDate) errors.endDate = 'The end comes after the start.';
  for (const k of ['maxAmount', 'maxStudents']) {
    if (body[k] === undefined) continue;
    if (body[k] === null || body[k] === '') out[k] = null;
    else if (!Number.isInteger(body[k]) || body[k] <= 0) errors[k] = 'A whole number above 0, or empty for no limit.';
    else out[k] = body[k];
  }
  for (const k of ['combinable', 'managersAssign']) {
    if (body[k] === undefined) continue;
    if (typeof body[k] !== 'boolean') errors[k] = 'Yes or no.';
    else out[k] = body[k];
  }
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return out;
}

const describe = (p, currency) => (p.type === 'PERCENTAGE' ? formatPercent(p.value) : formatMoney(p.value, currency));

export async function createPolicy(scope, values, user, req) {
  assertOwner(scope);
  const settings = await feeSettingsOf(scope.school.id);
  return getPrisma().$transaction(async (tx) => {
    await lockOperating(tx, scope);
    const nameKey = fold(values.name);
    if (await tx.feeDiscountPolicy.findUnique({ where: { schoolId_nameKey: { schoolId: scope.school.id, nameKey } } })) throw conflict('NAME_TAKEN', 'A discount policy with this name already exists.');
    const p = await tx.feeDiscountPolicy.create({
      data: { schoolId: scope.school.id, nameKey, ...values, startDate: values.startDate ? asDbDate(values.startDate) : null, endDate: values.endDate ? asDbDate(values.endDate) : null },
    });
    await recordAuditEvent({ client: tx, action: AUDIT_ACTIONS.FEE_DISCOUNT_POLICY_CREATED, actor: actorOf(user), target: { type: 'feeDiscountPolicy', id: p.id, name: p.name }, schoolId: scope.school.id, description: `${p.category === 'SCHOLARSHIP' ? 'Scholarship' : 'Discount'} policy ${p.name} created: ${describe(p, settings.currency)} off ${p.appliesTo.map((k) => k.toLowerCase()).join(', ')} fees.`, req });
    return toPolicy(p);
  }, TX);
}

export async function updatePolicy(scope, id, values, user, req) {
  assertOwner(scope);
  if (!isUuid(id)) throw notFound('Discount policy not found.');
  const settings = await feeSettingsOf(scope.school.id);
  return getPrisma().$transaction(async (tx) => {
    await lockOperating(tx, scope);
    const p = await tx.feeDiscountPolicy.findFirst({ where: { id, schoolId: scope.school.id } });
    if (!p) throw notFound('Discount policy not found.');
    const data = { ...values };
    if (values.name) {
      data.nameKey = fold(values.name);
      const clash = await tx.feeDiscountPolicy.findFirst({ where: { schoolId: scope.school.id, nameKey: data.nameKey, id: { not: p.id } } });
      if (clash) throw conflict('NAME_TAKEN', 'A discount policy with this name already exists.');
    }
    if (values.type === 'PERCENTAGE' && (values.value ?? p.value) > 10000) throw badRequest('At most 100%.', { value: 'At most 100%.' });
    for (const k of ['startDate', 'endDate']) if (values[k] !== undefined) data[k] = values[k] ? asDbDate(values[k]) : null;
    const updated = await tx.feeDiscountPolicy.update({ where: { id: p.id }, data });
    const fields = Object.keys(values).filter((k) => k !== 'nameKey').map((k) => ({ field: k, from: String(p[k] ?? ''), to: String(updated[k] ?? '') })).filter((f) => f.from !== f.to);
    if (fields.length) await recordAuditEvent({ client: tx, action: AUDIT_ACTIONS.FEE_DISCOUNT_POLICY_UPDATED, actor: actorOf(user), target: { type: 'feeDiscountPolicy', id: p.id, name: updated.name }, schoolId: scope.school.id, description: `Discount policy ${updated.name} changed (${describe(updated, settings.currency)}). Discounts already applied to fees keep their amounts.`, change: { fields }, req });
    return toPolicy(updated);
  }, TX);
}

export async function setPolicyActive(scope, id, active, user, req) {
  assertOwner(scope);
  if (!isUuid(id)) throw notFound('Discount policy not found.');
  return getPrisma().$transaction(async (tx) => {
    await lockOperating(tx, scope);
    const p = await tx.feeDiscountPolicy.findFirst({ where: { id, schoolId: scope.school.id } });
    if (!p) throw notFound('Discount policy not found.');
    if ((p.status === 'ACTIVE') === active) return toPolicy(p);
    const updated = await tx.feeDiscountPolicy.update({ where: { id: p.id }, data: { status: active ? 'ACTIVE' : 'INACTIVE' } });
    await recordAuditEvent({ client: tx, action: active ? AUDIT_ACTIONS.FEE_DISCOUNT_POLICY_REACTIVATED : AUDIT_ACTIONS.FEE_DISCOUNT_POLICY_DEACTIVATED, actor: actorOf(user), target: { type: 'feeDiscountPolicy', id: p.id, name: p.name }, schoolId: scope.school.id, description: active ? `Discount policy ${p.name} reactivated.` : `Discount policy ${p.name} deactivated: it no longer reduces new fees. Fees already charged keep their discounts.`, req });
    return toPolicy(updated);
  }, TX);
}

// ---- student discounts ------------------------------------------------------------------------------

export async function listStudentDiscounts(scope, { status = 'active', policy, q } = {}) {
  const prisma = getPrisma();
  const words = (q ?? '').trim().split(/\s+/).filter(Boolean);
  const rows = await prisma.studentDiscount.findMany({
    where: {
      schoolId: scope.school.id,
      ...(status === 'active' && { revokedAt: null }),
      ...(status === 'revoked' && { revokedAt: { not: null } }),
      ...(policy && isUuid(policy) && { policyId: policy }),
      student: { ...studentScope(scope), ...(words.length && { AND: words.map((w) => ({ OR: [{ firstName: { contains: w, mode: 'insensitive' } }, { lastName: { contains: w, mode: 'insensitive' } }, { studentNumber: { contains: w, mode: 'insensitive' } }] })) }) },
    },
    include: { policy: true, student: { include: { branch: { select: { id: true, name: true } }, enrollments: { where: { status: 'ACTIVE' }, include: { section: { include: { class: true } } }, take: 1 } } }, applied: { select: { amount: true, obligation: { select: { status: true } } } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const settings = await feeSettingsOf(scope.school.id);
  return {
    currency: settings.currency,
    items: rows.map((r) => ({
      id: r.id,
      student: { id: r.student.id, name: fullName(r.student), studentNumber: r.student.studentNumber, class: r.student.enrollments[0] ? `${r.student.enrollments[0].section.class.name}${r.student.enrollments[0].section.name}` : null, branch: r.student.branch },
      policy: toPolicy(r.policy),
      startMonth: fromDbDate(r.startMonth),
      endMonth: fromDbDate(r.endMonth),
      reason: r.reason,
      assignedBy: r.assignedByName,
      createdAt: r.createdAt.toISOString(),
      active: !r.revokedAt,
      revokedAt: r.revokedAt?.toISOString() ?? null,
      revokedBy: r.revokedByName,
      revokeReason: r.revokeReason,
      totalApplied: r.applied.filter((a) => a.obligation.status !== 'CANCELLED').reduce((n, a) => n + a.amount, 0),
    })),
  };
}

export function readAssignment(body) {
  const errors = {};
  if (!isUuid(body.student)) errors.student = 'Choose the student.';
  if (!isUuid(body.policy)) errors.policy = 'Choose a discount policy.';
  const month = (v, k, required) => {
    if (v === undefined || v === null || v === '') {
      if (required) errors[k] = 'Choose a month.';
      return null;
    }
    if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) {
      errors[k] = 'Choose a month.';
      return null;
    }
    return `${v}-01`;
  };
  const startMonth = month(body.startMonth, 'startMonth', true);
  const endMonth = month(body.endMonth, 'endMonth', false);
  if (startMonth && endMonth && endMonth < startMonth) errors.endMonth = 'The last month comes after the first.';
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) errors.reason = 'Give a reason (e.g. the eligibility it meets).';
  else if (reason.length > 500) errors.reason = 'At most 500 characters.';
  if (body.applyToOpen !== undefined && typeof body.applyToOpen !== 'boolean') errors.applyToOpen = 'Yes or no.';
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return { studentId: body.student, policyId: body.policy, startMonth, endMonth, reason, applyToOpen: body.applyToOpen !== false };
}

/**
 * Gives a student a discount policy. The policy must be active, assignable by the role (Managers only
 * policies the Owner lets them assign), cover the student's class and branch, have room under its
 * student limit, and its dates must include the months. With applyToOpen, fees already charged in
 * those months and not paid at all are recalculated with every discount the student holds.
 */
export async function assignDiscount(scope, values, user, req) {
  const prisma = getPrisma();
  const settings = await feeSettingsOf(scope.school.id);
  if (!permissions(scope, settings).assignDiscounts) throw forbidden('Only the School Owner or a Manager gives discounts.');
  const today = await calendarToday();
  return prisma.$transaction(async (tx) => {
    await lockOperating(tx, scope);
    const student = await findScopedStudent(tx, scope, values.studentId);
    await lockStudentAccount(tx, student.id);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fee-policy:${values.policyId}`}))`;
    const policy = await tx.feeDiscountPolicy.findFirst({ where: { id: values.policyId, schoolId: scope.school.id } });
    if (!policy) throw notFound('Discount policy not found.');
    if (policy.status !== 'ACTIVE') throw conflict('POLICY_INACTIVE', `${policy.name} is not active.`);
    if (scope.role === 'MANAGER' && !policy.managersAssign) throw forbidden(`Only the School Owner gives ${policy.name}.`);
    const enrollment = await tx.enrollment.findFirst({ where: { studentId: student.id, status: 'ACTIVE' }, include: { section: { include: { class: true } } } });
    if (policy.classIds.length && (!enrollment || !policy.classIds.includes(enrollment.section.classId))) throw conflict('NOT_ELIGIBLE', `${policy.name} is not for ${enrollment ? enrollment.section.class.name : 'students without a class'}.`);
    if (policy.branchIds.length && !policy.branchIds.includes(student.branchId)) throw conflict('NOT_ELIGIBLE', `${policy.name} is not for this branch.`);
    if (policy.startDate && values.startMonth < monthOf(fromDbDate(policy.startDate))) throw conflict('OUTSIDE_POLICY', `${policy.name} starts in ${monthLabel(monthOf(fromDbDate(policy.startDate)))}.`);
    if (policy.endDate && (values.startMonth > fromDbDate(policy.endDate) || (values.endMonth && values.endMonth > fromDbDate(policy.endDate)))) throw conflict('OUTSIDE_POLICY', `${policy.name} ends on ${fromDbDate(policy.endDate)}.`);
    if (await tx.studentDiscount.findFirst({ where: { studentId: student.id, policyId: policy.id, revokedAt: null } })) throw conflict('ALREADY_ASSIGNED', `${fullName(student)} already has ${policy.name}.`);
    if (policy.maxStudents) {
      const holders = await tx.studentDiscount.count({ where: { policyId: policy.id, revokedAt: null } });
      if (holders >= policy.maxStudents) throw conflict('POLICY_FULL', `${policy.name} is limited to ${policy.maxStudents} students and all places are taken.`);
    }
    const sd = await tx.studentDiscount.create({
      data: { schoolId: scope.school.id, branchId: student.branchId, studentId: student.id, policyId: policy.id, startMonth: asDbDate(values.startMonth), endMonth: values.endMonth ? asDbDate(values.endMonth) : null, reason: values.reason, assignedById: user.id, assignedByName: user.name, assignedByRole: user.role },
    });
    let changed = 0;
    if (values.applyToOpen) changed = await reapplyDiscounts(tx, student, settings, user, `${policy.name} given: ${values.reason}`, { from: values.startMonth, to: values.endMonth, today });
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.FEE_DISCOUNT_ASSIGNED,
      actor: actorOf(user),
      target: { type: 'student', id: student.id, name: `${fullName(student)} (${student.studentNumber})` },
      schoolId: scope.school.id,
      description: `${policy.name} (${describe(policy, settings.currency)}) given from ${monthLabel(values.startMonth)}${values.endMonth ? ` to ${monthLabel(values.endMonth)}` : ''}${changed ? `; ${changed} unpaid fee${changed === 1 ? '' : 's'} recalculated` : ''}. Reason: ${values.reason}`,
      req,
    });
    return { id: sd.id, changed };
  }, TX);
}

/**
 * Recalculates the discounts of a student's fees charged in a range of months with nothing paid yet,
 * from the discounts they hold now (each change recorded). → number of fees changed.
 */
async function reapplyDiscounts(tx, student, settings, user, reason, { from, to }) {
  const open = await tx.feeObligation.findMany({ where: { studentId: student.id, status: 'OPEN', paidAmount: 0 }, include: { discounts: true } });
  const held = await tx.studentDiscount.findMany({ where: { studentId: student.id, revokedAt: null }, include: { policy: true } });
  let changed = 0;
  for (const o of open) {
    const month = o.billingMonth ? fromDbDate(o.billingMonth) : monthOf(fromDbDate(o.dueDate));
    if (month < from || (to && month > to)) continue;
    const disc = applyDiscounts(
      o.amount,
      held.filter((d) => discountCovers(d, d.policy, { month, kind: o.kind, classId: o.classId, branchId: o.branchId })).map((d) => ({ id: d.id, name: d.policy.name, category: d.policy.category, type: d.policy.type, value: d.policy.value, maxAmount: d.policy.maxAmount, combinable: d.policy.combinable })),
      { combination: settings.discountCombination, maxCombinedPercent: settings.maxCombinedDiscount },
    );
    if (disc.total === o.discountAmount) continue;
    await tx.feeObligationDiscount.deleteMany({ where: { obligationId: o.id } });
    if (disc.applied.length) await tx.feeObligationDiscount.createMany({ data: disc.applied.map((d) => ({ obligationId: o.id, studentDiscountId: d.id, name: d.name, category: d.category, type: d.type, value: d.value, amount: d.amount })) });
    const net = o.amount - disc.total;
    await tx.feeObligation.update({ where: { id: o.id }, data: { discountAmount: disc.total, netAmount: net, status: net === 0 ? 'PAID' : 'OPEN' } });
    await tx.feeObligationChange.create({ data: { obligationId: o.id, type: disc.total > o.discountAmount ? 'DISCOUNT_APPLIED' : 'DISCOUNT_REMOVED', fromAmount: o.netAmount, toAmount: net, reason: `${reason}${o.discounts.length ? ` (was: ${o.discounts.map((d) => `${d.name} ${formatMoney(d.amount, settings.currency)}`).join(', ')})` : ''}`, actorId: user.id, actorName: user.name, actorRole: user.role } });
    changed += 1;
  }
  if (changed) await refreshInvoicesOf(tx, open.map((o) => o.id));
  return changed;
}

export async function revokeDiscount(scope, id, { reason, fromMonth }, user, req) {
  if (!isUuid(id)) throw notFound('Discount not found.');
  const prisma = getPrisma();
  const settings = await feeSettingsOf(scope.school.id);
  if (!permissions(scope, settings).assignDiscounts) throw forbidden('Only the School Owner or a Manager revokes discounts.');
  const today = await calendarToday();
  await prisma.$transaction(async (tx) => {
    await lockOperating(tx, scope);
    const sd = await tx.studentDiscount.findFirst({ where: { id, schoolId: scope.school.id }, include: { policy: true } });
    if (!sd) throw notFound('Discount not found.');
    const student = await findScopedStudent(tx, scope, sd.studentId);
    await lockStudentAccount(tx, student.id);
    if (sd.revokedAt) throw conflict('ALREADY_REVOKED', 'This discount is already revoked.');
    if (scope.role === 'MANAGER' && !sd.policy.managersAssign) throw forbidden(`Only the School Owner revokes ${sd.policy.name}.`);
    await tx.studentDiscount.update({ where: { id: sd.id }, data: { revokedAt: new Date(), revokedByName: user.name, revokeReason: reason } });
    // Unpaid fees from a month on lose it too (default: the current month).
    const from = fromMonth ?? monthOf(today);
    const changed = await reapplyDiscounts(tx, student, settings, user, `${sd.policy.name} revoked: ${reason}`, { from, to: null, today });
    await recordAuditEvent({ client: tx, action: AUDIT_ACTIONS.FEE_DISCOUNT_REVOKED, actor: actorOf(user), target: { type: 'student', id: student.id, name: `${fullName(student)} (${student.studentNumber})` }, schoolId: scope.school.id, description: `${sd.policy.name} revoked${changed ? `; ${changed} unpaid fee${changed === 1 ? '' : 's'} from ${monthLabel(from)} recalculated` : ''}. Reason: ${reason}`, req });
  }, TX);
}

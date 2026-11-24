import { badRequest, conflict, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { actorOf, lockOperating, TX, yearOf } from './feeAccess.js';
import { assertOwner, regenerateForClass, syncSchoolExamFees } from './feeGeneration.service.js';
import { feeSettingsOf } from './feeSettings.js';
import { addMonths, asDbDate, formatMoney, fromDbDate, monthLabel, monthOf, monthsBetween } from './feeRules.js';

/*
 * Fee structures (docs/business-rules.md → Fee Management → Fee structures): a monthly fee per class
 * and academic year, and examination fees per class, examination type and year (School Owner; Managers
 * and Accountants read). A monthly fee change is a new rate from a month on: it applies to fees not
 * generated yet; fees already generated keep their amounts.
 */

const toRate = (r) => ({ id: r.id, effectiveMonth: fromDbDate(r.effectiveMonth), amount: r.amount, reason: r.reason, createdAt: r.createdAt.toISOString(), createdBy: r.createdByName });

/** The rate in force for a month (rates sorted newest first). */
const rateFor = (rates, month) => rates.find((r) => fromDbDate(r.effectiveMonth) <= month) ?? null;

export async function listStructures(scope, { academicYear }) {
  const prisma = getPrisma();
  const year = await yearOf(prisma, scope, academicYear);
  const today = await calendarToday();
  const classes = await prisma.schoolClass.findMany({ where: { schoolId: scope.school.id }, orderBy: { sequence: 'asc' }, select: { id: true, name: true, status: true } });
  if (!year) return { academicYear: null, items: [], classesWithout: classes.filter((c) => c.status === 'ACTIVE'), canEdit: scope.role === 'OWNER' };
  const [structures, examRates, charged] = await Promise.all([
    prisma.feeStructure.findMany({ where: { schoolId: scope.school.id, academicYearId: year.id }, include: { rates: { orderBy: { effectiveMonth: 'desc' } } } }),
    prisma.examFeeRate.findMany({ where: { academicYearId: year.id, schoolId: scope.school.id }, include: { examType: { select: { id: true, name: true } } } }),
    prisma.feeObligation.groupBy({ by: ['classId'], where: { schoolId: scope.school.id, academicYearId: year.id, kind: 'MONTHLY', status: { not: 'CANCELLED' } }, _count: { _all: true }, _max: { billingMonth: true } }),
  ]);
  const chargedOf = new Map(charged.map((c) => [c.classId, c]));
  const month = monthOf(today);
  const items = structures
    .map((s) => {
      const cls = classes.find((c) => c.id === s.classId);
      const current = rateFor(s.rates, month) ?? s.rates.at(-1) ?? null;
      const next = s.rates.find((r) => fromDbDate(r.effectiveMonth) > month) ?? null;
      const exams = examRates.filter((r) => r.classId === s.classId).map((r) => ({ id: r.id, examType: r.examType, amount: r.amount }));
      return {
        id: s.id,
        class: cls ? { id: cls.id, name: cls.name } : { id: s.classId, name: '—' },
        sequence: classes.findIndex((c) => c.id === s.classId),
        monthlyFee: current?.amount ?? 0,
        upcoming: next ? toRate(next) : null,
        examFees: exams,
        examFee: exams.length ? Math.max(...exams.map((e) => e.amount)) : 0,
        excludedMonths: s.excludedMonths,
        status: s.status.toLowerCase(),
        notes: s.notes,
        rates: s.rates.map(toRate),
        charged: chargedOf.get(s.classId)?._count._all ?? 0,
        lastChargedMonth: chargedOf.get(s.classId)?._max.billingMonth ? fromDbDate(chargedOf.get(s.classId)._max.billingMonth) : null,
      };
    })
    .sort((a, b) => a.sequence - b.sequence);
  const withStructure = new Set(structures.map((s) => s.classId));
  return {
    academicYear: { id: year.id, name: year.name, startDate: fromDbDate(year.startDate), endDate: fromDbDate(year.endDate), status: year.status.toLowerCase() },
    months: monthsBetween(fromDbDate(year.startDate), fromDbDate(year.endDate)).map((m) => ({ value: m.slice(0, 7), label: monthLabel(m) })),
    today,
    items,
    classesWithout: classes.filter((c) => c.status === 'ACTIVE' && !withStructure.has(c.id)),
    canEdit: scope.role === 'OWNER' && year.status !== 'CLOSED',
  };
}

const AMOUNT_MAX = 100_000_000;
const readAmount = (value, field, errors, { required = true } = {}) => {
  if (value === undefined || value === null || value === '') {
    if (required) errors[field] = 'Enter an amount.';
    return undefined;
  }
  if (!Number.isInteger(value) || value < 0 || value > AMOUNT_MAX) errors[field] = 'Enter an amount of 0 or more.';
  return value;
};

export function readStructure(body, { creating }) {
  const errors = {};
  const out = {};
  if (creating) {
    if (!isUuid(body.class)) errors.class = 'Choose a class.';
    out.classId = body.class;
    if (body.academicYear !== undefined && body.academicYear !== 'current' && !isUuid(body.academicYear)) errors.academicYear = 'Choose an academic year.';
    out.academicYear = body.academicYear ?? 'current';
  }
  if (body.monthlyFee !== undefined || creating) out.monthlyFee = readAmount(body.monthlyFee, 'monthlyFee', errors);
  if (body.effectiveMonth !== undefined && body.effectiveMonth !== null) {
    if (typeof body.effectiveMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.effectiveMonth)) errors.effectiveMonth = 'Choose the month it starts.';
    else out.effectiveMonth = `${body.effectiveMonth}-01`;
  }
  if (body.excludedMonths !== undefined) {
    if (!Array.isArray(body.excludedMonths) || body.excludedMonths.some((m) => typeof m !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(m))) errors.excludedMonths = 'Choose months.';
    else out.excludedMonths = [...new Set(body.excludedMonths)].sort();
  }
  if (body.notes !== undefined) {
    if (body.notes !== null && (typeof body.notes !== 'string' || body.notes.length > 300)) errors.notes = 'At most 300 characters.';
    else out.notes = body.notes?.trim() || null;
  }
  if (body.reason !== undefined) {
    if (body.reason !== null && (typeof body.reason !== 'string' || body.reason.length > 300)) errors.reason = 'At most 300 characters.';
    else out.reason = body.reason?.trim() || null;
  }
  if (body.status !== undefined) {
    if (!['active', 'inactive'].includes(body.status)) errors.status = 'Active or inactive.';
    else out.status = body.status.toUpperCase();
  }
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return out;
}

/** Months of a class's structure already charged: a new rate must start after the last of them. */
async function lastChargedMonth(tx, structureId) {
  const last = await tx.feeObligation.findFirst({ where: { kind: 'MONTHLY', structureRate: { structureId } }, orderBy: { billingMonth: 'desc' }, select: { billingMonth: true } });
  return last ? fromDbDate(last.billingMonth) : null;
}

const audit = (tx, action, scope, user, req, target, description, change) =>
  recordAuditEvent({ client: tx, action, actor: actorOf(user), target, schoolId: scope.school.id, description, change, req });

export async function createStructure(scope, values, user, req) {
  assertOwner(scope);
  const prisma = getPrisma();
  const currency = (await feeSettingsOf(scope.school.id)).currency;
  const created = await prisma.$transaction(async (tx) => {
    await lockOperating(tx, scope);
    const year = await yearOf(tx, scope, values.academicYear);
    if (!year) throw conflict('NO_CURRENT_YEAR', 'Start an academic year first: fee structures belong to a year.');
    if (year.status === 'CLOSED') throw conflict('YEAR_CLOSED', `${year.name} is closed.`);
    const cls = await tx.schoolClass.findFirst({ where: { id: values.classId, schoolId: scope.school.id } });
    if (!cls) throw notFound('Class not found.');
    const exists = await tx.feeStructure.findUnique({ where: { academicYearId_classId: { academicYearId: year.id, classId: cls.id } } });
    if (exists) throw conflict('STRUCTURE_EXISTS', `${cls.name} already has a fee structure for ${year.name}. Edit it instead.`);
    const first = monthOf(fromDbDate(year.startDate));
    const effective = values.effectiveMonth && values.effectiveMonth > first ? values.effectiveMonth : first;
    const structure = await tx.feeStructure.create({
      data: { schoolId: scope.school.id, academicYearId: year.id, classId: cls.id, excludedMonths: values.excludedMonths ?? [], notes: values.notes ?? null, rates: { create: { effectiveMonth: asDbDate(effective), amount: values.monthlyFee, reason: values.reason ?? null, createdById: user.id, createdByName: user.name } } },
    });
    await audit(tx, AUDIT_ACTIONS.FEE_STRUCTURE_CREATED, scope, user, req, { type: 'feeStructure', id: structure.id, name: `${cls.name} · ${year.name}` }, `Monthly fee of ${cls.name} for ${year.name} set to ${formatMoney(values.monthlyFee, currency)} from ${monthLabel(effective)}.`);
    return structure;
  }, TX);
  await regenerateForClass(scope.school.id, created.classId);
  return created;
}

/**
 * Changes a structure: a new monthly amount from a month on (never a month already charged: those
 * fees keep their amounts), excluded months (only months not charged yet), notes, status.
 */
export async function updateStructure(scope, id, values, user, req) {
  assertOwner(scope);
  if (!isUuid(id)) throw notFound('Fee structure not found.');
  const prisma = getPrisma();
  const currency = (await feeSettingsOf(scope.school.id)).currency;
  const today = await calendarToday();
  const updated = await prisma.$transaction(async (tx) => {
    await lockOperating(tx, scope);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fees-gen:${scope.school.id}`}))`;
    const s = await tx.feeStructure.findFirst({ where: { id, schoolId: scope.school.id }, include: { rates: { orderBy: { effectiveMonth: 'desc' } }, class: true, academicYear: true } });
    if (!s) throw notFound('Fee structure not found.');
    if (s.academicYear.status === 'CLOSED') throw conflict('YEAR_CLOSED', `${s.academicYear.name} is closed: its fees are kept as they are.`);
    const fields = [];
    const last = await lastChargedMonth(tx, s.id);
    if (values.monthlyFee !== undefined) {
      const current = rateFor(s.rates, monthOf(today)) ?? s.rates.at(-1);
      const effective = values.effectiveMonth ?? (last ? addMonths(last, 1) : fromDbDate(s.rates.at(-1).effectiveMonth));
      if (last && effective <= last) throw conflict('MONTH_CHARGED', `Fees up to ${monthLabel(last)} are already charged and keep their amounts. Choose ${monthLabel(addMonths(last, 1))} or later.`);
      if (effective > fromDbDate(s.academicYear.endDate)) throw conflict('OUTSIDE_YEAR', `${monthLabel(effective)} is after ${s.academicYear.name}.`);
      const same = s.rates.find((r) => fromDbDate(r.effectiveMonth) === effective);
      if (same) await tx.feeStructureRate.update({ where: { id: same.id }, data: { amount: values.monthlyFee, reason: values.reason ?? same.reason, createdById: user.id, createdByName: user.name } });
      else await tx.feeStructureRate.create({ data: { structureId: s.id, effectiveMonth: asDbDate(effective), amount: values.monthlyFee, reason: values.reason ?? null, createdById: user.id, createdByName: user.name } });
      fields.push({ field: `Monthly fee from ${monthLabel(effective)}`, from: formatMoney(rateFor(s.rates, effective)?.amount ?? current?.amount ?? 0, currency), to: formatMoney(values.monthlyFee, currency) });
    }
    const data = {};
    if (values.excludedMonths !== undefined && JSON.stringify(values.excludedMonths) !== JSON.stringify(s.excludedMonths)) {
      const added = values.excludedMonths.filter((m) => !s.excludedMonths.includes(m));
      const removed = s.excludedMonths.filter((m) => !values.excludedMonths.includes(m));
      if (last && [...added, ...removed].some((m) => `${m}-01` <= last)) throw conflict('MONTH_CHARGED', 'Months already charged cannot be added to or removed from the months without fees.');
      data.excludedMonths = values.excludedMonths;
      fields.push({ field: 'Months without a fee', from: s.excludedMonths.join(', ') || 'None', to: values.excludedMonths.join(', ') || 'None' });
    }
    if (values.notes !== undefined && values.notes !== s.notes) {
      data.notes = values.notes;
      fields.push({ field: 'Notes', from: s.notes ?? '', to: values.notes ?? '' });
    }
    if (values.status !== undefined && values.status !== s.status) {
      data.status = values.status;
      fields.push({ field: 'Status', from: s.status.toLowerCase(), to: values.status.toLowerCase() });
    }
    if (!fields.length) return s;
    if (Object.keys(data).length) await tx.feeStructure.update({ where: { id: s.id }, data });
    await audit(tx, AUDIT_ACTIONS.FEE_STRUCTURE_UPDATED, scope, user, req, { type: 'feeStructure', id: s.id, name: `${s.class.name} · ${s.academicYear.name}` }, `Fee structure of ${s.class.name} changed: ${fields.map((f) => f.field).join('; ')}.${values.reason ? ` Reason: ${values.reason}` : ''}`, { fields });
    return s;
  }, TX);
  await regenerateForClass(scope.school.id, updated.classId);
  return updated;
}

// ---- examination fees ------------------------------------------------------------------------------

export async function listExamFees(scope, { academicYear }) {
  const prisma = getPrisma();
  const year = await yearOf(prisma, scope, academicYear);
  const [classes, types] = await Promise.all([
    prisma.schoolClass.findMany({ where: { schoolId: scope.school.id, status: 'ACTIVE' }, orderBy: { sequence: 'asc' }, select: { id: true, name: true } }),
    prisma.examType.findMany({ where: { schoolId: scope.school.id, status: 'ACTIVE' }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const rates = year ? await prisma.examFeeRate.findMany({ where: { academicYearId: year.id, schoolId: scope.school.id } }) : [];
  return {
    academicYear: year ? { id: year.id, name: year.name } : null,
    classes,
    examTypes: types,
    rates: rates.map((r) => ({ id: r.id, classId: r.classId, examTypeId: r.examTypeId, amount: r.amount, updatedAt: r.updatedAt.toISOString(), updatedBy: r.updatedByName })),
    canEdit: scope.role === 'OWNER' && year && year.status !== 'CLOSED',
  };
}

export function readExamFees(body) {
  const errors = {};
  if (body.academicYear !== undefined && body.academicYear !== 'current' && !isUuid(body.academicYear)) errors.academicYear = 'Choose an academic year.';
  if (!Array.isArray(body.rates) || body.rates.length > 2000) errors.rates = 'Send the examination fees.';
  const rates = [];
  for (const r of Array.isArray(body.rates) ? body.rates : []) {
    if (!isUuid(r?.class) || !isUuid(r?.examType)) errors.rates = 'Each fee names a class and an examination type.';
    else if (r.amount !== null && (!Number.isInteger(r.amount) || r.amount < 0 || r.amount > AMOUNT_MAX)) errors.rates = 'Enter amounts of 0 or more (empty: no fee).';
    else rates.push({ classId: r.class, examTypeId: r.examType, amount: r.amount });
  }
  if (Object.keys(errors).length) throw badRequest('Check the examination fees.', errors);
  return { academicYear: body.academicYear ?? 'current', rates };
}

/** Saves examination fees (amount null removes a fee not used yet; a used one is set to its new amount for future charges). */
export async function saveExamFees(scope, { academicYear, rates }, user, req) {
  assertOwner(scope);
  const prisma = getPrisma();
  const currency = (await feeSettingsOf(scope.school.id)).currency;
  await prisma.$transaction(async (tx) => {
    await lockOperating(tx, scope);
    const year = await yearOf(tx, scope, academicYear);
    if (!year) throw conflict('NO_CURRENT_YEAR', 'Start an academic year first.');
    if (year.status === 'CLOSED') throw conflict('YEAR_CLOSED', `${year.name} is closed.`);
    const [classes, types, existing] = await Promise.all([
      tx.schoolClass.findMany({ where: { schoolId: scope.school.id }, select: { id: true, name: true } }),
      tx.examType.findMany({ where: { schoolId: scope.school.id }, select: { id: true, name: true } }),
      tx.examFeeRate.findMany({ where: { academicYearId: year.id, schoolId: scope.school.id }, include: { _count: { select: { obligations: true } } } }),
    ]);
    const changes = [];
    for (const r of rates) {
      const cls = classes.find((c) => c.id === r.classId);
      const type = types.find((t) => t.id === r.examTypeId);
      if (!cls || !type) throw notFound('A class or examination type was not found.');
      const row = existing.find((e) => e.classId === r.classId && e.examTypeId === r.examTypeId);
      const label = `${cls.name} · ${type.name}`;
      if (r.amount === null) {
        if (!row) continue;
        if (row._count.obligations) throw conflict('FEE_IN_USE', `${label}: this fee is already charged. Set it to 0 to stop charging it.`);
        await tx.examFeeRate.delete({ where: { id: row.id } });
        changes.push({ field: label, from: formatMoney(row.amount, currency), to: 'No fee' });
      } else if (!row) {
        await tx.examFeeRate.create({ data: { schoolId: scope.school.id, academicYearId: year.id, classId: r.classId, examTypeId: r.examTypeId, amount: r.amount, updatedById: user.id, updatedByName: user.name } });
        changes.push({ field: label, from: 'No fee', to: formatMoney(r.amount, currency) });
      } else if (row.amount !== r.amount) {
        await tx.examFeeRate.update({ where: { id: row.id }, data: { amount: r.amount, updatedById: user.id, updatedByName: user.name } });
        changes.push({ field: label, from: formatMoney(row.amount, currency), to: formatMoney(r.amount, currency) });
      }
    }
    if (!changes.length) return;
    await audit(tx, AUDIT_ACTIONS.EXAM_FEES_CHANGED, scope, user, req, { type: 'school', id: scope.school.id, name: year.name }, `Examination fees for ${year.name} changed (${changes.length}). Fees already charged keep their amounts.`, { fields: changes });
  }, TX);
  await syncSchoolExamFees(scope.school.id);
  return listExamFees(scope, { academicYear });
}

import { Prisma } from '@prisma/client';
import { badRequest, conflict, forbidden, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { asDbDay, toDay } from '../academic-calendar/schoolDays.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockActiveSchool } from '../branches/branches.service.js';
import { examinationSummary } from './examinations.service.js';
import { examNameKey } from './examInput.js';

/*
 * Examination configuration (docs/business-rules.md → Examinations → Configuration): academic
 * periods, examination types, grading scales and the result formula. The School Owner changes them;
 * Managers read them (403 for changes). Never deleted: deactivated, and results keep the values they
 * were calculated with. Each change is one audit event in the same transaction.
 */

const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });
const ownerOnly = (scope) => {
  if (scope.branch) throw forbidden('Only the School Owner changes the examination configuration.');
};
const nameTaken = (what) => conflict('NAME_TAKEN', `Another ${what} already has this name.`, { name: `Another ${what} already has this name.` });
const isUnique = (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
const status = (s) => s.toLowerCase();
const num = (d) => (d === null || d === undefined ? null : Number(d));

async function audit(tx, scope, user, req, { action, target, description, fields }) {
  await recordAuditEvent({ client: tx, action, actor: actorOf(user), target, schoolId: scope.school.id, description, change: { fields }, req });
}

async function findYear(client, scope, value) {
  const year =
    value === 'current'
      ? await client.academicYear.findFirst({ where: { schoolId: scope.school.id, status: 'CURRENT' } })
      : isUuid(value)
        ? await client.academicYear.findFirst({ where: { id: value, schoolId: scope.school.id } })
        : null;
  if (!year && value !== 'current') throw notFound('Academic year not found.');
  return year;
}
const toYear = (y) => y && { id: y.id, name: y.name, status: status(y.status), startDate: toDay(y.startDate), endDate: toDay(y.endDate) };
const statusWhere = (s) => (s === 'all' ? {} : { status: s === 'inactive' ? 'INACTIVE' : 'ACTIVE' });

// ---- academic periods ---------------------------------------------------------------------------

const toPeriod = (p) => ({ id: p.id, name: p.name, sequence: p.sequence, startDate: toDay(p.startDate), endDate: toDay(p.endDate), status: status(p.status) });

/** The periods of a year (default the current one): { academicYear, items }. */
export async function listPeriods(scope, { academicYear, status: s }) {
  const prisma = getPrisma();
  const year = await findYear(prisma, scope, academicYear);
  if (!year) return { academicYear: null, items: [] };
  const rows = await prisma.academicPeriod.findMany({ where: { academicYearId: year.id, ...statusWhere(s) }, orderBy: [{ startDate: 'asc' }, { nameKey: 'asc' }] });
  return { academicYear: toYear(year), items: rows.map(toPeriod) };
}

/** Numbers the year's active periods 1, 2, … by start date. */
async function renumber(tx, yearId) {
  const rows = await tx.academicPeriod.findMany({ where: { academicYearId: yearId }, orderBy: [{ startDate: 'asc' }, { nameKey: 'asc' }] });
  let n = 0;
  for (const r of rows) {
    const sequence = r.status === 'ACTIVE' ? (n += 1) : 0;
    if (r.sequence !== sequence) await tx.academicPeriod.update({ where: { id: r.id }, data: { sequence } });
  }
}

async function checkPeriodDates(tx, year, { startDate, endDate }, exceptId) {
  const start = toDay(year.startDate);
  const end = toDay(year.endDate);
  if (startDate < start || endDate > end) throw badRequest('Check the highlighted fields.', { startDate: `Inside ${year.name}: ${start} to ${end}.` });
  const overlap = await tx.academicPeriod.findFirst({
    where: { academicYearId: year.id, status: 'ACTIVE', ...(exceptId && { id: { not: exceptId } }), startDate: { lte: asDbDay(endDate) }, endDate: { gte: asDbDay(startDate) } },
  });
  if (overlap) throw conflict('PERIOD_OVERLAP', `These dates overlap ${overlap.name} (${toDay(overlap.startDate)} to ${toDay(overlap.endDate)}).`, { startDate: `Overlaps ${overlap.name}.` });
}

const writableYear = (year) => {
  if (year.status === 'CLOSED') throw conflict('YEAR_CLOSED', `${year.name} is closed. Its periods are kept as they are.`);
};

export async function createPeriod(scope, values, user, req) {
  ownerOnly(scope);
  try {
    const id = await getPrisma().$transaction(async (tx) => {
      await lockActiveSchool(tx, scope.school);
      const year = await findYear(tx, scope, values.academicYear);
      writableYear(year);
      await checkPeriodDates(tx, year, values);
      const row = await tx.academicPeriod.create({
        data: { schoolId: scope.school.id, academicYearId: year.id, name: values.name, nameKey: examNameKey(values.name), sequence: 0, startDate: asDbDay(values.startDate), endDate: asDbDay(values.endDate) },
      });
      await renumber(tx, year.id);
      await audit(tx, scope, user, req, {
        action: AUDIT_ACTIONS.ACADEMIC_PERIOD_CREATED,
        target: { type: 'academic_period', id: row.id, name: `${row.name} (${year.name})` },
        description: `Academic period ${row.name} added to ${year.name}: ${values.startDate} to ${values.endDate}.`,
        fields: [{ field: 'Dates', from: null, to: `${values.startDate} to ${values.endDate}` }],
      });
      return row.id;
    });
    return toPeriod(await getPrisma().academicPeriod.findUnique({ where: { id } }));
  } catch (error) {
    if (isUnique(error)) throw nameTaken('period of this year');
    throw error;
  }
}

async function findPeriod(client, scope, id) {
  const row = isUuid(id) ? await client.academicPeriod.findFirst({ where: { id, schoolId: scope.school.id }, include: { academicYear: true } }) : null;
  if (!row) throw notFound('Academic period not found.');
  return row;
}

export async function updatePeriod(scope, id, values, user, req) {
  ownerOnly(scope);
  try {
    await getPrisma().$transaction(async (tx) => {
      await lockActiveSchool(tx, scope.school);
      const row = await findPeriod(tx, scope, id);
      writableYear(row.academicYear);
      const next = { name: values.name ?? row.name, startDate: values.startDate ?? toDay(row.startDate), endDate: values.endDate ?? toDay(row.endDate) };
      if (next.endDate < next.startDate) throw badRequest('Check the highlighted fields.', { endDate: 'The end is before the start.' });
      const fields = [];
      if (next.name !== row.name) fields.push({ field: 'Name', from: row.name, to: next.name });
      if (next.startDate !== toDay(row.startDate) || next.endDate !== toDay(row.endDate)) fields.push({ field: 'Dates', from: `${toDay(row.startDate)} to ${toDay(row.endDate)}`, to: `${next.startDate} to ${next.endDate}` });
      if (!fields.length) return;
      if (row.status === 'ACTIVE') await checkPeriodDates(tx, row.academicYear, next, row.id);
      await tx.academicPeriod.update({ where: { id: row.id }, data: { name: next.name, nameKey: examNameKey(next.name), startDate: asDbDay(next.startDate), endDate: asDbDay(next.endDate) } });
      await renumber(tx, row.academicYearId);
      await audit(tx, scope, user, req, { action: AUDIT_ACTIONS.ACADEMIC_PERIOD_UPDATED, target: { type: 'academic_period', id: row.id, name: `${next.name} (${row.academicYear.name})` }, description: `Academic period ${next.name} updated.`, fields });
    });
  } catch (error) {
    if (isUnique(error)) throw nameTaken('period of this year');
    throw error;
  }
  return toPeriod(await findPeriod(getPrisma(), scope, id));
}

export async function setPeriodActive(scope, id, active, user, req) {
  ownerOnly(scope);
  await getPrisma().$transaction(async (tx) => {
    await lockActiveSchool(tx, scope.school);
    const row = await findPeriod(tx, scope, id);
    writableYear(row.academicYear);
    if ((row.status === 'ACTIVE') === active) return;
    if (active) await checkPeriodDates(tx, row.academicYear, { startDate: toDay(row.startDate), endDate: toDay(row.endDate) }, row.id);
    await tx.academicPeriod.update({ where: { id: row.id }, data: { status: active ? 'ACTIVE' : 'INACTIVE' } });
    await renumber(tx, row.academicYearId);
    await audit(tx, scope, user, req, {
      action: active ? AUDIT_ACTIONS.ACADEMIC_PERIOD_REACTIVATED : AUDIT_ACTIONS.ACADEMIC_PERIOD_DEACTIVATED,
      target: { type: 'academic_period', id: row.id, name: `${row.name} (${row.academicYear.name})` },
      description: `Academic period ${row.name} ${active ? 'reactivated' : 'deactivated'}.`,
      fields: [{ field: 'Status', from: active ? 'Inactive' : 'Active', to: active ? 'Active' : 'Inactive' }],
    });
  });
  return toPeriod(await findPeriod(getPrisma(), scope, id));
}

// ---- grading scales -------------------------------------------------------------------------------

const toBand = (b) => ({ id: b.id, label: b.label, minPercent: num(b.minPercent), maxPercent: num(b.maxPercent), points: num(b.points), passes: b.passes, remark: b.remark ?? '' });
const toScale = (s) => ({
  id: s.id,
  name: s.name,
  isDefault: s.isDefault,
  status: status(s.status),
  bands: [...(s.bands ?? [])].sort((a, b) => Number(b.minPercent) - Number(a.minPercent)).map(toBand),
  usedByTypes: s._count?.examTypes ?? 0,
});
const scaleInclude = { bands: true, _count: { select: { examTypes: true } } };
const bandsText = (bands) => bands.map((b) => `${b.label} ${num(b.minPercent)}–${num(b.maxPercent)}${b.passes ? '' : ' (fail)'}`).join(', ');

export async function listScales(scope, { status: s }) {
  const rows = await getPrisma().gradingScale.findMany({ where: { schoolId: scope.school.id, ...statusWhere(s) }, include: scaleInclude, orderBy: [{ isDefault: 'desc' }, { nameKey: 'asc' }] });
  return { items: rows.map(toScale) };
}

async function findScale(client, scope, id) {
  const row = isUuid(id) ? await client.gradingScale.findFirst({ where: { id, schoolId: scope.school.id }, include: scaleInclude }) : null;
  if (!row) throw notFound('Grading scale not found.');
  return row;
}

export async function createScale(scope, values, user, req) {
  ownerOnly(scope);
  try {
    const id = await getPrisma().$transaction(async (tx) => {
      await lockActiveSchool(tx, scope.school);
      const first = !(await tx.gradingScale.count({ where: { schoolId: scope.school.id } }));
      const isDefault = values.isDefault === true || first;
      if (isDefault) await tx.gradingScale.updateMany({ where: { schoolId: scope.school.id, isDefault: true }, data: { isDefault: false } });
      const row = await tx.gradingScale.create({ data: { schoolId: scope.school.id, name: values.name, nameKey: examNameKey(values.name), isDefault, bands: { create: values.bands } } });
      await audit(tx, scope, user, req, {
        action: AUDIT_ACTIONS.GRADING_SCALE_CREATED,
        target: { type: 'grading_scale', id: row.id, name: row.name },
        description: `Grading scale ${row.name} created${isDefault ? ' as the school default' : ''}.`,
        fields: [{ field: 'Grades', from: null, to: bandsText(values.bands) }],
      });
      return row.id;
    });
    return toScale(await findScale(getPrisma(), scope, id));
  } catch (error) {
    if (isUnique(error)) throw nameTaken('grading scale');
    throw error;
  }
}

/** Renames, makes default and/or replaces the grades (as a set; results keep the grade they got). */
export async function updateScale(scope, id, values, user, req) {
  ownerOnly(scope);
  try {
    await getPrisma().$transaction(async (tx) => {
      await lockActiveSchool(tx, scope.school);
      const row = await findScale(tx, scope, id);
      const fields = [];
      const data = {};
      if (values.name !== undefined && values.name !== row.name) {
        fields.push({ field: 'Name', from: row.name, to: values.name });
        Object.assign(data, { name: values.name, nameKey: examNameKey(values.name) });
      }
      if (values.isDefault === true && !row.isDefault) {
        if (row.status !== 'ACTIVE') throw conflict('SCALE_INACTIVE', 'Reactivate the scale before making it the default.');
        await tx.gradingScale.updateMany({ where: { schoolId: scope.school.id, isDefault: true }, data: { isDefault: false } });
        data.isDefault = true;
        fields.push({ field: 'School default', from: 'No', to: 'Yes' });
      } else if (values.isDefault === false && row.isDefault) {
        throw conflict('DEFAULT_REQUIRED', 'Make another scale the default instead; the school always has one.');
      }
      if (values.bands) {
        const before = bandsText(toScale(row).bands.map((b) => ({ ...b })));
        const after = bandsText(values.bands);
        if (before !== after) {
          await tx.gradeBand.deleteMany({ where: { scaleId: row.id } });
          await tx.gradeBand.createMany({ data: values.bands.map((b) => ({ ...b, scaleId: row.id })) });
          fields.push({ field: 'Grades', from: before, to: after });
        }
      }
      if (!fields.length) return;
      if (Object.keys(data).length) await tx.gradingScale.update({ where: { id: row.id }, data });
      await audit(tx, scope, user, req, { action: AUDIT_ACTIONS.GRADING_SCALE_UPDATED, target: { type: 'grading_scale', id: row.id, name: values.name ?? row.name }, description: `Grading scale ${values.name ?? row.name} updated.`, fields });
    });
  } catch (error) {
    if (isUnique(error)) throw nameTaken('grading scale');
    throw error;
  }
  return toScale(await findScale(getPrisma(), scope, id));
}

export async function setScaleActive(scope, id, active, user, req) {
  ownerOnly(scope);
  await getPrisma().$transaction(async (tx) => {
    await lockActiveSchool(tx, scope.school);
    const row = await findScale(tx, scope, id);
    if ((row.status === 'ACTIVE') === active) return;
    if (!active && row.isDefault) throw conflict('DEFAULT_REQUIRED', 'The school default scale cannot be deactivated. Make another scale the default first.');
    if (!active) {
      const used = await tx.examType.count({ where: { gradingScaleId: row.id, status: 'ACTIVE' } });
      if (used) throw conflict('SCALE_IN_USE', `${used} active examination type${used === 1 ? ' uses' : 's use'} this scale. Choose another scale for ${used === 1 ? 'it' : 'them'} first.`);
    }
    await tx.gradingScale.update({ where: { id: row.id }, data: { status: active ? 'ACTIVE' : 'INACTIVE' } });
    await audit(tx, scope, user, req, {
      action: active ? AUDIT_ACTIONS.GRADING_SCALE_REACTIVATED : AUDIT_ACTIONS.GRADING_SCALE_DEACTIVATED,
      target: { type: 'grading_scale', id: row.id, name: row.name },
      description: `Grading scale ${row.name} ${active ? 'reactivated' : 'deactivated'}.`,
      fields: [{ field: 'Status', from: active ? 'Inactive' : 'Active', to: active ? 'Active' : 'Inactive' }],
    });
  });
  return toScale(await findScale(getPrisma(), scope, id));
}

// ---- examination types --------------------------------------------------------------------------

const toType = (t) => ({
  id: t.id,
  name: t.name,
  description: t.description ?? '',
  defaultMaxMarks: t.defaultMaxMarks,
  stopsLessons: t.stopsLessons,
  gradingScale: t.gradingScale ? { id: t.gradingScale.id, name: t.gradingScale.name } : null,
  status: status(t.status),
});
const typeInclude = { gradingScale: { select: { id: true, name: true } } };

export async function listTypes(scope, { status: s }) {
  const rows = await getPrisma().examType.findMany({ where: { schoolId: scope.school.id, ...statusWhere(s) }, include: typeInclude, orderBy: { nameKey: 'asc' } });
  return { items: rows.map(toType) };
}

async function findType(client, scope, id) {
  const row = isUuid(id) ? await client.examType.findFirst({ where: { id, schoolId: scope.school.id }, include: typeInclude }) : null;
  if (!row) throw notFound('Examination type not found.');
  return row;
}

async function checkScale(tx, scope, scaleId) {
  if (!scaleId) return null;
  const scale = await tx.gradingScale.findFirst({ where: { id: scaleId, schoolId: scope.school.id } });
  if (!scale) throw badRequest('Check the highlighted fields.', { gradingScale: 'Grading scale not found.' });
  if (scale.status !== 'ACTIVE') throw badRequest('Check the highlighted fields.', { gradingScale: `${scale.name} is inactive.` });
  return scale;
}

export async function createType(scope, values, user, req) {
  ownerOnly(scope);
  try {
    const id = await getPrisma().$transaction(async (tx) => {
      await lockActiveSchool(tx, scope.school);
      const scale = await checkScale(tx, scope, values.gradingScale);
      const row = await tx.examType.create({
        data: {
          schoolId: scope.school.id,
          name: values.name,
          nameKey: examNameKey(values.name),
          description: values.description ?? null,
          defaultMaxMarks: values.defaultMaxMarks,
          stopsLessons: values.stopsLessons ?? true,
          gradingScaleId: scale?.id ?? null,
        },
      });
      await audit(tx, scope, user, req, {
        action: AUDIT_ACTIONS.EXAM_TYPE_CREATED,
        target: { type: 'exam_type', id: row.id, name: row.name },
        description: `Examination type ${row.name} created.`,
        fields: [
          { field: 'Marks out of', from: null, to: String(row.defaultMaxMarks) },
          { field: 'Stops normal lessons', from: null, to: row.stopsLessons ? 'Yes' : 'No' },
          { field: 'Grading scale', from: null, to: scale?.name ?? 'School default' },
        ],
      });
      return row.id;
    });
    return toType(await findType(getPrisma(), scope, id));
  } catch (error) {
    if (isUnique(error)) throw nameTaken('examination type');
    throw error;
  }
}

export async function updateType(scope, id, values, user, req) {
  ownerOnly(scope);
  try {
    await getPrisma().$transaction(async (tx) => {
      await lockActiveSchool(tx, scope.school);
      const row = await findType(tx, scope, id);
      const fields = [];
      const data = {};
      if (values.name !== undefined && values.name !== row.name) {
        fields.push({ field: 'Name', from: row.name, to: values.name });
        Object.assign(data, { name: values.name, nameKey: examNameKey(values.name) });
      }
      if (values.description !== undefined && (values.description ?? null) !== (row.description ?? null)) {
        fields.push({ field: 'Description', from: row.description ?? '', to: values.description ?? '' });
        data.description = values.description;
      }
      if (values.defaultMaxMarks !== undefined && values.defaultMaxMarks !== row.defaultMaxMarks) {
        fields.push({ field: 'Marks out of', from: String(row.defaultMaxMarks), to: String(values.defaultMaxMarks) });
        data.defaultMaxMarks = values.defaultMaxMarks;
      }
      if (values.stopsLessons !== undefined && values.stopsLessons !== row.stopsLessons) {
        fields.push({ field: 'Stops normal lessons', from: row.stopsLessons ? 'Yes' : 'No', to: values.stopsLessons ? 'Yes' : 'No' });
        data.stopsLessons = values.stopsLessons;
      }
      if (values.gradingScale !== undefined && (values.gradingScale ?? null) !== (row.gradingScaleId ?? null)) {
        const scale = await checkScale(tx, scope, values.gradingScale);
        fields.push({ field: 'Grading scale', from: row.gradingScale?.name ?? 'School default', to: scale?.name ?? 'School default' });
        data.gradingScaleId = scale?.id ?? null;
      }
      if (!fields.length) return;
      await tx.examType.update({ where: { id: row.id }, data });
      await audit(tx, scope, user, req, { action: AUDIT_ACTIONS.EXAM_TYPE_UPDATED, target: { type: 'exam_type', id: row.id, name: values.name ?? row.name }, description: `Examination type ${values.name ?? row.name} updated.`, fields });
    });
  } catch (error) {
    if (isUnique(error)) throw nameTaken('examination type');
    throw error;
  }
  return toType(await findType(getPrisma(), scope, id));
}

export async function setTypeActive(scope, id, active, user, req) {
  ownerOnly(scope);
  await getPrisma().$transaction(async (tx) => {
    await lockActiveSchool(tx, scope.school);
    const row = await findType(tx, scope, id);
    if ((row.status === 'ACTIVE') === active) return;
    if (active && row.gradingScaleId) await checkScale(tx, scope, row.gradingScaleId);
    await tx.examType.update({ where: { id: row.id }, data: { status: active ? 'ACTIVE' : 'INACTIVE' } });
    await audit(tx, scope, user, req, {
      action: active ? AUDIT_ACTIONS.EXAM_TYPE_REACTIVATED : AUDIT_ACTIONS.EXAM_TYPE_DEACTIVATED,
      target: { type: 'exam_type', id: row.id, name: row.name },
      description: `Examination type ${row.name} ${active ? 'reactivated' : 'deactivated'}.`,
      fields: [{ field: 'Status', from: active ? 'Inactive' : 'Active', to: active ? 'Active' : 'Inactive' }],
    });
  });
  return toType(await findType(getPrisma(), scope, id));
}

// ---- result formula ---------------------------------------------------------------------------------

const METHOD_TEXT = { WEIGHTED: 'Weighted by examination type', AVERAGE: 'Average of the year’s examinations', LAST: 'The year’s last examination' };

/** A year's result formula (default the current year): { academicYear, formula | null, types, periods }. */
export async function getFormula(scope, { academicYear }) {
  const prisma = getPrisma();
  const year = await findYear(prisma, scope, academicYear);
  if (!year) return { academicYear: null, formula: null, types: [], periods: [] };
  const [formula, types, periods] = await Promise.all([
    prisma.resultFormula.findUnique({ where: { academicYearId: year.id } }),
    prisma.examType.findMany({ where: { schoolId: scope.school.id, status: 'ACTIVE' }, orderBy: { nameKey: 'asc' }, select: { id: true, name: true } }),
    prisma.academicPeriod.findMany({ where: { academicYearId: year.id, status: 'ACTIVE' }, orderBy: { startDate: 'asc' }, select: { id: true, name: true } }),
  ]);
  return {
    academicYear: toYear(year),
    formula: formula && { method: formula.method, typeWeights: formula.typeWeights, periodWeights: formula.periodWeights, updatedAt: formula.updatedAt.toISOString(), updatedBy: formula.updatedByName ?? null },
    types,
    periods,
  };
}

/** Sets a year's formula (School Owner; not for a closed year). Weights must name active types / periods of the school and year. */
export async function saveFormula(scope, yearValue, values, user, req) {
  ownerOnly(scope);
  await getPrisma().$transaction(async (tx) => {
    await lockActiveSchool(tx, scope.school);
    const year = await findYear(tx, scope, yearValue);
    if (!year) throw notFound('There is no current academic year.');
    writableYear(year);
    const [types, periods] = await Promise.all([
      tx.examType.findMany({ where: { schoolId: scope.school.id, status: 'ACTIVE' }, select: { id: true, name: true } }),
      tx.academicPeriod.findMany({ where: { academicYearId: year.id, status: 'ACTIVE' }, select: { id: true, name: true } }),
    ]);
    const typeName = new Map(types.map((t) => [t.id, t.name]));
    const periodName = new Map(periods.map((p) => [p.id, p.name]));
    const details = {};
    values.typeWeights.forEach((w, i) => !typeName.has(w.examTypeId) && (details[`typeWeights.${i}`] = 'Not an active examination type.'));
    values.periodWeights.forEach((w, i) => !periodName.has(w.periodId) && (details[`periodWeights.${i}`] = `Not an active period of ${year.name}.`));
    if (Object.keys(details).length) throw badRequest('Check the highlighted fields.', details);
    const before = await tx.resultFormula.findUnique({ where: { academicYearId: year.id } });
    const text = (f) =>
      f ? `${METHOD_TEXT[f.method]}${f.typeWeights.length ? `: ${f.typeWeights.map((w) => `${typeName.get(w.examTypeId) ?? '?'} ${w.weight}%`).join(', ')}` : ''}${f.periodWeights.length ? `; periods ${f.periodWeights.map((w) => `${periodName.get(w.periodId) ?? '?'} ${w.weight}%`).join(', ')}` : ''}` : 'Not set';
    const from = text(before);
    const to = text(values);
    if (from === to) return;
    const data = { method: values.method, typeWeights: values.typeWeights, periodWeights: values.periodWeights, updatedById: user.id, updatedByName: user.name };
    if (before) await tx.resultFormula.update({ where: { id: before.id }, data });
    else await tx.resultFormula.create({ data: { schoolId: scope.school.id, academicYearId: year.id, ...data } });
    await audit(tx, scope, user, req, { action: AUDIT_ACTIONS.RESULT_FORMULA_CHANGED, target: { type: 'academic_year', id: year.id, name: year.name }, description: `Final result calculation for ${year.name} changed.`, fields: [{ field: 'Calculation', from, to }] });
  });
  return getFormula(scope, { academicYear: yearValue });
}

// ---- overview ---------------------------------------------------------------------------------------

/**
 * The Examinations overview: whether the module is on for the school, the current year, and the
 * setup checklist (periods, types, default grading scale, result formula, rooms of the branch or school).
 */
export async function getExamOverview(scope) {
  const prisma = getPrisma();
  const [school, year] = await Promise.all([
    prisma.school.findUnique({ where: { id: scope.school.id }, select: { examinationsEnabled: true } }),
    prisma.academicYear.findFirst({ where: { schoolId: scope.school.id, status: 'CURRENT' } }),
  ]);
  const roomWhere = { schoolId: scope.school.id, status: 'ACTIVE', ...(scope.branch && { branchId: scope.branch.id }) };
  const [periods, types, defaultScale, formula, rooms, seats, examinations] = await Promise.all([
    year ? prisma.academicPeriod.count({ where: { academicYearId: year.id, status: 'ACTIVE' } }) : 0,
    prisma.examType.count({ where: { schoolId: scope.school.id, status: 'ACTIVE' } }),
    prisma.gradingScale.findFirst({ where: { schoolId: scope.school.id, isDefault: true, status: 'ACTIVE' }, select: { id: true, name: true } }),
    year ? prisma.resultFormula.findUnique({ where: { academicYearId: year.id }, select: { method: true } }) : null,
    prisma.examRoom.count({ where: roomWhere }),
    prisma.examRoom.aggregate({ where: roomWhere, _sum: { defaultCapacity: true } }),
    examinationSummary(scope, year?.id ?? null, prisma),
  ]);
  const step = (key, label, done, note, page) => ({ key, label, done, note, page });
  return {
    featureEnabled: school?.examinationsEnabled === true,
    academicYear: toYear(year),
    counts: { periods, types, rooms, seats: seats._sum.defaultCapacity ?? 0 },
    // The current year's examinations by state, and the one running (else the next planned one).
    examinations: { draft: examinations.draft, planned: examinations.planned, active: examinations.active, completed: examinations.completed },
    current: examinations.current,
    setup: [
      step('year', 'Current academic year', Boolean(year), year ? year.name : 'Start an academic year first', 'academic-years'),
      step('periods', 'Academic periods', periods > 0, periods ? `${periods} period${periods === 1 ? '' : 's'} in ${year.name}` : 'Add the terms or semesters of the year', 'types'),
      step('types', 'Examination types', types > 0, types ? `${types} active type${types === 1 ? '' : 's'}` : 'Add Mid-Term, Final…', 'types'),
      step('grading', 'Grading scale', Boolean(defaultScale), defaultScale ? `${defaultScale.name} is the default` : 'Add the school’s grading scale', 'settings'),
      step('formula', 'Final result calculation', Boolean(formula), formula ? METHOD_TEXT[formula.method] : 'Set how the year’s final result is calculated', 'settings'),
      step('rooms', 'Examination rooms', rooms > 0, rooms ? `${rooms} room${rooms === 1 ? '' : 's'}, ${seats._sum.defaultCapacity ?? 0} seats` : 'Add the rooms used for examinations', 'rooms'),
    ],
  };
}

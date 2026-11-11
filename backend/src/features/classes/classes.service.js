import { Prisma } from '@prisma/client';
import { conflict, notFound } from '../../common/httpError.js';
import { fromDbStatus } from '../../common/listQuery.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockActiveSchool, operatingState } from '../branches/branches.service.js';
import { classNameKey, sectionDisplayName } from './classInput.js';

/*
 * Classes and sections (approved rules: docs/business-rules.md → Classes and sections).
 *
 * A class (e.g. "Grade 7") is permanent and belongs to a school: the School Owner creates, edits,
 * deactivates and reactivates it; Managers read it. A section (e.g. "A" → "Grade 7A") belongs to one
 * class, one academic year and one branch of the same school: the School Owner manages sections of
 * any branch of the school, a Manager those of their own branch only. Nothing is deleted.
 *
 * Every function takes `scope`, decided by the server from the signed-in account, never from the
 * request: { school: { id, … }, branch: null } for an Owner (requireOwnerSchool) or
 * { school, branch: { id, … } } for a Manager (requireManagerBranch). Ids from the request (class,
 * year, branch, section) are only ever looked up inside that scope; anything outside it is reported
 * exactly like something that does not exist (404).
 *
 * Writes run in one transaction with a per-school advisory lock (changes to one school's classes and
 * sections run one at a time) and the school row locked, which must be ACTIVE (409 SCHOOL_SUSPENDED);
 * a Manager's branch must also be operating (409 BRANCH_NOT_OPERATING). Each change and its audit
 * event are written together; unchanged submissions write and record nothing.
 */

export const CLASS_STATUSES = ['active', 'inactive'];

const isUniqueViolation = (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
const mentions = (error, text) => {
  try {
    return `${error?.message ?? ''} ${JSON.stringify(error?.meta ?? {})}`.includes(text);
  } catch {
    return false;
  }
};

const CLASS_NAME_TAKEN = () =>
  conflict('NAME_TAKEN', 'A class with this name already exists in your school. Choose another name.', {
    name: 'A class with this name already exists in your school (names are compared without regard to capitalization).',
  });
const SEQUENCE_TAKEN = (other) =>
  conflict('SEQUENCE_TAKEN', other ? `Order ${other.sequence} is already used by ${other.name}. Choose another number.` : 'This order is already used by another class.', {
    sequence: other ? `Already used by ${other.name}.` : 'Already used by another class.',
  });
const SECTION_NAME_TAKEN = () =>
  conflict('NAME_TAKEN', 'This class already has a section with this name in this academic year and branch.', {
    name: 'Already used in this class, academic year and branch (compared without regard to capitalization).',
  });
const YEAR_CLOSED = (year) =>
  conflict('YEAR_CLOSED', `${year.name} is closed. Its sections are kept as they are and cannot be added to or changed.`);
const CLASS_INACTIVE = (cls) => conflict('CLASS_INACTIVE', `${cls.name} is inactive. Reactivate the class before adding or reactivating its sections.`);
const INVALID_STATUS = (message) => conflict('INVALID_STATUS', message);

function translateDbError(error, kind) {
  if (isUniqueViolation(error)) {
    if (kind === 'class' && mentions(error, 'sequence')) return SEQUENCE_TAKEN(null);
    if (kind === 'class') return CLASS_NAME_TAKEN();
    return SECTION_NAME_TAKEN();
  }
  return error;
}

/** A Manager's writes need their branch and school ACTIVE (409 BRANCH_NOT_OPERATING), as for schedules and staff. */
async function lockOperatingBranch(tx, scope) {
  const [school] = await tx.$queryRaw`SELECT "status"::text AS "status" FROM "School" WHERE "id" = ${scope.school.id} FOR SHARE`;
  const [branch] = await tx.$queryRaw`SELECT "status"::text AS "status" FROM "Branch" WHERE "id" = ${scope.branch.id} FOR SHARE`;
  const { operating, reasons } = operatingState(branch ?? { status: 'SUSPENDED' }, school ?? { status: 'SUSPENDED' });
  if (!operating) {
    const whose = reasons.includes('school_suspended') ? 'Your school is suspended' : 'Your branch is suspended';
    throw conflict('BRANCH_NOT_OPERATING', `${whose}. Its classes and sections can be viewed but not changed until it is reactivated.`, { reasons });
  }
}

/** Runs `work(tx)` with the school's classes and sections locked and the school (and a Manager's branch) writable. */
async function withLock(scope, kind, work) {
  try {
    return await getPrisma().$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`classes:${scope.school.id}`}))`;
      if (scope.branch) await lockOperatingBranch(tx, scope);
      else await lockActiveSchool(tx, scope.school);
      return work(tx);
    });
  } catch (error) {
    throw translateDbError(error, kind);
  }
}

// ---- shapes ---------------------------------------------------------------------------------

const day = (date) => date.toISOString().slice(0, 10);
const toYear = (y) => y && { id: y.id, name: y.name, status: y.status.toLowerCase(), startDate: day(y.startDate), endDate: day(y.endDate) };

export const toClass = (c, extra = {}) => ({
  id: c.id,
  name: c.name,
  description: c.description ?? '',
  sequence: c.sequence,
  status: fromDbStatus(c.status),
  deactivatedAt: c.deactivatedAt?.toISOString() ?? null,
  createdAt: c.createdAt.toISOString(),
  ...extra,
});

const sectionInclude = {
  class: { select: { id: true, name: true, sequence: true, status: true } },
  branch: { select: { id: true, name: true, code: true, status: true } },
  academicYear: true,
};

/** The section shape the web app uses; `displayName` is what pickers show (e.g. "Grade 7A"). */
export const toSection = (s) => ({
  id: s.id,
  name: s.name,
  displayName: sectionDisplayName(s.class.name, s.name),
  capacity: s.capacity,
  room: s.room ?? '',
  status: fromDbStatus(s.status),
  deactivatedAt: s.deactivatedAt?.toISOString() ?? null,
  createdAt: s.createdAt.toISOString(),
  class: { id: s.class.id, name: s.class.name, sequence: s.class.sequence, status: fromDbStatus(s.class.status) },
  branch: { id: s.branch.id, name: s.branch.name, code: s.branch.code, status: fromDbStatus(s.branch.status) },
  academicYear: toYear(s.academicYear),
  // Sections of a closed year are kept for history and are read only.
  readOnly: s.academicYear.status === 'CLOSED',
});

const bySequenceThenName = (a, b) => a.class.sequence - b.class.sequence || a.name.localeCompare(b.name, 'en', { numeric: true }) || a.branch.code.localeCompare(b.branch.code);

// ---- lookups inside the scope ---------------------------------------------------------------

async function findClass(client, scope, id) {
  const cls = isUuid(id) ? await client.schoolClass.findFirst({ where: { id, schoolId: scope.school.id } }) : null;
  if (!cls) throw notFound('Class not found.');
  return cls;
}

async function findYear(client, scope, id) {
  const year = isUuid(id) ? await client.academicYear.findFirst({ where: { id, schoolId: scope.school.id } }) : null;
  if (!year) throw notFound('Academic year not found.');
  return year;
}

/** The branch a section is for: a Manager's own branch, or (Owner) a branch of the school. */
async function findBranch(client, scope, id) {
  if (scope.branch) return client.branch.findUnique({ where: { id: scope.branch.id } });
  const branch = isUuid(id) ? await client.branch.findFirst({ where: { id, schoolId: scope.school.id } }) : null;
  if (!branch) throw notFound('Branch not found.');
  return branch;
}

async function findSection(client, scope, id) {
  const where = { id, schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) };
  const section = isUuid(id) ? await client.section.findFirst({ where, include: sectionInclude }) : null;
  // A section of another school, or (Manager) of another branch, is reported like one that does not exist.
  if (!section) throw notFound('Section not found.');
  return section;
}

/**
 * The academic year a list is for: the requested one (in the school), else the current one, else the
 * newest; null when the school has no years.
 */
export async function resolveYear(scope, id, client = getPrisma()) {
  if (id) return findYear(client, scope, id);
  return (
    (await client.academicYear.findFirst({ where: { schoolId: scope.school.id, status: 'CURRENT' } })) ??
    (await client.academicYear.findFirst({ where: { schoolId: scope.school.id }, orderBy: { startDate: 'desc' } }))
  );
}

/** The branch filter of a read: a Manager's own branch; an Owner's chosen branch (checked) or all. */
async function branchFilter(client, scope, branchId) {
  if (scope.branch) return scope.branch.id;
  if (!branchId) return undefined;
  return (await findBranch(client, scope, branchId)).id;
}

// ---- reads ------------------------------------------------------------------------------------

/**
 * The school's classes in progression order, each with its sections in the academic year (all
 * branches for an Owner, or one chosen branch; a Manager's own branch): { academicYear, items }.
 * Inactive classes are listed for Owners only (Managers see the classes they can add sections to,
 * plus inactive ones that still have sections in the year).
 */
export async function listClasses(scope, { academicYear, branch, q, status }) {
  const prisma = getPrisma();
  const year = await resolveYear(scope, academicYear, prisma);
  const branchId = await branchFilter(prisma, scope, branch);
  const where = {
    schoolId: scope.school.id,
    ...(q && { name: { contains: q, mode: 'insensitive' } }),
    ...(status && { status: status === 'active' ? 'ACTIVE' : 'INACTIVE' }),
  };
  const [classes, counts] = await Promise.all([
    prisma.schoolClass.findMany({ where, orderBy: { sequence: 'asc' } }),
    year
      ? prisma.section.groupBy({
          by: ['classId', 'status'],
          where: { schoolId: scope.school.id, academicYearId: year.id, ...(branchId && { branchId }) },
          _count: { _all: true },
          _sum: { capacity: true },
        })
      : [],
  ]);
  const countsOf = (classId) => {
    const rows = counts.filter((c) => c.classId === classId);
    const active = rows.find((r) => r.status === 'ACTIVE');
    return {
      sections: active?._count._all ?? 0,
      inactiveSections: rows.find((r) => r.status === 'INACTIVE')?._count._all ?? 0,
      capacity: active?._sum.capacity ?? null,
    };
  };
  const items = classes
    .map((c) => toClass(c, countsOf(c.id)))
    .filter((c) => !scope.branch || c.status === 'active' || c.sections + c.inactiveSections > 0);
  return { academicYear: toYear(year), items };
}

/** One class with its sections in the academic year (scope and optional Owner branch filter as listClasses). */
export async function getClass(scope, id, { academicYear, branch }) {
  const prisma = getPrisma();
  const cls = await findClass(prisma, scope, id);
  const year = await resolveYear(scope, academicYear, prisma);
  const branchId = await branchFilter(prisma, scope, branch);
  const sections = year
    ? await prisma.section.findMany({ where: { classId: cls.id, academicYearId: year.id, ...(branchId && { branchId }) }, include: sectionInclude })
    : [];
  return { class: toClass(cls), academicYear: toYear(year), sections: sections.map(toSection).sort(bySequenceThenName) };
}

/**
 * Sections of the academic year in scope, in class order then name — also the list a section picker
 * uses ("Grade 7A", "Grade 7B", "Grade 8A", …): `status: 'active'` gives the sections that can be chosen.
 */
export async function listSections(scope, { academicYear, branch, classId, status, q }) {
  const prisma = getPrisma();
  const year = await resolveYear(scope, academicYear, prisma);
  if (!year) return { academicYear: null, items: [] };
  const branchId = await branchFilter(prisma, scope, branch);
  if (classId) await findClass(prisma, scope, classId);
  const rows = await prisma.section.findMany({
    where: {
      schoolId: scope.school.id,
      academicYearId: year.id,
      ...(branchId && { branchId }),
      ...(classId && { classId }),
      ...(status && { status: status === 'active' ? 'ACTIVE' : 'INACTIVE' }),
    },
    include: sectionInclude,
  });
  const needle = q?.toLowerCase();
  const items = rows
    .map(toSection)
    .filter((s) => !needle || s.displayName.toLowerCase().includes(needle))
    .sort(bySequenceThenName);
  return { academicYear: toYear(year), items };
}

export async function getSection(scope, id) {
  return toSection(await findSection(getPrisma(), scope, id));
}

// ---- audit values -----------------------------------------------------------------------------

const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });
const classTarget = (c) => ({ type: 'class', id: c.id, name: c.name });
const sectionTarget = (s) => ({ type: 'section', id: s.id, name: `${sectionDisplayName(s.class.name, s.name)} · ${s.academicYear.name} · ${s.branch.code}` });
const CLASS_LABELS = { name: 'Name', description: 'Description', sequence: 'Order' };
const SECTION_LABELS = { name: 'Section name', capacity: 'Capacity', room: 'Room' };
const shown = (value) => (value === null || value === undefined || value === '' ? 'Not set' : String(value));

function audit(tx, action, target, { scope, user, req, description, fields }) {
  return recordAuditEvent({ client: tx, action, actor: actorOf(user), target, schoolId: scope.school.id, description, change: { fields }, req });
}

// ---- class changes (School Owner) ---------------------------------------------------------------

async function sequenceOwner(tx, scope, sequence, exceptId) {
  return tx.schoolClass.findFirst({ where: { schoolId: scope.school.id, sequence, ...(exceptId && { id: { not: exceptId } }) } });
}

export async function createClass(scope, values, user, req) {
  const created = await withLock(scope, 'class', async (tx) => {
    const other = await sequenceOwner(tx, scope, values.sequence);
    if (other) throw SEQUENCE_TAKEN(other);
    const cls = await tx.schoolClass.create({ data: { schoolId: scope.school.id, ...values, nameKey: classNameKey(values.name) } });
    await audit(tx, AUDIT_ACTIONS.CLASS_CREATED, classTarget(cls), {
      scope,
      user,
      req,
      description: `Class ${cls.name} created (order ${cls.sequence}).`,
      fields: [{ field: 'Status', from: null, to: 'Active' }, ...Object.keys(CLASS_LABELS).map((f) => ({ field: CLASS_LABELS[f], from: null, to: shown(cls[f]) }))],
    });
    return cls;
  });
  return toClass(created);
}

/** Edits name, description and order. Unchanged values are ignored; nothing changed → no event. */
export async function updateClass(scope, id, values, user, req) {
  const result = await withLock(scope, 'class', async (tx) => {
    const current = await findClass(tx, scope, id);
    const changed = Object.keys(values).filter((f) => (current[f] ?? null) !== values[f]);
    if (!changed.length) return current;
    if (changed.includes('sequence')) {
      const other = await sequenceOwner(tx, scope, values.sequence, current.id);
      if (other) throw SEQUENCE_TAKEN(other);
    }
    const data = Object.fromEntries(changed.map((f) => [f, values[f]]));
    if (data.name) data.nameKey = classNameKey(data.name);
    const updated = await tx.schoolClass.update({ where: { id: current.id }, data });
    await audit(tx, AUDIT_ACTIONS.CLASS_UPDATED, classTarget(updated), {
      scope,
      user,
      req,
      description: `Class ${updated.name} updated: ${changed.map((f) => CLASS_LABELS[f]).join(', ')}.`,
      fields: changed.map((f) => ({ field: CLASS_LABELS[f], from: shown(current[f]), to: shown(updated[f]) })),
    });
    return updated;
  });
  return toClass(result);
}

/**
 * ACTIVE → INACTIVE. Refused while the class has active sections in a planned or current academic
 * year (409 CLASS_IN_USE): deactivate those first. Sections of closed years stay as history.
 */
export async function deactivateClass(scope, id, user, req) {
  const result = await withLock(scope, 'class', async (tx) => {
    const current = await findClass(tx, scope, id);
    if (current.status === 'INACTIVE') throw INVALID_STATUS(`${current.name} is already inactive.`);
    const inUse = await tx.section.count({ where: { classId: current.id, status: 'ACTIVE', academicYear: { status: { in: ['PLANNED', 'CURRENT'] } } } });
    if (inUse) {
      throw conflict(
        'CLASS_IN_USE',
        `${current.name} has ${inUse} active section${inUse === 1 ? '' : 's'} in a planned or current academic year. Deactivate ${inUse === 1 ? 'it' : 'them'} first.`,
        { sections: inUse },
      );
    }
    const updated = await tx.schoolClass.update({ where: { id: current.id }, data: { status: 'INACTIVE', deactivatedAt: new Date() } });
    await audit(tx, AUDIT_ACTIONS.CLASS_DEACTIVATED, classTarget(updated), {
      scope,
      user,
      req,
      description: `Class ${updated.name} deactivated. Its sections and history are kept.`,
      fields: [{ field: 'Status', from: 'Active', to: 'Inactive' }],
    });
    return updated;
  });
  return toClass(result);
}

export async function reactivateClass(scope, id, user, req) {
  const result = await withLock(scope, 'class', async (tx) => {
    const current = await findClass(tx, scope, id);
    if (current.status === 'ACTIVE') throw INVALID_STATUS(`${current.name} is already active.`);
    const updated = await tx.schoolClass.update({ where: { id: current.id }, data: { status: 'ACTIVE', deactivatedAt: null } });
    await audit(tx, AUDIT_ACTIONS.CLASS_REACTIVATED, classTarget(updated), {
      scope,
      user,
      req,
      description: `Class ${updated.name} reactivated.`,
      fields: [{ field: 'Status', from: 'Inactive', to: 'Active' }],
    });
    return updated;
  });
  return toClass(result);
}

// ---- section changes (School Owner: any branch of the school; Manager: own branch) ---------------

/** Creates an ACTIVE section for an active class in a planned or current year of the school. */
export async function createSection(scope, values, user, req) {
  const created = await withLock(scope, 'section', async (tx) => {
    const cls = await findClass(tx, scope, values.classId);
    const year = await findYear(tx, scope, values.academicYearId);
    const branch = await findBranch(tx, scope, values.branchId);
    if (cls.status !== 'ACTIVE') throw CLASS_INACTIVE(cls);
    if (year.status === 'CLOSED') throw YEAR_CLOSED(year);
    const section = await tx.section.create({
      data: {
        schoolId: scope.school.id,
        branchId: branch.id,
        classId: cls.id,
        academicYearId: year.id,
        name: values.name,
        nameKey: classNameKey(values.name),
        capacity: values.capacity,
        room: values.room,
      },
      include: sectionInclude,
    });
    await audit(tx, AUDIT_ACTIONS.SECTION_CREATED, sectionTarget(section), {
      scope,
      user,
      req,
      description: `Section ${sectionDisplayName(cls.name, section.name)} created for ${year.name} at ${branch.name} (${branch.code}).`,
      fields: [
        { field: 'Class', from: null, to: cls.name },
        { field: 'Academic year', from: null, to: year.name },
        { field: 'Branch', from: null, to: `${branch.name} (${branch.code})` },
        ...Object.keys(SECTION_LABELS).map((f) => ({ field: SECTION_LABELS[f], from: null, to: shown(section[f]) })),
      ],
    });
    return section;
  });
  return toSection(created);
}

/** Edits name, capacity and room. Sections of a closed year are read only (409 YEAR_CLOSED). */
export async function updateSection(scope, id, values, user, req) {
  const result = await withLock(scope, 'section', async (tx) => {
    const current = await findSection(tx, scope, id);
    if (current.academicYear.status === 'CLOSED') throw YEAR_CLOSED(current.academicYear);
    const changed = Object.keys(values).filter((f) => (current[f] ?? null) !== values[f]);
    if (!changed.length) return current;
    const data = Object.fromEntries(changed.map((f) => [f, values[f]]));
    if (data.name) data.nameKey = classNameKey(data.name);
    const updated = await tx.section.update({ where: { id: current.id }, data, include: sectionInclude });
    await audit(tx, AUDIT_ACTIONS.SECTION_UPDATED, sectionTarget(updated), {
      scope,
      user,
      req,
      description: `Section ${sectionDisplayName(updated.class.name, updated.name)} updated: ${changed.map((f) => SECTION_LABELS[f]).join(', ')}.`,
      fields: changed.map((f) => ({ field: SECTION_LABELS[f], from: shown(current[f]), to: shown(updated[f]) })),
    });
    return updated;
  });
  return toSection(result);
}

async function setSectionStatus(scope, id, user, req, active) {
  const result = await withLock(scope, 'section', async (tx) => {
    const current = await findSection(tx, scope, id);
    if (current.academicYear.status === 'CLOSED') throw YEAR_CLOSED(current.academicYear);
    const label = sectionDisplayName(current.class.name, current.name);
    if ((current.status === 'ACTIVE') === active) throw INVALID_STATUS(`${label} is already ${active ? 'active' : 'inactive'}.`);
    if (active && current.class.status !== 'ACTIVE') throw CLASS_INACTIVE(current.class);
    const updated = await tx.section.update({
      where: { id: current.id },
      data: active ? { status: 'ACTIVE', deactivatedAt: null } : { status: 'INACTIVE', deactivatedAt: new Date() },
      include: sectionInclude,
    });
    await audit(tx, active ? AUDIT_ACTIONS.SECTION_REACTIVATED : AUDIT_ACTIONS.SECTION_DEACTIVATED, sectionTarget(updated), {
      scope,
      user,
      req,
      description: active ? `Section ${label} reactivated.` : `Section ${label} deactivated. Its history is kept.`,
      fields: [{ field: 'Status', from: active ? 'Inactive' : 'Active', to: active ? 'Active' : 'Inactive' }],
    });
    return updated;
  });
  return toSection(result);
}

export const deactivateSection = (scope, id, user, req) => setSectionStatus(scope, id, user, req, false);
export const reactivateSection = (scope, id, user, req) => setSectionStatus(scope, id, user, req, true);

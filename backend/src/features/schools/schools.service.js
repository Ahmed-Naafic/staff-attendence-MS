import { Prisma } from '@prisma/client';
import { conflict, notFound } from '../../common/httpError.js';
import { fromDbStatus, pageWindow, SCHOOL_STATUSES, statusSummary, toDbStatus } from '../../common/listQuery.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { codePrefix } from './schoolInput.js';

const schoolSelect = {
  id: true,
  code: true,
  name: true,
  location: true,
  status: true,
  registeredAt: true,
  description: true,
  phone: true,
  email: true,
  address: true,
  website: true,
  suspensionReason: true,
  suspendedAt: true,
  owner: { select: { id: true, name: true } },
};

/** The school shape the web app uses. City is stored as `location`. */
export const toSchool = (school) => ({
  id: school.id,
  code: school.code,
  name: school.name,
  ownerName: school.owner?.name ?? null,
  ownerId: school.owner?.id ?? null,
  location: school.location,
  status: fromDbStatus(school.status),
  registeredAt: school.registeredAt.toISOString(),
  description: school.description ?? '',
  phone: school.phone ?? '',
  email: school.email ?? '',
  address: school.address ?? '',
  website: school.website ?? '',
  suspensionReason: school.suspensionReason ?? null,
  suspendedAt: school.suspendedAt?.toISOString() ?? null,
});

/** Search (name, code, owner, location), status, location, registration-date and no-owner filters, newest first. */
export async function listSchools({ q, status, location, registeredSince, withoutOwner = false, page, pageSize }) {
  const prisma = getPrisma();
  const contains = (value) => ({ contains: value, mode: 'insensitive' });
  const where = {
    ...(q && { OR: [{ name: contains(q) }, { code: contains(q) }, { location: contains(q) }, { owner: { name: contains(q) } }] }),
    ...(status && { status: toDbStatus(status) }),
    ...(location && { location }),
    ...(registeredSince && { registeredAt: { gte: registeredSince } }),
    ...(withoutOwner && { ownerId: null }),
  };

  const [total, groups, locations] = await Promise.all([
    prisma.school.count({ where }),
    prisma.school.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.school.findMany({ distinct: ['location'], select: { location: true }, orderBy: { location: 'asc' } }),
  ]);
  const { skip, take, meta } = pageWindow(total, page, pageSize);
  const rows = await prisma.school.findMany({ where, select: schoolSelect, orderBy: [{ registeredAt: 'desc' }, { id: 'asc' }], skip, take });

  return {
    items: rows.map(toSchool),
    ...meta,
    summary: statusSummary(groups, SCHOOL_STATUSES),
    locations: locations.map((l) => l.location),
  };
}

export async function getSchool(id) {
  return toSchool(await findOrFail(getPrisma(), id));
}

/*
 * School Management (approved rules): Super Admins register schools (they start ACTIVE), edit
 * them (never the code), suspend them with a reason and reactivate them. There is no approval,
 * rejection or deletion. Each change and its audit event are written in one transaction, so an
 * audit event exists only when the change succeeded.
 */

const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });
const auditTarget = (school) => ({ type: 'school', id: school.id, name: school.name });

// API field names → database columns (City is stored as `location`).
const toColumns = ({ city, ...rest }) => ({ ...rest, ...(city !== undefined && { location: city }) });
const currentValue = (school, field) => (field === 'city' ? school.location : (school[field] ?? null));

const isUniqueViolation = (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

async function findOrFail(client, id) {
  const school = isUuid(id) ? await client.school.findUnique({ where: { id }, select: schoolSelect }) : null;
  if (!school) throw notFound('School not found.');
  return school;
}

/** The next free code for a name's prefix, e.g. "Jamhuriya Academy" → JHA-001 (or JHA-002…). */
export async function suggestCode(name) {
  const prefix = codePrefix(name);
  const rows = await getPrisma().school.findMany({ where: { code: { startsWith: `${prefix}-` } }, select: { code: true } });
  const numbers = rows.map((r) => /^[A-Z]+-(\d+)$/.exec(r.code)?.[1]).filter(Boolean).map(Number);
  return `${prefix}-${String(Math.max(0, ...numbers) + 1).padStart(3, '0')}`;
}

/** Registers a school; it starts ACTIVE. A code already in use → 409 CODE_TAKEN. */
export async function registerSchool(values, user, req) {
  try {
    const school = await getPrisma().$transaction(async (tx) => {
      const created = await tx.school.create({ data: { ...toColumns(values), status: 'ACTIVE' }, select: schoolSelect });
      await recordAuditEvent({
        client: tx,
        action: AUDIT_ACTIONS.SCHOOL_CREATED,
        actor: actorOf(user),
        target: auditTarget(created),
        schoolId: created.id,
        description: `School registered with code ${created.code} in ${created.location}.`,
        change: { field: 'Status', from: null, to: 'Active' },
        req,
      });
      return created;
    });
    return toSchool(school);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict('CODE_TAKEN', 'This School Code is already in use. Choose another code.', { code: 'This School Code is already in use.' });
    }
    throw error;
  }
}

/** Updates editable fields (never the code). Unchanged values are ignored; no change → no audit event. */
export async function updateSchool(id, values, user, req) {
  const school = await getPrisma().$transaction(async (tx) => {
    const current = await findOrFail(tx, id);
    const changed = Object.keys(values).filter((field) => currentValue(current, field) !== values[field]);
    if (!changed.length) return current;
    const updated = await tx.school.update({ where: { id: current.id }, data: toColumns(values), select: schoolSelect });
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.SCHOOL_UPDATED,
      actor: actorOf(user),
      target: auditTarget(updated),
      schoolId: updated.id,
      // Field names only: the values themselves stay in the school record.
      description: `School details updated: ${changed.join(', ')}.`,
      req,
    });
    return updated;
  });
  return toSchool(school);
}

/** ACTIVE → SUSPENDED with a reason. Already suspended → 409 INVALID_STATUS. */
export async function suspendSchool(id, reason, user, req) {
  const school = await getPrisma().$transaction(async (tx) => {
    const current = await findOrFail(tx, id);
    // Conditional update: two simultaneous requests cannot both suspend.
    const { count } = await tx.school.updateMany({
      where: { id: current.id, status: 'ACTIVE' },
      data: { status: 'SUSPENDED', suspensionReason: reason, suspendedAt: new Date() },
    });
    if (count === 0) throw conflict('INVALID_STATUS', 'Only an active school can be suspended. This school is already suspended.');
    const updated = await findOrFail(tx, current.id);
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.SCHOOL_SUSPENDED,
      actor: actorOf(user),
      target: auditTarget(updated),
      schoolId: updated.id,
      description: `School suspended. Reason: ${reason}`,
      change: { field: 'Status', from: 'Active', to: 'Suspended' },
      req,
    });
    return updated;
  });
  return toSchool(school);
}

/** SUSPENDED → ACTIVE. Already active → 409 INVALID_STATUS. */
export async function reactivateSchool(id, user, req) {
  const school = await getPrisma().$transaction(async (tx) => {
    const current = await findOrFail(tx, id);
    const { count } = await tx.school.updateMany({
      where: { id: current.id, status: 'SUSPENDED' },
      data: { status: 'ACTIVE', suspensionReason: null, suspendedAt: null },
    });
    if (count === 0) throw conflict('INVALID_STATUS', 'Only a suspended school can be reactivated. This school is already active.');
    const updated = await findOrFail(tx, current.id);
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.SCHOOL_REACTIVATED,
      actor: actorOf(user),
      target: auditTarget(updated),
      schoolId: updated.id,
      description: 'School reactivated.',
      change: { field: 'Status', from: 'Suspended', to: 'Active' },
      req,
    });
    return updated;
  });
  return toSchool(school);
}

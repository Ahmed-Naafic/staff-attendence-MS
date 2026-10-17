import { Prisma } from '@prisma/client';
import { badRequest, conflict, notFound } from '../../common/httpError.js';
import { OWNER_STATUSES, fromDbStatus, pageWindow, statusSummary, toDbStatus } from '../../common/listQuery.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { hashPassword } from '../auth/password.js';

const ownerSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  status: true,
  suspensionReason: true,
  suspendedAt: true,
  createdAt: true,
  lastSignInAt: true,
  ownedSchool: { select: { id: true, code: true, name: true, location: true, status: true, registeredAt: true } },
};

/** The owner shape the web app uses. Never includes password hashes or sessions. */
export const toOwner = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email ?? '',
  phone: user.phone ?? '',
  status: fromDbStatus(user.status),
  suspensionReason: user.suspensionReason ?? null,
  suspendedAt: user.suspendedAt?.toISOString() ?? null,
  registeredAt: user.createdAt.toISOString(),
  lastSignInAt: user.lastSignInAt?.toISOString() ?? null,
  school: user.ownedSchool
    ? { ...user.ownedSchool, status: fromDbStatus(user.ownedSchool.status), registeredAt: user.ownedSchool.registeredAt.toISOString() }
    : null,
});

/** School owners (role OWNER): search (name, email, school name or code), status, school location and registration-date filters. */
export async function listOwners({ q, status, location, registeredSince, page, pageSize }) {
  const prisma = getPrisma();
  const contains = (value) => ({ contains: value, mode: 'insensitive' });
  const owners = { role: 'OWNER' };
  const where = {
    ...owners,
    ...(q && {
      OR: [{ name: contains(q) }, { email: contains(q) }, { ownedSchool: { name: contains(q) } }, { ownedSchool: { code: contains(q) } }],
    }),
    ...(status && { status: toDbStatus(status) }),
    ...(location && { ownedSchool: { location } }),
    ...(registeredSince && { createdAt: { gte: registeredSince } }),
  };

  const [total, groups, locations] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.groupBy({ by: ['status'], where: owners, _count: { _all: true } }),
    prisma.school.findMany({ where: { ownerId: { not: null } }, distinct: ['location'], select: { location: true }, orderBy: { location: 'asc' } }),
  ]);
  const { skip, take, meta } = pageWindow(total, page, pageSize);
  const rows = await prisma.user.findMany({ where, select: ownerSelect, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip, take });

  return {
    items: rows.map(toOwner),
    ...meta,
    summary: statusSummary(groups, OWNER_STATUSES),
    locations: locations.map((l) => l.location),
  };
}

export async function getOwner(id) {
  return toOwner(await findOrFail(getPrisma(), id));
}

/*
 * School Owner Management (approved rules): one school ↔ one owner. Super Admins add an owner
 * to an existing school that has none, edit the owner's name, email and phone (never the school
 * or role), suspend the account with a reason and reactivate it. There is no approval, transfer
 * or deletion, and owner and school statuses never change each other. Each change and its audit
 * event are written in one transaction, so an audit event exists only when the change succeeded.
 */

const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });
const auditTarget = (owner) => ({ type: 'owner', id: owner.id, name: owner.name });

const EMAIL_TAKEN = () => conflict('EMAIL_TAKEN', 'An account with this email already exists.', { email: 'An account with this email already exists.' });
const SCHOOL_HAS_OWNER = () =>
  conflict('SCHOOL_HAS_OWNER', 'This school already has an owner. An owner cannot be replaced here.', { schoolId: 'This school already has an owner.' });

const isUniqueViolation = (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

async function findOrFail(client, id) {
  const owner = isUuid(id) ? await client.user.findFirst({ where: { id, role: 'OWNER' }, select: ownerSelect }) : null;
  if (!owner) throw notFound('School owner not found.');
  return owner;
}

async function assertEmailFree(client, email, exceptId) {
  const existing = await client.user.findUnique({ where: { email }, select: { id: true } });
  if (existing && existing.id !== exceptId) throw EMAIL_TAKEN();
}

/**
 * Adds an OWNER account (ACTIVE) and assigns it to a school that has no owner, in one
 * transaction: if the assignment fails, the account is not created. Only the scrypt hash of the
 * initial password is stored. Unknown school → 400; school with an owner → 409 SCHOOL_HAS_OWNER;
 * email in use → 409 EMAIL_TAKEN.
 */
export async function createOwner({ password, schoolId, ...details }, user, req) {
  const passwordHash = await hashPassword(password);
  try {
    const owner = await getPrisma().$transaction(async (tx) => {
      const school = await tx.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true, ownerId: true } });
      if (!school) throw badRequest('Check the highlighted fields.', { schoolId: 'This school does not exist.' });
      if (school.ownerId) throw SCHOOL_HAS_OWNER();
      await assertEmailFree(tx, details.email);

      const created = await tx.user.create({ data: { ...details, role: 'OWNER', status: 'ACTIVE', passwordHash }, select: { id: true } });
      // Conditional assignment: a simultaneous request for the same school cannot also succeed.
      const { count } = await tx.school.updateMany({ where: { id: school.id, ownerId: null }, data: { ownerId: created.id } });
      if (count === 0) throw SCHOOL_HAS_OWNER();

      const added = await findOrFail(tx, created.id);
      await recordAuditEvent({
        client: tx,
        action: AUDIT_ACTIONS.OWNER_CREATED,
        actor: actorOf(user),
        target: auditTarget(added),
        schoolId: school.id,
        description: `School owner account created for ${school.name}.`,
        change: { field: 'Status', from: null, to: 'Active' },
        req,
      });
      return added;
    });
    return toOwner(owner);
  } catch (error) {
    // The unique email (or one-owner-per-school) constraint caught a simultaneous request.
    if (isUniqueViolation(error)) throw JSON.stringify(error.meta ?? {}).includes('School_ownerId_key') ? SCHOOL_HAS_OWNER() : EMAIL_TAKEN();
    throw error;
  }
}

/** Updates name, email or phone. Unchanged values are ignored; no change → no audit event. */
export async function updateOwner(id, values, user, req) {
  try {
    const owner = await getPrisma().$transaction(async (tx) => {
      const current = await findOrFail(tx, id);
      const changed = Object.keys(values).filter((field) => (current[field] ?? null) !== values[field]);
      if (!changed.length) return current;
      if (changed.includes('email')) await assertEmailFree(tx, values.email, current.id);
      await tx.user.update({ where: { id: current.id }, data: values });
      const updated = await findOrFail(tx, current.id);
      await recordAuditEvent({
        client: tx,
        action: AUDIT_ACTIONS.OWNER_UPDATED,
        actor: actorOf(user),
        target: auditTarget(updated),
        schoolId: updated.ownedSchool?.id,
        // Field names only: the values themselves stay in the account record.
        description: `School owner details updated: ${changed.join(', ')}.`,
        req,
      });
      return updated;
    });
    return toOwner(owner);
  } catch (error) {
    if (isUniqueViolation(error)) throw EMAIL_TAKEN();
    throw error;
  }
}

const statusName = (status) => fromDbStatus(status);

/**
 * ACTIVE → SUSPENDED with a reason. The owner's sessions are ended (deleted, as signing out does),
 * so a signed-in browser loses access at once and stays signed out after a reactivation. The
 * school is not changed. Not active → 409 INVALID_STATUS.
 */
export async function suspendOwner(id, reason, user, req) {
  const owner = await getPrisma().$transaction(async (tx) => {
    const current = await findOrFail(tx, id);
    // Conditional update: two simultaneous requests cannot both suspend.
    const { count } = await tx.user.updateMany({
      where: { id: current.id, role: 'OWNER', status: 'ACTIVE' },
      data: { status: 'SUSPENDED', suspensionReason: reason, suspendedAt: new Date() },
    });
    if (count === 0) throw conflict('INVALID_STATUS', `Only an active owner can be suspended. This owner is ${statusName(current.status)}.`);
    await tx.session.deleteMany({ where: { userId: current.id } });
    const updated = await findOrFail(tx, current.id);
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.OWNER_SUSPENDED,
      actor: actorOf(user),
      target: auditTarget(updated),
      schoolId: updated.ownedSchool?.id,
      description: `School owner account suspended. Reason: ${reason}`,
      change: { field: 'Status', from: 'Active', to: 'Suspended' },
      req,
    });
    return updated;
  });
  return toOwner(owner);
}

/** SUSPENDED → ACTIVE: the owner can sign in again. Not suspended → 409 INVALID_STATUS. */
export async function reactivateOwner(id, user, req) {
  const owner = await getPrisma().$transaction(async (tx) => {
    const current = await findOrFail(tx, id);
    const { count } = await tx.user.updateMany({
      where: { id: current.id, role: 'OWNER', status: 'SUSPENDED' },
      data: { status: 'ACTIVE', suspensionReason: null, suspendedAt: null },
    });
    if (count === 0) throw conflict('INVALID_STATUS', `Only a suspended owner can be reactivated. This owner is ${statusName(current.status)}.`);
    const updated = await findOrFail(tx, current.id);
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.OWNER_REACTIVATED,
      actor: actorOf(user),
      target: auditTarget(updated),
      schoolId: updated.ownedSchool?.id,
      description: 'School owner account reactivated.',
      change: { field: 'Status', from: 'Suspended', to: 'Active' },
      req,
    });
    return updated;
  });
  return toOwner(owner);
}

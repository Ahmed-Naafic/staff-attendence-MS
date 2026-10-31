import { Prisma } from '@prisma/client';
import { badRequest, conflict, notFound } from '../../common/httpError.js';
import { fromDbStatus, pageWindow, statusSummary, toDbStatus } from '../../common/listQuery.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS, MANAGER_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { dispatch, enqueue, OUTBOX } from '../notifications/outbox.js';
import { hashPassword } from '../auth/password.js';
import { listSchoolAudit, lockActiveSchool } from '../branches/branches.service.js';

/*
 * Manager accounts (approved rules: docs/business-rules.md → Manager accounts). Every function
 * takes the signed-in owner's school (`school`, found by requireOwnerSchool from the account,
 * never from the request). A Manager belongs to that school through their branch: every query
 * filters on the branch's school, so a Manager or branch of another school is never found.
 *
 * Writes: the school row is locked first (FOR SHARE; suspended → 409 SCHOOL_SUSPENDED), then the
 * Manager row (FOR UPDATE). Each change and its audit event are written in one transaction, so an
 * event exists only when the change succeeded; unchanged submissions record nothing. Passwords are
 * hashed before the transaction and never returned, logged or recorded.
 */

export const MANAGER_STATUSES = ['active', 'suspended'];

const branchSummary = { select: { id: true, code: true, name: true, status: true } };
const managerSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  status: true,
  suspensionReason: true,
  suspendedAt: true,
  mustChangePassword: true,
  createdAt: true,
  lastSignInAt: true,
  branch: branchSummary,
};

const toBranchSummary = (b) => ({ id: b.id, code: b.code, name: b.name, status: fromDbStatus(b.status) });

/** The Manager shape the web app uses. Never includes password hashes or sessions. */
const toManager = (m) => ({
  id: m.id,
  name: m.name,
  email: m.email ?? '',
  phone: m.phone ?? '',
  status: fromDbStatus(m.status),
  suspensionReason: m.suspensionReason ?? null,
  suspendedAt: m.suspendedAt?.toISOString() ?? null,
  // True until the Manager has replaced their temporary password.
  passwordChangePending: m.mustChangePassword,
  createdAt: m.createdAt.toISOString(),
  lastSignInAt: m.lastSignInAt?.toISOString() ?? null,
  branch: toBranchSummary(m.branch),
});

const inSchool = (school) => ({ role: 'MANAGER', branch: { schoolId: school.id } });
const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });
const auditTarget = (manager) => ({ type: 'manager', id: manager.id, name: manager.name });
const branchLabel = (branch) => `${branch.name} (${branch.code})`;
const isUniqueViolation = (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
const EMAIL_TAKEN = () => conflict('EMAIL_TAKEN', 'An account with this email already exists.', { email: 'An account with this email already exists.' });
const LABELS = { name: 'Full name', email: 'Email', phone: 'Phone' };

// ---- reads --------------------------------------------------------------------------------

/** Search (name, email, phone, branch name or code), status and branch filters, newest first. Includes the school's branches (for filters and forms). */
export async function listManagers(school, { q, status, branch, page, pageSize }) {
  const prisma = getPrisma();
  const contains = (value) => ({ contains: value, mode: 'insensitive' });
  const where = {
    ...inSchool(school),
    ...(q && {
      OR: [{ name: contains(q) }, { email: contains(q) }, { phone: contains(q) }, { branch: { name: contains(q) } }, { branch: { code: contains(q) } }],
    }),
    ...(status && { status: toDbStatus(status) }),
    ...(branch && { branchId: branch }),
  };
  const [total, groups, branches] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.groupBy({ by: ['status'], where: inSchool(school), _count: { _all: true } }),
    prisma.branch.findMany({ where: { schoolId: school.id }, select: branchSummary.select, orderBy: { number: 'asc' } }),
  ]);
  const { skip, take, meta } = pageWindow(total, page, pageSize);
  const rows = await prisma.user.findMany({ where, select: managerSelect, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip, take });
  return {
    items: rows.map(toManager),
    ...meta,
    summary: statusSummary(groups, MANAGER_STATUSES),
    branches: branches.map(toBranchSummary),
  };
}

async function findOrFail(client, school, id) {
  const manager = isUuid(id) ? await client.user.findFirst({ where: { id, ...inSchool(school) }, select: managerSelect }) : null;
  // A Manager of another school is reported exactly like one that does not exist.
  if (!manager) throw notFound('Manager not found.');
  return manager;
}

/** One Manager with their assignment history (newest first). */
export async function getManager(school, id, client = getPrisma()) {
  const manager = await findOrFail(client, school, id);
  const assignments = await client.managerAssignment.findMany({
    where: { managerId: manager.id },
    select: { id: true, startedAt: true, endedAt: true, branch: branchSummary },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
  });
  return {
    ...toManager(manager),
    assignments: assignments.map((a) => ({
      id: a.id,
      branch: toBranchSummary(a.branch),
      startedAt: a.startedAt.toISOString(),
      endedAt: a.endedAt?.toISOString() ?? null,
    })),
  };
}

/** Manager audit events of the owner's school (optionally one Manager's), in the owner's view. */
export const listManagerAudit = (school, { manager, page, pageSize }) =>
  listSchoolAudit(school, { action: { in: MANAGER_ACTIONS }, ...(manager && { targetId: manager }) }, { page, pageSize });

// ---- changes ------------------------------------------------------------------------------

async function lockManager(tx, school, id) {
  if (!isUuid(id)) throw notFound('Manager not found.');
  const [row] = await tx.$queryRaw`
    SELECT u."id" FROM "User" u JOIN "Branch" b ON b."id" = u."branchId"
    WHERE u."id" = ${id} AND u."role" = 'MANAGER' AND b."schoolId" = ${school.id}
    FOR UPDATE OF u`;
  if (!row) throw notFound('Manager not found.');
  return findOrFail(tx, school, id);
}

/** A branch of the owner's school; any other id (another school's branch included) is a field error. */
async function schoolBranch(tx, school, branchId) {
  const branch = await tx.branch.findFirst({ where: { id: branchId, schoolId: school.id }, select: branchSummary.select });
  if (!branch) throw badRequest('Check the highlighted fields.', { branchId: 'Choose a branch of your school.' });
  return branch;
}

async function assertEmailFree(client, email, exceptId) {
  const existing = await client.user.findUnique({ where: { email }, select: { id: true } });
  if (existing && existing.id !== exceptId) throw EMAIL_TAKEN();
}

/**
 * Creates a MANAGER account (ACTIVE, must change the temporary password) in a branch of the owner's
 * school, with its first assignment. Email in use → 409 EMAIL_TAKEN.
 */
export async function createManager(school, { password, branchId, ...details }, user, req) {
  const passwordHash = await hashPassword(password);
  const outbox = [];
  try {
    const id = await getPrisma().$transaction(async (tx) => {
      await lockActiveSchool(tx, school);
      const branch = await schoolBranch(tx, school, branchId);
      await assertEmailFree(tx, details.email);
      const created = await tx.user.create({
        data: { ...details, role: 'MANAGER', status: 'ACTIVE', passwordHash, mustChangePassword: true, branchId: branch.id },
        select: { id: true, name: true },
      });
      const assignment = await tx.managerAssignment.create({ data: { managerId: created.id, branchId: branch.id } });
      // A branch with no schedule in effect: the new Manager is told (N3-6).
      await enqueue(tx, OUTBOX.MANAGER_ASSIGNED, { managerId: created.id, branchId: branch.id, assignmentId: assignment.id }, `manager-assigned:${assignment.id}`, outbox);
      await recordAuditEvent({
        client: tx,
        action: AUDIT_ACTIONS.MANAGER_CREATED,
        actor: actorOf(user),
        target: auditTarget(created),
        schoolId: school.id,
        description: `Manager account created for ${branchLabel(branch)}, with a temporary password to change at first sign-in.`,
        change: {
          fields: [
            { field: 'Status', from: null, to: 'Active' },
            { field: 'Branch', from: null, to: branchLabel(branch) },
          ],
        },
        req,
      });
      return created.id;
    });
    await dispatch(outbox);
    return getManager(school, id);
  } catch (error) {
    if (isUniqueViolation(error)) throw EMAIL_TAKEN();
    throw error;
  }
}

/** Edits full name, email or phone. Unchanged values are ignored; nothing changed → no event. */
export async function updateManager(school, id, values, user, req) {
  try {
    await getPrisma().$transaction(async (tx) => {
      await lockActiveSchool(tx, school);
      const current = await lockManager(tx, school, id);
      const changed = Object.keys(values).filter((field) => (current[field] ?? null) !== values[field]);
      if (!changed.length) return;
      if (changed.includes('email')) await assertEmailFree(tx, values.email, current.id);
      const updated = await tx.user.update({
        where: { id: current.id },
        data: Object.fromEntries(changed.map((f) => [f, values[f]])),
        select: { id: true, name: true },
      });
      await recordAuditEvent({
        client: tx,
        action: AUDIT_ACTIONS.MANAGER_UPDATED,
        actor: actorOf(user),
        target: auditTarget(updated),
        schoolId: school.id,
        // Field names only (as for owners): the values themselves stay in the account record.
        description: `Manager details updated: ${changed.map((f) => LABELS[f]).join(', ')}.`,
        req,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw EMAIL_TAKEN();
    throw error;
  }
  return getManager(school, id);
}

/**
 * Moves a Manager to another branch of the same school: the current assignment is ended and a new
 * one started (history kept). The Manager's sessions continue; their branch is read on every request.
 */
export async function transferManager(school, id, branchId, user, req) {
  const outbox = [];
  await getPrisma().$transaction(async (tx) => {
    await lockActiveSchool(tx, school);
    const current = await lockManager(tx, school, id);
    if (current.branch.id === branchId) {
      throw badRequest('Check the highlighted fields.', { branchId: 'This Manager is already assigned to this branch. Choose another branch.' });
    }
    const destination = await schoolBranch(tx, school, branchId);
    const now = new Date();
    await tx.managerAssignment.updateMany({ where: { managerId: current.id, endedAt: null }, data: { endedAt: now } });
    const assignment = await tx.managerAssignment.create({ data: { managerId: current.id, branchId: destination.id, startedAt: now } });
    await tx.user.update({ where: { id: current.id }, data: { branchId: destination.id } });
    // The Manager is told (N3-7); the Owner is told if the previous branch is left with no active Manager (N7).
    await enqueue(
      tx,
      OUTBOX.MANAGER_ASSIGNED,
      { managerId: current.id, branchId: destination.id, fromBranchId: current.branch.id, assignmentId: assignment.id },
      `manager-assigned:${assignment.id}`,
      outbox,
    );
    await enqueue(tx, OUTBOX.BRANCH_MANAGER_CHECK, { branchId: current.branch.id }, `manager-check:transfer:${assignment.id}`, outbox);
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.MANAGER_TRANSFERRED,
      actor: actorOf(user),
      target: auditTarget(current),
      schoolId: school.id,
      description: `Manager transferred from ${branchLabel(current.branch)} to ${branchLabel(destination)}.`,
      change: { field: 'Branch', from: branchLabel(current.branch), to: branchLabel(destination) },
      req,
    });
  });
  await dispatch(outbox);
  return getManager(school, id);
}

/** ACTIVE → SUSPENDED with a reason; the Manager's sessions end at once. Not active → 409 INVALID_STATUS. */
export async function suspendManager(school, id, reason, user, req) {
  const outbox = [];
  await getPrisma().$transaction(async (tx) => {
    await lockActiveSchool(tx, school);
    const current = await lockManager(tx, school, id);
    // Conditional update: two simultaneous requests cannot both suspend.
    const { count } = await tx.user.updateMany({
      where: { id: current.id, role: 'MANAGER', status: 'ACTIVE' },
      data: { status: 'SUSPENDED', suspensionReason: reason, suspendedAt: new Date() },
    });
    if (count === 0) throw conflict('INVALID_STATUS', `Only an active Manager can be suspended. This Manager is ${fromDbStatus(current.status)}.`);
    await tx.session.deleteMany({ where: { userId: current.id } });
    // The Owner is told if the branch is left with no active Manager (N7).
    await enqueue(tx, OUTBOX.BRANCH_MANAGER_CHECK, { branchId: current.branch.id }, `manager-check:suspend:${current.id}:${Date.now()}`, outbox);
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.MANAGER_SUSPENDED,
      actor: actorOf(user),
      target: auditTarget(current),
      schoolId: school.id,
      description: `Manager account suspended. Reason: ${reason}`,
      change: { field: 'Status', from: 'Active', to: 'Suspended', reason },
      req,
    });
  });
  await dispatch(outbox);
  return getManager(school, id);
}

/** SUSPENDED → ACTIVE: the Manager can sign in again (earlier sessions stay ended). Not suspended → 409 INVALID_STATUS. */
export async function reactivateManager(school, id, user, req) {
  await getPrisma().$transaction(async (tx) => {
    await lockActiveSchool(tx, school);
    const current = await lockManager(tx, school, id);
    const { count } = await tx.user.updateMany({
      where: { id: current.id, role: 'MANAGER', status: 'SUSPENDED' },
      data: { status: 'ACTIVE', suspensionReason: null, suspendedAt: null },
    });
    if (count === 0) throw conflict('INVALID_STATUS', `Only a suspended Manager can be reactivated. This Manager is ${fromDbStatus(current.status)}.`);
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.MANAGER_REACTIVATED,
      actor: actorOf(user),
      target: auditTarget(current),
      schoolId: school.id,
      description: 'Manager account reactivated.',
      change: { field: 'Status', from: 'Suspended', to: 'Active' },
      req,
    });
  });
  return getManager(school, id);
}

/**
 * A new temporary password: replaces the hash, requires a change at the next sign-in and ends the
 * Manager's sessions. The status is not changed (a suspended Manager stays suspended).
 */
export async function resetManagerPassword(school, id, password, user, req) {
  const passwordHash = await hashPassword(password);
  await getPrisma().$transaction(async (tx) => {
    await lockActiveSchool(tx, school);
    const current = await lockManager(tx, school, id);
    await tx.user.update({ where: { id: current.id }, data: { passwordHash, mustChangePassword: true } });
    const { count: ended } = await tx.session.deleteMany({ where: { userId: current.id } });
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.MANAGER_PASSWORD_RESET,
      actor: actorOf(user),
      target: auditTarget(current),
      schoolId: school.id,
      description: `New temporary password set; the Manager must change it at the next sign-in. Sessions ended: ${ended}.`,
      req,
    });
  });
  return getManager(school, id);
}

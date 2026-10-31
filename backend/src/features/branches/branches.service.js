import { Prisma } from '@prisma/client';
import { conflict, notFound } from '../../common/httpError.js';
import { fromDbStatus, pageWindow, statusSummary, toDbStatus } from '../../common/listQuery.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS, BRANCH_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { dispatch, enqueue, OUTBOX } from '../notifications/outbox.js';
import { nameKey } from './branchInput.js';

/*
 * Branch Management (approved rules: docs/business-rules.md → Branch management). Every function
 * takes the signed-in owner's school (`school`, found by requireOwnerSchool from the account,
 * never from the request) and only ever reads or writes that school's branches.
 *
 * Writes: the school row is locked first (FOR SHARE, or the branch-number UPDATE when creating)
 * and must be ACTIVE (409 SCHOOL_SUSPENDED), then the branch row (FOR UPDATE). Each change and
 * its audit event are written in one transaction, so an event exists only when the change
 * succeeded; unchanged submissions write nothing and record nothing.
 */

export const BRANCH_STATUSES = ['active', 'suspended'];

const branchSelect = {
  id: true,
  schoolId: true,
  number: true,
  code: true,
  name: true,
  address: true,
  city: true,
  phone: true,
  status: true,
  suspensionReason: true,
  suspendedAt: true,
  createdAt: true,
};

const isUniqueViolation = (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
const NAME_TAKEN = () =>
  conflict('NAME_TAKEN', 'A branch with this name already exists in your school. Choose another name.', {
    name: 'A branch with this name already exists in your school (names are compared without regard to capitalization).',
  });
const SCHOOL_SUSPENDED = () =>
  conflict('SCHOOL_SUSPENDED', 'Your school is suspended. Its branches and Managers can be viewed but not changed until the school is reactivated.');

/** Whether a branch is operating: only when the branch and its school are both ACTIVE. */
export function operatingState(branch, school) {
  const reasons = [];
  if (branch.status !== 'ACTIVE') reasons.push('branch_suspended');
  if (school.status !== 'ACTIVE') reasons.push('school_suspended');
  return { operating: reasons.length === 0, reasons };
}

const toLocation = (l) =>
  l && {
    id: l.id,
    latitude: l.latitude,
    longitude: l.longitude,
    accuracyMeters: l.accuracyMeters,
    effectiveFrom: l.effectiveFrom.toISOString(),
    recordedAt: l.recordedAt.toISOString(),
    cancelledAt: l.cancelledAt?.toISOString() ?? null,
  };

/** The branch shape the web app uses. `location`/`scheduledLocation` are added for single branches. */
const toBranch = (branch, school, extra = {}) => ({
  id: branch.id,
  code: branch.code,
  name: branch.name,
  address: branch.address,
  city: branch.city,
  phone: branch.phone ?? '',
  status: fromDbStatus(branch.status),
  suspensionReason: branch.suspensionReason ?? null,
  suspendedAt: branch.suspendedAt?.toISOString() ?? null,
  createdAt: branch.createdAt.toISOString(),
  operating: operatingState(branch, school),
  ...extra,
});

/** The location in force at `at` (the newest non-cancelled one effective at or before it), or null. */
export function locationAt(branchId, at, client = getPrisma()) {
  return client.branchLocation.findFirst({
    where: { branchId, cancelledAt: null, effectiveFrom: { lte: at } },
    orderBy: [{ effectiveFrom: 'desc' }, { recordedAt: 'desc' }],
  });
}

/** The scheduled (future, not cancelled) location after `now`, or null. There is at most one. */
export function scheduledLocationAfter(branchId, now, client) {
  return client.branchLocation.findFirst({
    where: { branchId, cancelledAt: null, effectiveFrom: { gt: now } },
    orderBy: [{ effectiveFrom: 'asc' }, { recordedAt: 'asc' }],
  });
}

async function findOrFail(client, school, id) {
  const branch = isUuid(id) ? await client.branch.findFirst({ where: { id, schoolId: school.id }, select: branchSelect }) : null;
  // A branch of another school is reported exactly like one that does not exist.
  if (!branch) throw notFound('Branch not found.');
  return branch;
}

async function withLocations(client, branch, school) {
  const now = new Date();
  const [current, scheduled] = await Promise.all([locationAt(branch.id, now, client), scheduledLocationAfter(branch.id, now, client)]);
  return toBranch(branch, school, { location: toLocation(current), scheduledLocation: toLocation(scheduled) });
}

/** The owner's school as the web app shows it (no suspension reason: that is the Super Admin's record). */
export const toOwnerSchool = (school) => ({ id: school.id, code: school.code, name: school.name, status: fromDbStatus(school.status) });

/** Search (name, code, city), status filter and pagination, oldest branch number first. */
export async function listBranches(school, { q, status, page, pageSize }) {
  const prisma = getPrisma();
  const contains = (value) => ({ contains: value, mode: 'insensitive' });
  const where = {
    schoolId: school.id,
    ...(q && { OR: [{ name: contains(q) }, { code: contains(q) }, { city: contains(q) }] }),
    ...(status && { status: toDbStatus(status) }),
  };
  const [total, groups, cities] = await Promise.all([
    prisma.branch.count({ where }),
    prisma.branch.groupBy({ by: ['status'], where: { schoolId: school.id }, _count: { _all: true } }),
    prisma.branch.findMany({ where: { schoolId: school.id }, distinct: ['city'], select: { city: true }, orderBy: { city: 'asc' } }),
  ]);
  const { skip, take, meta } = pageWindow(total, page, pageSize);
  const rows = await prisma.branch.findMany({ where, select: branchSelect, orderBy: { number: 'asc' }, skip, take });
  return {
    items: rows.map((b) => toBranch(b, school)),
    ...meta,
    summary: statusSummary(groups, BRANCH_STATUSES),
    cities: cities.map((c) => c.city),
  };
}

export async function getBranch(school, id) {
  const prisma = getPrisma();
  return withLocations(prisma, await findOrFail(prisma, school, id), school);
}

/** Every location of a branch, newest first, each with its state and the period it applies. */
export async function listLocations(school, id) {
  const prisma = getPrisma();
  const branch = await findOrFail(prisma, school, id);
  const rows = await prisma.branchLocation.findMany({ where: { branchId: branch.id }, orderBy: [{ effectiveFrom: 'desc' }, { recordedAt: 'desc' }] });
  const now = Date.now();
  const applied = rows.filter((l) => !l.cancelledAt);
  const current = applied.find((l) => l.effectiveFrom.getTime() <= now);
  return {
    items: rows.map((l) => {
      const next = applied.filter((n) => n.effectiveFrom > l.effectiveFrom).at(-1);
      const state = l.cancelledAt ? 'cancelled' : l.effectiveFrom.getTime() > now ? 'scheduled' : l === current ? 'current' : 'previous';
      return { ...toLocation(l), state, effectiveUntil: !l.cancelledAt && next ? next.effectiveFrom.toISOString() : null };
    }),
  };
}

// ---- audit values -------------------------------------------------------------------------

const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });
const auditTarget = (branch) => ({ type: 'branch', id: branch.id, name: `${branch.name} (${branch.code})` });
const LABELS = { name: 'Name', address: 'Address', city: 'City', phone: 'Phone' };
const shown = (value) => value ?? 'Not set';
const position = (l) => `${l.latitude.toFixed(6)}, ${l.longitude.toFixed(6)}`;
const positionWithAccuracy = (l) => `${position(l)} (±${l.accuracyMeters} m)`;
/** e.g. 2026-10-24 14:05 UTC (audit values are plain text, readable without a time zone setting). */
export const auditTime = (date) => `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;

/** Locks the school row (FOR SHARE) for a write; a suspended school → 409 SCHOOL_SUSPENDED. Shared with Manager accounts. */
export async function lockActiveSchool(tx, school) {
  const [row] = await tx.$queryRaw`SELECT "status"::text AS "status" FROM "School" WHERE "id" = ${school.id} FOR SHARE`;
  if (!row || row.status !== 'ACTIVE') throw SCHOOL_SUSPENDED();
}

async function lockBranch(tx, school, id) {
  if (!isUuid(id)) throw notFound('Branch not found.');
  const [row] = await tx.$queryRaw`SELECT "id" FROM "Branch" WHERE "id" = ${id} AND "schoolId" = ${school.id} FOR UPDATE`;
  if (!row) throw notFound('Branch not found.');
  return findOrFail(tx, school, id);
}

// ---- changes ------------------------------------------------------------------------------

/**
 * Creates a branch (ACTIVE) with its first location, effective at once. The branch number comes
 * from School.branchSequence, raised by one UPDATE that also locks the school row and requires it
 * to be ACTIVE: simultaneous creations wait for each other and never get the same number.
 */
export async function createBranch(school, { location, ...values }, user, req) {
  const outbox = [];
  try {
    const branch = await getPrisma().$transaction(async (tx) => {
      const [row] = await tx.$queryRaw`
        UPDATE "School" SET "branchSequence" = "branchSequence" + 1
        WHERE "id" = ${school.id} AND "status" = 'ACTIVE'
        RETURNING "branchSequence", "code"`;
      if (!row) throw SCHOOL_SUSPENDED();
      const number = Number(row.branchSequence);
      const code = `${row.code}-B${String(number).padStart(3, '0')}`;
      const created = await tx.branch.create({
        data: { schoolId: school.id, number, code, ...values, nameKey: nameKey(values.name), status: 'ACTIVE' },
        select: branchSelect,
      });
      const first = await tx.branchLocation.create({ data: { branchId: created.id, ...location, effectiveFrom: new Date() } });
      // A new branch has no Manager yet: the Owner is told (N7).
      await enqueue(tx, OUTBOX.BRANCH_MANAGER_CHECK, { branchId: created.id }, `manager-check:created:${created.id}`, outbox);
      await recordAuditEvent({
        client: tx,
        action: AUDIT_ACTIONS.BRANCH_CREATED,
        actor: actorOf(user),
        target: auditTarget(created),
        schoolId: school.id,
        description: `Branch created with code ${code} in ${created.city}.`,
        change: {
          fields: [
            { field: 'Status', from: null, to: 'Active' },
            ...Object.keys(LABELS).map((f) => ({ field: LABELS[f], from: null, to: shown(created[f]) })),
            { field: 'Location', from: null, to: positionWithAccuracy(first) },
            { field: 'Location effective from', from: null, to: auditTime(first.effectiveFrom) },
          ],
        },
        req,
      });
      return created;
    });
    await dispatch(outbox);
    return getBranch(school, branch.id);
  } catch (error) {
    if (isUniqueViolation(error) && JSON.stringify(error.meta ?? {}).includes('nameKey')) throw NAME_TAKEN();
    throw error;
  }
}

/** Edits name, address, city and phone. Unchanged values are ignored; nothing changed → no event. */
export async function updateBranch(school, id, values, user, req) {
  try {
    await getPrisma().$transaction(async (tx) => {
      await lockActiveSchool(tx, school);
      const current = await lockBranch(tx, school, id);
      const changed = Object.keys(values).filter((field) => (current[field] ?? null) !== values[field]);
      if (!changed.length) return;
      const data = Object.fromEntries(changed.map((f) => [f, values[f]]));
      if (data.name) data.nameKey = nameKey(data.name);
      const updated = await tx.branch.update({ where: { id: current.id }, data, select: branchSelect });
      await recordAuditEvent({
        client: tx,
        action: AUDIT_ACTIONS.BRANCH_UPDATED,
        actor: actorOf(user),
        target: auditTarget(updated),
        schoolId: school.id,
        description: `Branch details updated: ${changed.map((f) => LABELS[f]).join(', ')}.`,
        change: { fields: changed.map((f) => ({ field: LABELS[f], from: shown(current[f]), to: shown(updated[f]) })) },
        req,
      });
    });
  } catch (error) {
    if (isUniqueViolation(error) && JSON.stringify(error.meta ?? {}).includes('nameKey')) throw NAME_TAKEN();
    throw error;
  }
  return getBranch(school, id);
}

/** ACTIVE → SUSPENDED with a reason. Already suspended → 409 INVALID_STATUS. */
export async function suspendBranch(school, id, reason, user, req) {
  const outbox = [];
  await getPrisma().$transaction(async (tx) => {
    await lockActiveSchool(tx, school);
    const current = await findOrFail(tx, school, id);
    // Conditional update: two simultaneous requests cannot both suspend.
    const now = new Date();
    const { count } = await tx.branch.updateMany({
      where: { id: current.id, schoolId: school.id, status: 'ACTIVE' },
      data: { status: 'SUSPENDED', suspensionReason: reason, suspendedAt: now },
    });
    if (count === 0) throw conflict('INVALID_STATUS', 'Only an active branch can be suspended. This branch is already suspended.');
    // The exact interval, for attendance (absences are not counted while suspended).
    const period = await tx.suspensionPeriod.create({ data: { branchId: current.id, startedAt: now, reason, startedById: user.id } });
    // The branch's Managers and staff are told, without the reason (N11).
    await enqueue(tx, OUTBOX.BRANCH_STATUS, { branchId: current.id, status: 'SUSPENDED', periodId: period.id }, `branch-status:${period.id}:SUSPENDED`, outbox);
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.BRANCH_SUSPENDED,
      actor: actorOf(user),
      target: auditTarget(current),
      schoolId: school.id,
      description: `Branch suspended. Reason: ${reason}`,
      change: { field: 'Status', from: 'Active', to: 'Suspended', reason },
      req,
    });
  });
  await dispatch(outbox);
  return getBranch(school, id);
}

/** SUSPENDED → ACTIVE. Already active → 409 INVALID_STATUS. */
export async function reactivateBranch(school, id, user, req) {
  const outbox = [];
  await getPrisma().$transaction(async (tx) => {
    await lockActiveSchool(tx, school);
    const current = await findOrFail(tx, school, id);
    const { count } = await tx.branch.updateMany({
      where: { id: current.id, schoolId: school.id, status: 'SUSPENDED' },
      data: { status: 'ACTIVE', suspensionReason: null, suspendedAt: null },
    });
    if (count === 0) throw conflict('INVALID_STATUS', 'Only a suspended branch can be reactivated. This branch is already active.');
    const open = await tx.suspensionPeriod.findFirst({ where: { branchId: current.id, endedAt: null }, select: { id: true } });
    await tx.suspensionPeriod.updateMany({ where: { branchId: current.id, endedAt: null }, data: { endedAt: new Date(), endedById: user.id } });
    const periodKey = open?.id ?? `${current.id}:${Date.now()}`;
    await enqueue(tx, OUTBOX.BRANCH_STATUS, { branchId: current.id, status: 'ACTIVE', periodId: periodKey }, `branch-status:${periodKey}:ACTIVE`, outbox);
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.BRANCH_REACTIVATED,
      actor: actorOf(user),
      target: auditTarget(current),
      schoolId: school.id,
      description: 'Branch reactivated.',
      change: { field: 'Status', from: 'Suspended', to: 'Active' },
      req,
    });
  });
  await dispatch(outbox);
  return getBranch(school, id);
}

const samePosition = (a, b) => a && b && a.latitude === b.latitude && a.longitude === b.longitude;

/**
 * Changes the location now or from a later time (`effectiveFrom`, already checked against the
 * server clock by readLocationChange). A scheduled change is replaced: it is marked cancelled,
 * never deleted. Saving the location already in force with nothing scheduled changes nothing.
 * Saving it while a change is scheduled only cancels the scheduled change.
 */
export async function changeLocation(school, id, { position: next, effectiveFrom, immediate }, user, req) {
  await getPrisma().$transaction(async (tx) => {
    await lockActiveSchool(tx, school);
    const branch = await lockBranch(tx, school, id);
    const now = new Date();
    const at = immediate || effectiveFrom <= now ? now : effectiveFrom;
    const [current, scheduled] = await Promise.all([locationAt(branch.id, now, tx), scheduledLocationAfter(branch.id, now, tx)]);

    if (samePosition(current, next)) {
      if (!scheduled) return;
      await cancelScheduled(tx, branch, scheduled, now, user, req, 'The location saved is the one already in force.');
      return;
    }
    const fields = [];
    if (scheduled) {
      await tx.branchLocation.updateMany({ where: { id: scheduled.id, cancelledAt: null }, data: { cancelledAt: now } });
      fields.push({ field: 'Scheduled change', from: `${position(scheduled)} from ${auditTime(scheduled.effectiveFrom)}`, to: 'Replaced' });
    }
    const created = await tx.branchLocation.create({ data: { branchId: branch.id, ...next, effectiveFrom: at } });
    fields.unshift(
      { field: 'Location', from: current ? positionWithAccuracy(current) : 'Not set', to: positionWithAccuracy(created) },
      { field: 'Location effective from', from: current ? auditTime(current.effectiveFrom) : 'Not set', to: auditTime(at) },
    );
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.BRANCH_LOCATION_CHANGED,
      actor: actorOf(user),
      target: auditTarget(branch),
      schoolId: school.id,
      description:
        at === now
          ? 'Branch location changed, effective immediately.'
          : `Branch location change scheduled, effective ${auditTime(at)}.${scheduled ? ' It replaces the change scheduled before.' : ''}`,
      change: { fields },
      req,
    });
  });
  return getBranch(school, id);
}

async function cancelScheduled(tx, branch, scheduled, now, user, req, why) {
  // Only a change that has not taken effect can be cancelled.
  const { count } = await tx.branchLocation.updateMany({
    where: { id: scheduled.id, cancelledAt: null, effectiveFrom: { gt: now } },
    data: { cancelledAt: now },
  });
  if (count === 0) throw notFound('There is no scheduled location change.');
  await recordAuditEvent({
    client: tx,
    action: AUDIT_ACTIONS.BRANCH_LOCATION_CHANGE_CANCELLED,
    actor: actorOf(user),
    target: auditTarget(branch),
    schoolId: branch.schoolId,
    description: `Scheduled location change cancelled.${why ? ` ${why}` : ''}`,
    change: { fields: [{ field: 'Scheduled change', from: `${positionWithAccuracy(scheduled)} from ${auditTime(scheduled.effectiveFrom)}`, to: 'Cancelled' }] },
    req,
  });
}

/** Cancels the scheduled location change (404 when there is none). */
export async function cancelScheduledLocation(school, id, user, req) {
  await getPrisma().$transaction(async (tx) => {
    await lockActiveSchool(tx, school);
    const branch = await lockBranch(tx, school, id);
    const now = new Date();
    const scheduled = await scheduledLocationAfter(branch.id, now, tx);
    if (!scheduled) throw notFound('There is no scheduled location change.');
    await cancelScheduled(tx, branch, scheduled, now, user, req);
  });
  return getBranch(school, id);
}

// ---- audit (School Owner view) ------------------------------------------------------------

/**
 * Branch audit events of the owner's school only, newest first. No network address or browser
 * details (the Super Admin audit log keeps those).
 */
export const listBranchAudit = (school, { branch, page, pageSize }) =>
  listSchoolAudit(school, { targetType: 'branch', action: { in: BRANCH_ACTIONS }, ...(branch && { targetId: branch }) }, { page, pageSize });

/** Audit events of the owner's school matching `filter` (newest first), in the owner's view. */
export async function listSchoolAudit(school, filter, { page, pageSize }) {
  const prisma = getPrisma();
  const where = { ...filter, schoolId: school.id };
  const total = await prisma.auditEvent.count({ where });
  const { skip, take, meta } = pageWindow(total, page, pageSize);
  const rows = await prisma.auditEvent.findMany({
    where,
    select: { id: true, occurredAt: true, action: true, actorName: true, actorRole: true, targetId: true, targetName: true, description: true, change: true },
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    skip,
    take,
  });
  return {
    items: rows.map((e) => ({
      id: e.id,
      occurredAt: e.occurredAt.toISOString(),
      action: e.action,
      actor: { name: e.actorName ?? 'Unknown account', role: e.actorRole },
      target: { id: e.targetId, name: e.targetName ?? '' },
      description: e.description,
      change: e.change ?? null,
    })),
    ...meta,
  };
}

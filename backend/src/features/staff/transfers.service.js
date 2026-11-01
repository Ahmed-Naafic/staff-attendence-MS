import { Prisma } from '@prisma/client';
import { badRequest, conflict, notFound } from '../../common/httpError.js';
import { fromDbStatus, pageWindow, toDbStatus } from '../../common/listQuery.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockActiveSchool } from '../branches/branches.service.js';
import { dispatch, enqueue, OUTBOX } from '../notifications/outbox.js';
import { localDateTime } from '../../common/zonedTime.js';
import { effectiveDateFields, effectiveText, resolveEffective, schedulingPolicy } from '../platform-settings/schedulingPolicy.js';
import { platformTimeZone } from '../platform-settings/settings.service.js';
import { dayList, toTime } from '../schedules/scheduleInput.js';
import { addDays, localDate, MAX_AHEAD_DAYS, scheduleAt, scheduleOn } from '../schedules/schedules.service.js';
import { assignedShiftErrors } from './staff.service.js';

/*
 * Staff transfers between branches of the same school (approved decisions T1–T12,
 * docs/business-rules.md → Staff transfers).
 *
 * Only the School Owner transfers, within their own school (T1, T11). A transfer is scheduled for a
 * branch-local date, at the earliest today + the effective delay of the Scheduling & Assignments
 * settings (T3, extended 2026-11-01; 1 day by default, i.e. tomorrow), and takes effect at 00:00 of that date in the
 * platform time zone; the work day before it ends at the old branch, so an open check-in can still
 * be checked out there that day (T4). The Staff ID never changes (T2). The Owner chooses the shifts
 * at the destination (T6): a new assignment set of the destination branch from the same date, and
 * any scheduled assignment change from that date on is cancelled.
 *
 * The transfers are the staff member's branch history. The branch at any instant is the destination
 * of the latest transfer in effect by then (or the origin of the first later one), so attendance
 * events — also ones saved offline before a transfer and uploaded after it — are judged against the
 * branch of their own time (T5). User.branchId, the current branch every screen and scope uses, is
 * switched when a transfer takes effect (settleDueTransfers: on the next request and by the job).
 * Attendance records are never moved or edited: each keeps the branch it was recorded at.
 */

const fromDbDate = (value) => value.toISOString().slice(0, 10);
const asDbDate = (date) => new Date(`${date}T00:00:00Z`);
const branchRef = (b) => ({ id: b.id, code: b.code, name: b.name });
const branchLabel = (b) => `${b.name} (${b.code})`;
const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });
const staffTarget = (s) => ({ type: 'staff', id: s.id, name: `${s.name} (${s.staffId})` });
const isUniqueViolation = (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
const ALREADY_SCHEDULED = () => conflict('TRANSFER_SCHEDULED', 'A transfer is already scheduled for this staff member. Cancel it first to choose another.');
const IN_EFFECT = ['SCHEDULED', 'COMPLETED'];

// 00:00 of a local date in a time zone (moved to common/zonedTime.js; re-exported for existing imports).
export { zonedMidnight } from '../../common/zonedTime.js';

/**
 * The staff member's branch at an instant (T5), from their transfers: the destination of the latest
 * transfer in effect by then, else the origin of the first later one, else their current branch.
 * Scheduled transfers whose time has come count even before they are settled.
 */
export async function staffBranchAt(staffUserId, instant, client = getPrisma()) {
  const before = await client.staffTransfer.findFirst({
    where: { staffUserId, status: { in: IN_EFFECT }, effectiveAt: { lte: instant } },
    orderBy: { effectiveAt: 'desc' },
    select: { toBranchId: true },
  });
  if (before) return before.toBranchId;
  const after = await client.staffTransfer.findFirst({
    where: { staffUserId, status: 'COMPLETED', effectiveAt: { gt: instant } },
    orderBy: { effectiveAt: 'asc' },
    select: { fromBranchId: true },
  });
  if (after) return after.fromBranchId;
  return (await client.user.findUnique({ where: { id: staffUserId }, select: { branchId: true } }))?.branchId ?? null;
}

// ---- taking effect -----------------------------------------------------------------------

/**
 * Applies every scheduled transfer whose time has come: the staff member's current branch becomes
 * the destination, the transfer is COMPLETED and STAFF_TRANSFERRED is recorded (actor: the system).
 * Locks the staff row first (as scheduling and cancelling do), then the transfer, so they never
 * deadlock; a transfer cancelled or settled meanwhile is skipped. → number applied.
 */
export async function settleDueTransfers({ now = new Date(), client = getPrisma(), limit = 100 } = {}) {
  const due = await client.staffTransfer.findMany({ where: { status: 'SCHEDULED', effectiveAt: { lte: now } }, orderBy: { effectiveAt: 'asc' }, take: limit, select: { id: true, staffUserId: true } });
  let applied = 0;
  for (const { id, staffUserId } of due) {
    applied += await client.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${staffUserId} FOR UPDATE`;
      const [t] = await tx.$queryRaw`
        SELECT "id" FROM "StaffTransfer" WHERE "id" = ${id} AND "status" = 'SCHEDULED' AND "effectiveAt" <= ${now} FOR UPDATE`;
      if (!t) return 0;
      const transfer = await tx.staffTransfer.update({
        where: { id },
        data: { status: 'COMPLETED', completedAt: now },
        include: { staff: { select: { id: true, name: true, staffId: true } }, fromBranch: true, toBranch: true },
      });
      await tx.user.update({ where: { id: staffUserId }, data: { branchId: transfer.toBranchId } });
      await recordAuditEvent({
        client: tx,
        action: AUDIT_ACTIONS.STAFF_TRANSFERRED,
        actor: null,
        target: staffTarget(transfer.staff),
        schoolId: transfer.schoolId,
        description: `Transfer took effect on ${fromDbDate(transfer.effectiveFrom)}: ${branchLabel(transfer.fromBranch)} → ${branchLabel(transfer.toBranch)}.`,
        change: { field: 'Branch', from: branchLabel(transfer.fromBranch), to: branchLabel(transfer.toBranch) },
      });
      return 1;
    });
  }
  return applied;
}

let lastCheck = 0;
/**
 * settleDueTransfers before a request that depends on a staff member's current branch, at most every
 * 5 seconds per API process (one indexed query when nothing is due). Never fails the request.
 */
export async function settleIfDue(now = new Date()) {
  if (now.getTime() - lastCheck < 5_000) return;
  lastCheck = now.getTime();
  try {
    await settleDueTransfers({ now });
  } catch (error) {
    lastCheck = 0;
    console.error('[transfers] settling failed; the next request retries:', error.message);
  }
}

// ---- reads -------------------------------------------------------------------------------

const shiftLabel = (s) => `${s.name}: ${dayList(s.days)} ${s.start}–${s.end}`;

/** The shifts of an assignment set, named from the branch schedule in effect when it takes effect. */
async function assignedShifts(assignmentId, client) {
  if (!assignmentId) return [];
  const set = await client.staffAssignment.findUnique({ where: { id: assignmentId }, include: { shifts: true } });
  if (!set) return [];
  const schedule = await scheduleAt(set.branchId, set.effectiveAt, client);
  const byKey = new Map((schedule?.shifts ?? []).map((s) => [s.shiftKey, s]));
  return set.shifts
    .map((a) => ({ a, s: byKey.get(a.shiftKey) }))
    .filter(({ s }) => s)
    .sort((x, y) => x.s.startMinute - y.s.startMinute)
    .map(({ a, s }) => ({ shiftKey: a.shiftKey, name: s.name, days: a.days, start: toTime(s.startMinute), end: toTime(s.endMinute) }));
}

const toTransfer = async (t, client) => ({
  id: t.id,
  status: t.status.toLowerCase(),
  fromBranch: branchRef(t.fromBranch),
  toBranch: branchRef(t.toBranch),
  effectiveFrom: fromDbDate(t.effectiveFrom),
  // The local time it takes effect ('00:00' unless timed changes chose another).
  effectiveTime: localDateTime(t.effectiveAt, t.timeZone).time,
  effectiveAt: t.effectiveAt.toISOString(),
  timeZone: t.timeZone,
  shifts: await assignedShifts(t.assignmentId, client),
  createdAt: t.createdAt.toISOString(),
  completedAt: t.completedAt?.toISOString() ?? null,
  cancelledAt: t.cancelledAt?.toISOString() ?? null,
});

const transferInclude = { fromBranch: true, toBranch: true };
const ownerStaffSelect = {
  id: true,
  staffId: true,
  name: true,
  jobTitle: true,
  status: true,
  branch: { select: { id: true, code: true, name: true, status: true } },
  staffTransfers: { where: { status: 'SCHEDULED' }, include: transferInclude, take: 1 },
};
const toOwnerStaff = (s) => ({
  id: s.id,
  staffId: s.staffId,
  name: s.name,
  jobTitle: s.jobTitle ?? '',
  status: fromDbStatus(s.status),
  branch: { ...branchRef(s.branch), status: fromDbStatus(s.branch.status) },
  scheduledTransfer: s.staffTransfers[0] ? { id: s.staffTransfers[0].id, toBranch: branchRef(s.staffTransfers[0].toBranch), effectiveFrom: fromDbDate(s.staffTransfers[0].effectiveFrom) } : null,
});
const inSchool = (school) => ({ role: 'STAFF', branch: { schoolId: school.id } });

/**
 * The Owner's staff list for transfers (T1): their school's staff with name, Staff ID, job title,
 * status, current branch and a scheduled transfer. No contact details or account data.
 */
export async function listSchoolStaff(school, { q, branch, status, page, pageSize }) {
  const prisma = getPrisma();
  const contains = (value) => ({ contains: value, mode: 'insensitive' });
  if (branch && !(await prisma.branch.findFirst({ where: { id: branch, schoolId: school.id }, select: { id: true } }))) throw notFound('Branch not found.');
  const where = {
    ...inSchool(school),
    ...(branch && { branchId: branch }),
    ...(q && { OR: [{ name: contains(q) }, { staffId: contains(q) }, { jobTitle: contains(q) }] }),
    ...(status && { status: toDbStatus(status) }),
  };
  const total = await prisma.user.count({ where });
  const { skip, take, meta } = pageWindow(total, page, pageSize);
  const rows = await prisma.user.findMany({ where, select: ownerStaffSelect, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip, take });
  return { items: rows.map(toOwnerStaff), ...meta };
}

async function findSchoolStaff(client, school, id) {
  const staff = isUuid(id) ? await client.user.findFirst({ where: { id, ...inSchool(school) }, select: ownerStaffSelect }) : null;
  // A staff member of another school is reported exactly like one that does not exist.
  if (!staff) throw notFound('Staff member not found.');
  return staff;
}

/** One staff member for the Owner, with their transfer history (newest first) and today's date. */
export async function getSchoolStaff(school, id, client = getPrisma()) {
  const staff = await findSchoolStaff(client, school, id);
  const now = new Date();
  const [timeZone, policy] = await Promise.all([platformTimeZone(), schedulingPolicy(client)]);
  const today = localDate(timeZone, now);
  const transfers = await client.staffTransfer.findMany({ where: { staffUserId: staff.id }, include: transferInclude, orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }] });
  const items = [];
  for (const t of transfers) items.push(await toTransfer(t, client));
  const { earliestEffectiveDate: earliestTransferDate, ...dates } = effectiveDateFields(policy, { timeZone, today, now });
  return { ...toOwnerStaff(staff), transfers: items, timeZone, ...dates, earliestTransferDate, latestTransferDate: addDays(today, MAX_AHEAD_DAYS) };
}

/** The shifts of one of the Owner's branches in the schedule in effect on a date (for choosing destination shifts). */
export async function branchShiftsOn(school, branchId, date) {
  const prisma = getPrisma();
  const branch = isUuid(branchId) ? await prisma.branch.findFirst({ where: { id: branchId, schoolId: school.id }, select: { id: true } }) : null;
  if (!branch) throw notFound('Branch not found.');
  const schedule = await scheduleOn(branch.id, date, prisma);
  return {
    date,
    schedule: schedule && {
      effectiveFrom: fromDbDate(schedule.effectiveFrom),
      timeZone: schedule.timeZone,
      shifts: schedule.shifts.map((s) => ({ key: s.shiftKey, name: s.name, days: s.days, start: toTime(s.startMinute), end: toTime(s.endMinute) })),
    },
  };
}

/**
 * What a Manager sees of their staff member's transfers (T12): a scheduled transfer out of their
 * branch (date only) and the transfers into and out of their branch. The other branch is never
 * named, so a Manager learns nothing about another branch.
 */
export async function transferSummary(branch, staffUserId, client = getPrisma()) {
  const rows = await client.staffTransfer.findMany({
    where: { staffUserId, status: { in: IN_EFFECT }, OR: [{ fromBranchId: branch.id }, { toBranchId: branch.id }] },
    orderBy: { effectiveAt: 'desc' },
    select: { status: true, effectiveFrom: true, fromBranchId: true },
  });
  const scheduled = rows.find((r) => r.status === 'SCHEDULED' && r.fromBranchId === branch.id);
  return {
    scheduledOut: scheduled ? { effectiveFrom: fromDbDate(scheduled.effectiveFrom) } : null,
    history: rows.filter((r) => r.status === 'COMPLETED').map((r) => ({ effectiveFrom: fromDbDate(r.effectiveFrom), direction: r.fromBranchId === branch.id ? 'out' : 'in' })),
  };
}

/** The staff member's own upcoming transfer (their profile in the app), or null. */
export async function upcomingTransfer(staffUserId, client = getPrisma()) {
  const t = await client.staffTransfer.findFirst({ where: { staffUserId, status: 'SCHEDULED' }, include: { toBranch: true } });
  return t ? { effectiveFrom: fromDbDate(t.effectiveFrom), branch: { code: t.toBranch.code, name: t.toBranch.name } } : null;
}

// ---- changes -----------------------------------------------------------------------------

/** Locks the staff row of the Owner's school (FOR UPDATE). Another school's staff member → 404. */
async function lockSchoolStaff(tx, school, id) {
  if (!isUuid(id)) throw notFound('Staff member not found.');
  const [row] = await tx.$queryRaw`
    SELECT u."id" FROM "User" u JOIN "Branch" b ON b."id" = u."branchId"
    WHERE u."id" = ${id} AND u."role" = 'STAFF' AND b."schoolId" = ${school.id} FOR UPDATE OF u`;
  if (!row) throw notFound('Staff member not found.');
  return tx.user.findUnique({ where: { id }, select: { id: true, name: true, staffId: true, branchId: true, branch: true } });
}

/**
 * Schedules a transfer (School Owner, T1–T7): `branchId` (another branch of the same school,
 * operating), `effectiveFrom` and `effectiveTime` (today + the effective delay at 00:00 at the earliest, or with
 * timed changes any time after now; at most a year ahead) and `shifts` (the
 * destination assignment set; may be empty). One transfer per staff member may be scheduled.
 * In one transaction: the destination assignment set from that date, scheduled assignment changes
 * from that date on cancelled, the transfer, its notification event and STAFF_TRANSFER_SCHEDULED.
 */
export async function scheduleTransfer(school, id, { branchId, effectiveFrom, effectiveTime = null, shifts }, user, req) {
  const timeZone = await platformTimeZone();
  const outbox = [];
  let transferId;
  try {
    transferId = await getPrisma().$transaction(async (tx) => {
      await lockActiveSchool(tx, school);
      const staff = await lockSchoolStaff(tx, school, id);
      const now = new Date();
      const today = localDate(timeZone, now);
      const errors = {};
      const [destination] = await tx.$queryRaw`
        SELECT "id", "code", "name", "status"::text AS "status" FROM "Branch" WHERE "id" = ${branchId} AND "schoolId" = ${school.id} FOR SHARE`;
      // A branch of another school is reported exactly like one that does not exist.
      if (!destination) errors.branchId = 'Choose a branch of your school.';
      else if (destination.id === staff.branchId) errors.branchId = 'This staff member already works at this branch. Choose another branch.';
      else if (destination.status !== 'ACTIVE') errors.branchId = 'This branch is suspended and cannot receive staff. Choose an active branch.';
      let effectiveAt;
      try {
        ({ effectiveAt } = resolveEffective(await schedulingPolicy(tx), { what: 'transfer', effectiveFrom, effectiveTime, timeZone, today, latest: addDays(today, MAX_AHEAD_DAYS), now }));
      } catch (problem) {
        if (!problem.details) throw problem;
        Object.assign(errors, problem.details);
      }
      if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);

      if (await tx.staffTransfer.findFirst({ where: { staffUserId: staff.id, status: 'SCHEDULED' }, select: { id: true } })) throw ALREADY_SCHEDULED();

      const schedule = await scheduleAt(destination.id, effectiveAt, tx);
      if (shifts.length && !schedule) {
        throw badRequest('Check the highlighted fields.', { effectiveFrom: `${destination.name} has no schedule in effect from ${effectiveText(effectiveAt, timeZone)}. Choose no shifts, or a date when it has one.` });
      }
      const shiftErrors = assignedShiftErrors(schedule, shifts, effectiveFrom, 'the destination branch');
      if (Object.keys(shiftErrors).length) throw badRequest('Check the highlighted fields.', shiftErrors);

      const replaced = await tx.staffAssignment.findMany({ where: { staffUserId: staff.id, cancelledAt: null, effectiveAt: { gte: effectiveAt } }, select: { id: true, effectiveAt: true, timeZone: true } });
      if (replaced.length) await tx.staffAssignment.updateMany({ where: { id: { in: replaced.map((r) => r.id) } }, data: { cancelledAt: now } });
      const assignment = await tx.staffAssignment.create({
        data: { staffUserId: staff.id, branchId: destination.id, effectiveFrom: asDbDate(effectiveFrom), effectiveAt, timeZone, shifts: { create: shifts } },
      });
      const transfer = await tx.staffTransfer.create({
        data: {
          staffUserId: staff.id,
          schoolId: school.id,
          fromBranchId: staff.branchId,
          toBranchId: destination.id,
          effectiveFrom: asDbDate(effectiveFrom),
          effectiveAt,
          timeZone,
          assignmentId: assignment.id,
          requestedById: user.id,
        },
      });
      await enqueue(tx, OUTBOX.STAFF_TRANSFER, { transferId: transfer.id, action: 'scheduled' }, `staff-transfer:${transfer.id}:scheduled`, outbox);
      const byKey = new Map((schedule?.shifts ?? []).map((s) => [s.shiftKey, s]));
      const shiftText = shifts.length
        ? shifts.map((a) => shiftLabel({ name: byKey.get(a.shiftKey).name, days: a.days, start: toTime(byKey.get(a.shiftKey).startMinute), end: toTime(byKey.get(a.shiftKey).endMinute) })).join('; ')
        : 'No shifts';
      await recordAuditEvent({
        client: tx,
        action: AUDIT_ACTIONS.STAFF_TRANSFER_SCHEDULED,
        actor: actorOf(user),
        target: staffTarget(staff),
        schoolId: school.id,
        description: `Transfer scheduled from ${branchLabel(staff.branch)} to ${branchLabel(destination)}, effective ${effectiveFrom} ${localDateTime(effectiveAt, timeZone).time} (${timeZone}).`,
        change: {
          fields: [
            { field: 'Branch', from: branchLabel(staff.branch), to: branchLabel(destination) },
            { field: 'Effective from', from: null, to: `${effectiveFrom} ${localDateTime(effectiveAt, timeZone).time} (${timeZone})` },
            { field: 'Shifts at the destination', from: null, to: shiftText },
            ...(replaced.length ? [{ field: 'Scheduled assignment changes', from: replaced.map((r) => `From ${effectiveText(r.effectiveAt, r.timeZone)}`).join(', '), to: 'Cancelled' }] : []),
          ],
        },
        req,
      });
      return transfer.id;
    });
  } catch (error) {
    // The partial unique index: a simultaneous request scheduled one first.
    if (isUniqueViolation(error)) throw ALREADY_SCHEDULED();
    throw error;
  }
  await dispatch(outbox);
  const t = await getPrisma().staffTransfer.findUnique({ where: { id: transferId }, include: transferInclude });
  return toTransfer(t, getPrisma());
}

/**
 * Cancels the scheduled transfer before it takes effect (School Owner): the destination assignment
 * set is cancelled too; STAFF_TRANSFER_CANCELLED is recorded and the staff member and the
 * destination Managers are told. Assignment changes cancelled when it was scheduled stay cancelled
 * (the Manager can set new ones). None scheduled → 404; already in effect → 409.
 */
export async function cancelTransfer(school, id, user, req) {
  const outbox = [];
  await getPrisma().$transaction(async (tx) => {
    await lockActiveSchool(tx, school);
    const staff = await lockSchoolStaff(tx, school, id);
    const transfer = await tx.staffTransfer.findFirst({ where: { staffUserId: staff.id, status: 'SCHEDULED' }, include: transferInclude });
    if (!transfer) throw notFound('There is no scheduled transfer for this staff member.');
    const now = new Date();
    if (transfer.effectiveAt <= now) throw conflict('TRANSFER_IN_EFFECT', 'This transfer has already taken effect and can no longer be cancelled.');
    await tx.staffTransfer.update({ where: { id: transfer.id }, data: { status: 'CANCELLED', cancelledAt: now, cancelledById: user.id } });
    if (transfer.assignmentId) await tx.staffAssignment.updateMany({ where: { id: transfer.assignmentId, cancelledAt: null }, data: { cancelledAt: now } });
    await enqueue(tx, OUTBOX.STAFF_TRANSFER, { transferId: transfer.id, action: 'cancelled' }, `staff-transfer:${transfer.id}:cancelled`, outbox);
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.STAFF_TRANSFER_CANCELLED,
      actor: actorOf(user),
      target: staffTarget(staff),
      schoolId: school.id,
      description: `Scheduled transfer to ${branchLabel(transfer.toBranch)} from ${fromDbDate(transfer.effectiveFrom)} cancelled.`,
      change: { field: 'Scheduled transfer', from: `${branchLabel(transfer.toBranch)} from ${fromDbDate(transfer.effectiveFrom)}`, to: 'Cancelled' },
      req,
    });
  });
  await dispatch(outbox);
  return getSchoolStaff(school, id);
}

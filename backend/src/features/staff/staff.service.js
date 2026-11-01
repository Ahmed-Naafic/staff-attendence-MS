import { Prisma } from '@prisma/client';
import { badRequest, conflict, notFound } from '../../common/httpError.js';
import { fromDbStatus, pageWindow, statusSummary, toDbStatus } from '../../common/listQuery.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { dispatch, enqueue, OUTBOX } from '../notifications/outbox.js';
import { hashPassword } from '../auth/password.js';
import { localDateTime } from '../../common/zonedTime.js';
import { effectiveDateFields, effectiveText, resolveEffective, schedulingPolicy } from '../platform-settings/schedulingPolicy.js';
import { platformTimeZone } from '../platform-settings/settings.service.js';
import { dayList, toTime } from '../schedules/scheduleInput.js';
import { addDays, BRANCH_TX, lastDayBefore, localDate, lockOperatingBranch, MAX_AHEAD_DAYS, scheduleAt, scheduleOn } from '../schedules/schedules.service.js';
import { phoneKey } from '../schools/schoolInput.js';
import { transferSummary } from './transfers.service.js';

/*
 * Staff accounts and shift assignments (approved rules: docs/business-rules.md → Staff accounts and
 * shift assignments). Every function takes the Manager's branch (req.branch, read from the database
 * by requireManagerBranch, never from the request) and only reads or writes that branch's staff.
 *
 * Writes lock the school (FOR SHARE) and branch (FOR UPDATE) rows and need both ACTIVE (409
 * BRANCH_NOT_OPERATING). Staff IDs come from Branch.staffSequence, raised by one UPDATE … RETURNING on
 * the locked branch row. Assignment sets follow the schedule-version pattern: insert-only, a
 * replaced or cancelled scheduled set gets cancelledAt. Each change and its audit event are written
 * in one transaction; passwords are hashed before it and never returned, logged or recorded.
 */

export const STAFF_STATUSES = ['active', 'suspended'];

const staffSelect = {
  id: true,
  staffId: true,
  name: true,
  phone: true,
  jobTitle: true,
  email: true,
  status: true,
  suspensionReason: true,
  suspendedAt: true,
  mustChangePassword: true,
  createdAt: true,
  lastSignInAt: true,
};

/** The staff shape the web app uses. Never includes password hashes or sessions. */
const toStaff = (s) => ({
  id: s.id,
  staffId: s.staffId,
  name: s.name,
  phone: s.phone ?? '',
  jobTitle: s.jobTitle ?? '',
  email: s.email ?? '',
  status: fromDbStatus(s.status),
  suspensionReason: s.suspensionReason ?? null,
  suspendedAt: s.suspendedAt?.toISOString() ?? null,
  passwordChangePending: s.mustChangePassword,
  createdAt: s.createdAt.toISOString(),
  lastSignInAt: s.lastSignInAt?.toISOString() ?? null,
});

const inBranch = (branch) => ({ role: 'STAFF', branchId: branch.id });
const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });
const auditTarget = (s) => ({ type: 'staff', id: s.id, name: `${s.name} (${s.staffId})` });
const isUniqueViolation = (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
const EMAIL_TAKEN = () => conflict('EMAIL_TAKEN', 'An account with this email already exists.', { email: 'An account with this email already exists.' });
const PHONE_TAKEN = () =>
  conflict('PHONE_TAKEN', 'A staff account with this phone number already exists.', { phone: 'A staff account with this phone number already exists (it is how staff sign in).' });
const LABELS = { name: 'Full name', phone: 'Phone', jobTitle: 'Job title', email: 'Email' };
const fromDbDate = (value) => value.toISOString().slice(0, 10);
const asDbDate = (date) => new Date(`${date}T00:00:00Z`);

function uniqueViolation(error) {
  const target = JSON.stringify(error.meta ?? {});
  if (target.includes('phoneKey')) return PHONE_TAKEN();
  if (target.includes('email')) return EMAIL_TAKEN();
  return error;
}

// ---- reads --------------------------------------------------------------------------------

/** Search (name, Staff ID, phone, job title, email), status filter and pagination, newest first. */
export async function listStaff(branch, { q, status, page, pageSize }) {
  const prisma = getPrisma();
  const contains = (value) => ({ contains: value, mode: 'insensitive' });
  const where = {
    ...inBranch(branch),
    ...(q && { OR: [{ name: contains(q) }, { staffId: contains(q) }, { phone: contains(q) }, { jobTitle: contains(q) }, { email: contains(q) }] }),
    ...(status && { status: toDbStatus(status) }),
  };
  const [total, groups] = await Promise.all([prisma.user.count({ where }), prisma.user.groupBy({ by: ['status'], where: inBranch(branch), _count: { _all: true } })]);
  const { skip, take, meta } = pageWindow(total, page, pageSize);
  const rows = await prisma.user.findMany({ where, select: staffSelect, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip, take });
  return { items: rows.map(toStaff), ...meta, summary: statusSummary(groups, STAFF_STATUSES) };
}

async function findOrFail(client, branch, id) {
  const staff = isUuid(id) ? await client.user.findFirst({ where: { id, ...inBranch(branch) }, select: staffSelect }) : null;
  // A staff member of another branch is reported exactly like one that does not exist.
  if (!staff) throw notFound('Staff member not found.');
  return staff;
}

const assignmentInclude = { shifts: { orderBy: { shiftKey: 'asc' } } };

/**
 * The set in effect by the end of a branch-local date (newest non-cancelled set starting on or
 * before it, at any time that day), or null. Use assignmentAt for an instant and daySets for a day
 * on which a set starts after 00:00.
 */
export function assignmentOn(staffUserId, date, client = getPrisma()) {
  return client.staffAssignment.findFirst({
    where: { staffUserId, cancelledAt: null, effectiveFrom: { lte: asDbDate(date) } },
    orderBy: [{ effectiveFrom: 'desc' }, { effectiveAt: 'desc' }, { recordedAt: 'desc' }],
    include: assignmentInclude,
  });
}

/** The set in effect at an instant (the newest non-cancelled set whose effectiveAt has arrived), or null. */
export function assignmentAt(staffUserId, instant, client = getPrisma()) {
  return client.staffAssignment.findFirst({
    where: { staffUserId, cancelledAt: null, effectiveAt: { lte: instant } },
    orderBy: [{ effectiveAt: 'desc' }, { recordedAt: 'desc' }],
    include: assignmentInclude,
  });
}

/** The sets that apply during a day [dayStart, dayEnd): the one in effect at dayStart, then each starting during the day, in order. */
export async function daySets(staffUserId, dayStart, dayEnd, client = getPrisma()) {
  const [first, later] = await Promise.all([
    assignmentAt(staffUserId, dayStart, client),
    client.staffAssignment.findMany({
      where: { staffUserId, cancelledAt: null, effectiveAt: { gt: dayStart, lt: dayEnd } },
      orderBy: [{ effectiveAt: 'asc' }, { recordedAt: 'asc' }],
      include: assignmentInclude,
    }),
  ]);
  return [...(first ? [first] : []), ...later];
}

/** The scheduled (not yet in effect) set of the staff member in a branch after `now` (an instant); a transfer's destination set belongs to the destination. */
function assignmentAfter(staffUserId, now, client, branchId) {
  return client.staffAssignment.findFirst({
    where: { staffUserId, cancelledAt: null, effectiveAt: { gt: now }, ...(branchId && { branchId }) },
    orderBy: [{ effectiveAt: 'asc' }, { recordedAt: 'asc' }],
    include: assignmentInclude,
  });
}

/** Shift summaries of a schedule version (for forms and for naming assigned shifts). */
const shiftOptions = (schedule) =>
  schedule ? schedule.shifts.map((s) => ({ key: s.shiftKey, name: s.name, days: s.days, start: toTime(s.startMinute), end: toTime(s.endMinute) })) : [];

/** An assignment set with each shift named from the schedule in effect when it takes effect. */
async function toAssignment(set, client) {
  if (!set) return null;
  const effectiveFrom = fromDbDate(set.effectiveFrom);
  const schedule = await scheduleAt(set.branchId, set.effectiveAt, client);
  const named = new Map(shiftOptions(schedule).map((s) => [s.key, s]));
  return {
    id: set.id,
    effectiveFrom,
    // The local time it takes effect ('00:00' from the start of its date).
    effectiveTime: localDateTime(set.effectiveAt, set.timeZone).time,
    effectiveAt: set.effectiveAt.toISOString(),
    timeZone: set.timeZone,
    recordedAt: set.recordedAt.toISOString(),
    cancelledAt: set.cancelledAt?.toISOString() ?? null,
    shifts: set.shifts.map((a) => {
      const shift = named.get(a.shiftKey);
      return { shiftKey: a.shiftKey, days: a.days, name: shift?.name ?? null, start: shift?.start ?? null, end: shift?.end ?? null };
    }),
  };
}

/**
 * One staff member with their assignments: the set in effect today, the scheduled set, the allowed
 * effective dates, and the branch's shifts in the schedule in effect today and in a scheduled change.
 */
export async function getStaff(branch, id, client = getPrisma()) {
  const staff = await findOrFail(client, branch, id);
  const now = new Date();
  const [timeZone, policy] = await Promise.all([platformTimeZone(), schedulingPolicy(client)]);
  const today = localDate(timeZone, now);
  const [current, scheduled, scheduleNow, scheduleNext] = await Promise.all([
    assignmentAt(staff.id, now, client),
    assignmentAfter(staff.id, now, client, branch.id),
    scheduleAt(branch.id, now, client),
    client.branchSchedule.findFirst({
      where: { branchId: branch.id, cancelledAt: null, effectiveAt: { gt: now } },
      orderBy: { effectiveAt: 'asc' },
      include: { shifts: { orderBy: [{ startMinute: 'asc' }, { name: 'asc' }] } },
    }),
  ]);
  return {
    ...toStaff(staff),
    assignments: {
      timeZone,
      today,
      ...effectiveDateFields(policy, { timeZone, today, now, first: !current, immediateFirst: policy.immediateFirstAssignment }),
      latestEffectiveDate: addDays(today, MAX_AHEAD_DAYS),
      current: await toAssignment(current, client),
      scheduled: await toAssignment(scheduled, client),
    },
    transfer: await transferSummary(branch, staff.id, client),
    branchShifts: {
      current: scheduleNow ? { effectiveFrom: fromDbDate(scheduleNow.effectiveFrom), effectiveTime: localDateTime(scheduleNow.effectiveAt, scheduleNow.timeZone).time, shifts: shiftOptions(scheduleNow) } : null,
      scheduled: scheduleNext ? { effectiveFrom: fromDbDate(scheduleNext.effectiveFrom), effectiveTime: localDateTime(scheduleNext.effectiveAt, scheduleNext.timeZone).time, shifts: shiftOptions(scheduleNext) } : null,
    },
  };
}

/** Every assignment set of a staff member, newest effective date first, with state and effectiveUntil. */
export async function listAssignments(branch, id) {
  const prisma = getPrisma();
  const staff = await findOrFail(prisma, branch, id);
  const now = new Date();
  const rows = await prisma.staffAssignment.findMany({
    // This branch's sets only: a transferred staff member's sets at another branch are not this Manager's.
    where: { staffUserId: staff.id, branchId: branch.id },
    include: assignmentInclude,
    orderBy: [{ effectiveAt: 'desc' }, { recordedAt: 'desc' }],
  });
  const active = rows.filter((a) => !a.cancelledAt);
  const current = active.find((a) => a.effectiveAt <= now);
  const items = [];
  for (const a of rows) {
    const next = active.filter((o) => o.effectiveAt > a.effectiveAt).at(-1);
    const state = a.cancelledAt ? 'cancelled' : a === current ? 'current' : a.effectiveAt > now ? 'scheduled' : 'previous';
    items.push({
      ...(await toAssignment(a, prisma)),
      state,
      effectiveUntil: !a.cancelledAt && next ? lastDayBefore(next) : null,
      endsAt: !a.cancelledAt && next ? next.effectiveAt.toISOString() : null,
    });
  }
  return { items };
}

// ---- account changes ----------------------------------------------------------------------

async function lockStaff(tx, branch, id) {
  if (!isUuid(id)) throw notFound('Staff member not found.');
  const [row] = await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} AND "role" = 'STAFF' AND "branchId" = ${branch.id} FOR UPDATE`;
  if (!row) throw notFound('Staff member not found.');
  return findOrFail(tx, branch, id);
}

async function assertContactsFree(tx, { email, phone }, exceptId) {
  if (email) {
    const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
    if (existing && existing.id !== exceptId) throw EMAIL_TAKEN();
  }
  if (phone) {
    const existing = await tx.user.findFirst({ where: { role: 'STAFF', phoneKey: phoneKey(phone) }, select: { id: true } });
    if (existing && existing.id !== exceptId) throw PHONE_TAKEN();
  }
}

/**
 * Creates a STAFF account in the Manager's branch: ACTIVE (direct activation), with the next Staff
 * ID of the branch and a temporary password to change at first sign-in.
 */
export async function createStaff(branch, { password, ...details }, user, req) {
  const passwordHash = await hashPassword(password);
  try {
    const id = await getPrisma().$transaction(async (tx) => {
      await lockOperatingBranch(tx, branch);
      await assertContactsFree(tx, details);
      const [row] = await tx.$queryRaw`UPDATE "Branch" SET "staffSequence" = "staffSequence" + 1 WHERE "id" = ${branch.id} RETURNING "staffSequence", "code"`;
      const staffId = `${row.code}-ST${String(Number(row.staffSequence)).padStart(3, '0')}`;
      const created = await tx.user.create({
        data: { ...details, role: 'STAFF', status: 'ACTIVE', branchId: branch.id, staffId, phoneKey: phoneKey(details.phone), passwordHash, mustChangePassword: true },
        select: { id: true, name: true, staffId: true },
      });
      await recordAuditEvent({
        client: tx,
        action: AUDIT_ACTIONS.STAFF_CREATED,
        actor: actorOf(user),
        target: auditTarget(created),
        schoolId: branch.school.id,
        description: `Staff account created and activated in ${branch.name} (${branch.code}) with Staff ID ${staffId}, with a temporary password to change at first sign-in.`,
        change: {
          fields: [
            { field: 'Status', from: null, to: 'Active' },
            { field: 'Staff ID', from: null, to: staffId },
          ],
        },
        req,
      });
      return created.id;
    }, BRANCH_TX);
    return getStaff(branch, id);
  } catch (error) {
    if (isUniqueViolation(error)) throw uniqueViolation(error);
    throw error;
  }
}

/** Edits full name, phone, job title or email. Unchanged values are ignored; nothing changed → no event. */
export async function updateStaff(branch, id, values, user, req) {
  try {
    await getPrisma().$transaction(async (tx) => {
      await lockOperatingBranch(tx, branch);
      const current = await lockStaff(tx, branch, id);
      const changed = Object.keys(values).filter((field) => (current[field] ?? null) !== values[field]);
      if (!changed.length) return;
      await assertContactsFree(tx, { email: changed.includes('email') ? values.email : null, phone: changed.includes('phone') ? values.phone : null }, current.id);
      const data = Object.fromEntries(changed.map((f) => [f, values[f]]));
      if (data.phone) data.phoneKey = phoneKey(data.phone);
      const updated = await tx.user.update({ where: { id: current.id }, data, select: { id: true, name: true, staffId: true } });
      await recordAuditEvent({
        client: tx,
        action: AUDIT_ACTIONS.STAFF_UPDATED,
        actor: actorOf(user),
        target: auditTarget(updated),
        schoolId: branch.school.id,
        // Field names only (as for owners and Managers): the values stay in the account record.
        description: `Staff details updated: ${changed.map((f) => LABELS[f]).join(', ')}.`,
        req,
      });
    }, BRANCH_TX);
  } catch (error) {
    if (isUniqueViolation(error)) throw uniqueViolation(error);
    throw error;
  }
  return getStaff(branch, id);
}

/** ACTIVE → SUSPENDED with a reason; sessions end at once. Not active → 409 INVALID_STATUS. */
export async function suspendStaff(branch, id, reason, user, req) {
  await getPrisma().$transaction(async (tx) => {
    await lockOperatingBranch(tx, branch);
    const current = await lockStaff(tx, branch, id);
    const { count } = await tx.user.updateMany({
      where: { id: current.id, role: 'STAFF', status: 'ACTIVE' },
      data: { status: 'SUSPENDED', suspensionReason: reason, suspendedAt: new Date() },
    });
    if (count === 0) throw conflict('INVALID_STATUS', `Only an active staff member can be suspended. This staff member is ${fromDbStatus(current.status)}.`);
    await tx.session.deleteMany({ where: { userId: current.id } });
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.STAFF_SUSPENDED,
      actor: actorOf(user),
      target: auditTarget(current),
      schoolId: branch.school.id,
      description: `Staff account suspended. Reason: ${reason}`,
      change: { field: 'Status', from: 'Active', to: 'Suspended', reason },
      req,
    });
  }, BRANCH_TX);
  return getStaff(branch, id);
}

/** SUSPENDED → ACTIVE (earlier sessions stay ended). Not suspended → 409 INVALID_STATUS. */
export async function reactivateStaff(branch, id, user, req) {
  await getPrisma().$transaction(async (tx) => {
    await lockOperatingBranch(tx, branch);
    const current = await lockStaff(tx, branch, id);
    const { count } = await tx.user.updateMany({
      where: { id: current.id, role: 'STAFF', status: 'SUSPENDED' },
      data: { status: 'ACTIVE', suspensionReason: null, suspendedAt: null },
    });
    if (count === 0) throw conflict('INVALID_STATUS', `Only a suspended staff member can be reactivated. This staff member is ${fromDbStatus(current.status)}.`);
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.STAFF_REACTIVATED,
      actor: actorOf(user),
      target: auditTarget(current),
      schoolId: branch.school.id,
      description: 'Staff account reactivated.',
      change: { field: 'Status', from: 'Suspended', to: 'Active' },
      req,
    });
  }, BRANCH_TX);
  return getStaff(branch, id);
}

/** A new temporary password: replaces the hash, requires a change at the next sign-in, ends sessions. */
export async function resetStaffPassword(branch, id, password, user, req) {
  const passwordHash = await hashPassword(password);
  await getPrisma().$transaction(async (tx) => {
    await lockOperatingBranch(tx, branch);
    const current = await lockStaff(tx, branch, id);
    await tx.user.update({ where: { id: current.id }, data: { passwordHash, mustChangePassword: true } });
    const { count: ended } = await tx.session.deleteMany({ where: { userId: current.id } });
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.STAFF_PASSWORD_RESET,
      actor: actorOf(user),
      target: auditTarget(current),
      schoolId: branch.school.id,
      description: `New temporary password set; the staff member must change it at the next sign-in. Sessions ended: ${ended}.`,
      req,
    });
  }, BRANCH_TX);
  return getStaff(branch, id);
}

// ---- assignments --------------------------------------------------------------------------

/**
 * Field errors for an assignment set against the branch schedule in effect on its effective date:
 * each shift must be in that schedule and work the chosen days; assigned shifts sharing a day may
 * not overlap. Shared by the Manager's assignment changes and the Owner's transfers.
 */
export function assignedShiftErrors(schedule, shifts, effectiveFrom, whose = 'your branch') {
  const errors = {};
  const byKey = new Map((schedule?.shifts ?? []).map((s) => [s.shiftKey, s]));
  shifts.forEach((a, i) => {
    const shift = byKey.get(a.shiftKey);
    if (!shift) errors[`shifts.${i}.shiftKey`] = `This shift is not in ${whose}'s schedule on ${effectiveFrom}.`;
    else {
      const off = a.days.filter((d) => !shift.days.includes(d));
      if (off.length) errors[`shifts.${i}.days`] = `"${shift.name}" does not work on ${dayList(off)} in the schedule from ${fromDbDate(schedule.effectiveFrom)}.`;
    }
  });
  shifts.forEach((b, j) => {
    const sb = byKey.get(b.shiftKey);
    if (!sb || errors[`shifts.${j}.days`]) return;
    for (let i = 0; i < j; i += 1) {
      const sa = byKey.get(shifts[i].shiftKey);
      const shared = shifts[i].days.filter((d) => b.days.includes(d));
      if (sa && shared.length && sa.startMinute < sb.endMinute && sb.startMinute < sa.endMinute) {
        errors[`shifts.${j}.shiftKey`] = `Overlaps "${sa.name}" on ${dayList(shared)}.`;
        break;
      }
    }
  });
  return errors;
}

const canonical = (shifts) => JSON.stringify([...shifts].map((s) => [s.shiftKey, s.days.join(',')]).sort((a, b) => a[0].localeCompare(b[0])));
const summary = (items, named) => (items.length ? items.map((a) => `${named.get(a.shiftKey)?.name ?? 'Removed shift'}: ${dayList(a.days)}`).join('; ') : 'No shifts');

async function cancelSet(tx, branch, staff, set, user, req, reason, outbox) {
  await tx.staffAssignment.updateMany({ where: { id: set.id, cancelledAt: null }, data: { cancelledAt: new Date() } });
  await enqueue(tx, OUTBOX.ASSIGNMENT_CANCELLED, { assignmentId: set.id }, `assignment-cancelled:${set.id}`, outbox);
  await recordAuditEvent({
    client: tx,
    action: AUDIT_ACTIONS.STAFF_ASSIGNMENT_CHANGE_CANCELLED,
    actor: actorOf(user),
    target: auditTarget(staff),
    schoolId: branch.school.id,
    description: `Scheduled shift assignment change from ${effectiveText(set.effectiveAt, set.timeZone)} cancelled.${reason ? ` ${reason}` : ''}`,
    change: { field: 'Scheduled change', from: `From ${effectiveText(set.effectiveAt, set.timeZone)}`, to: 'Cancelled' },
    req,
  });
}

/**
 * Saves an assignment set from `effectiveFrom` (and `effectiveTime` with timed changes): at the
 * earliest today + the effective delay, or today for the staff member's first set when the settings
 * allow it; with timed changes any time after now; at most a year ahead. Each shift and its days
 * must exist in the branch schedule in effect at that moment; assigned shifts sharing a day may not overlap. A
 * scheduled set is replaced (kept as cancelled). Saving the set in effect changes nothing (or only
 * cancels a scheduled set).
 */
export async function saveAssignments(branch, id, { effectiveFrom, effectiveTime = null, shifts }, user, req) {
  const timeZone = await platformTimeZone();
  const outbox = [];
  await getPrisma().$transaction(async (tx) => {
    await lockOperatingBranch(tx, branch);
    const staff = await lockStaff(tx, branch, id);
    const now = new Date();
    const today = localDate(timeZone, now);
    const [current, scheduled, transfer] = await Promise.all([
      assignmentAt(staff.id, now, tx),
      assignmentAfter(staff.id, now, tx, branch.id),
      tx.staffTransfer.findFirst({ where: { staffUserId: staff.id, status: 'SCHEDULED' }, select: { effectiveFrom: true, effectiveAt: true } }),
    ]);
    // Read in the transaction: a settings change saved meanwhile applies to this save.
    const policy = await schedulingPolicy(tx);
    const errors = {};
    const { effectiveAt } = resolveEffective(policy, {
      what: 'assignments',
      effectiveFrom,
      effectiveTime,
      timeZone,
      today,
      latest: addDays(today, MAX_AHEAD_DAYS),
      now,
      first: !current,
      immediateFirst: policy.immediateFirstAssignment,
    });
    // After a scheduled transfer the destination branch's assignments apply (set by the School Owner).
    if (transfer && effectiveAt >= transfer.effectiveAt) {
      throw badRequest('Check the highlighted fields.', {
        effectiveFrom: `This staff member moves to another branch from ${effectiveText(transfer.effectiveAt, timeZone)}. Assignments in your branch must start before then.`,
      });
    }

    const schedule = await scheduleAt(branch.id, effectiveAt, tx);
    if (shifts.length && !schedule) {
      throw badRequest('Check the highlighted fields.', { effectiveFrom: `Your branch has no schedule in effect on ${effectiveFrom}. Set the schedule first.` });
    }
    Object.assign(errors, assignedShiftErrors(schedule, shifts, effectiveFrom));
    if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
    const byKey = new Map((schedule?.shifts ?? []).map((s) => [s.shiftKey, s]));

    const named = new Map([...byKey].map(([k, s]) => [k, s]));
    if (current && canonical(current.shifts) === canonical(shifts)) {
      if (scheduled) await cancelSet(tx, branch, staff, scheduled, user, req, 'The assignments saved are the ones already in effect.', outbox);
      return;
    }
    const fields = [];
    if (scheduled) {
      await tx.staffAssignment.updateMany({ where: { id: scheduled.id, cancelledAt: null }, data: { cancelledAt: new Date() } });
      fields.push({ field: 'Scheduled change', from: `From ${effectiveText(scheduled.effectiveAt, scheduled.timeZone)}`, to: 'Replaced' });
    }
    const created = await tx.staffAssignment.create({
      data: { staffUserId: staff.id, branchId: branch.id, effectiveFrom: asDbDate(effectiveFrom), effectiveAt, timeZone, shifts: { create: shifts } },
    });
    // The staff member is told about their new shifts (a replaced scheduled set is covered by this notice).
    await enqueue(tx, OUTBOX.ASSIGNMENT_CHANGED, { assignmentId: created.id }, `assignment:${created.id}`, outbox);
    const previousSchedule = current ? await scheduleAt(branch.id, now, tx) : null;
    const previousNames = new Map((previousSchedule?.shifts ?? []).map((s) => [s.shiftKey, s]));
    fields.push(
      { field: 'Effective from', from: current ? effectiveText(current.effectiveAt, current.timeZone) : null, to: `${effectiveText(effectiveAt, timeZone)} (${timeZone})` },
      { field: 'Shifts', from: current ? summary(current.shifts, previousNames) : null, to: summary(shifts, named) },
    );
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.STAFF_ASSIGNMENT_CHANGED,
      actor: actorOf(user),
      target: auditTarget(staff),
      schoolId: branch.school.id,
      description: `Shift assignments ${current ? 'changed' : 'set'} from ${effectiveText(effectiveAt, timeZone)}: ${summary(shifts, named)}.`,
      change: { fields },
      req,
    });
  }, BRANCH_TX);
  await dispatch(outbox);
  return getStaff(branch, id);
}

/** Cancels the scheduled assignment set (404 when there is none). */
export async function cancelScheduledAssignments(branch, id, user, req) {
  const outbox = [];
  await getPrisma().$transaction(async (tx) => {
    await lockOperatingBranch(tx, branch);
    const staff = await lockStaff(tx, branch, id);
    const scheduled = await assignmentAfter(staff.id, new Date(), tx, branch.id);
    if (!scheduled) throw notFound('There is no scheduled assignment change.');
    await cancelSet(tx, branch, staff, scheduled, user, req, undefined, outbox);
  }, BRANCH_TX);
  await dispatch(outbox);
  return getStaff(branch, id);
}

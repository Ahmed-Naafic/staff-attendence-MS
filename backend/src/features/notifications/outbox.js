import { getPrisma } from '../../config/prisma.js';
import { localParts } from '../attendance/attendanceReports.service.js';
import { platformTimeZone } from '../platform-settings/settings.service.js';
import { toTime } from '../schedules/scheduleInput.js';
import { localDate, scheduleOn } from '../schedules/schedules.service.js';
import { createNotifications } from './notify.js';
import { checkPushReceipts, sendPendingPush } from './push.js';
import { latestSets, scheduleImpact } from './scheduleImpact.js';
import { staffBranchAt, zonedMidnight } from '../staff/transfers.service.js';

/*
 * Transactional outbox (N20). A business change calls enqueue() inside its own transaction, so the
 * event exists exactly when the change committed. After the commit, dispatch() turns the events into
 * notifications (recipients resolved from the current roles, schools and branch assignments) and
 * tries to send their pushes; the scheduled job (jobs.js) retries whatever is still pending.
 * A failure here is logged and retried; it never fails or rolls back the business request.
 *
 * Processing claims an event with a conditional update (a lease), so the request and the job never
 * work on it at the same time, and every notification has a unique dedupe key, so a retry after a
 * partial failure creates nothing twice.
 */

export const OUTBOX = {
  LATE_CHECK_IN: 'LATE_CHECK_IN', // { eventId }
  ASSIGNMENT_CHANGED: 'ASSIGNMENT_CHANGED', // { assignmentId }
  ASSIGNMENT_CANCELLED: 'ASSIGNMENT_CANCELLED', // { assignmentId }
  SCHEDULE_CHANGED: 'SCHEDULE_CHANGED', // { versionId, baselineId }
  SCHEDULE_CHANGE_CANCELLED: 'SCHEDULE_CHANGE_CANCELLED', // { versionId }
  MANAGER_ASSIGNED: 'MANAGER_ASSIGNED', // { managerId, branchId, fromBranchId?, assignmentId }
  BRANCH_MANAGER_CHECK: 'BRANCH_MANAGER_CHECK', // { branchId }
  BRANCH_STATUS: 'BRANCH_STATUS', // { branchId, status: 'SUSPENDED' | 'ACTIVE', periodId }
  SCHOOL_STATUS: 'SCHOOL_STATUS', // { schoolId, status, periodId }
  STAFF_TRANSFER: 'STAFF_TRANSFER', // { transferId, action: 'scheduled' | 'cancelled' }
};

const LEASE_MS = 2 * 60 * 1000;
export const MAX_ATTEMPTS = 8;
/** Wait before attempt n + 1 (minutes): 1, 5, 15, 60, then 3 hours. */
export const retryDelayMs = (attempts) => [1, 5, 15, 60, 180][Math.min(attempts - 1, 4)] * 60 * 1000;

/**
 * Writes an outbox event in the caller's transaction and adds its id to `sink` (to dispatch after
 * the commit). A duplicate dedupe key (the same business event) is ignored.
 */
export async function enqueue(tx, type, payload, dedupeKey, sink) {
  const [row] = await tx.notificationEvent.createManyAndReturn({ data: [{ type, payload, dedupeKey }], skipDuplicates: true, select: { id: true } });
  if (row && sink) sink.push(row.id);
  return row?.id ?? null;
}

/** After a commit: process these events now and send their pushes. Never throws. */
export async function dispatch(ids, { now = new Date(), send } = {}) {
  if (!ids?.length) return;
  try {
    for (const id of ids) await processEvent(id, { now });
    await sendPendingPush({ now, limit: 50, send });
    // Receipts of earlier pushes that are due (cheap when there are none; the job does the rest).
    await checkPushReceipts({ now, limit: 100 });
  } catch (error) {
    console.error('[notifications] dispatch failed; the scheduled job retries:', error.message);
  }
}

/** Processes one event if it is due and not being processed elsewhere. → 'done' | 'retry' | 'failed' | 'skipped'. */
export async function processEvent(id, { now = new Date(), client = getPrisma() } = {}) {
  const claimed = await client.notificationEvent.updateMany({
    where: { id, status: 'PENDING', nextAttemptAt: { lte: now } },
    data: { attempts: { increment: 1 }, nextAttemptAt: new Date(now.getTime() + LEASE_MS) },
  });
  if (!claimed.count) return 'skipped';
  const event = await client.notificationEvent.findUnique({ where: { id } });
  try {
    const handler = HANDLERS[event.type];
    if (!handler) throw new Error(`Unknown notification event type ${event.type}.`);
    const items = await handler(event.payload, { client, now, eventId: event.id });
    await createNotifications(items, { client, now });
    await client.notificationEvent.update({ where: { id }, data: { status: 'DONE', processedAt: now, lastError: null } });
    return 'done';
  } catch (error) {
    const failed = event.attempts >= MAX_ATTEMPTS;
    await client.notificationEvent.update({
      where: { id },
      data: { status: failed ? 'FAILED' : 'PENDING', nextAttemptAt: new Date(now.getTime() + retryDelayMs(event.attempts)), lastError: String(error.message).slice(0, 500) },
    });
    console.error(`[notifications] event ${id} (${event.type}) failed, attempt ${event.attempts}:`, error.message);
    return failed ? 'failed' : 'retry';
  }
}

/** Pending events that are due, oldest first (the job's catch-up). */
export async function processPendingEvents({ now = new Date(), limit = 200, stop = () => false } = {}) {
  const due = await getPrisma().notificationEvent.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: now } }, orderBy: { createdAt: 'asc' }, take: limit, select: { id: true } });
  const counts = { done: 0, retry: 0, failed: 0, skipped: 0 };
  for (const { id } of due) {
    if (stop()) break;
    counts[await processEvent(id, { now })] += 1;
  }
  return counts;
}

// ---- recipient resolution (one handler per event type) -------------------------------------

const branchRef = (b) => ({ name: b.name, code: b.code });
const hhmm = (time) => time.slice(0, 5);
/** Everyone currently working in a branch with one of these roles (any status: suspended accounts keep in-app notices, N15). */
const branchUsers = (client, branchId, roles) => client.user.findMany({ where: { branchId, role: { in: roles } }, select: { id: true, role: true } });

/** "Branch has no schedule in effect" notices for these Managers (once per Manager and branch while kept). */
export function noScheduleItems(branch, managers, date) {
  return managers.map((m) => ({
    type: 'BRANCH_NO_SCHEDULE',
    recipientId: m.id,
    schoolId: branch.schoolId,
    branchId: branch.id,
    subjectType: 'branch',
    subjectId: branch.id,
    params: { branch: branchRef(branch), date },
    dedupeKey: `no-schedule:${branch.id}:${m.id}`,
  }));
}

const HANDLERS = {
  /** N6: an accepted late check-in received during its work day → the branch's Managers. Uploaded after the work day → digest only. */
  async LATE_CHECK_IN({ eventId }, { client }) {
    const e = await client.attendanceEvent.findUnique({
      where: { id: eventId },
      select: {
        id: true, status: true, occurredAt: true, receivedAt: true, workDate: true, shiftKey: true, branchId: true,
        schedule: { select: { timeZone: true, shifts: true } },
        staff: { select: { name: true, staffId: true } },
        branch: { select: { schoolId: true } },
      },
    });
    if (!e || e.status !== 'LATE') return [];
    const tz = e.schedule.timeZone;
    const workDate = e.workDate.toISOString().slice(0, 10);
    if (localParts(e.receivedAt, tz).date !== workDate) return [];
    const shift = e.schedule.shifts.find((s) => s.shiftKey === e.shiftKey);
    const occurred = localParts(e.occurredAt, tz); // the event time, never the upload time
    const params = {
      staffName: e.staff.name,
      staffCode: e.staff.staffId,
      shiftName: shift?.name ?? '',
      shiftStart: shift ? toTime(shift.startMinute) : '',
      date: occurred.date,
      time: hhmm(occurred.time),
      timeZone: tz,
    };
    const managers = await branchUsers(client, e.branchId, ['MANAGER']);
    return managers.map((m) => ({
      type: 'LATE_CHECK_IN',
      recipientId: m.id,
      schoolId: e.branch.schoolId,
      branchId: e.branchId,
      subjectType: 'attendanceEvent',
      subjectId: e.id,
      params,
      dedupeKey: `late:${e.id}:${m.id}`,
    }));
  },

  /** N3-3: the staff member, with their new shifts as of the effective date. */
  async ASSIGNMENT_CHANGED({ assignmentId }, { client }) {
    const set = await client.staffAssignment.findUnique({
      where: { id: assignmentId },
      include: { shifts: true, branch: { select: { schoolId: true } } },
    });
    if (!set) return [];
    const effectiveFrom = set.effectiveFrom.toISOString().slice(0, 10);
    const schedule = await scheduleOn(set.branchId, effectiveFrom, client);
    const byKey = new Map((schedule?.shifts ?? []).map((s) => [s.shiftKey, s]));
    const shifts = set.shifts
      .map((a) => ({ a, s: byKey.get(a.shiftKey) }))
      .filter(({ s }) => s)
      .sort((x, y) => x.s.startMinute - y.s.startMinute)
      .map(({ a, s }) => ({ name: s.name, days: a.days, start: toTime(s.startMinute), end: toTime(s.endMinute) }));
    return [
      {
        type: 'ASSIGNMENT_CHANGED',
        recipientId: set.staffUserId,
        schoolId: set.branch.schoolId,
        branchId: set.branchId,
        subjectType: 'staffAssignment',
        subjectId: set.id,
        params: { effectiveFrom, shifts },
        dedupeKey: `assignment:${set.id}`,
      },
    ];
  },

  /** N3-4: the staff member, when a scheduled assignment change is cancelled. */
  async ASSIGNMENT_CANCELLED({ assignmentId }, { client }) {
    const set = await client.staffAssignment.findUnique({ where: { id: assignmentId }, select: { id: true, staffUserId: true, branchId: true, effectiveFrom: true, branch: { select: { schoolId: true } } } });
    if (!set) return [];
    return [
      {
        type: 'ASSIGNMENT_CANCELLED',
        recipientId: set.staffUserId,
        schoolId: set.branch.schoolId,
        branchId: set.branchId,
        subjectType: 'staffAssignment',
        subjectId: set.id,
        params: { effectiveFrom: set.effectiveFrom.toISOString().slice(0, 10) },
        dedupeKey: `assignment-cancelled:${set.id}`,
      },
    ];
  },

  /** N9: a saved schedule change → only staff whose assigned shifts change from its effective date. */
  async SCHEDULE_CHANGED({ versionId, baselineId }, { client }) {
    const after = await client.branchSchedule.findUnique({ where: { id: versionId }, include: { shifts: true, branch: true } });
    if (!after) return [];
    const before = baselineId ? await client.branchSchedule.findUnique({ where: { id: baselineId }, include: { shifts: true } }) : null;
    return impactItems(client, 'SCHEDULE_CHANGED', after.branch, after.effectiveFrom, before, after, `schedule:${after.id}`);
  },

  /** N9: a cancelled scheduled change → staff it would have affected (compared with the schedule that now applies that day). */
  async SCHEDULE_CHANGE_CANCELLED({ versionId }, { client }) {
    const cancelled = await client.branchSchedule.findUnique({ where: { id: versionId }, include: { shifts: true, branch: true } });
    if (!cancelled) return [];
    const date = cancelled.effectiveFrom.toISOString().slice(0, 10);
    const applies = await scheduleOn(cancelled.branchId, date, client);
    return impactItems(client, 'SCHEDULE_CHANGE_CANCELLED', cancelled.branch, cancelled.effectiveFrom, cancelled, applies, `schedule-cancelled:${cancelled.id}`);
  },

  /** N3-7: a Manager transferred (fromBranchId) or created → the Manager; and the new branch's "no schedule" notice when it has none. */
  async MANAGER_ASSIGNED({ managerId, branchId, fromBranchId, assignmentId }, { client }) {
    const [manager, branch, from] = await Promise.all([
      client.user.findUnique({ where: { id: managerId }, select: { id: true, branchId: true } }),
      client.branch.findUnique({ where: { id: branchId } }),
      fromBranchId ? client.branch.findUnique({ where: { id: fromBranchId } }) : null,
    ]);
    if (!manager || !branch) return [];
    const items = [];
    if (from) {
      items.push({
        type: 'MANAGER_TRANSFERRED',
        recipientId: manager.id,
        schoolId: branch.schoolId,
        // Tied to the new branch: it stays visible only while the Manager works there (N10).
        branchId: branch.id,
        subjectType: 'branch',
        subjectId: branch.id,
        params: { fromBranch: branchRef(from), toBranch: branchRef(branch) },
        dedupeKey: `manager-transferred:${assignmentId}`,
      });
    }
    // Only while the Manager is still assigned there.
    if (manager.branchId === branch.id) {
      const date = localDate(await platformTimeZone());
      if (!(await scheduleOn(branch.id, date, client))) items.push(...noScheduleItems(branch, [manager], date));
    }
    return items;
  },

  /** N7: the Owner, when a branch has no active Manager (once until the notice is read or expires). */
  async BRANCH_MANAGER_CHECK({ branchId }, { client, eventId, now }) {
    const branch = await client.branch.findUnique({ where: { id: branchId }, include: { school: { select: { ownerId: true } } } });
    if (!branch?.school.ownerId) return [];
    const active = await client.user.count({ where: { branchId, role: 'MANAGER', status: 'ACTIVE' } });
    if (active) return [];
    const open = await client.notification.count({
      where: { recipientId: branch.school.ownerId, type: 'BRANCH_NO_MANAGER', branchId, readAt: null, expiresAt: { gt: now } },
    });
    if (open) return [];
    return [
      {
        type: 'BRANCH_NO_MANAGER',
        recipientId: branch.school.ownerId,
        schoolId: branch.schoolId,
        branchId,
        subjectType: 'branch',
        subjectId: branchId,
        params: { branch: branchRef(branch) },
        dedupeKey: `no-manager:${eventId}`,
      },
    ];
  },

  /** T9: a staff transfer scheduled or cancelled → the staff member, and the destination branch's Managers (the origin branch is not named to them). */
  async STAFF_TRANSFER({ transferId, action }, { client }) {
    const t = await client.staffTransfer.findUnique({
      where: { id: transferId },
      include: { staff: { select: { id: true, name: true, staffId: true } }, fromBranch: true, toBranch: true },
    });
    if (!t) return [];
    const effectiveFrom = t.effectiveFrom.toISOString().slice(0, 10);
    const shifts = [];
    if (action === 'scheduled' && t.assignmentId) {
      const set = await client.staffAssignment.findUnique({ where: { id: t.assignmentId }, include: { shifts: true } });
      const schedule = set ? await scheduleOn(t.toBranchId, effectiveFrom, client) : null;
      const byKey = new Map((schedule?.shifts ?? []).map((s) => [s.shiftKey, s]));
      for (const a of set?.shifts ?? []) {
        const s = byKey.get(a.shiftKey);
        if (s) shifts.push({ name: s.name, days: a.days, start: toTime(s.startMinute), end: toTime(s.endMinute) });
      }
    }
    const item = (recipientId, type, params) => ({
      type,
      recipientId,
      schoolId: t.schoolId,
      branchId: t.toBranchId,
      subjectType: 'staffTransfer',
      subjectId: t.id,
      params,
      dedupeKey: `staff-transfer:${t.id}:${action}:${recipientId}`,
    });
    const managers = await branchUsers(client, t.toBranchId, ['MANAGER']);
    const staffParams = { effectiveFrom, fromBranch: branchRef(t.fromBranch), toBranch: branchRef(t.toBranch), shifts, audience: 'staff' };
    const managerParams = { effectiveFrom, staffName: t.staff.name, staffCode: t.staff.staffId, toBranch: branchRef(t.toBranch), audience: 'manager' };
    return [
      item(t.staffUserId, action === 'scheduled' ? 'STAFF_TRANSFERRED' : 'STAFF_TRANSFER_CANCELLED', staffParams),
      ...managers.map((m) => item(m.id, action === 'scheduled' ? 'STAFF_TRANSFER_IN' : 'STAFF_TRANSFER_CANCELLED', managerParams)),
    ];
  },

  /** N11: branch suspended or reactivated → its Managers and staff, without the reason. */
  async BRANCH_STATUS({ branchId, status, periodId }, { client }) {
    const branch = await client.branch.findUnique({ where: { id: branchId } });
    if (!branch) return [];
    const type = status === 'SUSPENDED' ? 'BRANCH_SUSPENDED' : 'BRANCH_REACTIVATED';
    const users = await branchUsers(client, branchId, ['MANAGER', 'STAFF']);
    return users.map((u) => ({
      type,
      recipientId: u.id,
      schoolId: branch.schoolId,
      branchId,
      subjectType: 'branch',
      subjectId: branchId,
      params: { branch: branchRef(branch) },
      dedupeKey: `branch-status:${periodId}:${status}:${u.id}`,
    }));
  },

  /** N11: school suspended or reactivated → the Owner (with the reason) and every Manager and staff member of the school (without it). */
  async SCHOOL_STATUS({ schoolId, status, periodId }, { client }) {
    const school = await client.school.findUnique({ where: { id: schoolId }, select: { id: true, name: true, ownerId: true } });
    if (!school) return [];
    const type = status === 'SUSPENDED' ? 'SCHOOL_SUSPENDED' : 'SCHOOL_REACTIVATED';
    const reason = status === 'SUSPENDED' ? (await client.suspensionPeriod.findUnique({ where: { id: periodId }, select: { reason: true } }))?.reason : null;
    const members = await client.user.findMany({ where: { role: { in: ['MANAGER', 'STAFF'] }, branch: { schoolId } }, select: { id: true } });
    const item = (recipientId, params) => ({
      type,
      recipientId,
      schoolId,
      branchId: null,
      subjectType: 'school',
      subjectId: schoolId,
      params,
      dedupeKey: `school-status:${periodId}:${status}:${recipientId}`,
    });
    return [
      ...(school.ownerId ? [item(school.ownerId, { schoolName: school.name, ...(reason ? { reason } : {}) })] : []),
      ...members.map((m) => item(m.id, { schoolName: school.name })),
    ];
  },
};

/** Notices for the staff of a branch whose assigned shifts (as in effect on `effectiveFrom`) change between two versions. */
async function impactItems(client, type, branch, effectiveFrom, before, after, key) {
  const date = effectiveFrom.toISOString().slice(0, 10);
  const sets = latestSets(
    await client.staffAssignment.findMany({
      where: { branchId: branch.id, cancelledAt: null, effectiveFrom: { lte: effectiveFrom }, staff: { role: 'STAFF' } },
      orderBy: [{ effectiveFrom: 'desc' }, { recordedAt: 'desc' }],
      include: { shifts: true },
    }),
  );
  const items = [];
  const startsAt = zonedMidnight(date, (after ?? before).timeZone);
  for (const [staffUserId, set] of sets) {
    const impact = scheduleImpact(before, after, set);
    if (!impact.affected) continue;
    // A staff member transferred to another branch by that date is no longer this branch's.
    if ((await staffBranchAt(staffUserId, startsAt, client)) !== branch.id) continue;
    items.push({
      type,
      recipientId: staffUserId,
      schoolId: branch.schoolId,
      branchId: branch.id,
      subjectType: 'branchSchedule',
      subjectId: (type === 'SCHEDULE_CHANGED' ? after : before).id,
      params: { branchName: branch.name, effectiveFrom: date, shifts: impact.shifts, checkOutChanged: impact.checkOutChanged, checkOutEnabled: impact.checkOutEnabled },
      dedupeKey: `${key}:${staffUserId}`,
    });
  }
  return items;
}

import { getPrisma } from '../../config/prisma.js';
import { checkOutState, lastClosedWorkDate, localParts } from '../attendance/attendanceReports.service.js';
import { localMoment } from '../attendance/attendance.service.js';
import { platformTimeZone } from '../platform-settings/settings.service.js';
import { toTime } from '../schedules/scheduleInput.js';
import { addDays, localDate } from '../schedules/schedules.service.js';
import { queueAnnouncementPush } from './announcements.service.js';
import { createNotifications } from './notify.js';
import { platformNotificationSettings } from './notificationSettings.service.js';
import { noScheduleItems, processPendingEvents } from './outbox.js';
import { checkPushReceipts, sendPendingPush } from './push.js';
import { settleDueTransfers } from '../staff/transfers.service.js';

/*
 * The scheduled notification job (docs/notifications/notification-architecture.md → Background
 * processing). The API is serverless, so there is no resident worker: an external scheduler (Vercel
 * Cron, or any scheduler calling the protected endpoint) runs runNotificationJobs(). Every task is
 * idempotent and catches up on what an earlier run missed (conditions plus unique dedupe keys, never
 * "since the last run" bookkeeping), and the run stops after its time budget, leaving the rest for
 * the next run. Queries are grouped (a few per task for the whole platform), not one per branch.
 */

const asDbDate = (date) => new Date(`${date}T00:00:00Z`);
const fromDbDate = (value) => value.toISOString().slice(0, 10);
const DAY_MS = 24 * 60 * 60 * 1000;
/** Optional limit of a task to some schools (operations and tests); all schools by default. */
const inSchools = (schoolIds) => (schoolIds ? { branch: { schoolId: { in: schoolIds } } } : {});
/** Missing check-outs are looked for over the last closed work dates (catch-up window). */
export const MISSING_LOOKBACK_DAYS = 3;
/** Digests are created for work dates up to this many days back (catch-up after missed runs). */
export const DIGEST_LOOKBACK_DAYS = 2;

// ---- missing check-outs (N8) ---------------------------------------------------------------

/**
 * A check-in on a day whose schedule had check-out on, still without a check-out once the D9
 * deadline (end of the work day + 24 h) has passed, is a missing check-out: the staff member gets
 * one notification. Nothing about the attendance record changes and no end time is assumed.
 */
export async function notifyMissingCheckOuts({ now = new Date(), schoolIds } = {}) {
  const prisma = getPrisma();
  const zones = (await prisma.branchSchedule.findMany({ where: { checkOutEnabled: true }, distinct: ['timeZone'], select: { timeZone: true } })).map((z) => z.timeZone);
  let created = 0;
  for (const timeZone of zones) {
    const last = lastClosedWorkDate(timeZone, now);
    const rows = await prisma.attendanceEvent.findMany({
      where: {
        type: 'CHECK_IN',
        workDate: { gte: asDbDate(addDays(last, -(MISSING_LOOKBACK_DAYS - 1))), lte: asDbDate(last) },
        schedule: { timeZone, checkOutEnabled: true },
        checkOut: { is: null },
        ...inSchools(schoolIds),
      },
      select: { id: true, staffUserId: true, branchId: true, workDate: true, occurredAt: true, shiftKey: true, scheduleId: true, branch: { select: { schoolId: true } } },
      take: 5000,
    });
    if (!rows.length) continue;
    const versions = new Map(
      (await prisma.branchSchedule.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.scheduleId))] } }, include: { shifts: true } })).map((v) => [v.id, v]),
    );
    const items = rows.map((r) => {
      const version = versions.get(r.scheduleId);
      const shift = version.shifts.find((s) => s.shiftKey === r.shiftKey);
      // Same rule as the reports (D9), checked again per row.
      if (checkOutState({ hasCheckOut: false, checkOutEnabled: true, workDate: fromDbDate(r.workDate), timeZone: version.timeZone }, now) !== 'missing') return null;
      return {
        type: 'MISSING_CHECK_OUT',
        recipientId: r.staffUserId,
        schoolId: r.branch.schoolId,
        branchId: r.branchId,
        subjectType: 'attendanceEvent',
        subjectId: r.id,
        params: {
          date: fromDbDate(r.workDate),
          shiftName: shift?.name ?? '',
          shiftStart: shift ? toTime(shift.startMinute) : '',
          shiftEnd: shift ? toTime(shift.endMinute) : '',
          checkInTime: localParts(r.occurredAt, version.timeZone).time.slice(0, 5),
          timeZone: version.timeZone,
        },
        dedupeKey: `missing-checkout:${r.id}`,
      };
    });
    created += (await createNotifications(items.filter(Boolean), { now })).length;
  }
  return created;
}

// ---- branches without a schedule (N3-6) ----------------------------------------------------

/** Operating branches with no schedule in effect today → their Managers (once per Manager and branch while the notice is kept). */
export async function notifyBranchesWithoutSchedule({ now = new Date(), schoolIds } = {}) {
  const prisma = getPrisma();
  const today = localDate(await platformTimeZone(), now);
  const branches = await prisma.branch.findMany({
    where: {
      status: 'ACTIVE',
      school: { status: 'ACTIVE' },
      schedules: { none: { cancelledAt: null, effectiveFrom: { lte: asDbDate(today) } } },
      ...(schoolIds && { schoolId: { in: schoolIds } }),
    },
    select: { id: true, name: true, code: true, schoolId: true, managers: { where: { role: 'MANAGER' }, select: { id: true } } },
  });
  const items = branches.flatMap((b) => noScheduleItems(b, b.managers, today));
  return (await createNotifications(items, { now })).length;
}

// ---- daily digests (N6, N7, N8) ------------------------------------------------------------

const emptyDay = () => ({ checkIns: 0, present: 0, late: 0, staff: 0, checkedOut: 0, open: 0, missing: 0, notRequired: 0 });

/**
 * Counts per branch for work dates `dates` (all branches, three grouped queries), with each check-in
 * group's check-out state from its own schedule version (the reports' rule, D9).
 * → Map(branchId → Map(date → counts)).
 */
export async function digestCounts(dates, now, schoolIds) {
  const prisma = getPrisma();
  const where = { type: 'CHECK_IN', workDate: { in: dates.map(asDbDate) }, ...inSchools(schoolIds) };
  const keys = ['branchId', 'workDate', 'scheduleId'];
  const [checkIns, checkOuts, staff] = await Promise.all([
    prisma.attendanceEvent.groupBy({ by: [...keys, 'status'], where, _count: { _all: true } }),
    prisma.attendanceEvent.groupBy({ by: keys, where: { ...where, type: 'CHECK_OUT' }, _count: { _all: true } }),
    prisma.attendanceEvent.groupBy({ by: ['branchId', 'workDate', 'staffUserId'], where }),
  ]);
  const versions = new Map(
    (await prisma.branchSchedule.findMany({ where: { id: { in: [...new Set(checkIns.map((g) => g.scheduleId))] } }, select: { id: true, timeZone: true, checkOutEnabled: true } })).map((v) => [v.id, v]),
  );
  const result = new Map();
  const counts = (branchId, date) => {
    if (!result.has(branchId)) result.set(branchId, new Map());
    const byDate = result.get(branchId);
    if (!byDate.has(date)) byDate.set(date, emptyDay());
    return byDate.get(date);
  };
  const groups = new Map();
  for (const g of checkIns) {
    const date = fromDbDate(g.workDate);
    const c = counts(g.branchId, date);
    c.checkIns += g._count._all;
    c[g.status === 'LATE' ? 'late' : 'present'] += g._count._all;
    const key = `${g.branchId}|${date}|${g.scheduleId}`;
    groups.set(key, { branchId: g.branchId, date, scheduleId: g.scheduleId, checkIns: (groups.get(key)?.checkIns ?? 0) + g._count._all, checkOuts: 0 });
  }
  for (const g of checkOuts) {
    const group = groups.get(`${g.branchId}|${fromDbDate(g.workDate)}|${g.scheduleId}`);
    if (group) group.checkOuts += g._count._all;
  }
  for (const group of groups.values()) {
    const v = versions.get(group.scheduleId);
    const c = counts(group.branchId, group.date);
    const recorded = Math.min(group.checkOuts, group.checkIns);
    c.checkedOut += recorded;
    const state = checkOutState({ hasCheckOut: false, checkOutEnabled: v.checkOutEnabled, workDate: group.date, timeZone: v.timeZone }, now);
    c[{ open: 'open', missing: 'missing', not_required: 'notRequired' }[state]] += group.checkIns - recorded;
  }
  for (const g of staff) counts(g.branchId, fromDbDate(g.workDate)).staff += 1;
  return result;
}

const add = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, a[k] + (b?.[k] ?? 0)]));
const previousOf = (date, c) => ({ date, checkIns: c.checkIns, late: c.late, missing: c.missing });

/**
 * Daily digests for work date `date` (the day before, in the platform time zone), created once the
 * digest hour has passed: one per Manager of each branch with check-ins (BRANCH_DIGEST) and one per
 * Owner for the whole school (SCHOOL_DIGEST, all branches). Each has the day's counts as of now and
 * the final counts of the day before it — including late check-ins uploaded after their work day and
 * the check-outs now classified missing (N6, N8). Counts only; absence is not calculated (D20).
 */
export async function createDigests({ now = new Date(), schoolIds } = {}) {
  const prisma = getPrisma();
  const [timeZone, settings] = await Promise.all([platformTimeZone(), platformNotificationSettings(prisma)]);
  const moment = localMoment(now, timeZone);
  const due = [];
  for (let back = DIGEST_LOOKBACK_DAYS; back >= 1; back -= 1) {
    const date = addDays(moment.date, -back);
    // Due from the digest hour of the next day.
    if (back > 1 || moment.minutes >= settings.digestHour * 60) due.push(date);
  }
  let created = 0;
  for (const date of due) {
    const previous = addDays(date, -1);
    const counts = await digestCounts([previous, date], now, schoolIds);
    if (!counts.size) continue;
    const branches = await prisma.branch.findMany({
      where: { id: { in: [...counts.keys()] } },
      select: { id: true, name: true, code: true, schoolId: true, managers: { where: { role: 'MANAGER' }, select: { id: true } }, school: { select: { id: true, name: true, ownerId: true } } },
      orderBy: { number: 'asc' },
    });
    const items = [];
    const schools = new Map();
    for (const b of branches) {
      const day = counts.get(b.id).get(date) ?? emptyDay();
      const before = counts.get(b.id).get(previous) ?? emptyDay();
      const params = { date, branch: { name: b.name, code: b.code }, day, previous: previousOf(previous, before) };
      for (const m of b.managers) {
        items.push({ type: 'BRANCH_DIGEST', recipientId: m.id, schoolId: b.schoolId, branchId: b.id, subjectType: 'branch', subjectId: b.id, params, dedupeKey: `digest:${date}:${b.id}:${m.id}` });
      }
      if (!schools.has(b.schoolId)) schools.set(b.schoolId, { school: b.school, day: emptyDay(), before: emptyDay(), branches: [] });
      const s = schools.get(b.schoolId);
      s.day = add(s.day, day);
      s.before = add(s.before, before);
      s.branches.push({ name: b.name, code: b.code, day, previous: previousOf(previous, before) });
    }
    for (const [schoolId, s] of schools) {
      if (!s.school.ownerId) continue;
      items.push({
        type: 'SCHOOL_DIGEST',
        recipientId: s.school.ownerId,
        schoolId,
        branchId: null,
        subjectType: 'school',
        subjectId: schoolId,
        params: { date, schoolName: s.school.name, day: s.day, previous: previousOf(previous, s.before), branches: s.branches },
        dedupeKey: `school-digest:${date}:${schoolId}`,
      });
    }
    created += (await createNotifications(items, { now })).length;
  }
  return created;
}

// ---- retention (N18) -----------------------------------------------------------------------

/** Removes expired notifications, read marks of expired announcements, and old processed outbox and push rows. */
export async function purgeExpired({ now = new Date() } = {}) {
  const prisma = getPrisma();
  const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
  const [notifications, reads, events, pushes] = await prisma.$transaction([
    prisma.notification.deleteMany({ where: { expiresAt: { lte: now } } }),
    prisma.announcementRead.deleteMany({ where: { announcement: { expiresAt: { lte: now } } } }),
    prisma.notificationEvent.deleteMany({ where: { status: { in: ['DONE', 'FAILED'] }, createdAt: { lt: monthAgo } } }),
    prisma.pushMessage.deleteMany({ where: { status: { not: 'PENDING' }, createdAt: { lt: monthAgo } } }),
  ]);
  return { notifications: notifications.count, announcementReads: reads.count, events: events.count, pushMessages: pushes.count };
}

// ---- the run ---------------------------------------------------------------------------------

/**
 * One job run: retries pending outbox events, then missing check-outs, branches without a schedule,
 * digests, announcement pushes, push delivery and retention, until the time budget is spent.
 * A failing task is reported and does not stop the others. → { [task]: result | { error } }.
 */
export async function runNotificationJobs({ now = new Date(), budgetMs = 45_000, send, getReceipts } = {}) {
  const started = Date.now();
  const stop = () => Date.now() - started > budgetMs;
  const tasks = [
    ['staffTransfers', () => settleDueTransfers({ now })],
    ['outbox', () => processPendingEvents({ now, stop })],
    ['missingCheckOuts', () => notifyMissingCheckOuts({ now })],
    ['branchesWithoutSchedule', () => notifyBranchesWithoutSchedule({ now })],
    ['digests', () => createDigests({ now })],
    ['announcementPush', () => queueAnnouncementPush({ now })],
    ['push', () => sendPendingPush({ now, stop, ...(send && { send }) })],
    ['pushReceipts', () => checkPushReceipts({ now, ...(getReceipts && { getReceipts }) })],
    ['retention', () => purgeExpired({ now })],
  ];
  const result = {};
  for (const [name, task] of tasks) {
    if (stop()) {
      result[name] = { skipped: 'time budget spent; the next run continues' };
      continue;
    }
    try {
      result[name] = await task();
    } catch (error) {
      console.error(`[notifications] job task ${name} failed:`, error.message);
      result[name] = { error: error.message };
    }
  }
  return { ranAt: now.toISOString(), durationMs: Date.now() - started, ...result };
}

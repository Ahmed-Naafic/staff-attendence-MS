import { randomUUID } from 'node:crypto';
import { badRequest, conflict, notFound } from '../../common/httpError.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { operatingState } from '../branches/branches.service.js';
import { dispatch, enqueue, OUTBOX } from '../notifications/outbox.js';
import { localDateTime } from '../../common/zonedTime.js';
import { effectiveDateFields, effectiveText, resolveEffective, schedulingPolicy } from '../platform-settings/schedulingPolicy.js';
import { platformTimeZone } from '../platform-settings/settings.service.js';
import { dayList, nameKey, toTime } from './scheduleInput.js';

/*
 * Branch schedules and shifts (approved rules: docs/business-rules.md → Branch schedules and
 * shifts). Every function takes the Manager's branch (req.branch, read from the database by
 * requireManagerBranch, never from the request).
 *
 * Dates are branch-local calendar dates 'YYYY-MM-DD' in the platform time zone; "today" is the
 * server's date there. The earliest effective date and time follow the Scheduling & Assignments
 * settings (schedulingPolicy.js): today + the effective delay at 00:00, or today for a first schedule
 * when allowed; with timed changes, any time after now. Each version has the instant it takes
 * effect (effectiveAt; its local date is effectiveFrom). Nothing activates a saved version: the one
 * in effect at an instant is the newest whose effectiveAt has arrived (scheduleAt), so a pending
 * change applies from exactly that moment. A change saves a new, complete version; versions are never edited or
 * deleted (a replaced or cancelled scheduled version gets cancelledAt). Writes lock the school row
 * (FOR SHARE) and the branch row (FOR UPDATE) and need both ACTIVE (409 BRANCH_NOT_OPERATING);
 * each change and its audit event are written in one transaction.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Options for writes that queue on the branch row lock (schedules, staff): simultaneous requests wait
 * for each other, so on a slow database the last one can need longer than Prisma's 5-second default
 * and would fail with P2028 (500) instead of waiting its turn.
 */
export const BRANCH_TX = { maxWait: 10_000, timeout: 20_000 };
/** Latest effective date: one year after today. */
export const MAX_AHEAD_DAYS = 365;

/** Today's date in a time zone, 'YYYY-MM-DD'. */
export const localDate = (timeZone, now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const asDbDate = (date) => new Date(`${date}T00:00:00Z`);
const fromDbDate = (value) => value.toISOString().slice(0, 10);

const versionInclude = { shifts: { orderBy: [{ startMinute: 'asc' }, { name: 'asc' }] } };

const toShift = (s) => ({
  id: s.id,
  key: s.shiftKey,
  name: s.name,
  days: s.days,
  start: toTime(s.startMinute),
  end: toTime(s.endMinute),
  graceMinutes: s.graceMinutes,
  absenceCutoffMinutes: s.absenceCutoffMinutes,
});
const toVersion = (v) =>
  v && {
    id: v.id,
    effectiveFrom: fromDbDate(v.effectiveFrom),
    // The local time it takes effect ('00:00' for a change from the start of its date).
    effectiveTime: localDateTime(v.effectiveAt, v.timeZone).time,
    effectiveAt: v.effectiveAt.toISOString(),
    timeZone: v.timeZone,
    checkOutEnabled: v.checkOutEnabled,
    recordedAt: v.recordedAt.toISOString(),
    cancelledAt: v.cancelledAt?.toISOString() ?? null,
    shifts: v.shifts.map(toShift),
  };

/**
 * The version in effect by the end of a branch-local date (the newest non-cancelled version starting
 * on or before it, at any time that day), with shifts; or null. Use scheduleAt for an instant, and
 * daySchedules for a day on which a version starts after 00:00.
 */
export function scheduleOn(branchId, date, client = getPrisma()) {
  return client.branchSchedule.findFirst({
    where: { branchId, cancelledAt: null, effectiveFrom: { lte: asDbDate(date) } },
    orderBy: [{ effectiveFrom: 'desc' }, { effectiveAt: 'desc' }, { recordedAt: 'desc' }],
    include: versionInclude,
  });
}

/** The version in effect at an instant (the newest non-cancelled version whose effectiveAt has arrived), with shifts; or null. */
export function scheduleAt(branchId, instant, client = getPrisma()) {
  return client.branchSchedule.findFirst({
    where: { branchId, cancelledAt: null, effectiveAt: { lte: instant } },
    orderBy: [{ effectiveAt: 'desc' }, { recordedAt: 'desc' }],
    include: versionInclude,
  });
}

/**
 * The versions that apply during a day [dayStart, dayEnd): the one in effect at dayStart, then each
 * starting during the day, in order, with shifts. A day with one entry is an ordinary day.
 */
export async function daySchedules(branchId, dayStart, dayEnd, client = getPrisma()) {
  const [first, later] = await Promise.all([
    scheduleAt(branchId, dayStart, client),
    client.branchSchedule.findMany({
      where: { branchId, cancelledAt: null, effectiveAt: { gt: dayStart, lt: dayEnd } },
      orderBy: [{ effectiveAt: 'asc' }, { recordedAt: 'asc' }],
      include: versionInclude,
    }),
  ]);
  return [...(first ? [first] : []), ...later];
}

/** The scheduled (not yet in effect, not cancelled) version after `now` (an instant), or null. There is at most one. */
function scheduledAfter(branchId, now, client) {
  return client.branchSchedule.findFirst({
    where: { branchId, cancelledAt: null, effectiveAt: { gt: now } },
    orderBy: [{ effectiveAt: 'asc' }, { recordedAt: 'asc' }],
    include: versionInclude,
  });
}

const notOperating = (reasons) =>
  conflict(
    'BRANCH_NOT_OPERATING',
    reasons.includes('school_suspended')
      ? 'Your school is suspended. Its schedules and staff can be viewed but not changed until it is reactivated.'
      : 'Your branch is suspended. Its schedule and staff can be viewed but not changed until it is reactivated.',
    { reasons },
  );

/**
 * The schedule page: time zone, today, the effective delay, allowed effective dates, current and
 * scheduled versions, and whether changes are allowed.
 */
export async function getSchedule(branch) {
  const prisma = getPrisma();
  const now = new Date();
  const [timeZone, policy] = await Promise.all([platformTimeZone(), schedulingPolicy(prisma)]);
  const today = localDate(timeZone, now);
  const [current, scheduled] = await Promise.all([scheduleAt(branch.id, now, prisma), scheduledAfter(branch.id, now, prisma)]);
  const { operating, reasons } = operatingState(branch, branch.school);
  return {
    timeZone,
    today,
    ...effectiveDateFields(policy, { timeZone, today, now, first: !current, immediateFirst: policy.immediateFirstSchedule }),
    latestEffectiveDate: addDays(today, MAX_AHEAD_DAYS),
    current: toVersion(current),
    scheduled: toVersion(scheduled),
    canChange: operating,
    notOperatingReasons: reasons,
  };
}

/**
 * Every version, newest first, with state (current, scheduled, previous, cancelled), effectiveUntil
 * (the last day it applies, fully or until the next version starts that day) and endsAt (the
 * instant the next version takes over, or null).
 */
export async function listVersions(branch) {
  const now = new Date();
  const timeZone = await platformTimeZone();
  const rows = await getPrisma().branchSchedule.findMany({
    where: { branchId: branch.id },
    include: versionInclude,
    orderBy: [{ effectiveAt: 'desc' }, { recordedAt: 'desc' }],
  });
  const active = rows.filter((v) => !v.cancelledAt);
  const current = active.find((v) => v.effectiveAt <= now);
  return {
    timeZone,
    items: rows.map((v) => {
      const next = active.filter((o) => o.effectiveAt > v.effectiveAt).at(-1);
      const state = v.cancelledAt ? 'cancelled' : v === current ? 'current' : v.effectiveAt > now ? 'scheduled' : 'previous';
      return { ...toVersion(v), state, effectiveUntil: !v.cancelledAt && next ? lastDayBefore(next) : null, endsAt: !v.cancelledAt && next ? next.effectiveAt.toISOString() : null };
    }),
  };
}

/** The last day a version applies before `next` takes over: the day before when `next` starts at 00:00, else `next`'s own date. */
export const lastDayBefore = (next) =>
  localDateTime(next.effectiveAt, next.timeZone).minutes === 0 ? addDays(fromDbDate(next.effectiveFrom), -1) : fromDbDate(next.effectiveFrom);

/** Locks the school (FOR SHARE) and the branch (FOR UPDATE); both must be ACTIVE. */
export async function lockOperatingBranch(tx, branch) {
  const [school] = await tx.$queryRaw`SELECT "status"::text AS "status" FROM "School" WHERE "id" = ${branch.school.id} FOR SHARE`;
  const [row] = await tx.$queryRaw`SELECT "status"::text AS "status" FROM "Branch" WHERE "id" = ${branch.id} FOR UPDATE`;
  const { operating, reasons } = operatingState(row ?? { status: 'SUSPENDED' }, school ?? { status: 'SUSPENDED' });
  if (!operating) throw notOperating(reasons);
}

const canonical = (v) =>
  JSON.stringify({
    checkOutEnabled: v.checkOutEnabled,
    shifts: [...v.shifts]
      .map((s) => [s.name, s.days.join(','), s.startMinute, s.endMinute, s.graceMinutes, s.absenceCutoffMinutes, s.shiftKey])
      .sort((a, b) => a[2] - b[2] || String(a[0]).localeCompare(String(b[0]))),
  });
const shiftSummary = (s) =>
  `${s.name}: ${dayList(s.days)} ${toTime(s.startMinute)}–${toTime(s.endMinute)}, grace ${s.graceMinutes} min, absent after ${s.absenceCutoffMinutes} min`;
const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });
const auditTarget = (branch) => ({ type: 'branch', id: branch.id, name: `${branch.name} (${branch.code})` });

async function cancelVersion(tx, branch, version, user, req, reason, outbox) {
  const now = new Date();
  await tx.branchSchedule.updateMany({ where: { id: version.id, cancelledAt: null }, data: { cancelledAt: now } });
  // Staff whose shifts that change would have affected are told it was cancelled (N9).
  await enqueue(tx, OUTBOX.SCHEDULE_CHANGE_CANCELLED, { versionId: version.id }, `schedule-cancelled:${version.id}`, outbox);
  await recordAuditEvent({
    client: tx,
    action: AUDIT_ACTIONS.BRANCH_SCHEDULE_CHANGE_CANCELLED,
    actor: actorOf(user),
    target: auditTarget(branch),
    schoolId: branch.school.id,
    description: `Scheduled schedule change from ${effectiveText(version.effectiveAt, version.timeZone)} cancelled.${reason ? ` ${reason}` : ''}`,
    change: { field: 'Scheduled change', from: `From ${effectiveText(version.effectiveAt, version.timeZone)}`, to: 'Cancelled' },
    req,
  });
}

/**
 * Keys for the shifts sent without one (name key → shift key): a shift added with the name of a
 * shift this branch had before (in any version, also a cancelled one) is that shift again, so staff
 * assignments to it follow it — e.g. a shift typed in again after its scheduled change was cancelled.
 * The most recently saved shift with that name decides; when the request already keeps that shift
 * (under its key, perhaps renamed), the added one is a new shift.
 */
async function earlierShiftKeys(tx, branch, shifts) {
  const added = new Set(shifts.filter((s) => !s.key).map((s) => nameKey(s.name)));
  const result = new Map();
  if (!added.size) return result;
  const taken = new Set(shifts.map((s) => s.key).filter(Boolean));
  const rows = await tx.branchShift.findMany({
    where: { schedule: { branchId: branch.id } },
    select: { shiftKey: true, name: true },
    orderBy: [{ schedule: { recordedAt: 'desc' } }],
  });
  const decided = new Set();
  for (const { shiftKey, name } of rows) {
    const k = nameKey(name);
    if (!added.has(k) || decided.has(k)) continue;
    decided.add(k);
    if (!taken.has(shiftKey)) {
      result.set(k, shiftKey);
      taken.add(shiftKey); // one shift per key, also when it had several names over time
    }
  }
  return result;
}

/**
 * Saves a new schedule version from `effectiveFrom` (and `effectiveTime` with timed changes): at the
 * earliest today + the effective delay, or today for the branch's first schedule when the settings
 * allow it; with timed changes any time after now; at most a year ahead. A scheduled version is replaced
 * (cancelled, kept). Saving the schedule already in effect with nothing scheduled changes nothing;
 * with something scheduled it only cancels that.
 */
export async function saveSchedule(branch, { effectiveFrom, effectiveTime = null, checkOutEnabled, shifts }, user, req) {
  const timeZone = await platformTimeZone();
  const outbox = [];
  await getPrisma().$transaction(async (tx) => {
    await lockOperatingBranch(tx, branch);
    const now = new Date();
    const today = localDate(timeZone, now);
    const [current, scheduled] = await Promise.all([scheduleAt(branch.id, now, tx), scheduledAfter(branch.id, now, tx)]);
    // Read in the transaction: a settings change saved meanwhile applies to this save.
    const policy = await schedulingPolicy(tx);
    const { effectiveAt } = resolveEffective(policy, {
      what: 'schedule',
      effectiveFrom,
      effectiveTime,
      timeZone,
      today,
      latest: addDays(today, MAX_AHEAD_DAYS),
      now,
      first: !current,
      immediateFirst: policy.immediateFirstSchedule,
    });

    // Kept shifts must be shifts of this branch (any earlier version). Added shifts take the key of
    // an earlier shift with the same name, else a new key.
    const keys = shifts.map((s) => s.key).filter(Boolean);
    if (keys.length) {
      const known = new Set(
        (await tx.branchShift.findMany({ where: { shiftKey: { in: keys }, schedule: { branchId: branch.id } }, select: { shiftKey: true }, distinct: ['shiftKey'] })).map(
          (s) => s.shiftKey,
        ),
      );
      const unknown = Object.fromEntries(shifts.map((s, i) => [i, s]).filter(([, s]) => s.key && !known.has(s.key)).map(([i]) => [`shifts.${i}.key`, "This shift is not one of your branch's shifts."]));
      if (Object.keys(unknown).length) throw badRequest('Check the highlighted fields.', unknown);
    }
    const earlier = await earlierShiftKeys(tx, branch, shifts);
    const keyed = shifts.map(({ key, ...shift }) => ({ ...shift, shiftKey: key ?? earlier.get(nameKey(shift.name)) ?? randomUUID() }));
    const next = { checkOutEnabled, shifts: keyed };
    if (current && canonical(current) === canonical(next)) {
      if (scheduled) await cancelVersion(tx, branch, scheduled, user, req, 'The schedule saved is the one already in effect.', outbox);
      return;
    }
    // The version that would apply at the effective moment without this change (for the affected staff, N9).
    const baseline = await scheduleAt(branch.id, effectiveAt, tx);
    const fields = [];
    if (scheduled) {
      await tx.branchSchedule.updateMany({ where: { id: scheduled.id, cancelledAt: null }, data: { cancelledAt: new Date() } });
      fields.push({ field: 'Scheduled change', from: `From ${effectiveText(scheduled.effectiveAt, scheduled.timeZone)}`, to: 'Replaced' });
      // A replaced change that would have started earlier will not happen: tell its affected staff.
      // (One starting at or after the new moment is covered by the new change's notice.)
      if (scheduled.effectiveAt < effectiveAt) {
        await enqueue(tx, OUTBOX.SCHEDULE_CHANGE_CANCELLED, { versionId: scheduled.id }, `schedule-cancelled:${scheduled.id}`, outbox);
      }
    }
    const created = await tx.branchSchedule.create({
      data: { branchId: branch.id, effectiveFrom: asDbDate(effectiveFrom), effectiveAt, timeZone, checkOutEnabled, shifts: { create: keyed } },
    });
    await enqueue(tx, OUTBOX.SCHEDULE_CHANGED, { versionId: created.id, baselineId: baseline?.id ?? null }, `schedule:${created.id}`, outbox);
    fields.push(
      { field: 'Effective from', from: current ? effectiveText(current.effectiveAt, current.timeZone) : null, to: `${effectiveText(effectiveAt, timeZone)} (${timeZone})` },
      { field: 'Check-out', from: current ? (current.checkOutEnabled ? 'On' : 'Off') : null, to: checkOutEnabled ? 'On' : 'Off' },
      { field: 'Shifts', from: current ? current.shifts.map(shiftSummary).join('; ') : null, to: shifts.map(shiftSummary).join('; ') },
    );
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.BRANCH_SCHEDULE_CHANGED,
      actor: actorOf(user),
      target: auditTarget(branch),
      schoolId: branch.school.id,
      description: `Schedule ${current ? 'changed' : 'set'} from ${effectiveText(effectiveAt, timeZone)} with ${shifts.length} shift${shifts.length === 1 ? '' : 's'}; check-out ${checkOutEnabled ? 'on' : 'off'}.`,
      change: { fields },
      req,
    });
  }, BRANCH_TX);
  await dispatch(outbox);
  return getSchedule(branch);
}

/** Cancels the scheduled version (404 when there is none). */
export async function cancelScheduledSchedule(branch, user, req) {
  const outbox = [];
  await getPrisma().$transaction(async (tx) => {
    await lockOperatingBranch(tx, branch);
    const scheduled = await scheduledAfter(branch.id, new Date(), tx);
    if (!scheduled) throw notFound('There is no scheduled schedule change.');
    await cancelVersion(tx, branch, scheduled, user, req, undefined, outbox);
  }, BRANCH_TX);
  await dispatch(outbox);
  return getSchedule(branch);
}

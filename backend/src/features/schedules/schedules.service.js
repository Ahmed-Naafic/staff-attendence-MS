import { randomUUID } from 'node:crypto';
import { badRequest, conflict, notFound } from '../../common/httpError.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { operatingState } from '../branches/branches.service.js';
import { platformTimeZone } from '../platform-settings/settings.service.js';
import { dayList, nameKey, toTime } from './scheduleInput.js';

/*
 * Branch schedules and shifts (approved rules: docs/business-rules.md → Branch schedules and
 * shifts). Every function takes the Manager's branch (req.branch, read from the database by
 * requireManagerBranch, never from the request).
 *
 * Dates are branch-local calendar dates 'YYYY-MM-DD' in the platform time zone; "today" is the
 * server's date there. A change saves a new, complete version; versions are never edited or
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
    timeZone: v.timeZone,
    checkOutEnabled: v.checkOutEnabled,
    recordedAt: v.recordedAt.toISOString(),
    cancelledAt: v.cancelledAt?.toISOString() ?? null,
    shifts: v.shifts.map(toShift),
  };

/** The version in effect on a branch-local date (newest non-cancelled version starting on or before it), with shifts; or null. */
export function scheduleOn(branchId, date, client = getPrisma()) {
  return client.branchSchedule.findFirst({
    where: { branchId, cancelledAt: null, effectiveFrom: { lte: asDbDate(date) } },
    orderBy: [{ effectiveFrom: 'desc' }, { recordedAt: 'desc' }],
    include: versionInclude,
  });
}

/** The scheduled (future, not cancelled) version after `date`, or null. There is at most one. */
function scheduledAfter(branchId, date, client) {
  return client.branchSchedule.findFirst({
    where: { branchId, cancelledAt: null, effectiveFrom: { gt: asDbDate(date) } },
    orderBy: [{ effectiveFrom: 'asc' }, { recordedAt: 'asc' }],
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

/** The schedule page: time zone, today, allowed effective dates, current and scheduled versions, and whether changes are allowed. */
export async function getSchedule(branch) {
  const prisma = getPrisma();
  const timeZone = await platformTimeZone();
  const today = localDate(timeZone);
  const [current, scheduled] = await Promise.all([scheduleOn(branch.id, today, prisma), scheduledAfter(branch.id, today, prisma)]);
  const { operating, reasons } = operatingState(branch, branch.school);
  return {
    timeZone,
    today,
    earliestEffectiveDate: current ? addDays(today, 1) : today,
    latestEffectiveDate: addDays(today, MAX_AHEAD_DAYS),
    current: toVersion(current),
    scheduled: toVersion(scheduled),
    canChange: operating,
    notOperatingReasons: reasons,
  };
}

/** Every version, newest effective date first, with state (current, scheduled, previous, cancelled) and effectiveUntil (the last day it applies). */
export async function listVersions(branch) {
  const timeZone = await platformTimeZone();
  const today = localDate(timeZone);
  const rows = await getPrisma().branchSchedule.findMany({
    where: { branchId: branch.id },
    include: versionInclude,
    orderBy: [{ effectiveFrom: 'desc' }, { recordedAt: 'desc' }],
  });
  const active = rows.filter((v) => !v.cancelledAt);
  const current = active.find((v) => fromDbDate(v.effectiveFrom) <= today);
  return {
    timeZone,
    items: rows.map((v) => {
      const next = active.filter((o) => o.effectiveFrom > v.effectiveFrom).at(-1);
      const state = v.cancelledAt ? 'cancelled' : v === current ? 'current' : fromDbDate(v.effectiveFrom) > today ? 'scheduled' : 'previous';
      return { ...toVersion(v), state, effectiveUntil: !v.cancelledAt && next ? addDays(fromDbDate(next.effectiveFrom), -1) : null };
    }),
  };
}

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

async function cancelVersion(tx, branch, version, user, req, reason) {
  const now = new Date();
  await tx.branchSchedule.updateMany({ where: { id: version.id, cancelledAt: null }, data: { cancelledAt: now } });
  await recordAuditEvent({
    client: tx,
    action: AUDIT_ACTIONS.BRANCH_SCHEDULE_CHANGE_CANCELLED,
    actor: actorOf(user),
    target: auditTarget(branch),
    schoolId: branch.school.id,
    description: `Scheduled schedule change from ${fromDbDate(version.effectiveFrom)} cancelled.${reason ? ` ${reason}` : ''}`,
    change: { field: 'Scheduled change', from: `From ${fromDbDate(version.effectiveFrom)}`, to: 'Cancelled' },
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
 * Saves a new schedule version from `effectiveFrom` (today only for the branch's first schedule,
 * otherwise tomorrow at the earliest; at most a year ahead). A scheduled version is replaced
 * (cancelled, kept). Saving the schedule already in effect with nothing scheduled changes nothing;
 * with something scheduled it only cancels that.
 */
export async function saveSchedule(branch, { effectiveFrom, checkOutEnabled, shifts }, user, req) {
  const timeZone = await platformTimeZone();
  await getPrisma().$transaction(async (tx) => {
    await lockOperatingBranch(tx, branch);
    const today = localDate(timeZone);
    const [current, scheduled] = await Promise.all([scheduleOn(branch.id, today, tx), scheduledAfter(branch.id, today, tx)]);
    const earliest = current ? addDays(today, 1) : today;
    const latest = addDays(today, MAX_AHEAD_DAYS);
    if (effectiveFrom < earliest) {
      throw badRequest('Check the highlighted fields.', {
        effectiveFrom: current
          ? `A change can start tomorrow (${earliest}) at the earliest, so today's schedule does not change during the day.`
          : `The schedule can start today (${today}) at the earliest.`,
      });
    }
    if (effectiveFrom > latest) throw badRequest('Check the highlighted fields.', { effectiveFrom: `The schedule can start at most one year ahead (${latest}).` });

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
      if (scheduled) await cancelVersion(tx, branch, scheduled, user, req, 'The schedule saved is the one already in effect.');
      return;
    }
    const fields = [];
    if (scheduled) {
      await tx.branchSchedule.updateMany({ where: { id: scheduled.id, cancelledAt: null }, data: { cancelledAt: new Date() } });
      fields.push({ field: 'Scheduled change', from: `From ${fromDbDate(scheduled.effectiveFrom)}`, to: 'Replaced' });
    }
    await tx.branchSchedule.create({
      data: { branchId: branch.id, effectiveFrom: asDbDate(effectiveFrom), timeZone, checkOutEnabled, shifts: { create: keyed } },
    });
    fields.push(
      { field: 'Effective from', from: current ? fromDbDate(current.effectiveFrom) : null, to: `${effectiveFrom} (${timeZone})` },
      { field: 'Check-out', from: current ? (current.checkOutEnabled ? 'On' : 'Off') : null, to: checkOutEnabled ? 'On' : 'Off' },
      { field: 'Shifts', from: current ? current.shifts.map(shiftSummary).join('; ') : null, to: shifts.map(shiftSummary).join('; ') },
    );
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.BRANCH_SCHEDULE_CHANGED,
      actor: actorOf(user),
      target: auditTarget(branch),
      schoolId: branch.school.id,
      description: `Schedule ${current ? 'changed' : 'set'} from ${effectiveFrom} with ${shifts.length} shift${shifts.length === 1 ? '' : 's'}; check-out ${checkOutEnabled ? 'on' : 'off'}.`,
      change: { fields },
      req,
    });
  }, BRANCH_TX);
  return getSchedule(branch);
}

/** Cancels the scheduled version (404 when there is none). */
export async function cancelScheduledSchedule(branch, user, req) {
  const timeZone = await platformTimeZone();
  await getPrisma().$transaction(async (tx) => {
    await lockOperatingBranch(tx, branch);
    const scheduled = await scheduledAfter(branch.id, localDate(timeZone), tx);
    if (!scheduled) throw notFound('There is no scheduled schedule change.');
    await cancelVersion(tx, branch, scheduled, user, req);
  }, BRANCH_TX);
  return getSchedule(branch);
}

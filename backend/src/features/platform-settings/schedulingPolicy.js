import { badRequest } from '../../common/httpError.js';
import { localDateTime, zonedInstant } from '../../common/zonedTime.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';

/*
 * Scheduling & Assignments settings (Platform Settings, Super Admin). Approved 2026-11-01:
 *   effectiveDelayDays        the minimum effective delay, in calendar days (1–30) in the platform
 *                             time zone, for branch schedule changes, staff assignment changes and
 *                             staff transfers: the earliest effective date is today + N. Not 24-hour
 *                             periods: a change saved at 23:59 with a 1-day delay starts at 00:00
 *                             the next day. The user may choose any later date (up to one year).
 *   immediateFirstSchedule    a branch's first schedule (none in effect today) may start today
 *   immediateFirstAssignment  a staff member's first assignment set may start today
 *   timedChanges              "Allow changes to take effect at their scheduled time": schedule
 *                             changes, assignment changes and transfers may start today or later at
 *                             a chosen date and time (never in the past); the delay and the two
 *                             switches above do not apply. Off: the delay applies and changes start
 *                             at 00:00 (no time can be chosen).
 * Defaults (an empty value): 1 day, both switches on, and no timed changes, which is the behaviour
 * before these settings existed. A delay of 0 is not offered: a day's rules never change during the day.
 * Changes are saved at once and apply from their date; nothing has to "activate" them (the version
 * in effect on a day is the newest one whose date has arrived; see schedules.service scheduleOn).
 */

export const SCHEDULING_DEFAULTS = Object.freeze({ effectiveDelayDays: 1, immediateFirstSchedule: true, immediateFirstAssignment: true, timedChanges: false });
export const EFFECTIVE_DELAY = Object.freeze({ minDays: 1, maxDays: 30 });

const FIELDS = ['effectiveDelayDays', 'immediateFirstSchedule', 'immediateFirstAssignment', 'timedChanges'];
const SWITCHES = ['immediateFirstSchedule', 'immediateFirstAssignment', 'timedChanges'];
const DELAY_PROBLEM = `Effective delay must be a whole number of days from ${EFFECTIVE_DELAY.minDays} to ${EFFECTIVE_DELAY.maxDays}.`;

export const isValidDelayDays = (value) => Number.isInteger(value) && value >= EFFECTIVE_DELAY.minDays && value <= EFFECTIVE_DELAY.maxDays;

/** The policy in force from the settings row (or null): stored values, or the defaults. */
export function schedulingSettings(row) {
  return {
    effectiveDelayDays: isValidDelayDays(row?.effectiveDelayDays) ? row.effectiveDelayDays : SCHEDULING_DEFAULTS.effectiveDelayDays,
    immediateFirstSchedule: typeof row?.immediateFirstSchedule === 'boolean' ? row.immediateFirstSchedule : SCHEDULING_DEFAULTS.immediateFirstSchedule,
    immediateFirstAssignment: typeof row?.immediateFirstAssignment === 'boolean' ? row.immediateFirstAssignment : SCHEDULING_DEFAULTS.immediateFirstAssignment,
    timedChanges: typeof row?.timedChanges === 'boolean' ? row.timedChanges : SCHEDULING_DEFAULTS.timedChanges,
    limits: EFFECTIVE_DELAY,
  };
}

/** The policy in force (one small query; pass a transaction client to read it inside one). */
export async function schedulingPolicy(client = getPrisma()) {
  const row = await client.platformSettings.findUnique({
    where: { id: 'platform' },
    select: { effectiveDelayDays: true, immediateFirstSchedule: true, immediateFirstAssignment: true, timedChanges: true },
  });
  return schedulingSettings(row);
}

const plusDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The earliest effective date for a change saved today ('YYYY-MM-DD', platform time zone).
 * `first`: nothing is in effect today (no schedule, or no assignment set); `immediateFirst`: the
 * matching switch. → today for an allowed first one, otherwise today + the delay.
 */
export const earliestEffectiveDate = (today, { delayDays, first = false, immediateFirst = false }) => (first && immediateFirst ? today : plusDays(today, delayDays));

/**
 * Why a date before the earliest is refused, for the effective-date field. `what`: 'schedule',
 * 'assignments' or 'transfer'.
 */
export function earliestDateProblem(what, { today, earliest, delayDays, first }) {
  if (earliest === today) return what === 'schedule' ? `The schedule can start today (${today}) at the earliest.` : `Assignments can start today (${today}) at the earliest.`;
  const when = delayDays === 1 ? `tomorrow (${earliest})` : `on ${earliest} (${delayDays} days from today)`;
  if (what === 'transfer') return `A transfer can start ${when} at the earliest, so a work day is never split between branches.`;
  if (first) return `The first ${what === 'schedule' ? 'schedule' : 'assignments'} can start ${when} at the earliest (the platform's effective delay).`;
  return what === 'schedule'
    ? `A change can start ${when} at the earliest, so today's schedule does not change during the day.`
    : `A change can start ${when} at the earliest, so today's assignments do not change during the day.`;
}

/**
 * The earliest effective date under the policy: today when timed changes are on (any time after now
 * on that date), otherwise earliestEffectiveDate.
 */
export const earliestDateUnder = (policy, today, { first = false, immediateFirst = false } = {}) =>
  policy.timedChanges ? today : earliestEffectiveDate(today, { delayDays: policy.effectiveDelayDays, first, immediateFirst });

/**
 * The effective date fields for a page: { timedChanges, effectiveDelayDays, earliestEffectiveDate,
 * now: { date, time } } (now in the time zone, so a form can tell a past time on today).
 */
export function effectiveDateFields(policy, { timeZone, today, now = new Date(), first = false, immediateFirst = false }) {
  const local = localDateTime(now, timeZone);
  return {
    timedChanges: policy.timedChanges,
    effectiveDelayDays: policy.effectiveDelayDays,
    earliestEffectiveDate: earliestDateUnder(policy, today, { first, immediateFirst }),
    now: { date: local.date, time: local.time },
  };
}

const minutesText = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * The instant a change takes effect, checked against the policy: `effectiveFrom` (a date) and
 * `effectiveTime` (minutes after midnight, or null = 00:00) in `timeZone`. → { effectiveFrom,
 * effectiveAt }, or throws 400 with `effectiveFrom` / `effectiveTime` problems. `what`:
 * 'schedule', 'assignments' or 'transfer'; `first` / `immediateFirst` as for earliestEffectiveDate;
 * `latest`: the last allowed date.
 *   Timed changes on: any date from today to `latest`, at any time after now (00:00 when not sent);
 *     a past date or time is refused.
 *   Off: no time may be sent (00:00); the date is from the earliest date (delay, first switch) to `latest`.
 */
export function resolveEffective(policy, { what, effectiveFrom, effectiveTime, timeZone, today, latest, now = new Date(), first = false, immediateFirst = false }) {
  const errors = {};
  const noun = what === 'schedule' ? 'The schedule' : what === 'transfer' ? 'A transfer' : 'Assignments';
  if (!policy.timedChanges) {
    if (effectiveTime !== null && effectiveTime !== undefined && effectiveTime !== 0) {
      errors.effectiveTime = 'Changes take effect at 00:00 of their date. A time can be chosen only when Platform Settings allow changes at their scheduled time.';
    }
    const earliest = earliestEffectiveDate(today, { delayDays: policy.effectiveDelayDays, first, immediateFirst });
    if (effectiveFrom < earliest) errors.effectiveFrom = earliestDateProblem(what, { today, earliest, delayDays: policy.effectiveDelayDays, first });
    else if (effectiveFrom > latest) errors.effectiveFrom = `${noun} can start at most one year ahead (${latest}).`;
    if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
    return { effectiveFrom, effectiveAt: zonedInstant(effectiveFrom, 0, timeZone) };
  }
  if (effectiveFrom < today) errors.effectiveFrom = `Choose today (${today}) or a later date. Changes cannot start in the past.`;
  else if (effectiveFrom > latest) errors.effectiveFrom = `${noun} can start at most one year ahead (${latest}).`;
  else {
    const effectiveAt = zonedInstant(effectiveFrom, effectiveTime ?? 0, timeZone);
    if (effectiveAt <= now) {
      const local = localDateTime(now, timeZone);
      errors.effectiveTime = `Choose a time after now (${local.time}). Changes cannot start in the past.`;
    }
    if (!Object.keys(errors).length) return { effectiveFrom, effectiveAt };
  }
  throw badRequest('Check the highlighted fields.', errors);
}

/** 'From 2026-11-01 13:30' or 'From 2026-11-01' (00:00), for audit descriptions. */
export const effectiveText = (effectiveAt, timeZone) => {
  const local = localDateTime(effectiveAt, timeZone);
  return local.minutes ? `${local.date} ${minutesText(local.minutes)}` : local.date;
};

const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key);

/** Update body: { effectiveDelayDays?, immediateFirstSchedule?, immediateFirstAssignment?, timedChanges? }, at least one. */
export function readScheduling(body) {
  const unknown = Object.keys(body).filter((key) => !FIELDS.includes(key));
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);
  if (!FIELDS.some((key) => has(body, key))) throw badRequest('Send effectiveDelayDays, immediateFirstSchedule, immediateFirstAssignment or timedChanges.');
  const values = {};
  const details = {};
  if (has(body, 'effectiveDelayDays')) {
    if (isValidDelayDays(body.effectiveDelayDays)) values.effectiveDelayDays = body.effectiveDelayDays;
    else details.effectiveDelayDays = DELAY_PROBLEM;
  }
  for (const key of SWITCHES) {
    if (!has(body, key)) continue;
    if (typeof body[key] === 'boolean') values[key] = body[key];
    else details[key] = 'Send true or false.';
  }
  if (Object.keys(details).length) throw badRequest(Object.values(details).join(' '), details);
  return values;
}

const LABELS = {
  effectiveDelayDays: 'Effective delay',
  immediateFirstSchedule: 'First schedule may start today',
  immediateFirstAssignment: 'First assignments may start today',
  timedChanges: 'Allow changes to take effect at their scheduled time',
};
const text = (key, value) => (key === 'effectiveDelayDays' ? `${value} ${value === 1 ? 'day' : 'days'}` : value ? 'Yes' : 'No');

/**
 * Saves the settings that differ from the policy in force; each change records one
 * SCHEDULING_SETTINGS_UPDATED event (previous and new value) in the same transaction, with the
 * settings row locked so simultaneous saves apply one after the other. The same values change and
 * record nothing. Applies to changes saved afterwards; changes already saved keep their dates.
 */
export async function updateScheduling(values, user, req) {
  const row = await getPrisma().$transaction(async (tx) => {
    // The row may not exist yet (e.g. production before any setting is saved).
    await tx.$executeRaw`INSERT INTO "PlatformSettings" ("id", "updatedAt") VALUES ('platform', now()) ON CONFLICT ("id") DO NOTHING`;
    const [current] = await tx.$queryRaw`SELECT "effectiveDelayDays", "immediateFirstSchedule", "immediateFirstAssignment", "timedChanges" FROM "PlatformSettings" WHERE "id" = 'platform' FOR UPDATE`;
    const inForce = schedulingSettings(current);
    const changed = FIELDS.filter((key) => values[key] !== undefined && values[key] !== inForce[key]);
    if (!changed.length) return current;
    const saved = await tx.platformSettings.update({ where: { id: 'platform' }, data: Object.fromEntries(changed.map((key) => [key, values[key]])) });
    for (const key of changed) {
      await recordAuditEvent({
        client: tx,
        action: AUDIT_ACTIONS.SCHEDULING_SETTINGS_UPDATED,
        actor: { id: user.id, name: user.name, role: user.role },
        target: { type: 'system', id: null, name: 'Scheduling & Assignments settings' },
        description: `${LABELS[key]} changed. It applies to changes saved from now on; changes already saved keep their dates.`,
        change: { field: LABELS[key], from: text(key, inForce[key]), to: text(key, values[key]) },
        req,
      });
    }
    return saved;
  });
  return schedulingSettings(row);
}

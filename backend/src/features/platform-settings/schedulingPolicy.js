import { badRequest } from '../../common/httpError.js';
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
 * Defaults (an empty value): 1 day, and both switches on, which is the behaviour before these
 * settings existed. A delay of 0 is not offered: a day's rules never change during the day.
 * Changes are saved at once and apply from their date; nothing has to "activate" them (the version
 * in effect on a day is the newest one whose date has arrived; see schedules.service scheduleOn).
 */

export const SCHEDULING_DEFAULTS = Object.freeze({ effectiveDelayDays: 1, immediateFirstSchedule: true, immediateFirstAssignment: true });
export const EFFECTIVE_DELAY = Object.freeze({ minDays: 1, maxDays: 30 });

const FIELDS = ['effectiveDelayDays', 'immediateFirstSchedule', 'immediateFirstAssignment'];
const DELAY_PROBLEM = `Effective delay must be a whole number of days from ${EFFECTIVE_DELAY.minDays} to ${EFFECTIVE_DELAY.maxDays}.`;

export const isValidDelayDays = (value) => Number.isInteger(value) && value >= EFFECTIVE_DELAY.minDays && value <= EFFECTIVE_DELAY.maxDays;

/** The policy in force from the settings row (or null): stored values, or the defaults. */
export function schedulingSettings(row) {
  return {
    effectiveDelayDays: isValidDelayDays(row?.effectiveDelayDays) ? row.effectiveDelayDays : SCHEDULING_DEFAULTS.effectiveDelayDays,
    immediateFirstSchedule: typeof row?.immediateFirstSchedule === 'boolean' ? row.immediateFirstSchedule : SCHEDULING_DEFAULTS.immediateFirstSchedule,
    immediateFirstAssignment: typeof row?.immediateFirstAssignment === 'boolean' ? row.immediateFirstAssignment : SCHEDULING_DEFAULTS.immediateFirstAssignment,
    limits: EFFECTIVE_DELAY,
  };
}

/** The policy in force (one small query; pass a transaction client to read it inside one). */
export async function schedulingPolicy(client = getPrisma()) {
  const row = await client.platformSettings.findUnique({
    where: { id: 'platform' },
    select: { effectiveDelayDays: true, immediateFirstSchedule: true, immediateFirstAssignment: true },
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

const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key);

/** Update body: { effectiveDelayDays?, immediateFirstSchedule?, immediateFirstAssignment? }, at least one. */
export function readScheduling(body) {
  const unknown = Object.keys(body).filter((key) => !FIELDS.includes(key));
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);
  if (!FIELDS.some((key) => has(body, key))) throw badRequest('Send effectiveDelayDays, immediateFirstSchedule or immediateFirstAssignment.');
  const values = {};
  const details = {};
  if (has(body, 'effectiveDelayDays')) {
    if (isValidDelayDays(body.effectiveDelayDays)) values.effectiveDelayDays = body.effectiveDelayDays;
    else details.effectiveDelayDays = DELAY_PROBLEM;
  }
  for (const key of ['immediateFirstSchedule', 'immediateFirstAssignment']) {
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
    const [current] = await tx.$queryRaw`SELECT "effectiveDelayDays", "immediateFirstSchedule", "immediateFirstAssignment" FROM "PlatformSettings" WHERE "id" = 'platform' FOR UPDATE`;
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

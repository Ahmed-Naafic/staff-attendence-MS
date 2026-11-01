import { badRequest } from '../../common/httpError.js';

/*
 * Data & Backup rules without I/O (docs/data-backup/data-backup-specification.md): schedule
 * timing, overdue detection, validation of configuration changes and the confirmation phrase.
 */

export const FREQUENCIES = ['daily', 'weekly', 'monthly'];
/** Neon keeps scheduled snapshots at most 35 days (retention_seconds ≤ 3 024 000). */
export const SCHEDULE_RETENTION_DAYS = { min: 1, max: 35, fallback: 14 };
/** Manual backups: kept this many days unless protected (Neon deletes them at expiry). */
export const MANUAL_RETENTION_DAYS = { min: 1, max: 365, fallback: 30 };
/** A scheduled backup this much later than due counts as overdue. */
export const OVERDUE_GRACE_MS = 3 * 60 * 60 * 1000;
/** A backup or restore step still running after this long is reported as failed (timed out). */
export const OPERATION_TIMEOUT_MS = 2 * 60 * 60 * 1000;
/** Typed to confirm a production restore. */
export const PRODUCTION_CONFIRMATION = 'RESTORE PRODUCTION';
/**
 * Weekly schedules: Neon's documentation describes `day` as 1–7, Monday to Sunday
 * (docs/data-backup/backup-architecture.md → Open points: checked against the live API).
 */
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const DAY_MS = 24 * 60 * 60 * 1000;
const INTERVAL_MS = { daily: DAY_MS, weekly: 7 * DAY_MS, monthly: 31 * DAY_MS };

const utc = (y, m, d, h) => new Date(Date.UTC(y, m, d, h, 0, 0, 0));
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** The next time Neon's schedule is due after `now` (hours are UTC), or null without a schedule. */
export function nextScheduledAt(schedule, now = new Date()) {
  if (!schedule) return null;
  const hour = schedule.hour ?? 0;
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  if (schedule.frequency === 'daily') {
    const today = utc(y, m, d, hour);
    return today > now ? today : utc(y, m, d + 1, hour);
  }
  if (schedule.frequency === 'weekly') {
    const target = (Number(schedule.day ?? 1) % 7 + 7) % 7; // 1..7 Mon..Sun → JS 1..6, 0 (Sunday)
    for (let i = 0; i <= 7; i += 1) {
      const at = utc(y, m, d + i, hour);
      if (at.getUTCDay() === target && at > now) return at;
    }
  }
  if (schedule.frequency === 'monthly') {
    const want = Number(schedule.day ?? 1);
    for (let i = 0; i <= 1; i += 1) {
      const month = m + i;
      const yy = y + Math.floor(month / 12);
      const mm = ((month % 12) + 12) % 12;
      const at = utc(yy, mm, Math.min(want, daysInMonth(yy, mm)), hour);
      if (at > now) return at;
    }
  }
  return null;
}

/** Whether the latest scheduled backup is older than the schedule allows (+3 h grace). */
export function scheduleOverdue(schedule, lastScheduledAt, now = new Date()) {
  if (!schedule || !lastScheduledAt) return false;
  return now.getTime() - new Date(lastScheduledAt).getTime() > (INTERVAL_MS[schedule.frequency] ?? DAY_MS) + OVERDUE_GRACE_MS;
}

/** The schedule in words: "Daily at 02:00 UTC", "Weekly on Monday at 02:00 UTC", "Monthly on day 1 at 02:00 UTC". */
export function scheduleText(schedule) {
  if (!schedule) return 'No schedule';
  const at = `${String(schedule.hour ?? 0).padStart(2, '0')}:00 UTC`;
  if (schedule.frequency === 'weekly') return `Weekly on ${WEEKDAYS[(Number(schedule.day ?? 1) - 1 + 7) % 7]} at ${at}`;
  if (schedule.frequency === 'monthly') return `Monthly on day ${schedule.day ?? 1} at ${at}`;
  return `Daily at ${at}`;
}

const intIn = (value, { min, max }) => Number.isInteger(value) && value >= min && value <= max;

/**
 * A configuration change: { frequency, hour, day, retentionDays, manualRetentionDays }, each optional.
 * → { schedule?: { frequency, hour, day, retentionDays }, manualRetentionDays? } merged onto `current`
 * ({ schedule, manualRetentionDays }). Unknown fields are refused.
 */
export function readConfiguration(body, current) {
  const allowed = ['frequency', 'hour', 'day', 'retentionDays', 'manualRetentionDays'];
  const unknown = Object.keys(body ?? {}).filter((k) => !allowed.includes(k));
  if (unknown.length) throw badRequest(`Unknown field(s): ${unknown.join(', ')}.`);
  if (!Object.keys(body ?? {}).length) throw badRequest('Send at least one setting.');
  const errors = {};
  const base = current.schedule ?? { frequency: 'daily', hour: 2, day: null, retentionDays: SCHEDULE_RETENTION_DAYS.fallback };
  const touchesSchedule = ['frequency', 'hour', 'day', 'retentionDays'].some((k) => body[k] !== undefined);
  const next = { ...base, ...Object.fromEntries(['frequency', 'hour', 'day', 'retentionDays'].filter((k) => body[k] !== undefined).map((k) => [k, body[k]])) };
  if (!FREQUENCIES.includes(next.frequency)) errors.frequency = 'Choose daily, weekly or monthly.';
  if (!intIn(next.hour, { min: 0, max: 23 })) errors.hour = 'Choose an hour from 00 to 23 (UTC).';
  if (next.frequency === 'weekly' && !intIn(next.day, { min: 1, max: 7 })) errors.day = 'Choose a day of the week.';
  if (next.frequency === 'monthly' && !intIn(next.day, { min: 1, max: 28 })) errors.day = 'Choose a day of the month from 1 to 28 (every month has it).';
  if (next.frequency === 'daily') next.day = null;
  if (!intIn(next.retentionDays, SCHEDULE_RETENTION_DAYS)) errors.retentionDays = `Keep scheduled backups ${SCHEDULE_RETENTION_DAYS.min} to ${SCHEDULE_RETENTION_DAYS.max} days (Neon's limit).`;
  if (body.manualRetentionDays !== undefined && !intIn(body.manualRetentionDays, MANUAL_RETENTION_DAYS)) {
    errors.manualRetentionDays = `Keep manual backups ${MANUAL_RETENTION_DAYS.min} to ${MANUAL_RETENTION_DAYS.max} days.`;
  }
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return {
    ...(touchesSchedule && { schedule: next }),
    ...(body.manualRetentionDays !== undefined && { manualRetentionDays: body.manualRetentionDays }),
  };
}

/** Name of a backup, branch or recovery point made by EduTrack: `${prefix}-YYYYMMDD-HHMMSS` (UTC). */
export const stampName = (prefix, now = new Date()) => `${prefix}-${now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`;

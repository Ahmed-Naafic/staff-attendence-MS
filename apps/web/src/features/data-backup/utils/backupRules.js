// Display and form rules for Data & Backup (the API checks everything again).

export const BACKUP_STATUS = {
  COMPLETED: { label: 'Completed', variant: 'success' },
  RUNNING: { label: 'Running', variant: 'info' },
  SCHEDULED: { label: 'Scheduled', variant: 'neutral' },
  RESTORING: { label: 'Restoring', variant: 'warning' },
  FAILED: { label: 'Failed', variant: 'error' },
  EXPIRED: { label: 'Expired', variant: 'neutral' },
  DELETED: { label: 'Deleted', variant: 'neutral' },
};
export const statusOf = (code) => BACKUP_STATUS[code] ?? { label: code, variant: 'neutral' };

export const RESTORE_STATUS = {
  RUNNING: { label: 'Restoring (staged)', variant: 'warning' },
  VERIFIED: { label: 'Checked, awaiting decision', variant: 'info' },
  COMPLETED: { label: 'Production restored', variant: 'success' },
  FAILED: { label: 'Failed', variant: 'error' },
  DISCARDED: { label: 'Discarded', variant: 'neutral' },
};
export const restoreStatusOf = (code) => RESTORE_STATUS[code] ?? { label: code, variant: 'neutral' };

export const KIND_LABELS = { MANUAL: 'Manual', SCHEDULED: 'Scheduled', PRE_RESTORE: 'Before restore' };

export const STATUS_FILTERS = [
  { value: '', label: 'All statuses' },
  ...['COMPLETED', 'RUNNING', 'RESTORING', 'FAILED', 'EXPIRED', 'DELETED'].map((value) => ({ value, label: statusOf(value).label })),
];
export const KIND_FILTERS = [
  { value: '', label: 'All types' },
  { value: 'MANUAL', label: 'Manual' },
  { value: 'SCHEDULED', label: 'Scheduled' },
];

/** The phrase typed to confirm a production restore (the API requires the same). */
export const PRODUCTION_CONFIRMATION = 'RESTORE PRODUCTION';
export const confirmationOk = (text) => text === PRODUCTION_CONFIRMATION;

/** 1536 → "1.5 KB"; null → "Not reported". */
export function formatBytes(bytes) {
  if (bytes == null) return 'Not reported';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];
export const weekdayOptions = WEEKDAYS.map((label, i) => ({ value: String(i + 1), label }));
export const monthDayOptions = Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `Day ${i + 1}` }));

const localHour = (hour, timeZone, now) => {
  try {
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour));
    return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  } catch {
    return null;
  }
};

/** Hours 00–23 UTC (Neon's schedule is in UTC), each with the platform time zone's local time. */
export function hourOptions(timeZone, now = new Date()) {
  return Array.from({ length: 24 }, (_, hour) => {
    const utc = `${String(hour).padStart(2, '0')}:00 UTC`;
    const local = timeZone && timeZone !== 'UTC' ? localHour(hour, timeZone, now) : null;
    return { value: String(hour), label: local ? `${utc} (${local} ${timeZone})` : utc };
  });
}

/** The configuration form's values (strings) from the API's configuration. */
export const configDraft = (config) => ({
  frequency: config.schedule?.frequency ?? 'daily',
  hour: String(config.schedule?.hour ?? 2),
  day: config.schedule?.day == null ? '1' : String(config.schedule.day),
  retentionDays: String(config.schedule?.retentionDays ?? 14),
  manualRetentionDays: String(config.manualRetentionDays ?? 30),
});

const whole = (text, min, max) => /^\d+$/.test(String(text).trim()) && Number(text) >= min && Number(text) <= max;

/** Field problems of a draft, as the API would report them. */
export function configProblems(draft) {
  const errors = {};
  if (!whole(draft.retentionDays, 1, 35)) errors.retentionDays = 'Enter 1 to 35 days (Neon keeps scheduled backups at most 35 days).';
  if (!whole(draft.manualRetentionDays, 1, 365)) errors.manualRetentionDays = 'Enter 1 to 365 days.';
  return errors;
}

/**
 * The changed values to send. A schedule change sends the whole schedule (frequency, hour, day,
 * retention), so Neon receives one consistent entry; the manual retention is sent on its own.
 */
export function changedConfig(saved, draft) {
  const before = configDraft(saved);
  const scheduleKeys = ['frequency', 'hour', 'day', 'retentionDays'];
  const relevant = (d) => ({ ...d, day: d.frequency === 'daily' ? '' : String(d.day) });
  // Without a schedule at Neon yet, saving sets one.
  const scheduleChanged = !saved.schedule || scheduleKeys.some((k) => relevant(before)[k].trim() !== relevant(draft)[k].trim());
  const values = {};
  if (scheduleChanged) {
    values.frequency = draft.frequency;
    values.hour = Number(draft.hour);
    if (draft.frequency !== 'daily') values.day = Number(draft.day);
    values.retentionDays = Number(draft.retentionDays);
  }
  if (before.manualRetentionDays !== draft.manualRetentionDays.trim()) values.manualRetentionDays = Number(draft.manualRetentionDays);
  return values;
}

/** What changing the retention means, shown before saving. */
export function retentionConsequences(saved, draft) {
  const notes = [];
  const before = configDraft(saved);
  if (saved.schedule && Number(draft.retentionDays) < Number(before.retentionDays)) {
    notes.push(`Scheduled backups will be kept ${draft.retentionDays} days instead of ${before.retentionDays}: Neon may remove scheduled backups older than that, and you can restore less far back.`);
  }
  if (Number(draft.manualRetentionDays) < Number(before.manualRetentionDays)) {
    notes.push(`New manual backups will expire after ${draft.manualRetentionDays} days. Existing manual backups keep the expiry they were created with.`);
  }
  if (Number(draft.retentionDays) > Number(before.retentionDays) || Number(draft.manualRetentionDays) > Number(before.manualRetentionDays)) {
    notes.push('Keeping backups longer uses more Neon storage, which Neon bills.');
  }
  return notes;
}

/** Actions allowed on a history row. */
export const canDelete = (b) => ['COMPLETED', 'EXPIRED'].includes(b.status) && !b.protected && b.providerRef;
export const canRestore = (b) => b.status === 'COMPLETED';
export const canProtect = (b) => b.status === 'COMPLETED' && b.kind === 'MANUAL';
export const canVerify = (b) => ['COMPLETED', 'RUNNING'].includes(b.status);

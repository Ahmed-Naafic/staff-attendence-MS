import { badRequest, conflict } from '../../common/httpError.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { operatingState } from '../branches/branches.service.js';
import {
  DEFAULT_PLATFORM_SETTINGS,
  effectiveReminders,
  HARD_LIMITS,
  isMandatory,
  ROLE_CATEGORIES,
} from './notificationTypes.js';

/*
 * The three configuration levels (N5, N12, N13):
 *   platform (Super Admin): reminder defaults and limits, push on/off, digest hour;
 *   branch (its Manager): reminder timing within the platform limits;
 *   user: optional categories on/off, push on/off, and for staff their reminders within the limits.
 * Owners configure no defaults for others (N13). Every actual change records one audit event with
 * the previous and new values (N22); saving the same values changes and records nothing.
 */

const PLATFORM_FIELDS = Object.keys(DEFAULT_PLATFORM_SETTINGS);
const LABELS = {
  pushEnabled: 'Push notifications',
  checkInReminderEnabled: 'Check-in reminders',
  checkOutReminderEnabled: 'Check-out reminders',
  uploadReminderEnabled: 'Upload reminders',
  checkInLeadDefault: 'Check-in reminder default (minutes)',
  checkInLeadMin: 'Check-in reminder minimum (minutes)',
  checkInLeadMax: 'Check-in reminder maximum (minutes)',
  checkOutLeadDefault: 'Check-out reminder default (minutes)',
  checkOutLeadMin: 'Check-out reminder minimum (minutes)',
  checkOutLeadMax: 'Check-out reminder maximum (minutes)',
  staffCanAdjustTiming: 'Staff can adjust reminder timing',
  digestHour: 'Daily digest hour',
  checkInLeadMinutes: 'Check-in reminder (minutes before start)',
  checkOutLeadMinutes: 'Check-out reminder (minutes before end)',
  checkInReminder: 'Check-in reminder',
  checkOutReminder: 'Check-out reminder',
  uploadReminder: 'Upload reminder',
  disabledCategories: 'Turned-off categories',
  locationConsent: 'Background location for reminders',
};
const show = (value) => (value === null || value === undefined ? 'Default' : typeof value === 'boolean' ? (value ? 'On' : 'Off') : Array.isArray(value) ? value.join(', ') || 'None' : String(value));
const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });

// ---- input ---------------------------------------------------------------------------------

function readBody(body, allowed) {
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length) throw badRequest('Check the highlighted fields.', Object.fromEntries(unknown.map((k) => [k, 'This field cannot be changed here.'])));
}
const bool = (body, key, errors) => {
  if (body[key] === undefined) return undefined;
  if (typeof body[key] !== 'boolean') errors[key] = 'Choose on or off.';
  return body[key];
};
const int = (body, key, errors, { min, max, nullable = false }) => {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null && nullable) return null;
  if (!Number.isInteger(value) || value < min || value > max) errors[key] = `Enter a whole number from ${min} to ${max}.`;
  return value;
};

// ---- platform ------------------------------------------------------------------------------

/** The platform notification settings (the database defaults when none are saved). */
export async function platformNotificationSettings(client = getPrisma()) {
  const row = await client.notificationSettings.findUnique({ where: { id: 'platform' } });
  return Object.fromEntries(PLATFORM_FIELDS.map((k) => [k, row?.[k] ?? DEFAULT_PLATFORM_SETTINGS[k]]));
}

export const platformLimits = () => HARD_LIMITS;

/** Validates a platform settings change: one or more known fields, with consistent limits. */
export function readPlatformSettings(body, current) {
  readBody(body, PLATFORM_FIELDS);
  if (!Object.keys(body).length) throw badRequest('Send at least one setting.');
  const errors = {};
  const values = {};
  for (const key of ['pushEnabled', 'checkInReminderEnabled', 'checkOutReminderEnabled', 'uploadReminderEnabled', 'staffCanAdjustTiming']) {
    const v = bool(body, key, errors);
    if (v !== undefined) values[key] = v;
  }
  for (const [key, limit] of [
    ['checkInLeadDefault', HARD_LIMITS.checkInLead],
    ['checkInLeadMin', HARD_LIMITS.checkInLead],
    ['checkInLeadMax', HARD_LIMITS.checkInLead],
    ['checkOutLeadDefault', HARD_LIMITS.checkOutLead],
    ['checkOutLeadMin', HARD_LIMITS.checkOutLead],
    ['checkOutLeadMax', HARD_LIMITS.checkOutLead],
    ['digestHour', HARD_LIMITS.digestHour],
  ]) {
    const v = int(body, key, errors, limit);
    if (v !== undefined) values[key] = v;
  }
  if (!Object.keys(errors).length) {
    const next = { ...current, ...values };
    for (const kind of ['checkIn', 'checkOut']) {
      if (next[`${kind}LeadMin`] > next[`${kind}LeadMax`]) errors[`${kind}LeadMin`] = 'The minimum cannot be more than the maximum.';
      else if (next[`${kind}LeadDefault`] < next[`${kind}LeadMin`] || next[`${kind}LeadDefault`] > next[`${kind}LeadMax`]) {
        errors[`${kind}LeadDefault`] = `The default must be from ${next[`${kind}LeadMin`]} to ${next[`${kind}LeadMax`]} minutes.`;
      }
    }
  }
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return values;
}

/** Saves platform settings (Super Admin): one NOTIFICATION_SETTINGS_UPDATED event listing each changed field. */
export async function updatePlatformNotificationSettings(body, user, req) {
  return getPrisma().$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "NotificationSettings" ("id", "updatedAt") VALUES ('platform', now()) ON CONFLICT ("id") DO NOTHING`;
    await tx.$queryRaw`SELECT "id" FROM "NotificationSettings" WHERE "id" = 'platform' FOR UPDATE`;
    const current = await platformNotificationSettings(tx);
    const values = readPlatformSettings(body, current);
    const changed = Object.keys(values).filter((k) => values[k] !== current[k]);
    if (!changed.length) return current;
    await tx.notificationSettings.update({ where: { id: 'platform' }, data: Object.fromEntries(changed.map((k) => [k, values[k]])) });
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.NOTIFICATION_SETTINGS_UPDATED,
      actor: actorOf(user),
      target: { type: 'system', id: null, name: 'Notification settings' },
      description: `Notification settings updated: ${changed.map((k) => LABELS[k]).join(', ')}.`,
      change: { fields: changed.map((k) => ({ field: LABELS[k], from: show(current[k]), to: show(values[k]) })) },
      req,
    });
    return platformNotificationSettings(tx);
  });
}

// ---- branch (Manager) ----------------------------------------------------------------------

const BRANCH_FIELDS = ['checkInReminderEnabled', 'checkOutReminderEnabled', 'checkInLeadMinutes', 'checkOutLeadMinutes'];
const branchValues = (row) => ({
  checkInReminderEnabled: row?.checkInReminderEnabled ?? true,
  checkOutReminderEnabled: row?.checkOutReminderEnabled ?? true,
  checkInLeadMinutes: row?.checkInLeadMinutes ?? null,
  checkOutLeadMinutes: row?.checkOutLeadMinutes ?? null,
});

/** The branch's reminder settings with the platform limits and the values staff get by default. */
export async function getBranchReminderSettings(branch, client = getPrisma()) {
  const [platform, row] = await Promise.all([platformNotificationSettings(client), client.branchReminderSettings.findUnique({ where: { branchId: branch.id } })]);
  const settings = branchValues(row);
  const { operating } = operatingState(branch, branch.school);
  return {
    settings,
    platform: {
      checkInReminderEnabled: platform.checkInReminderEnabled,
      checkOutReminderEnabled: platform.checkOutReminderEnabled,
      checkIn: { min: platform.checkInLeadMin, max: platform.checkInLeadMax, default: platform.checkInLeadDefault },
      checkOut: { min: platform.checkOutLeadMin, max: platform.checkOutLeadMax, default: platform.checkOutLeadDefault },
    },
    effective: effectiveReminders(platform, settings, null),
    canChange: operating,
  };
}

/** Saves the branch's reminder settings (its Manager, operating branch only), within the platform limits. */
export async function updateBranchReminderSettings(branch, body, user, req) {
  readBody(body, BRANCH_FIELDS);
  if (!Object.keys(body).length) throw badRequest('Send at least one setting.');
  await getPrisma().$transaction(async (tx) => {
    const [school] = await tx.$queryRaw`SELECT "status"::text AS "status" FROM "School" WHERE "id" = ${branch.school.id} FOR SHARE`;
    const [row] = await tx.$queryRaw`SELECT "status"::text AS "status" FROM "Branch" WHERE "id" = ${branch.id} FOR UPDATE`;
    const state = operatingState(row ?? { status: 'SUSPENDED' }, school ?? { status: 'SUSPENDED' });
    if (!state.operating) {
      throw conflict('BRANCH_NOT_OPERATING', 'Your branch or school is suspended. Its reminder settings can be viewed but not changed until it is reactivated.', { reasons: state.reasons });
    }
    const platform = await platformNotificationSettings(tx);
    const errors = {};
    const values = {};
    for (const key of ['checkInReminderEnabled', 'checkOutReminderEnabled']) {
      const v = bool(body, key, errors);
      if (v !== undefined) values[key] = v;
    }
    const ci = int(body, 'checkInLeadMinutes', errors, { min: platform.checkInLeadMin, max: platform.checkInLeadMax, nullable: true });
    if (ci !== undefined) values.checkInLeadMinutes = ci;
    const co = int(body, 'checkOutLeadMinutes', errors, { min: platform.checkOutLeadMin, max: platform.checkOutLeadMax, nullable: true });
    if (co !== undefined) values.checkOutLeadMinutes = co;
    if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);

    const current = branchValues(await tx.branchReminderSettings.findUnique({ where: { branchId: branch.id } }));
    const changed = Object.keys(values).filter((k) => values[k] !== current[k]);
    if (!changed.length) return;
    await tx.branchReminderSettings.upsert({ where: { branchId: branch.id }, create: { branchId: branch.id, ...current, ...values }, update: values });
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.BRANCH_REMINDER_SETTINGS_UPDATED,
      actor: actorOf(user),
      target: { type: 'branch', id: branch.id, name: `${branch.name} (${branch.code})` },
      schoolId: branch.school.id,
      description: `Branch reminder settings updated: ${changed.map((k) => LABELS[k]).join(', ')}.`,
      change: { fields: changed.map((k) => ({ field: LABELS[k], from: show(current[k]), to: show(values[k]) })) },
      req,
    });
  });
  return getBranchReminderSettings(branch);
}

// ---- user preferences ----------------------------------------------------------------------

const preferenceValues = (row) => ({
  disabledCategories: row?.disabledCategories ?? [],
  pushEnabled: row?.pushEnabled ?? true,
  checkInReminder: row?.checkInReminder ?? true,
  checkOutReminder: row?.checkOutReminder ?? true,
  uploadReminder: row?.uploadReminder ?? true,
  checkInLeadMinutes: row?.checkInLeadMinutes ?? null,
  checkOutLeadMinutes: row?.checkOutLeadMinutes ?? null,
  locationConsentAt: row?.locationConsentAt ?? null,
});

/**
 * The signed-in user's preferences (ctx: { userId, role, branchId, schoolId }): the categories their
 * role receives (mandatory ones cannot be turned off), push (staff app only) and, for staff, the
 * effective reminders and whether their branch is operating (no geofence reminders otherwise, N1).
 */
export async function getPreferences(ctx, client = getPrisma()) {
  const [platform, row] = await Promise.all([platformNotificationSettings(client), client.notificationPreference.findUnique({ where: { userId: ctx.userId } })]);
  const own = preferenceValues(row);
  const result = {
    categories: (ROLE_CATEGORIES[ctx.role] ?? []).map((key) => ({ key, mandatory: isMandatory(key), enabled: isMandatory(key) || !own.disabledCategories.includes(key) })),
    push: { available: ctx.role === 'STAFF' && platform.pushEnabled, enabled: ctx.role === 'STAFF' && platform.pushEnabled && own.pushEnabled },
  };
  if (ctx.role === 'STAFF') {
    const branch = await client.branch.findUnique({
      where: { id: ctx.branchId },
      select: { status: true, school: { select: { status: true } }, reminderSettings: true },
    });
    result.reminders = effectiveReminders(platform, branch?.reminderSettings ?? null, own);
    result.branchOperating = Boolean(branch && operatingState(branch, branch.school).operating);
    result.locationConsentAt = own.locationConsentAt?.toISOString() ?? null;
  }
  return result;
}

const STAFF_ONLY = ['pushEnabled', 'checkInReminder', 'checkOutReminder', 'uploadReminder', 'checkInLeadMinutes', 'checkOutLeadMinutes', 'locationConsent'];

/** Saves the user's own preferences; one NOTIFICATION_PREFERENCES_UPDATED event with the changed fields. */
export async function updatePreferences(ctx, body, user, req) {
  const allowed = ['disabledCategories', ...(ctx.role === 'STAFF' ? STAFF_ONLY : [])];
  readBody(body, allowed);
  if (!Object.keys(body).length) throw badRequest('Send at least one preference.');
  const platform = await platformNotificationSettings();
  const errors = {};
  const values = {};
  if (body.disabledCategories !== undefined) {
    const list = body.disabledCategories;
    const mine = ROLE_CATEGORIES[ctx.role] ?? [];
    if (!Array.isArray(list) || list.some((c) => typeof c !== 'string')) errors.disabledCategories = 'Send a list of categories.';
    else if (list.some((c) => !mine.includes(c))) errors.disabledCategories = 'One of these categories is not one of your notifications.';
    else if (list.some(isMandatory)) errors.disabledCategories = 'Mandatory notifications (suspensions, reactivations, transfers and announcements) cannot be turned off.';
    else values.disabledCategories = [...new Set(list)].sort();
  }
  for (const key of ['pushEnabled', 'checkInReminder', 'checkOutReminder', 'uploadReminder']) {
    const v = bool(body, key, errors);
    if (v !== undefined) values[key] = v;
  }
  for (const [key, kind] of [['checkInLeadMinutes', 'checkIn'], ['checkOutLeadMinutes', 'checkOut']]) {
    if (body[key] === undefined) continue;
    if (!platform.staffCanAdjustTiming && body[key] !== null) {
      errors[key] = 'Reminder timing is set by your branch.';
      continue;
    }
    const v = int(body, key, errors, { min: platform[`${kind}LeadMin`], max: platform[`${kind}LeadMax`], nullable: true });
    if (v !== undefined) values[key] = v;
  }
  if (body.locationConsent !== undefined && typeof body.locationConsent !== 'boolean') errors.locationConsent = 'Choose yes or no.';
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);

  await getPrisma().$transaction(async (tx) => {
    const current = preferenceValues(await tx.notificationPreference.findUnique({ where: { userId: ctx.userId } }));
    const changed = Object.keys(values).filter((k) => JSON.stringify(values[k]) !== JSON.stringify(current[k]));
    const fields = changed.map((k) => ({ field: LABELS[k], from: show(current[k]), to: show(values[k]) }));
    if (body.locationConsent !== undefined && body.locationConsent !== Boolean(current.locationConsentAt)) {
      values.locationConsentAt = body.locationConsent ? new Date() : null;
      changed.push('locationConsentAt');
      fields.push({ field: LABELS.locationConsent, from: current.locationConsentAt ? 'Agreed' : 'Not agreed', to: body.locationConsent ? 'Agreed' : 'Withdrawn' });
    }
    if (!changed.length) return;
    const data = Object.fromEntries(changed.map((k) => [k, values[k]]));
    const { locationConsentAt, ...rest } = current;
    await tx.notificationPreference.upsert({ where: { userId: ctx.userId }, create: { userId: ctx.userId, ...rest, locationConsentAt, ...data }, update: data });
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.NOTIFICATION_PREFERENCES_UPDATED,
      actor: actorOf(user),
      target: { type: 'user', id: user.id, name: user.name },
      schoolId: ctx.schoolId ?? null,
      description: `Notification preferences updated: ${fields.map((f) => f.field).join(', ')}.`,
      change: { fields },
      req,
    });
  });
  return getPreferences(ctx);
}

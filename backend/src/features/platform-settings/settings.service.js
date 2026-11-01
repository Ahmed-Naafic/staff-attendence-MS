import { readFileSync } from 'node:fs';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import {
  effectiveInactivity,
  effectiveLifetime,
  INACTIVITY_TIMEOUT_CHOICES,
  rememberInactivityTimeout,
  SESSION_LIFETIME,
} from '../auth/authPolicy.js';
import { MIN_PASSWORD_LENGTH } from '../auth/password.js';
import { MAX_FAILURES, WINDOW_MS } from '../auth/rateLimit.js';
import { platformNameProblem } from './brandingInput.js';
import { schedulingSettings } from './schedulingPolicy.js';
import { DATE_FORMATS, FIELD_LABELS, GENERAL_FIELDS, isValidTimeZone, readField, TIME_FORMATS } from './generalInput.js';

const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));

/**
 * Platform settings. Values come from the single PlatformSettings row (empty when it does not
 * exist). A Super Admin can change Branding (the platform name), General (platform information
 * and localization), the session lifetime and inactivity timeout (Authentication) and the
 * effective delay with the two "first may start today" switches (Scheduling; schedulingPolicy.js); everything
 * else is read-only. Platform Configuration switches are not stored: their rules are not approved,
 * so `configuration` is null. `conflicts` lists stored General values that do not meet the
 * approved rules (kept as stored, never replaced; a save must give a valid value), and `display`
 * the values the platform applies (see displaySettings). `authentication` holds the values
 * the server enforces; it is only ever returned to a Super Admin (never by a public endpoint).
 */
export async function getSettings() {
  const row = await getPrisma().platformSettings.findUnique({ where: { id: 'platform' } });
  const { information, localization, conflicts, display } = generalSettings(row);
  return {
    isDemo: false,
    settings: { information, localization, configuration: null, conflicts, display, authentication: authenticationSettings(row), scheduling: schedulingSettings(row) },
    system: { version, database: 'PostgreSQL (Neon)' },
  };
}

/**
 * Public branding (no sign-in): the platform name only, never any other setting. null when it is
 * not set, or when the stored value does not meet the Branding rules; the web app then shows EduTrack.
 */
export async function getPublicBranding() {
  const row = await getPrisma().platformSettings.findUnique({ where: { id: 'platform' }, select: { platformName: true } });
  const name = row?.platformName ?? null;
  return { platformName: name !== null && !platformNameProblem(name) ? name.trim() : null };
}

/**
 * Branding (approved rules): a Super Admin changes the platform name; each actual change records
 * one BRANDING_UPDATED event with the previous and new name, in the same transaction. Saving the
 * current name changes nothing and records nothing. The settings row is locked while it is read
 * and written, so simultaneous saves are applied one after the other and each event's "from" is exact.
 */
export async function updateBranding(platformName, user, req) {
  const name = await getPrisma().$transaction(async (tx) => {
    // The row may not exist yet (e.g. production before any setting is saved).
    await tx.$executeRaw`INSERT INTO "PlatformSettings" ("id", "updatedAt") VALUES ('platform', now()) ON CONFLICT ("id") DO NOTHING`;
    const [current] = await tx.$queryRaw`SELECT "platformName" FROM "PlatformSettings" WHERE "id" = 'platform' FOR UPDATE`;
    const previous = current.platformName ?? null;
    if (previous === platformName) return previous;

    await tx.platformSettings.update({ where: { id: 'platform' }, data: { platformName } });
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.BRANDING_UPDATED,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { type: 'system', id: null, name: 'Platform branding' },
      description: 'Platform name changed.',
      change: { field: 'Platform name', from: previous, to: platformName },
      req,
    });
    return platformName;
  });
  return { platformName: name };
}

/**
 * Authentication Settings as enforced by the server, from the settings row (or null). The session
 * lifetime and inactivity timeout can be changed; the other values are fixed in the code. Never
 * includes sessions, tokens or password data.
 */
export function authenticationSettings(row) {
  const minutes = effectiveInactivity(row?.inactivityTimeoutMinutes ?? null);
  return {
    // source: 'setting' (saved here) | 'environment' (SESSION_HOURS) | 'default' (12 hours)
    sessionLifetime: { ...effectiveLifetime(row?.sessionLifetimeHours ?? null), ...SESSION_LIFETIME },
    inactivityTimeout: { enabled: minutes !== null, minutes, choices: INACTIVITY_TIMEOUT_CHOICES },
    failedSignInLimit: { attempts: MAX_FAILURES, windowMinutes: WINDOW_MS / 60000, per: 'email and network address' },
    minPasswordLength: MIN_PASSWORD_LENGTH,
    mfa: { available: false },
  };
}

const hoursText = (hours) => `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
const minutesText = (minutes) => (minutes === null ? 'Disabled' : `${minutes} minutes`);

/**
 * Authentication (approved rules): a Super Admin changes the absolute session lifetime and/or the
 * inactivity timeout. Each value is compared with the one in force (for the lifetime: saved,
 * SESSION_HOURS or the default; for the timeout: saved or disabled); the same value changes nothing
 * and records nothing. Each setting that actually changes records one AUTH_SETTINGS_UPDATED event
 * (previous and new value) in the same transaction as the change, with the settings row locked so
 * simultaneous saves apply one after the other.
 * A lifetime change applies to new sign-ins; existing sessions keep their expiry. A timeout change
 * applies to every session at once in this API process (and within the cache period in others).
 */
export async function updateAuthentication(values, user, req) {
  const row = await getPrisma().$transaction(async (tx) => {
    // The row may not exist yet (e.g. production before any setting is saved).
    await tx.$executeRaw`INSERT INTO "PlatformSettings" ("id", "updatedAt") VALUES ('platform', now()) ON CONFLICT ("id") DO NOTHING`;
    const [current] = await tx.$queryRaw`SELECT "sessionLifetimeHours", "inactivityTimeoutMinutes" FROM "PlatformSettings" WHERE "id" = 'platform' FOR UPDATE`;
    const data = {};
    const events = [];

    if (values.sessionLifetimeHours !== undefined) {
      const previous = effectiveLifetime(current.sessionLifetimeHours ?? null).hours;
      if (previous !== values.sessionLifetimeHours) {
        data.sessionLifetimeHours = values.sessionLifetimeHours;
        events.push({
          description: 'Session lifetime changed. It applies to new sign-ins; existing sessions keep their expiry.',
          change: { field: 'Session lifetime', from: hoursText(previous), to: hoursText(values.sessionLifetimeHours) },
        });
      }
    }
    if (values.inactivityTimeoutMinutes !== undefined) {
      const previous = effectiveInactivity(current.inactivityTimeoutMinutes ?? null);
      if (previous !== values.inactivityTimeoutMinutes) {
        data.inactivityTimeoutMinutes = values.inactivityTimeoutMinutes;
        events.push({
          description: 'Inactivity timeout changed. It applies to every session, including those already signed in.',
          change: { field: 'Inactivity timeout', from: minutesText(previous), to: minutesText(values.inactivityTimeoutMinutes) },
        });
      }
    }
    if (!events.length) return current;

    const saved = await tx.platformSettings.update({ where: { id: 'platform' }, data });
    for (const event of events) {
      await recordAuditEvent({
        client: tx,
        action: AUDIT_ACTIONS.AUTH_SETTINGS_UPDATED,
        actor: { id: user.id, name: user.name, role: user.role },
        target: { type: 'system', id: null, name: 'Authentication settings' },
        req,
        ...event,
      });
    }
    return saved;
  });
  // Committed: this process applies the timeout at once (it was read inside the locked transaction).
  rememberInactivityTimeout(row.inactivityTimeoutMinutes ?? null);
  return authenticationSettings(row);
}

/** Stored General values that do not meet the approved rules: { field: problem }. Empty values are fine. */
export function generalConflicts(row) {
  const conflicts = {};
  for (const key of GENERAL_FIELDS) {
    const stored = row?.[key];
    if (stored === null || stored === undefined) continue;
    const { value, problem } = readField(key, stored);
    if (problem) conflicts[key] = problem;
    // Stored differently from how it would be saved now (e.g. untrimmed or upper-case email).
    else if (value !== stored) conflicts[key] = `${FIELD_LABELS[key]} is not stored in its standard form; save it again.`;
  }
  return conflicts;
}

/** The platform time zone: the stored one when valid, otherwise UTC (the server's default). */
export const effectiveTimeZone = (stored) => (isValidTimeZone(stored) ? stored : 'UTC');

/**
 * Display settings the platform applies: { timeZone, dateFormat, timeFormat }. timeZone is always
 * set (see effectiveTimeZone); dateFormat and timeFormat are null when not set or not an approved
 * value, and the web app then keeps its standard display (e.g. "Jan 12, 2026", 24-hour).
 */
export function displaySettings(row) {
  return {
    timeZone: effectiveTimeZone(row?.timezone ?? null),
    dateFormat: DATE_FORMATS.includes(row?.dateFormat) ? row.dateFormat : null,
    timeFormat: TIME_FORMATS.includes(row?.timeFormat) ? row.timeFormat : null,
  };
}

/** The platform time zone for Reports and the Dashboard (read each time; one small query). */
export async function platformTimeZone() {
  const row = await getPrisma().platformSettings.findUnique({ where: { id: 'platform' }, select: { timezone: true } });
  return effectiveTimeZone(row?.timezone ?? null);
}

// Audit values: readable and safe (no secrets exist in these fields). null is "Not set".
const CHOICE_TEXT = {
  language: { en: 'English' },
  timeFormat: { '12h': '12-hour', '24h': '24-hour' },
  firstDayOfWeek: { monday: 'Monday', sunday: 'Sunday' },
};
const auditValue = (key, value) => (value === null || value === undefined ? 'Not set' : (CHOICE_TEXT[key]?.[value] ?? value));

/**
 * General Settings (approved rules): a Super Admin changes platform information and localization.
 * Only fields whose value actually changes are written; together they record one
 * GENERAL_SETTINGS_UPDATED event listing each changed field with its previous and new value, in
 * the same transaction. Nothing changed: nothing written, nothing recorded. The row is locked
 * while it is read and written, so simultaneous saves apply one after the other.
 */
export async function updateGeneral(values, user, req) {
  const row = await getPrisma().$transaction(async (tx) => {
    // The row may not exist yet (e.g. production before any setting is saved).
    await tx.$executeRaw`INSERT INTO "PlatformSettings" ("id", "updatedAt") VALUES ('platform', now()) ON CONFLICT ("id") DO NOTHING`;
    await tx.$queryRaw`SELECT "id" FROM "PlatformSettings" WHERE "id" = 'platform' FOR UPDATE`;
    const current = await tx.platformSettings.findUnique({ where: { id: 'platform' } });
    const data = {};
    const fields = [];
    for (const key of GENERAL_FIELDS) {
      if (values[key] === undefined || values[key] === current[key]) continue;
      data[key] = values[key];
      fields.push({ field: FIELD_LABELS[key], from: auditValue(key, current[key]), to: auditValue(key, values[key]) });
    }
    if (!fields.length) return current;

    const saved = await tx.platformSettings.update({ where: { id: 'platform' }, data });
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.GENERAL_SETTINGS_UPDATED,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { type: 'system', id: null, name: 'General settings' },
      description: `General settings changed: ${fields.map((f) => f.field).join(', ')}.`,
      change: { fields },
      req,
    });
    return saved;
  });
  return generalSettings(row);
}

/** The General part of the settings response for a row: stored values ('' when not set), conflicts and display. */
function generalSettings(row) {
  const value = (key) => row?.[key] ?? '';
  return {
    information: {
      platformName: value('platformName'),
      description: value('description'),
      supportEmail: value('supportEmail'),
      supportPhone: value('supportPhone'),
      websiteUrl: value('websiteUrl'),
    },
    localization: {
      timezone: value('timezone'),
      language: value('language'),
      dateFormat: value('dateFormat'),
      timeFormat: value('timeFormat'),
      firstDayOfWeek: value('firstDayOfWeek'),
    },
    conflicts: generalConflicts(row),
    display: displaySettings(row),
  };
}

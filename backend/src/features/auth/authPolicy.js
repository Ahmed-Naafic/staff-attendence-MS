import { env } from '../../config/env.js';
import { getPrisma } from '../../config/prisma.js';

/*
 * Session policy (approved Authentication Settings rules).
 *
 * Absolute session lifetime: 1–72 hours, default 12, measured from sign-in. A Super Admin sets it
 * in Platform Settings (PlatformSettings.sessionLifetimeHours); a change applies to new sign-ins
 * only, so existing sessions keep the expiry they were given. Order: a valid saved value; otherwise
 * SESSION_HOURS from the environment when it is a whole number from 1 to 72; otherwise 12.
 *
 * Inactivity timeout: disabled by default; otherwise one of the fixed choices (5–480 minutes).
 * It applies to every session, including those already signed in (sessions.js checks it on each
 * request). A stored value that is not one of the choices is never used: the timeout is disabled.
 */
export const SESSION_LIFETIME = { minHours: 1, maxHours: 72, defaultHours: 12 };
export const INACTIVITY_TIMEOUT_CHOICES = [5, 10, 15, 30, 60, 120, 240, 480];

export const isValidLifetimeHours = (value) =>
  Number.isInteger(value) && value >= SESSION_LIFETIME.minHours && value <= SESSION_LIFETIME.maxHours;

export const isValidInactivityMinutes = (value) => INACTIVITY_TIMEOUT_CHOICES.includes(value);

/** The lifetime used when no valid value is saved: SESSION_HOURS when valid, otherwise 12. */
export function fallbackLifetime() {
  return isValidLifetimeHours(env.sessionHours)
    ? { hours: env.sessionHours, source: 'environment' }
    : { hours: SESSION_LIFETIME.defaultHours, source: 'default' };
}

/** The lifetime for a stored value: { hours, source: 'setting' | 'environment' | 'default' }. */
export const effectiveLifetime = (stored) => (isValidLifetimeHours(stored) ? { hours: stored, source: 'setting' } : fallbackLifetime());

/** The inactivity timeout for a stored value, in minutes, or null (disabled). */
export const effectiveInactivity = (stored) => (isValidInactivityMinutes(stored) ? stored : null);

/** The lifetime for a new sign-in (read when the session is created, not cached). */
export async function sessionLifetime(client = getPrisma()) {
  const row = await client.platformSettings.findUnique({ where: { id: 'platform' }, select: { sessionLifetimeHours: true } });
  return effectiveLifetime(row?.sessionLifetimeHours ?? null);
}

/*
 * The inactivity timeout is checked on every authenticated request, so it is cached in this API
 * process for INACTIVITY_CACHE_MS instead of read each time. A change saved through this process
 * replaces the cached value at once (rememberInactivityTimeout); another API process picks it up
 * within INACTIVITY_CACHE_MS. If the setting cannot be read, the request fails (as any request does
 * when the database is unavailable); a timeout is never assumed to be off because of an error.
 */
export const INACTIVITY_CACHE_MS = 30 * 1000;
let cached = null; // { minutes, until }

/** The inactivity timeout in minutes, or null when disabled. */
export async function inactivityTimeout(now = Date.now()) {
  if (cached && now < cached.until) return cached.minutes;
  const row = await getPrisma().platformSettings.findUnique({ where: { id: 'platform' }, select: { inactivityTimeoutMinutes: true } });
  const minutes = effectiveInactivity(row?.inactivityTimeoutMinutes ?? null);
  cached = { minutes, until: now + INACTIVITY_CACHE_MS };
  return minutes;
}

/** Called after a saved change, so this process applies it immediately. */
export function rememberInactivityTimeout(minutes, now = Date.now()) {
  cached = { minutes: effectiveInactivity(minutes), until: now + INACTIVITY_CACHE_MS };
}

/** Test helper: forget the cached timeout (e.g. after writing the setting directly to the database). */
export function clearInactivityCache() {
  cached = null;
}

/**
 * Activity is written at most once per interval per session (not on every request). A session's
 * recorded activity can therefore lag by up to this interval; the shortest timeout is 5 minutes.
 */
export const ACTIVITY_WRITE_INTERVAL_MS = 60 * 1000;

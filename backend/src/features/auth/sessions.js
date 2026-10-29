import { createHash, randomBytes } from 'node:crypto';
import { isProduction } from '../../config/env.js';
import { getPrisma } from '../../config/prisma.js';
import { ACTIVITY_WRITE_INTERVAL_MS, inactivityTimeout } from './authPolicy.js';

export const SESSION_COOKIE = 'edutrack_session';

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

/**
 * Creates a session and returns the raw token for the cookie (only its hash is stored).
 * `lifetimeHours` is the absolute lifetime from sign-in (authPolicy.sessionLifetime); the expiry
 * is fixed now and never moved later, also when the setting changes.
 */
export async function createSession(userId, { ipAddress, userAgent, lifetimeHours }) {
  const token = randomBytes(32).toString('base64url');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + lifetimeHours * 60 * 60 * 1000);
  await getPrisma().session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt, lastUsedAt: now, ipAddress, userAgent: userAgent?.slice(0, 300) },
  });
  return { token, expiresAt };
}

/**
 * The session and its user for a cookie token, or null when missing, expired, idle for longer than
 * the inactivity timeout (when one is set, Platform Settings → Authentication; it applies to
 * existing sessions too), or the account is not active.
 *
 * Activity: every request that presents a valid session (any API call, including the web app's
 * session check). It is written to `lastUsedAt` at most once per ACTIVITY_WRITE_INTERVAL_MS, and
 * only after the session has passed every check, so a rejected session never records activity.
 * Because of that interval, a session can end up to one minute before the timeout has fully passed
 * since its last request, never later.
 * A session that has been idle too long is deleted, so it stays ended even if the timeout is later
 * changed or turned off.
 */
export async function findSession(token) {
  if (!token) return null;
  const prisma = getPrisma();
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, name: true, role: true, status: true, mustChangePassword: true } } },
  });
  const now = new Date();
  if (!session || session.expiresAt <= now || session.user.status !== 'ACTIVE') return null;

  const timeoutMinutes = await inactivityTimeout(now.getTime());
  if (timeoutMinutes) {
    const idleSince = new Date(now.getTime() - timeoutMinutes * 60 * 1000);
    if (session.lastUsedAt <= idleSince) {
      // Only while still idle: a request that has just recorded activity is not undone.
      await prisma.session.deleteMany({ where: { id: session.id, lastUsedAt: { lte: idleSince } } });
      return null;
    }
  }

  const writeBefore = new Date(now.getTime() - ACTIVITY_WRITE_INTERVAL_MS);
  if (session.lastUsedAt <= writeBefore) {
    // Conditional, so simultaneous requests write it once.
    await prisma.session.updateMany({ where: { id: session.id, lastUsedAt: { lte: writeBefore } }, data: { lastUsedAt: now } });
  }
  return session;
}

export async function deleteSession(token) {
  if (!token) return;
  await getPrisma().session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/** Removes expired sessions (called on sign-in to keep the table small). */
export const deleteExpiredSessions = () => getPrisma().session.deleteMany({ where: { expiresAt: { lte: new Date() } } });

const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: isProduction,
  path: '/api',
};

export const setSessionCookie = (res, token, expiresAt) => res.cookie(SESSION_COOKIE, token, { ...cookieOptions, expires: expiresAt });
export const clearSessionCookie = (res) => res.clearCookie(SESSION_COOKIE, cookieOptions);

/**
 * The session token of a request: `Authorization: Bearer <token>` (the mobile app) when present,
 * otherwise the session cookie (the web app). Both name the same kind of Session row.
 */
export function readSessionToken(req) {
  const header = req.get('authorization');
  if (header) {
    const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header.trim());
    return match ? match[1] : undefined;
  }
  return readCookie(req, SESSION_COOKIE);
}

/** Reads one cookie from the Cookie header (no cookie-parser dependency). */
export function readCookie(req, name) {
  const header = req.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

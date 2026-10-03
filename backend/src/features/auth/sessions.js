import { createHash, randomBytes } from 'node:crypto';
import { env, isProduction } from '../../config/env.js';
import { getPrisma } from '../../config/prisma.js';

export const SESSION_COOKIE = 'edutrack_session';

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

/** Creates a session and returns the raw token for the cookie (only its hash is stored). */
export async function createSession(userId, { ipAddress, userAgent }) {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.sessionHours * 60 * 60 * 1000);
  await getPrisma().session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt, ipAddress, userAgent: userAgent?.slice(0, 300) },
  });
  return { token, expiresAt };
}

/** The session and its user for a cookie token, or null when missing, expired or the account is not active. */
export async function findSession(token) {
  if (!token) return null;
  const session = await getPrisma().session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, name: true, role: true, status: true } } },
  });
  if (!session || session.expiresAt <= new Date() || session.user.status !== 'ACTIVE') return null;
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

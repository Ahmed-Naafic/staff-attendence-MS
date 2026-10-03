import { forbidden, unauthorized } from '../common/httpError.js';
import { findSession, readCookie, SESSION_COOKIE } from '../features/auth/sessions.js';

/** Requires a valid session cookie; sets req.user = { id, name, role, status }. */
export async function requireAuth(req, res, next) {
  const session = await requireAuth.lookup(req);
  if (!session) return next(unauthorized());
  req.user = session.user;
  next();
}

/** The session for this request, or null (no error). */
requireAuth.lookup = (req) => findSession(readCookie(req, SESSION_COOKIE));

/**
 * Requires one of the given roles. The backend is the security boundary: hiding pages in the web
 * app is only for usability. Use after requireAuth.
 */
export const requireRole =
  (...roles) =>
  (req, res, next) =>
    roles.includes(req.user?.role) ? next() : next(forbidden());

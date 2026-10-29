import { forbidden, HttpError, unauthorized } from '../common/httpError.js';
import { findSession, readSessionToken } from '../features/auth/sessions.js';

const passwordChangeRequired = () =>
  new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your temporary password before you continue.');

function authenticate({ allowPendingPasswordChange }) {
  return async (req, res, next) => {
    const session = await requireAuth.lookup(req);
    if (!session) return next(unauthorized());
    // An account with a temporary password may do nothing else until it is changed (server-side,
    // so calling the API directly cannot skip it).
    if (session.user.mustChangePassword && !allowPendingPasswordChange) return next(passwordChangeRequired());
    req.user = session.user;
    req.sessionId = session.id;
    next();
  };
}

/**
 * Requires a valid session cookie; sets req.user = { id, name, role, status, mustChangePassword }
 * and req.sessionId. An account that must change its password gets 403 PASSWORD_CHANGE_REQUIRED.
 */
export const requireAuth = authenticate({ allowPendingPasswordChange: false });

/** The session for this request (bearer token or cookie), or null (no error). */
requireAuth.lookup = (req) => findSession(readSessionToken(req));

/** requireAuth for the password change itself: also lets through an account that must change its password. */
requireAuth.allowingPasswordChange = authenticate({ allowPendingPasswordChange: true });

/**
 * Requires one of the given roles. The backend is the security boundary: hiding pages in the web
 * app is only for usability. Use after requireAuth.
 */
export const requireRole =
  (...roles) =>
  (req, res, next) =>
    roles.includes(req.user?.role) ? next() : next(forbidden());

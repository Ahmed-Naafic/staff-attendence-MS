import { Router } from 'express';
import { badRequest, conflict, forbidden, unauthorized } from '../../common/httpError.js';
import { jsonBody, requiredString } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { clientIp, recordAuditEvent } from '../audit-logs/auditService.js';
import { sessionLifetime } from './authPolicy.js';
import { hashPassword, passwordProblem, verifyAgainstDummy, verifyPassword } from './password.js';
import { isValidPhone, phoneKey } from '../schools/schoolInput.js';
import { assertNotLimited, clearFailures, recordFailure } from './rateLimit.js';
import {
  clearSessionCookie,
  createSession,
  deleteExpiredSessions,
  deleteSession,
  readSessionToken,
  setSessionCookie,
} from './sessions.js';

export const authRouter = Router();

const publicUser = (user) => ({ id: user.id, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword === true });
const WEB_APP = { type: 'system', name: 'EduTrack web app' };
const MOBILE_APP = { type: 'system', name: 'EduTrack mobile app' };
// Roles of the mobile app (docs/architecture.md → Applications).
const MOBILE_ROLES = ['STAFF', 'MANAGER'];
// Sign-in events of school owners, Managers and staff are linked to their school (for the audit log's school filter).
async function schoolIdOf(user) {
  if (user?.role === 'OWNER') return (await getPrisma().school.findUnique({ where: { ownerId: user.id }, select: { id: true } }))?.id ?? null;
  if (user?.role === 'MANAGER' || user?.role === 'STAFF') {
    const manager = await getPrisma().user.findUnique({ where: { id: user.id }, select: { branch: { select: { schoolId: true } } } });
    return manager?.branch?.schoolId ?? null;
  }
  return null;
}
// One message for every failure, so the response does not reveal which accounts exist.
const SIGN_IN_FAILED = 'The email, phone number or password is incorrect.';

/**
 * A sign-in identifier: an email (any account) or a phone number (STAFF only, compared by phoneKey).
 * { key, kind }: `key` is the normalized identifier, used for the limiter and the lookup.
 */
function readIdentifier(identifier) {
  if (identifier.includes('@')) return { key: identifier.toLowerCase(), kind: 'email' };
  if (isValidPhone(identifier)) return { key: phoneKey(identifier), kind: 'phone' };
  return { key: identifier, kind: 'none' };
}

async function findAccount({ key, kind }) {
  if (kind === 'email') return getPrisma().user.findUnique({ where: { email: key } });
  if (kind === 'phone') return getPrisma().user.findFirst({ where: { role: 'STAFF', phoneKey: key } });
  return null;
}

/** POST /api/auth/login { identifier (email or staff phone) | email, password } → { user } and a session cookie. */
authRouter.post('/login', async (req, res) => {
  const body = jsonBody(req);
  const identifier = requiredString(body, body.identifier === undefined ? 'email' : 'identifier', { max: 254 });
  if (body.client !== undefined && body.client !== 'mobile') throw badRequest('"client" must be "mobile" when given.');
  const mobile = body.client === 'mobile';
  const app = mobile ? MOBILE_APP : WEB_APP;
  const password = typeof body.password === 'string' && body.password.length <= 1024 ? body.password : '';
  if (!password) throw unauthorized(SIGN_IN_FAILED);
  const ip = clientIp(req);
  const signInId = readIdentifier(identifier);
  // `email` is the limiter key: the normalized email or phone.
  const email = signInId.key;
  assertNotLimited(email, ip);

  const user = await findAccount(signInId);
  const passwordOk = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : await verifyAgainstDummy(password);

  if (!user || !passwordOk || user.status !== 'ACTIVE') {
    recordFailure(email, ip);
    await recordAuditEvent({
      action: AUDIT_ACTIONS.SIGN_IN,
      result: 'FAILURE',
      // Linked to the account only when it exists; the typed email is never stored.
      actor: user ? publicUser(user) : null,
      target: app,
      schoolId: await schoolIdOf(user),
      description: !user
        ? 'Sign-in failed: no account matches the details given.'
        : !passwordOk
          ? 'Sign-in failed: the password was incorrect.'
          : 'Sign-in refused: the account is not active.',
      req,
    });
    throw unauthorized(SIGN_IN_FAILED);
  }

  clearFailures(email, ip);
  if (mobile && !MOBILE_ROLES.includes(user.role)) {
    await recordAuditEvent({
      action: AUDIT_ACTIONS.SIGN_IN,
      result: 'FAILURE',
      actor: publicUser(user),
      target: app,
      schoolId: await schoolIdOf(user),
      description: 'Sign-in refused: this account uses the web app, not the mobile app.',
      req,
    });
    throw forbidden('This account signs in on the EduTrack web app.');
  }
  await deleteExpiredSessions();
  // The lifetime in force at sign-in (Platform Settings → Authentication); it never changes afterwards.
  const { hours } = await sessionLifetime();
  const { token, expiresAt } = await createSession(user.id, { ipAddress: ip, userAgent: req.get('user-agent'), lifetimeHours: hours });
  await getPrisma().user.update({ where: { id: user.id }, data: { lastSignInAt: new Date() } });
  await recordAuditEvent({
    action: AUDIT_ACTIONS.SIGN_IN,
    actor: publicUser(user),
    target: app,
    schoolId: await schoolIdOf(user),
    description: mobile ? 'Signed in to the EduTrack mobile app.' : 'Signed in to the EduTrack web app.',
    req,
  });

  // The mobile app gets the same session as a token, once, to keep in secure storage (no cookie).
  if (mobile) return res.json({ user: publicUser(user), token, expiresAt: expiresAt.toISOString() });
  setSessionCookie(res, token, expiresAt);
  res.json({ user: publicUser(user) });
});

/**
 * GET /api/auth/session → { user } for a valid session, { user: null } otherwise. Not an error
 * when signed out: it is how the web app finds out whether to show the sign-in page.
 */
authRouter.get('/session', async (req, res) => {
  const session = await requireAuth.lookup(req);
  res.json({ user: session ? publicUser(session.user) : null });
});

/** POST /api/auth/logout → ends the session, cookie or bearer token (idempotent). */
authRouter.post('/logout', async (req, res) => {
  const token = readSessionToken(req);
  const session = await requireAuth.lookup(req);
  await deleteSession(token);
  clearSessionCookie(res);
  if (session) {
    await recordAuditEvent({
      action: AUDIT_ACTIONS.SIGN_OUT,
      actor: publicUser(session.user),
      target: WEB_APP,
      schoolId: await schoolIdOf(session.user),
      description: 'Signed out of the EduTrack web app.',
      req,
    });
  }
  res.status(204).end();
});

/**
 * POST /api/auth/password { currentPassword, newPassword } → { user }. Only for an account that
 * must change its password (a Manager's temporary password, at first sign-in or after a reset): it
 * is not a general password change. Wrong current passwords count towards the sign-in limiter.
 * The new hash, clearing the flag, ending the account's other sessions and the PASSWORD_CHANGED
 * security event are written in one transaction. Passwords are never logged or recorded.
 */
authRouter.post('/password', requireAuth.allowingPasswordChange, async (req, res) => {
  if (!req.user.mustChangePassword) throw forbidden('Your password cannot be changed here.');
  const body = jsonBody(req);
  const unknown = Object.keys(body).filter((key) => key !== 'currentPassword' && key !== 'newPassword');
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);
  const { currentPassword, newPassword } = body;
  const limiterKey = `password-change:${req.user.id}`;
  const ip = clientIp(req);
  assertNotLimited(limiterKey, ip);

  const errors = {};
  if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 1024) errors.currentPassword = 'Enter your temporary password.';
  const problem = passwordProblem(newPassword);
  if (problem) errors.newPassword = problem;
  else if (newPassword === currentPassword) errors.newPassword = 'Choose a password different from the temporary one.';
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);

  const account = await getPrisma().user.findUnique({ where: { id: req.user.id }, select: { passwordHash: true } });
  if (!account?.passwordHash || !(await verifyPassword(currentPassword, account.passwordHash))) {
    recordFailure(limiterKey, ip);
    throw badRequest('Check the highlighted fields.', { currentPassword: 'The temporary password is incorrect.' });
  }
  clearFailures(limiterKey, ip);

  const passwordHash = await hashPassword(newPassword);
  const schoolId = await schoolIdOf(req.user);
  await getPrisma().$transaction(async (tx) => {
    // Conditional: two simultaneous changes cannot both succeed, and a reset in between is not lost.
    const { count } = await tx.user.updateMany({
      where: { id: req.user.id, status: 'ACTIVE', mustChangePassword: true, passwordHash: account.passwordHash },
      data: { passwordHash, mustChangePassword: false },
    });
    if (count === 0) throw conflict('INVALID_STATUS', 'Your password was changed in the meantime. Sign in again.');
    await tx.session.deleteMany({ where: { userId: req.user.id, id: { not: req.sessionId } } });
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      actor: publicUser(req.user),
      target: { type: 'user', id: req.user.id, name: req.user.name },
      schoolId,
      description: 'Temporary password replaced by the account holder.',
      req,
    });
  });
  res.json({ user: { ...publicUser(req.user), mustChangePassword: false } });
});

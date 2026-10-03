import { Router } from 'express';
import { unauthorized } from '../../common/httpError.js';
import { jsonBody, requiredString } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { clientIp, recordAuditEvent } from '../audit-logs/auditService.js';
import { verifyAgainstDummy, verifyPassword } from './password.js';
import { assertNotLimited, clearFailures, recordFailure } from './rateLimit.js';
import {
  clearSessionCookie,
  createSession,
  deleteExpiredSessions,
  deleteSession,
  readCookie,
  SESSION_COOKIE,
  setSessionCookie,
} from './sessions.js';

export const authRouter = Router();

const publicUser = (user) => ({ id: user.id, name: user.name, role: user.role });
const WEB_APP = { type: 'system', name: 'EduTrack web app' };
// Sign-in events of school owners are linked to their school (for the audit log's school filter).
const ownedSchoolId = async (user) =>
  user?.role === 'OWNER' ? (await getPrisma().school.findUnique({ where: { ownerId: user.id }, select: { id: true } }))?.id : null;
// One message for every failure, so the response does not reveal which accounts exist.
const SIGN_IN_FAILED = 'The email or password is incorrect.';

/** POST /api/auth/login { email, password } → { user } and a session cookie. */
authRouter.post('/login', async (req, res) => {
  const body = jsonBody(req);
  const email = requiredString(body, 'email', { max: 254 }).toLowerCase();
  const password = typeof body.password === 'string' && body.password.length <= 1024 ? body.password : '';
  if (!password) throw unauthorized(SIGN_IN_FAILED);
  const ip = clientIp(req);
  assertNotLimited(email, ip);

  const user = await getPrisma().user.findUnique({ where: { email } });
  const passwordOk = user?.passwordHash ? await verifyPassword(password, user.passwordHash) : await verifyAgainstDummy(password);

  if (!user || !passwordOk || user.status !== 'ACTIVE') {
    recordFailure(email, ip);
    await recordAuditEvent({
      action: AUDIT_ACTIONS.SIGN_IN,
      result: 'FAILURE',
      // Linked to the account only when it exists; the typed email is never stored.
      actor: user ? publicUser(user) : null,
      target: WEB_APP,
      schoolId: await ownedSchoolId(user),
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
  await deleteExpiredSessions();
  const { token, expiresAt } = await createSession(user.id, { ipAddress: ip, userAgent: req.get('user-agent') });
  await getPrisma().user.update({ where: { id: user.id }, data: { lastSignInAt: new Date() } });
  await recordAuditEvent({
    action: AUDIT_ACTIONS.SIGN_IN,
    actor: publicUser(user),
    target: WEB_APP,
    schoolId: await ownedSchoolId(user),
    description: 'Signed in to the EduTrack web app.',
    req,
  });

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

/** POST /api/auth/logout → ends the session (idempotent). */
authRouter.post('/logout', async (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  const session = await requireAuth.lookup(req);
  await deleteSession(token);
  clearSessionCookie(res);
  if (session) {
    await recordAuditEvent({
      action: AUDIT_ACTIONS.SIGN_OUT,
      actor: publicUser(session.user),
      target: WEB_APP,
      schoolId: await ownedSchoolId(session.user),
      description: 'Signed out of the EduTrack web app.',
      req,
    });
  }
  res.status(204).end();
});

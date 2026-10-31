import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { forbidden, HttpError } from '../../common/httpError.js';
import { jsonBody, optionalEnum, optionalInt } from '../../common/validate.js';
import { env } from '../../config/env.js';
import { requireAuth, requireRole } from '../../middleware/requireAuth.js';
import { getNotification, listNotifications, markAllRead, markRead, notificationViewer, unreadCount } from './feed.service.js';
import { runNotificationJobs } from './jobs.js';
import { getPreferences, updatePreferences } from './notificationSettings.service.js';
import { CATEGORIES } from './notificationTypes.js';
import { registerDevice, unregisterDevice } from './push.js';

/**
 * Notification centre API (/api/notifications) for School Owners, Managers and Staff (web app and
 * Staff app). Every route works on the signed-in account only: the viewer (role, school, current
 * branch) is read from the database on every request, never from the request, so a Manager's
 * transfer changes what they see at once (N10). Super Admins have no notification centre (N16);
 * they manage announcements and settings under /api/platform.
 */
export const notificationsRouter = Router();
notificationsRouter.use(requireAuth, requireRole('OWNER', 'MANAGER', 'STAFF'), async (req, res, next) => {
  try {
    req.viewer = await notificationViewer(req.user);
    next();
  } catch (error) {
    next(error);
  }
});

notificationsRouter.get('/', async (req, res) => {
  res.json(
    await listNotifications(req.viewer, {
      unread: optionalEnum(req.query, 'unread', ['true', 'false']) === 'true',
      category: optionalEnum(req.query, 'category', CATEGORIES),
      page: optionalInt(req.query, 'page', { min: 1, max: 100000, fallback: 1 }),
      pageSize: optionalInt(req.query, 'pageSize', { min: 1, max: 50, fallback: 20 }),
    }),
  );
});

notificationsRouter.get('/unread-count', async (req, res) => {
  res.json({ unreadCount: await unreadCount(req.viewer) });
});

notificationsRouter.get('/preferences', async (req, res) => {
  res.json(await getPreferences(req.viewer));
});
notificationsRouter.put('/preferences', async (req, res) => {
  res.json(await updatePreferences(req.viewer, jsonBody(req), req.user, req));
});

notificationsRouter.post('/read-all', async (req, res) => {
  res.json(await markAllRead(req.viewer));
});

// Push token of the Staff app's current session (Staff only: Owners and Managers have no app).
notificationsRouter.post('/devices', async (req, res) => {
  if (req.viewer.role !== 'STAFF') throw forbidden('Push notifications are available in the Staff app only.');
  res.status(201).json(await registerDevice({ userId: req.user.id, sessionId: req.sessionId }, jsonBody(req)));
});
notificationsRouter.delete('/devices/current', async (req, res) => {
  await unregisterDevice({ sessionId: req.sessionId });
  res.status(204).end();
});

notificationsRouter.get('/:source/:id', async (req, res) => {
  res.json({ item: await getNotification(req.viewer, req.params.source, req.params.id) });
});
notificationsRouter.post('/:source/:id/read', async (req, res) => {
  res.json({ item: await markRead(req.viewer, req.params.source, req.params.id) });
});

/**
 * The scheduled notification job (GET for Vercel Cron, POST for other schedulers). Only a request
 * with `Authorization: Bearer <CRON_SECRET>` runs it; without a configured secret it is disabled.
 */
export async function notificationJobHandler(req, res) {
  if (!env.cronSecret) throw new HttpError(503, 'JOBS_DISABLED', 'The notification job is not configured (CRON_SECRET).');
  const presented = Buffer.from(req.get('authorization') ?? '');
  const expected = Buffer.from(`Bearer ${env.cronSecret}`);
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) throw new HttpError(401, 'UNAUTHENTICATED', 'Not allowed.');
  res.json(await runNotificationJobs({ budgetMs: env.jobBudgetMs }));
}

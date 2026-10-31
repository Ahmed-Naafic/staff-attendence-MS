import express from 'express';
import { authRouter } from './features/auth/auth.routes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { sameOrigin } from './middleware/sameOrigin.js';
import { env } from './config/env.js';
import { getPublicBranding } from './features/platform-settings/settings.service.js';
import { platformRouter } from './platform/platform.routes.js';
import { attendanceRouter } from './attendance/attendance.routes.js';
import { managerRouter } from './manager/manager.routes.js';
import { ownerRouter } from './owner/owner.routes.js';
import { notificationJobHandler, notificationsRouter } from './features/notifications/notifications.routes.js';

const app = express();

app.disable('x-powered-by');
// On Vercel the request arrives through Vercel's proxy, which sets X-Forwarded-For to the client's
// address. Trust that one hop so req.ip (sign-in rate limiting, audit IP) is the client, not the
// proxy. Elsewhere (local development) the header is ignored, so it cannot be spoofed.
if (env.onVercel) app.set('trust proxy', 1);
app.use(express.json({ limit: '10kb' }));
// Responses carry private data: never cache them in shared caches.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use('/api', sameOrigin);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Public (no sign-in): the platform name for the sign-in page and the app shell. No other setting.
app.get('/api/branding', async (req, res) => {
  res.json(await getPublicBranding());
});

app.use('/api/auth', authRouter);
app.use('/api/platform', platformRouter);
app.use('/api/owner', ownerRouter);
app.use('/api/manager', managerRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/notifications', notificationsRouter);
// Scheduled notification job (Vercel Cron or another scheduler; Bearer CRON_SECRET).
app.get('/api/internal/jobs/notifications', notificationJobHandler);
app.post('/api/internal/jobs/notifications', notificationJobHandler);

app.use(notFound);
app.use(errorHandler);

export default app;

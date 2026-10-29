import express from 'express';
import { authRouter } from './features/auth/auth.routes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { sameOrigin } from './middleware/sameOrigin.js';
import { getPublicBranding } from './features/platform-settings/settings.service.js';
import { platformRouter } from './platform/platform.routes.js';
import { attendanceRouter } from './attendance/attendance.routes.js';
import { managerRouter } from './manager/manager.routes.js';
import { ownerRouter } from './owner/owner.routes.js';

const app = express();

app.disable('x-powered-by');
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

app.use(notFound);
app.use(errorHandler);

export default app;

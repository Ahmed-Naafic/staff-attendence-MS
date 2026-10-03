import express from 'express';
import { authRouter } from './features/auth/auth.routes.js';
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';
import { sameOrigin } from './middleware/sameOrigin.js';
import { platformRouter } from './platform/platform.routes.js';

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

app.use('/api/auth', authRouter);
app.use('/api/platform', platformRouter);

app.use(notFound);
app.use(errorHandler);

export default app;

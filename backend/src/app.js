import express from 'express';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(express.json());

// Phase 0: foundation health check only. Feature routers (src/features/*)
// are mounted here in later phases.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use(notFound);
app.use(errorHandler);

export default app;

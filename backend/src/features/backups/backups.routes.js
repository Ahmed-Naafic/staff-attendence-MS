import { Router } from 'express';
import { badRequest } from '../../common/httpError.js';
import { jsonBody, optionalEnum, optionalInt } from '../../common/validate.js';
import {
  createBackupNow,
  deleteBackup,
  getConfiguration,
  getOperation,
  getOverview,
  listBackups,
  setProtection,
  updateConfiguration,
  verifyBackup,
} from './backups.service.js';
import { discardRestore, finalizeRestore, getRestore, listRestores, startRestore } from './restore.service.js';

/**
 * Data & Backup API (/api/platform/backups; docs/data-backup/backup-api.md). Mounted on the
 * platform router, so every route requires a signed-in SUPER_ADMIN. Responses carry Neon ids,
 * names, times and sizes only: never the API key or a connection string.
 */
export const backupsRouter = Router();

const snapshotParam = (value) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw badRequest('Invalid backup id.');
  return value;
};
const uuidParam = (value) => {
  if (!/^[0-9a-f-]{36}$/i.test(value)) throw badRequest('Invalid id.');
  return value;
};

backupsRouter.get('/overview', async (req, res) => {
  res.json(await getOverview());
});

backupsRouter.get('/', async (req, res) => {
  res.json(
    await listBackups({
      status: optionalEnum(req.query, 'status', ['COMPLETED', 'RUNNING', 'RESTORING', 'FAILED', 'EXPIRED', 'DELETED']),
      kind: optionalEnum(req.query, 'kind', ['MANUAL', 'SCHEDULED', 'PRE_RESTORE']),
      page: optionalInt(req.query, 'page', { min: 1, max: 10000, fallback: 1 }),
      pageSize: optionalInt(req.query, 'pageSize', { min: 1, max: 50, fallback: 10 }),
    }),
  );
});

backupsRouter.get('/configuration', async (req, res) => {
  res.json(await getConfiguration());
});
backupsRouter.put('/configuration', async (req, res) => {
  res.json(await updateConfiguration(jsonBody(req), req.user, req));
});

// Create Backup Now: 202 while Neon creates the snapshot (poll GET /operations/:id).
backupsRouter.post('/', async (req, res) => {
  const body = jsonBody(req);
  if (body.confirm !== true) throw badRequest('Confirm that you want to create a backup now.', { confirm: 'Required.' });
  const result = await createBackupNow(req.user, req);
  res.status(result.status === 'COMPLETED' ? 201 : 202).json(result);
});
backupsRouter.get('/operations/:id', async (req, res) => {
  res.json(await getOperation(uuidParam(req.params.id)));
});

// Restores (fixed paths before /:snapshotId).
backupsRouter.get('/restores', async (req, res) => {
  res.json(await listRestores({ limit: optionalInt(req.query, 'limit', { min: 1, max: 50, fallback: 10 }) }));
});
backupsRouter.post('/restores', async (req, res) => {
  res.status(202).json({ restore: await startRestore(jsonBody(req), req.user, req) });
});
backupsRouter.get('/restores/:id', async (req, res) => {
  res.json({ restore: await getRestore(uuidParam(req.params.id)) });
});
backupsRouter.post('/restores/:id/discard', async (req, res) => {
  res.json({ restore: await discardRestore(uuidParam(req.params.id), req.user, req) });
});
// The only route that changes production data. Never called by a job or a page load.
backupsRouter.post('/restores/:id/finalize', async (req, res) => {
  res.json({ restore: await finalizeRestore(uuidParam(req.params.id), jsonBody(req), req.user, req) });
});

backupsRouter.post('/:snapshotId/verify', async (req, res) => {
  res.json({ verification: await verifyBackup(snapshotParam(req.params.snapshotId), req.user, req) });
});
backupsRouter.post('/:snapshotId/protection', async (req, res) => {
  const body = jsonBody(req);
  if (typeof body.protected !== 'boolean') throw badRequest('"protected" must be true or false.');
  res.json(await setProtection(snapshotParam(req.params.snapshotId), body.protected, req.user, req));
});
backupsRouter.delete('/:snapshotId', async (req, res) => {
  res.json(await deleteBackup(snapshotParam(req.params.snapshotId), req.user, req));
});

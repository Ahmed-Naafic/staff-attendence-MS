import { Router } from 'express';
import { jsonBody } from '../../common/validate.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { decideRequest, deviceChannelStatus, deviceHistory, deviceWipeComplete, listDevices, myDevices, reportMyDeviceLost, revokeDevice, wipeDevice } from './devices.service.js';

/*
 * Phones of mobile accounts (docs/mobile/devices.md).
 * /api/devices/status and /wipe-complete are the device channel: the phone proves itself with its
 * device secret (no session), so a revoked or lost phone still receives its remote wipe.
 */
export const devicesRouter = Router();

const channelBody = (req) => {
  const body = jsonBody(req);
  return { installationId: body.installationId, secret: body.secret };
};

devicesRouter.post('/status', async (req, res) => {
  res.json(await deviceChannelStatus(channelBody(req), req));
});

devicesRouter.post('/wipe-complete', async (req, res) => {
  res.json(await deviceWipeComplete(channelBody(req), req));
});

// The signed-in account's own phones (any mobile role).
const currentDevice = async (req) => (await requireAuth.lookup(req))?.deviceId ?? null;

devicesRouter.get('/mine', requireAuth, async (req, res) => {
  res.json(await myDevices(req.user, await currentDevice(req)));
});

devicesRouter.post('/:id/report-lost', requireAuth, async (req, res) => {
  res.json({ device: await reportMyDeviceLost(req.user, req.params.id, await currentDevice(req), jsonBody(req), req) });
});

/**
 * Device administration for the School Owner (every account of the school) and Managers (staff and
 * Accountants of their branch). `scopeOf(req)` → { school, branch }; `role`: 'OWNER' | 'MANAGER'.
 */
export function mountDeviceAdminRoutes(router, scopeOf, role) {
  const scope = (req) => ({ ...scopeOf(req), role });
  router.get('/devices', async (req, res) => res.json(await listDevices(scope(req), { status: typeof req.query.status === 'string' ? req.query.status : 'all' })));
  router.get('/devices/:id/history', async (req, res) => res.json(await deviceHistory(scope(req), req.params.id)));
  router.post('/devices/:id/revoke', async (req, res) => res.json({ device: await revokeDevice(scope(req), req.params.id, jsonBody(req), req.user, req) }));
  router.post('/devices/:id/wipe', async (req, res) => res.json({ device: await wipeDevice(scope(req), req.params.id, jsonBody(req), req.user, req) }));
  router.post('/device-requests/:id/approve', async (req, res) => res.json({ request: await decideRequest(scope(req), req.params.id, true, req.user, req) }));
  router.post('/device-requests/:id/reject', async (req, res) => res.json({ request: await decideRequest(scope(req), req.params.id, false, req.user, req) }));
}

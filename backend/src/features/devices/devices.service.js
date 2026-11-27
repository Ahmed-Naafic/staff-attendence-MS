import { createHash, randomBytes } from 'node:crypto';
import { badRequest, conflict, forbidden, HttpError, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { createNotifications } from '../notifications/notify.js';

/*
 * Phones of mobile accounts (docs/mobile/devices.md):
 * - Registration at mobile sign-in: a phone sends its installation id and description; an account
 *   has at most MAX_DEVICES active phones. Another phone needs an approved request (Owner: any
 *   branch; Manager: their branch). The phone gets a device secret once; only its hash is stored.
 * - Revoke: the phone's sessions end at once and it cannot sign in again with that registration.
 * - Lost or stolen (reported by an Owner, a Manager, or the staff member from another of their
 *   phones): revoked, and a remote wipe is registered. The phone learns it from POST
 *   /api/devices/status with its secret (no session needed), deletes its data, then reports the
 *   wipe complete. REQUESTED → DELIVERED → COMPLETED; a wipe is never cancelled. A phone found
 *   again registers anew (fresh sign-in; the lost registration stays lost).
 * Every change is audited; administrators are notified of a lost phone and of a request.
 */

export const MAX_DEVICES = 3;
const hash = (secret) => createHash('sha256').update(secret).digest('hex');
const clean = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const actorOf = (u) => ({ id: u.id, name: u.name, role: u.role });

/** The `device` object of a mobile sign-in: { installationId, name, platform, model?, appVersion? } or null. */
export function readDeviceInfo(device) {
  if (device === undefined || device === null) return null;
  const installationId = clean(device.installationId, 100);
  if (!installationId || !/^[A-Za-z0-9-]{16,100}$/.test(installationId)) throw badRequest('Invalid device.', { device: 'Invalid device id.' });
  return {
    installationId,
    name: clean(device.name, 80) ?? 'Phone',
    platform: ['android', 'ios'].includes(device.platform) ? device.platform : 'other',
    model: clean(device.model, 80),
    appVersion: clean(device.appVersion, 20),
  };
}

const toDevice = (d, currentId = null) => ({
  id: d.id,
  name: d.name,
  platform: d.platform,
  model: d.model,
  appVersion: d.appVersion,
  status: d.status.toLowerCase(),
  current: d.id === currentId,
  registeredAt: d.registeredAt.toISOString(),
  lastSeenAt: d.lastSeenAt.toISOString(),
  revokedAt: d.revokedAt?.toISOString() ?? null,
  revokedBy: d.revokedByName,
  revokeReason: d.revokeReason,
  wipe: d.wipeState
    ? { state: d.wipeState.toLowerCase(), requestedAt: d.wipeRequestedAt?.toISOString() ?? null, requestedBy: d.wipeRequestedByName, deliveredAt: d.wipeDeliveredAt?.toISOString() ?? null, completedAt: d.wipeCompletedAt?.toISOString() ?? null }
    : null,
  ...(d.user && { user: { id: d.user.id, name: d.user.name, role: d.user.role, staffId: d.user.staffId ?? null } }),
});

const toRequest = (r) => ({
  id: r.id,
  name: r.name,
  platform: r.platform,
  model: r.model,
  status: r.status.toLowerCase(),
  requestedAt: r.requestedAt.toISOString(),
  decidedAt: r.decidedAt?.toISOString() ?? null,
  decidedBy: r.decidedByName,
  ...(r.user && { user: { id: r.user.id, name: r.user.name, role: r.user.role, staffId: r.user.staffId ?? null } }),
});

async function schoolOfUser(prisma, userId) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { branchId: true, branch: { select: { schoolId: true } } } });
  return { schoolId: u?.branch?.schoolId ?? null, branchId: u?.branchId ?? null };
}

/** The Owner and the active Managers of the account's branch (a Manager's own phone: the Owner only). */
async function administratorsOf(prisma, user) {
  const { schoolId, branchId } = await schoolOfUser(prisma, user.id);
  if (!schoolId) return { schoolId, branchId, ids: [] };
  const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { ownerId: true } });
  const managers = user.role === 'MANAGER' ? [] : await prisma.user.findMany({ where: { role: 'MANAGER', status: 'ACTIVE', branchId }, select: { id: true } });
  return { schoolId, branchId, ids: [...new Set([school?.ownerId, ...managers.map((m) => m.id)].filter(Boolean))] };
}

/**
 * At mobile sign-in, after the password check: the phone's active registration, a new one (under
 * the limit or with an approved request), or a refusal with a waiting request (403 DEVICE_LIMIT).
 * → { device, secret? } (secret only for a new registration).
 */
export async function registerForSignIn(user, info, req) {
  const prisma = getPrisma();
  const existing = await prisma.device.findFirst({ where: { userId: user.id, installationId: info.installationId, status: 'ACTIVE' } });
  if (existing) {
    const device = await prisma.device.update({ where: { id: existing.id }, data: { lastSeenAt: new Date(), name: info.name, model: info.model, appVersion: info.appVersion } });
    return { device };
  }
  const result = await prisma.$transaction(async (tx) => {
    // One registration decision at a time per account.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`devices:${user.id}`}))`;
    const active = await tx.device.count({ where: { userId: user.id, status: 'ACTIVE' } });
    const approved = await tx.deviceRequest.findFirst({ where: { userId: user.id, installationId: info.installationId, status: 'APPROVED' }, orderBy: { decidedAt: 'desc' } });
    if (active >= MAX_DEVICES && !approved) {
      const waiting = await tx.deviceRequest.findFirst({ where: { userId: user.id, installationId: info.installationId, status: 'PENDING' } });
      if (waiting) return { refused: waiting, created: false };
      const made = await tx.deviceRequest.create({ data: { userId: user.id, installationId: info.installationId, name: info.name, platform: info.platform, model: info.model } });
      return { refused: made, created: true };
    }
    const secret = randomBytes(32).toString('base64url');
    const device = await tx.device.create({ data: { userId: user.id, installationId: info.installationId, secretHash: hash(secret), name: info.name, platform: info.platform, model: info.model, appVersion: info.appVersion } });
    if (approved) await tx.deviceRequest.update({ where: { id: approved.id }, data: { status: 'USED', usedAt: new Date() } });
    return { device, secret };
  });
  const { schoolId, ids } = await administratorsOf(prisma, user);
  if (result.refused) {
    if (result.created) {
      await recordAuditEvent({ action: AUDIT_ACTIONS.DEVICE_REQUESTED, actor: actorOf(user), target: { type: 'device_request', id: result.refused.id, name: `${user.name} · ${info.name}` }, schoolId, description: `${user.name} asked to use another phone (${info.name}): the account already has ${MAX_DEVICES}.`, req });
      await createNotifications(ids.map((recipientId) => ({ type: 'DEVICE_APPROVAL_NEEDED', recipientId, schoolId, subjectType: 'device_request', subjectId: result.refused.id, params: { name: user.name, device: info.name }, dedupeKey: `device-request:${result.refused.id}:${recipientId}` }))).catch(() => {});
    }
    throw new HttpError(403, 'DEVICE_LIMIT', `This account already uses ${MAX_DEVICES} phones. Your Manager or School Owner can approve this phone; then sign in again.`, { requestId: result.refused.id });
  }
  await recordAuditEvent({ action: AUDIT_ACTIONS.DEVICE_REGISTERED, actor: actorOf(user), target: { type: 'device', id: result.device.id, name: `${user.name} · ${info.name}` }, schoolId, description: `Phone registered: ${info.name} (${info.platform}${info.model ? `, ${info.model}` : ''}).`, req });
  return result;
}

/** The device of a valid secret (any status), or null. */
async function deviceBySecret(prisma, installationId, secret) {
  if (typeof secret !== 'string' || secret.length < 20 || secret.length > 200 || typeof installationId !== 'string') return null;
  const d = await prisma.device.findUnique({ where: { secretHash: hash(secret) } });
  return d && d.installationId === installationId ? d : null;
}

/**
 * POST /api/devices/status { installationId, secret } (no session): { status, wipe }. A wipe the
 * phone receives now is marked delivered. An unknown phone: { status: 'unknown', wipe: false }.
 */
export async function deviceChannelStatus({ installationId, secret }, req) {
  const prisma = getPrisma();
  const d = await deviceBySecret(prisma, installationId, secret);
  if (!d) return { status: 'unknown', wipe: false };
  if (d.wipeState === 'REQUESTED') {
    const updated = await prisma.device.updateMany({ where: { id: d.id, wipeState: 'REQUESTED' }, data: { wipeState: 'DELIVERED', wipeDeliveredAt: new Date() } });
    if (updated.count) {
      const { schoolId } = await schoolOfUser(prisma, d.userId);
      await recordAuditEvent({ action: AUDIT_ACTIONS.DEVICE_WIPE_DELIVERED, actor: null, target: { type: 'device', id: d.id, name: d.name }, schoolId, description: `The remote wipe reached the phone ${d.name}.`, req });
    }
  }
  if (d.status === 'ACTIVE') await prisma.device.update({ where: { id: d.id }, data: { lastSeenAt: new Date() } });
  return { status: d.status.toLowerCase(), wipe: d.wipeState === 'REQUESTED' || d.wipeState === 'DELIVERED' };
}

/** POST /api/devices/wipe-complete { installationId, secret } (no session): the phone deleted its data. */
export async function deviceWipeComplete({ installationId, secret }, req) {
  const prisma = getPrisma();
  const d = await deviceBySecret(prisma, installationId, secret);
  if (!d || !d.wipeState) return { done: false };
  if (d.wipeState !== 'COMPLETED') {
    await prisma.device.update({ where: { id: d.id }, data: { wipeState: 'COMPLETED', wipeCompletedAt: new Date(), ...(d.wipeDeliveredAt ? {} : { wipeDeliveredAt: new Date() }) } });
    const { schoolId } = await schoolOfUser(prisma, d.userId);
    await recordAuditEvent({ action: AUDIT_ACTIONS.DEVICE_WIPE_COMPLETED, actor: null, target: { type: 'device', id: d.id, name: d.name }, schoolId, description: `The phone ${d.name} reported its EduTrack data deleted.`, req });
  }
  return { done: true };
}

/** The signed-in account's phones and waiting requests. */
export async function myDevices(user, currentDeviceId) {
  const prisma = getPrisma();
  const [devices, requests] = await Promise.all([
    prisma.device.findMany({ where: { userId: user.id }, orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }], take: 30 }),
    prisma.deviceRequest.findMany({ where: { userId: user.id, status: { in: ['PENDING', 'APPROVED', 'REJECTED'] } }, orderBy: { requestedAt: 'desc' }, take: 10 }),
  ]);
  return { max: MAX_DEVICES, devices: devices.map((d) => toDevice(d, currentDeviceId)), requests: requests.map(toRequest) };
}

/** Ends a device's registration: its sessions end now. `lost`: also registers a remote wipe. */
async function block(prisma, device, { lost, by, reason, req, action, description }) {
  const now = new Date();
  const updated = await prisma.$transaction(async (tx) => {
    const fresh = await tx.device.findUnique({ where: { id: device.id } });
    if (fresh.status === 'LOST' || (fresh.status === 'REVOKED' && !lost)) return null;
    const d = await tx.device.update({
      where: { id: device.id },
      data: {
        status: lost ? 'LOST' : 'REVOKED',
        revokedAt: fresh.revokedAt ?? now,
        revokedById: fresh.revokedById ?? by.id,
        revokedByName: fresh.revokedByName ?? by.name,
        revokeReason: fresh.revokeReason ?? reason,
        ...(lost && { wipeState: 'REQUESTED', wipeRequestedAt: now, wipeRequestedById: by.id, wipeRequestedByName: by.name }),
      },
    });
    // Its sessions end at once (and with them its push registration).
    await tx.session.deleteMany({ where: { deviceId: device.id } });
    return d;
  });
  if (!updated) throw conflict('DEVICE_ALREADY_BLOCKED', lost ? 'This phone is already reported lost.' : 'This phone is already revoked.');
  const owner = await prisma.user.findUnique({ where: { id: device.userId }, select: { id: true, name: true, role: true } });
  const { schoolId, ids } = await administratorsOf(prisma, owner);
  await recordAuditEvent({ action, actor: actorOf(by), target: { type: 'device', id: device.id, name: `${owner.name} · ${device.name}` }, schoolId, description, req });
  if (lost) {
    await createNotifications(
      ids.filter((id) => id !== by.id).map((recipientId) => ({ type: 'DEVICE_REPORTED_LOST', recipientId, schoolId, subjectType: 'device', subjectId: device.id, params: { name: owner.name, device: device.name, by: by.name }, dedupeKey: `device-lost:${device.id}:${recipientId}` })),
    ).catch(() => {});
  }
  return toDevice(updated);
}

const readReason = (body, required) => {
  const reason = clean(body?.reason, 300);
  if (required && !reason) throw badRequest('Give a reason.', { reason: 'Give a reason.' });
  return reason;
};

/** The staff member reports one of their phones lost or stolen, from another registered phone. */
export async function reportMyDeviceLost(user, deviceId, currentDeviceId, body, req) {
  const prisma = getPrisma();
  if (!currentDeviceId) throw forbidden('Report a lost phone from another phone registered to your account.');
  if (deviceId === currentDeviceId) throw badRequest('This is the phone you are using. Report it from another of your phones, or ask your Manager.');
  const device = isUuid(deviceId) ? await prisma.device.findFirst({ where: { id: deviceId, userId: user.id } }) : null;
  if (!device) throw notFound('Phone not found.');
  return block(prisma, device, { lost: true, by: user, reason: readReason(body, false) ?? 'Reported lost or stolen by its owner.', req, action: AUDIT_ACTIONS.DEVICE_REPORTED_LOST, description: `${user.name} reported their phone ${device.name} lost or stolen; a remote wipe is registered.` });
}

// ---- Administrators: Owner (whole school) and Manager (their branch) ----

/** The users whose phones an administrator manages. */
function managedUsers(scope) {
  if (scope.role === 'OWNER') return { branch: { schoolId: scope.school.id }, role: { in: ['STAFF', 'MANAGER', 'ACCOUNTANT'] } };
  return { branchId: scope.branch.id, role: { in: ['STAFF', 'ACCOUNTANT'] } };
}

async function findManaged(prisma, scope, deviceId) {
  const d = isUuid(deviceId) ? await prisma.device.findFirst({ where: { id: deviceId, user: managedUsers(scope) } }) : null;
  if (!d) throw notFound('Phone not found.');
  return d;
}

export async function listDevices(scope, { status } = {}) {
  const prisma = getPrisma();
  const where = { user: managedUsers(scope), ...(status && status !== 'all' && { status: status.toUpperCase() }) };
  const [devices, requests] = await Promise.all([
    prisma.device.findMany({ where, include: { user: { select: { id: true, name: true, role: true, staffId: true } } }, orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }], take: 300 }),
    prisma.deviceRequest.findMany({ where: { user: managedUsers(scope), status: 'PENDING' }, include: { user: { select: { id: true, name: true, role: true, staffId: true } } }, orderBy: { requestedAt: 'asc' } }),
  ]);
  return { max: MAX_DEVICES, devices: devices.map((d) => toDevice(d)), requests: requests.map(toRequest) };
}

export async function revokeDevice(scope, deviceId, body, user, req) {
  const prisma = getPrisma();
  const device = await findManaged(prisma, scope, deviceId);
  return block(prisma, device, { lost: false, by: user, reason: readReason(body, true), req, action: AUDIT_ACTIONS.DEVICE_REVOKED, description: `Phone ${device.name} revoked.` });
}

export async function wipeDevice(scope, deviceId, body, user, req) {
  const prisma = getPrisma();
  const device = await findManaged(prisma, scope, deviceId);
  return block(prisma, device, { lost: true, by: user, reason: readReason(body, true), req, action: AUDIT_ACTIONS.DEVICE_WIPE_REQUESTED, description: `Phone ${device.name} reported lost or stolen; a remote wipe is registered (it cannot be cancelled).` });
}

export async function decideRequest(scope, requestId, approve, user, req) {
  const prisma = getPrisma();
  const request = isUuid(requestId) ? await prisma.deviceRequest.findFirst({ where: { id: requestId, user: managedUsers(scope) }, include: { user: { select: { id: true, name: true } } } }) : null;
  if (!request) throw notFound('Request not found.');
  const updated = await prisma.deviceRequest.updateMany({ where: { id: request.id, status: 'PENDING' }, data: { status: approve ? 'APPROVED' : 'REJECTED', decidedAt: new Date(), decidedById: user.id, decidedByName: user.name } });
  if (!updated.count) throw conflict('REQUEST_DECIDED', 'This request was already decided.');
  await recordAuditEvent({
    action: approve ? AUDIT_ACTIONS.DEVICE_REQUEST_APPROVED : AUDIT_ACTIONS.DEVICE_REQUEST_REJECTED,
    actor: actorOf(user),
    target: { type: 'device_request', id: request.id, name: `${request.user.name} · ${request.name}` },
    schoolId: scope.school.id,
    description: approve ? `Another phone (${request.name}) approved for ${request.user.name}: it can register at the next sign-in.` : `Another phone (${request.name}) refused for ${request.user.name}.`,
    req,
  });
  return toRequest({ ...request, status: approve ? 'APPROVED' : 'REJECTED', decidedAt: new Date(), decidedByName: user.name, user: undefined });
}

/** The security history of a phone (its audit events), newest first. */
export async function deviceHistory(scope, deviceId) {
  const prisma = getPrisma();
  const device = await findManaged(prisma, scope, deviceId);
  const events = await prisma.auditEvent.findMany({ where: { targetType: 'device', targetId: device.id }, orderBy: { occurredAt: 'desc' }, take: 50 });
  return { device: toDevice(device), events: events.map((e) => ({ id: e.id, action: e.action, at: e.occurredAt.toISOString(), by: e.actorName, description: e.description })) };
}

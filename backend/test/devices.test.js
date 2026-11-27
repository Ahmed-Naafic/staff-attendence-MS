/*
 * Phones of mobile accounts (docs/mobile/devices.md): registration at mobile sign-in, the limit of
 * three with a request an administrator approves, revoking, a lost phone's remote wipe through the
 * device channel (requested → delivered → completed), the staff member reporting their own phone,
 * administrator scope, and the app lock's password check. Dev branch only.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import app from '../src/app.js';
import { getPrisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Device tests only run against the Neon dev branch.');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(4).toString('hex');
let server;
let base;
const accounts = {};
const phone = (n) => ({ installationId: `test-${tag}-${n}-${randomUUID()}`, name: `Phone ${n}`, platform: 'android', model: 'Pixel', appVersion: '0.2.0' });

async function call(path, { method = 'GET', body, token, cookie } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined && { 'content-type': 'application/json' }),
      ...(method !== 'GET' && cookie && { origin: ORIGIN }),
      ...(token && { authorization: `Bearer ${token}` }),
      ...(cookie && { cookie }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const mobileSignIn = (who, device) => call('/api/auth/login', { method: 'POST', body: { identifier: accounts[who].email, password: accounts[who].password, client: 'mobile', ...(device && { device }) } });

async function webCookie(who) {
  const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: accounts[who].email, password: accounts[who].password }) });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [key, role] of [['STAFF', 'STAFF'], ['OTHER', 'STAFF'], ['MANAGER', 'MANAGER']]) {
    const password = randomBytes(12).toString('base64url');
    const email = `test-device-${key.toLowerCase()}-${tag}@test.edutrack.example`;
    const user = await prisma.user.create({ data: { name: `Device ${key} ${tag}`, email, role, ...(await branchFor(role)), passwordHash: await hashPassword(password) } });
    accounts[key] = { id: user.id, email, password, branchId: user.branchId };
  }
  // The Manager is assigned to the branch (requireManagerBranch).
  await prisma.managerAssignment.create({ data: { managerId: accounts.MANAGER.id, branchId: accounts.MANAGER.branchId } });
});

after(async () => {
  const ids = Object.values(accounts).map((a) => a.id);
  await prisma.managerAssignment.deleteMany({ where: { managerId: { in: ids } } });
  await prisma.notification.deleteMany({ where: { recipientId: { in: ids } } });
  await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await removeTestBranches();
  server.close();
  await prisma.$disconnect();
});

describe('devices', () => {
  const phones = [phone(1), phone(2), phone(3), phone(4)];
  const registered = [];

  test('mobile sign-in registers a phone once; a fourth phone needs an approved request', async () => {
    resetLimiter();
    for (const p of phones.slice(0, 3)) {
      const res = await mobileSignIn('STAFF', p);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.match(res.body.device.secret, /^[\w-]{40,}$/);
      registered.push({ ...p, id: res.body.device.id, secret: res.body.device.secret, token: res.body.token });
    }
    // The same phone again: the same registration, no new secret.
    const again = await mobileSignIn('STAFF', phones[0]);
    assert.equal(again.body.device.id, registered[0].id);
    assert.equal(again.body.device.secret, undefined);
    const stored = await prisma.device.findFirst({ where: { id: registered[0].id } });
    assert.notEqual(stored.secretHash, registered[0].secret, 'only a hash of the secret is stored');

    const fourth = await mobileSignIn('STAFF', phones[3]);
    assert.equal(fourth.status, 403);
    assert.equal(fourth.body.code, 'DEVICE_LIMIT');
    const requestId = fourth.body.details.requestId;
    assert.ok(requestId);
    const notified = await prisma.notification.count({ where: { recipientId: accounts.MANAGER.id, type: 'DEVICE_APPROVAL_NEEDED' } });
    assert.equal(notified, 1);

    const manager = await webCookie('MANAGER');
    const list = await call('/api/manager/devices', { cookie: manager });
    assert.equal(list.status, 200);
    assert.equal(list.body.devices.filter((d) => d.user.id === accounts.STAFF.id).length, 3);
    assert.deepEqual(list.body.requests.map((r) => r.id), [requestId]);
    assert.equal((await call(`/api/manager/device-requests/${requestId}/approve`, { method: 'POST', cookie: manager, body: {} })).status, 200);
    assert.equal((await call(`/api/manager/device-requests/${requestId}/approve`, { method: 'POST', cookie: manager, body: {} })).body.code, 'REQUEST_DECIDED');
    const now = await mobileSignIn('STAFF', phones[3]);
    assert.equal(now.status, 200);
    registered.push({ ...phones[3], id: now.body.device.id, secret: now.body.device.secret, token: now.body.token });
    assert.equal((await prisma.deviceRequest.findUnique({ where: { id: requestId } })).status, 'USED');
  });

  test('revoking a phone ends its sessions; it cannot come back with that registration', async () => {
    const manager = await webCookie('MANAGER');
    const target = registered[1];
    assert.equal((await call('/api/devices/mine', { token: target.token })).status, 200);
    assert.equal((await call(`/api/manager/devices/${target.id}/revoke`, { method: 'POST', cookie: manager, body: {} })).status, 400, 'a reason is required');
    const revoked = await call(`/api/manager/devices/${target.id}/revoke`, { method: 'POST', cookie: manager, body: { reason: 'Left the school phone at home' } });
    assert.equal(revoked.body.device.status, 'revoked');
    assert.equal((await call('/api/devices/mine', { token: target.token })).status, 401, 'its session ended');
    const status = await call('/api/devices/status', { method: 'POST', body: { installationId: target.installationId, secret: target.secret } });
    assert.deepEqual(status.body, { status: 'revoked', wipe: false });
  });

  test('the staff member reports a phone lost from another phone: wipe requested → delivered → completed', async () => {
    const lost = registered[2];
    const from = registered[0];
    // Not from the phone itself.
    assert.equal((await call(`/api/devices/${lost.id}/report-lost`, { method: 'POST', token: lost.token, body: {} })).status, 400);
    const reported = await call(`/api/devices/${lost.id}/report-lost`, { method: 'POST', token: from.token, body: { reason: 'Stolen on the bus' } });
    assert.equal(reported.status, 200, JSON.stringify(reported.body));
    assert.equal(reported.body.device.status, 'lost');
    assert.equal(reported.body.device.wipe.state, 'requested');
    assert.equal((await call('/api/devices/mine', { token: lost.token })).status, 401);
    assert.equal(await prisma.notification.count({ where: { recipientId: accounts.MANAGER.id, type: 'DEVICE_REPORTED_LOST' } }), 1);

    // A wrong secret learns nothing.
    assert.deepEqual((await call('/api/devices/status', { method: 'POST', body: { installationId: lost.installationId, secret: randomBytes(32).toString('base64url') } })).body, { status: 'unknown', wipe: false });
    const delivered = await call('/api/devices/status', { method: 'POST', body: { installationId: lost.installationId, secret: lost.secret } });
    assert.deepEqual(delivered.body, { status: 'lost', wipe: true });
    assert.equal((await prisma.device.findUnique({ where: { id: lost.id } })).wipeState, 'DELIVERED');
    assert.deepEqual((await call('/api/devices/wipe-complete', { method: 'POST', body: { installationId: lost.installationId, secret: lost.secret } })).body, { done: true });
    const done = await prisma.device.findUnique({ where: { id: lost.id } });
    assert.equal(done.wipeState, 'COMPLETED');
    assert.ok(done.wipeDeliveredAt && done.wipeCompletedAt);

    // Found again: signing in registers it as a new phone (the lost registration stays lost).
    const back = await mobileSignIn('STAFF', lost);
    assert.equal(back.status, 200);
    assert.notEqual(back.body.device.id, lost.id);
    assert.equal((await prisma.device.findUnique({ where: { id: lost.id } })).status, 'LOST');

    const manager = await webCookie('MANAGER');
    const history = await call(`/api/manager/devices/${lost.id}/history`, { cookie: manager });
    assert.deepEqual(new Set(history.body.events.map((e) => e.action)), new Set(['DEVICE_REGISTERED', 'DEVICE_REPORTED_LOST', 'DEVICE_WIPE_DELIVERED', 'DEVICE_WIPE_COMPLETED']));
  });

  test("an administrator's wipe cannot be undone, and a Manager only reaches their branch's staff", async () => {
    const manager = await webCookie('MANAGER');
    const target = registered[3];
    const wiped = await call(`/api/manager/devices/${target.id}/wipe`, { method: 'POST', cookie: manager, body: { reason: 'Reported stolen' } });
    assert.equal(wiped.body.device.wipe.state, 'requested');
    assert.equal((await call(`/api/manager/devices/${target.id}/revoke`, { method: 'POST', cookie: manager, body: { reason: 'Undo?' } })).body.code, 'DEVICE_ALREADY_BLOCKED');
    // The Manager's own phone is the Owner's to manage.
    const own = await mobileSignIn('MANAGER', phone(9));
    assert.equal((await call(`/api/manager/devices/${own.body.device.id}/revoke`, { method: 'POST', cookie: manager, body: { reason: 'x' } })).status, 404);
    // Staff cannot use the administrator routes.
    const staffCookie = await webCookie('OTHER');
    assert.equal((await call('/api/manager/devices', { cookie: staffCookie })).status, 403);
  });

  test('the app lock checks the account password; a wrong one is 422 and the session stays', async () => {
    resetLimiter();
    const token = registered[0].token;
    const wrong = await call('/api/auth/verify-password', { method: 'POST', token, body: { password: 'not it' } });
    assert.equal(wrong.status, 422);
    assert.equal(wrong.body.code, 'WRONG_PASSWORD');
    assert.equal((await call('/api/auth/verify-password', { method: 'POST', token, body: { password: accounts.STAFF.password } })).status, 204);
    assert.equal((await call('/api/devices/mine', { token })).status, 200);
  });

  test('an app without device details still signs in (earlier versions)', async () => {
    resetLimiter();
    const res = await mobileSignIn('OTHER');
    assert.equal(res.status, 200);
    assert.equal(res.body.device, null);
  });
});

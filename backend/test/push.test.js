/*
 * Remote push (notification phase 3; docs/notifications/notification-architecture.md → Push
 * delivery): device registration per session (Android and iOS, several phones, token refresh,
 * account switching, sign-out), Expo submission, ticket and receipt errors, retries that reach only
 * the devices not reached yet, receipts (accepted, failed, unconfirmed), preferences and privacy.
 * Expo is replaced by test functions and, for the HTTP layer, by a local stub server: these are not
 * real-device tests. Runs on the Neon dev branch; everything it creates is removed.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { getPrisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { createNotifications } from '../src/features/notifications/notify.js';
import { checkPushReceipts, expoReceipts, expoSend, PushProviderError, RECEIPT_DELAY_MS, sendPendingPush } from '../src/features/notifications/push.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Push tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const phonePrefix = `+94${String(parseInt(randomBytes(3).toString('hex'), 16)).padStart(8, '0')}`;
const MIN = 60 * 1000;
const people = {};
const saved = { url: env.expoPushUrl, receipts: env.expoReceiptsUrl, token: env.expoAccessToken };
let server;
let stubServer;
let stub = { status: 200, body: null, requests: [] };
let base;
let school;
let branch;
let counter = 0;

const token = (name) => `ExponentPushToken[${lower}-${name}-xxxxxxxx]`;
async function call(path, { method = 'GET', body, auth } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(auth && { authorization: `Bearer ${auth}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
/** A new Staff app session (one phone) for a staff member. */
async function signIn(person) {
  const res = await call('/api/auth/login', { method: 'POST', body: { identifier: person.phone, password: person.password, client: 'mobile' } });
  assert.equal(res.status, 200);
  return res.body.token;
}
const register = (session, value, platform = 'android') => call('/api/notifications/devices', { method: 'POST', body: { token: value, platform }, auth: session });
const devicesOf = (person) => prisma.pushDevice.findMany({ where: { userId: person.id }, orderBy: { token: 'asc' } });
/** A notification (and its queued push) for a staff member. */
async function notify(person, type = 'ASSIGNMENT_CANCELLED') {
  const [n] = await createNotifications([{ type, recipientId: person.id, params: { effectiveFrom: '2026-11-02' }, dedupeKey: `push-${tag}-${randomUUID()}` }]);
  return prisma.pushMessage.findUnique({ where: { userId_sourceKey: { userId: person.id, sourceKey: `notification:${n.id}` } } });
}
/** A fake Expo: records what is sent and answers each message with `ticketFor(message)`. */
function fakeExpo(ticketFor = () => ({ status: 'ok', id: randomUUID() })) {
  const sent = [];
  const send = async (batch) => {
    sent.push(...batch);
    return batch.map((m) => ticketFor(m));
  };
  return { sent, send };
}
/** Leaves only `ids` pending, so other tests' queued pushes do not interfere. */
const onlyPending = (ids) => prisma.pushMessage.updateMany({ where: { status: 'PENDING', id: { notIn: ids } }, data: { status: 'SKIPPED' } });

before(async () => {
  stubServer = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      stub.requests.push({ url: req.url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
      res.statusCode = stub.status;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(stub.body));
    });
  });
  stubServer.listen(0);
  await new Promise((r) => stubServer.once('listening', r));
  const stubBase = `http://127.0.0.1:${stubServer.address().port}`;
  env.expoPushUrl = `${stubBase}/push/send`;
  env.expoReceiptsUrl = `${stubBase}/push/getReceipts`;

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  school = await prisma.school.create({ data: { code: `PU${tag}`, name: `Push School ${tag}`, location: 'Mogadishu' } });
  branch = await prisma.branch.create({ data: { schoolId: school.id, number: 1, code: `PU${tag}-B001`, name: `Push ${tag}`, nameKey: `push ${lower}`, address: 'Road', city: 'Mogadishu' } });
  for (const key of ['S1', 'S2', 'S3']) {
    counter += 1;
    const password = randomBytes(12).toString('base64url');
    const phone = `${phonePrefix}${String(counter).padStart(3, '0')}`;
    const user = await prisma.user.create({
      data: { name: `Push ${key} ${tag}`, email: `test-push-${counter}-${lower}@test.edutrack.example`, role: 'STAFF', branchId: branch.id, staffId: `${branch.code}-ST00${counter}`, phone, phoneKey: phone, jobTitle: 'Teacher', passwordHash: await hashPassword(password) },
    });
    people[key] = { ...user, password };
  }
});

after(async () => {
  Object.assign(env, { expoPushUrl: saved.url, expoReceiptsUrl: saved.receipts, expoAccessToken: saved.token });
  const userIds = Object.values(people).map((p) => p.id);
  await prisma.pushMessage.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: userIds } }, { schoolId: school.id }] } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.delete({ where: { id: branch.id } });
  await prisma.school.delete({ where: { id: school.id } });
  server.close();
  stubServer.close();
  await prisma.$disconnect();
});

// ---- device registration lifecycle ---------------------------------------------------------

test('registration: Android and iOS tokens, one per session, several phones per staff member, each the signed-in account’s', async () => {
  people.S1.phoneA = await signIn(people.S1);
  people.S1.phoneB = await signIn(people.S1);
  assert.equal((await register(people.S1.phoneA, token('a1'), 'android')).status, 201);
  assert.equal((await register(people.S1.phoneB, token('b1'), 'ios')).status, 201);
  assert.deepEqual((await devicesOf(people.S1)).map((d) => [d.token, d.platform]), [[token('a1'), 'android'], [token('b1'), 'ios']]);
  assert.ok((await devicesOf(people.S1)).every((d) => d.userId === people.S1.id));
  for (const bad of [{ token: 'abc', platform: 'android' }, { token: token('x'), platform: 'web' }, { token: token('x'), platform: 'ios', userId: people.S2.id }]) {
    assert.equal((await call('/api/notifications/devices', { method: 'POST', body: bad, auth: people.S1.phoneA })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await register(undefined, token('x'))).status, 401);
});

test('token refresh: the session’s new token replaces its old one', async () => {
  assert.equal((await register(people.S1.phoneA, token('a2'), 'android')).status, 201);
  assert.deepEqual((await devicesOf(people.S1)).map((d) => d.token), [token('a2'), token('b1')]);
});

test('account switching: the phone’s token moves to the new account; the previous account no longer reaches it', async () => {
  people.S2.phoneA = await signIn(people.S2);
  assert.equal((await register(people.S2.phoneA, token('a2'), 'android')).status, 201);
  assert.deepEqual((await devicesOf(people.S1)).map((d) => d.token), [token('b1')]);
  assert.deepEqual((await devicesOf(people.S2)).map((d) => d.token), [token('a2')]);
  const message = await notify(people.S1);
  await onlyPending([message.id]);
  const expo = fakeExpo();
  await sendPendingPush({ send: expo.send });
  assert.deepEqual(expo.sent.map((m) => m.to), [token('b1')], 'S1’s push never goes to the phone S2 now uses');
});

test('sign-out removes the session’s device; DELETE devices/current removes it without signing out', async () => {
  assert.equal((await call('/api/auth/logout', { method: 'POST', auth: people.S2.phoneA })).status, 204);
  assert.equal((await devicesOf(people.S2)).length, 0);
  people.S3.session1 = await signIn(people.S3);
  await register(people.S3.session1, token('c1'));
  assert.equal((await call('/api/notifications/devices/current', { method: 'DELETE', auth: people.S3.session1 })).status, 204);
  assert.equal((await devicesOf(people.S3)).length, 0);
});

// ---- submission, errors, retries ------------------------------------------------------------

test('submission to every device: tickets stored per device; SUBMITTED is not ACCEPTED; generic Somali text and an opaque reference only', async () => {
  people.S1.phoneC = await signIn(people.S1);
  await register(people.S1.phoneC, token('c2'), 'android');
  const message = await notify(people.S1);
  await onlyPending([message.id]);
  const expo = fakeExpo();
  const counts = await sendPendingPush({ send: expo.send });
  assert.equal(counts.submitted, 1);
  assert.deepEqual(expo.sent.map((m) => m.to).sort(), [token('b1'), token('c2')]);
  const row = await prisma.pushMessage.findUnique({ where: { id: message.id }, include: { deliveries: true } });
  assert.deepEqual([row.status, Boolean(row.submittedAt), row.acceptedAt], ['SUBMITTED', true, null]);
  assert.deepEqual(row.deliveries.map((d) => [d.status, Boolean(d.ticketId)]), [['SUBMITTED', true], ['SUBMITTED', true]]);
  for (const m of expo.sent) {
    assert.equal(m.title, 'EduTrack');
    assert.equal(m.body, 'Waxaad leedahay ogeysiis cusub oo imaanshaha ah.');
    assert.deepEqual(m.data, { kind: 'notification', source: 'notification', id: row.sourceKey.split(':')[1] });
    assert.ok(!JSON.stringify(m).includes(people.S1.name) && !JSON.stringify(m).includes(people.S1.phone) && !JSON.stringify(m).includes('2026-11-02'));
  }
  // Not sent again by a later run.
  const again = fakeExpo();
  await sendPendingPush({ send: again.send });
  assert.equal(again.sent.length, 0);
});

test('a temporary ticket error (MessageRateExceeded) retries only that device; the device already reached gets nothing twice', async () => {
  const message = await notify(people.S1);
  await onlyPending([message.id]);
  const first = fakeExpo((m) => (m.to === token('c2') ? { status: 'error', message: 'Too many', details: { error: 'MessageRateExceeded' } } : { status: 'ok', id: randomUUID() }));
  const now = new Date();
  await sendPendingPush({ now, send: first.send });
  let row = await prisma.pushMessage.findUnique({ where: { id: message.id } });
  assert.equal(row.status, 'PENDING');
  assert.equal(row.nextAttemptAt.getTime(), now.getTime() + MIN, 'backoff: 1 minute');
  const second = fakeExpo();
  await sendPendingPush({ now: new Date(now.getTime() + 2 * MIN), send: second.send });
  assert.deepEqual(second.sent.map((m) => m.to), [token('c2')]);
  row = await prisma.pushMessage.findUnique({ where: { id: message.id }, include: { deliveries: true } });
  assert.equal(row.status, 'SUBMITTED');
  assert.equal(row.deliveries.length, 2);
});

test('provider failures: temporary (network, 503) are retried with backoff and then given up; permanent ones fail at once', async () => {
  const message = await notify(people.S1);
  await onlyPending([message.id]);
  let now = new Date();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await sendPendingPush({ now, send: async () => { throw new PushProviderError('Push service answered 503.', 'transient', 'HTTP_503'); } });
    const row = await prisma.pushMessage.findUnique({ where: { id: message.id } });
    assert.equal(row.status, attempt < 5 ? 'PENDING' : 'FAILED', `attempt ${attempt}`);
    now = new Date(row.nextAttemptAt.getTime() + 1000);
  }
  const permanent = await notify(people.S1);
  await onlyPending([permanent.id]);
  await sendPendingPush({ send: async () => { throw new PushProviderError('Push service refused the credentials (EXPO_ACCESS_TOKEN).', 'permanent', 'UNAUTHORIZED'); } });
  const row = await prisma.pushMessage.findUnique({ where: { id: permanent.id }, include: { deliveries: true } });
  assert.equal(row.status, 'FAILED');
  assert.ok(row.deliveries.every((d) => d.status === 'FAILED' && d.errorCode === 'UNAUTHORIZED'));
});

test('a dead token (DeviceNotRegistered) is removed and never used again; MessageTooBig fails without a retry', async () => {
  people.S3.session2 = await signIn(people.S3);
  await register(people.S3.session2, token('d1'), 'ios');
  const message = await notify(people.S3);
  await onlyPending([message.id]);
  await sendPendingPush({ send: fakeExpo(() => ({ status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } })).send });
  assert.equal((await devicesOf(people.S3)).length, 0);
  assert.equal((await prisma.pushMessage.findUnique({ where: { id: message.id } })).status, 'FAILED');
  const later = await notify(people.S3);
  await onlyPending([later.id]);
  const expo = fakeExpo();
  await sendPendingPush({ send: expo.send });
  assert.equal(expo.sent.length, 0);
  assert.equal((await prisma.pushMessage.findUnique({ where: { id: later.id } })).status, 'SKIPPED', 'no device left');

  const big = await notify(people.S1);
  await onlyPending([big.id]);
  await sendPendingPush({ send: fakeExpo(() => ({ status: 'error', message: 'too big', details: { error: 'MessageTooBig' } })).send });
  const row = await prisma.pushMessage.findUnique({ where: { id: big.id } });
  assert.deepEqual([row.status, row.attempts], ['FAILED', 1]);
});

test('preferences: push turned off is skipped without contacting Expo', async () => {
  await prisma.notificationPreference.upsert({ where: { userId: people.S1.id }, create: { userId: people.S1.id, pushEnabled: true }, update: { pushEnabled: true } });
  const message = await notify(people.S1);
  await onlyPending([message.id]);
  await prisma.notificationPreference.update({ where: { userId: people.S1.id }, data: { pushEnabled: false } });
  const expo = fakeExpo();
  await sendPendingPush({ send: expo.send });
  assert.equal(expo.sent.length, 0);
  assert.equal((await prisma.pushMessage.findUnique({ where: { id: message.id } })).status, 'SKIPPED');
  await prisma.notificationPreference.update({ where: { userId: people.S1.id }, data: { pushEnabled: true } });
});

// ---- receipts ----------------------------------------------------------------------------------

test('receipts: read after 15 minutes; ok → ACCEPTED, DeviceNotRegistered → FAILED and the device removed, missing after 24 hours → UNCONFIRMED', async () => {
  people.S2.phone2 = await signIn(people.S2);
  await register(people.S2.phone2, token('e1'), 'android');
  people.S2.phone3 = await signIn(people.S2);
  await register(people.S2.phone3, token('e2'), 'ios');
  const message = await notify(people.S2);
  await onlyPending([message.id]);
  const tickets = { [token('e1')]: `t-${randomUUID()}`, [token('e2')]: `t-${randomUUID()}` };
  const sentAt = new Date(Date.now() + 1000);
  await sendPendingPush({ now: sentAt, send: fakeExpo((m) => ({ status: 'ok', id: tickets[m.to] })).send });

  const asked = [];
  const receipts = (answers) => async (ids) => (asked.push(...ids), Object.fromEntries(ids.filter((id) => answers[id]).map((id) => [id, answers[id]])));
  await checkPushReceipts({ now: new Date(sentAt.getTime() + 5 * MIN), getReceipts: receipts({}) });
  assert.ok(!asked.includes(tickets[token('e1')]), 'not before 15 minutes');

  const counts = await checkPushReceipts({
    now: new Date(sentAt.getTime() + RECEIPT_DELAY_MS + MIN),
    getReceipts: receipts({ [tickets[token('e1')]]: { status: 'ok' }, [tickets[token('e2')]]: { status: 'error', message: 'unregistered', details: { error: 'DeviceNotRegistered' } } }),
  });
  assert.deepEqual([counts.accepted, counts.failed], [1, 1]);
  const row = await prisma.pushMessage.findUnique({ where: { id: message.id }, include: { deliveries: { orderBy: { token: 'asc' } } } });
  assert.deepEqual(row.deliveries.map((d) => [d.token, d.status, d.errorCode]), [[token('e1'), 'ACCEPTED', null], [token('e2'), 'FAILED', 'DeviceNotRegistered']]);
  assert.deepEqual([row.status, Boolean(row.acceptedAt)], ['ACCEPTED', true]);
  assert.deepEqual((await devicesOf(people.S2)).map((d) => d.token), [token('e1')]);

  // No receipt: still waiting within 24 hours, UNCONFIRMED after.
  const quiet = await notify(people.S2);
  await onlyPending([quiet.id]);
  await sendPendingPush({ now: new Date(Date.now() + 1000), send: fakeExpo(() => ({ status: 'ok', id: `t-${randomUUID()}` })).send });
  await checkPushReceipts({ now: new Date(sentAt.getTime() + 2 * 60 * MIN), getReceipts: receipts({}) });
  assert.equal((await prisma.pushDelivery.findFirst({ where: { pushMessageId: quiet.id } })).status, 'SUBMITTED');
  await checkPushReceipts({ now: new Date(sentAt.getTime() + 25 * 60 * MIN), getReceipts: receipts({}) });
  assert.equal((await prisma.pushDelivery.findFirst({ where: { pushMessageId: quiet.id } })).status, 'UNCONFIRMED');
  assert.equal((await prisma.pushMessage.findUnique({ where: { id: quiet.id } })).status, 'SUBMITTED', 'never claimed as accepted or delivered');
});

// ---- the HTTP calls to Expo (local stub server) ------------------------------------------------

test('Expo HTTP: tickets and receipts are read; 503 is temporary; 401 and request errors are permanent; the access token is sent when configured', async () => {
  stub = { status: 200, body: { data: [{ status: 'ok', id: 'ticket-1' }] }, requests: [] };
  env.expoAccessToken = 'test-access-token';
  assert.deepEqual(await expoSend([{ to: token('z'), title: 'EduTrack', body: 'x' }]), [{ status: 'ok', id: 'ticket-1' }]);
  assert.equal(stub.requests[0].url, '/push/send');
  assert.equal(stub.requests[0].headers.authorization, 'Bearer test-access-token');
  env.expoAccessToken = undefined;

  stub = { status: 200, body: { data: { 'ticket-1': { status: 'ok' } } }, requests: [] };
  assert.deepEqual(await expoReceipts(['ticket-1']), { 'ticket-1': { status: 'ok' } });
  assert.deepEqual(stub.requests[0].body, { ids: ['ticket-1'] });
  assert.equal(stub.requests[0].headers.authorization, undefined);

  const kindOf = async (status, body) => {
    stub = { status, body, requests: [] };
    try {
      await expoSend([{ to: token('z') }]);
      return 'ok';
    } catch (error) {
      return [error.kind, error.code];
    }
  };
  assert.deepEqual(await kindOf(503, {}), ['transient', 'HTTP_503']);
  assert.deepEqual(await kindOf(429, {}), ['transient', 'HTTP_429']);
  assert.deepEqual(await kindOf(401, {}), ['permanent', 'UNAUTHORIZED']);
  assert.deepEqual(await kindOf(400, { errors: [{ code: 'VALIDATION_ERROR' }] }), ['permanent', 'HTTP_400']);
  assert.deepEqual(await kindOf(200, { errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS' }] }), ['permanent', 'PUSH_TOO_MANY_EXPERIENCE_IDS']);
  assert.deepEqual(await kindOf(200, { data: [] }), ['transient', 'BAD_RESPONSE'], 'a ticket per message is required');
});

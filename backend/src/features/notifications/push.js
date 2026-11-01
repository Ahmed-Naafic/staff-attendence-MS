import { badRequest } from '../../common/httpError.js';
import { env } from '../../config/env.js';
import { getPrisma } from '../../config/prisma.js';
import { platformNotificationSettings } from './notificationSettings.service.js';
import { DEFAULT_LANGUAGE } from './notificationTypes.js';
import { PUSH_TEXTS } from './templates.js';

/*
 * Remote push (N2 phase 3) through the Expo push service, for the Staff app only (Managers and
 * Owners use the web app). Expo forwards each message to FCM (Android) or APNs (iOS).
 *
 * Devices: a token belongs to one signed-in session of the Staff app (a staff member may have
 * several phones, one session each). It is removed with the session (sign-out, suspension, password
 * reset, expiry cleanup), when another account signs in on the same phone (the token moves), and when
 * Expo or the provider reports it is no longer registered — so a dead or foreign token is never used
 * again.
 *
 * Content (N21): a generic Somali text on the lock screen; the data holds only `kind` and the opaque
 * id of the notification so a tap can open it inside the signed-in app (which checks access again).
 *
 * States, kept apart on purpose:
 *   PushMessage   PENDING (queued / waiting for a retry) → SUBMITTED (Expo returned a ticket for at
 *                 least one device) → ACCEPTED (a receipt says FCM/APNs accepted it); FAILED; SKIPPED.
 *   PushDelivery  per device: SUBMITTED → ACCEPTED | FAILED, or UNCONFIRMED (no receipt in 24 h).
 * Acceptance by the provider is not proof that the phone displayed it; nothing here claims that.
 *
 * Reliability: messages are claimed with SKIP LOCKED (no double sending by parallel runs); a token
 * gets a message at most once (unique delivery), so a retry reaches only devices not reached yet.
 * Temporary failures (network, timeout, HTTP 429/5xx, MessageRateExceeded) are retried with backoff;
 * permanent ones (bad credentials, invalid request, MessageTooBig…) fail at once. Push never blocks
 * or undoes the business change that caused it. Suspended users, expired notifications and
 * withdrawn announcements are skipped (N15).
 */

export const EXPO_BATCH = 100;
export const RECEIPT_BATCH = 300;
export const PUSH_MAX_ATTEMPTS = 5;
/** Expo recommends waiting about 15 minutes before reading receipts; they are kept for 24 hours. */
export const RECEIPT_DELAY_MS = 15 * 60 * 1000;
export const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
export const pushDelayMs = (attempts) => [1, 5, 30, 120][Math.min(Math.max(attempts, 1) - 1, 3)] * 60 * 1000;
const TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/;
const DELIVERED = ['SUBMITTED', 'ACCEPTED'];

/** A failure of a whole request to Expo: `transient` (retry later) or `permanent` (configuration or request error). */
export class PushProviderError extends Error {
  constructor(message, kind, code = null) {
    super(message);
    this.kind = kind;
    this.code = code;
  }
}

/**
 * What an Expo ticket or receipt error means for us:
 *   device     — DeviceNotRegistered: the token is dead; remove the device.
 *   transient  — MessageRateExceeded: try this device again later.
 *   permanent  — MessageTooBig, InvalidCredentials, MismatchSenderId and anything unknown: do not retry.
 */
export function classifyPushError(code) {
  if (code === 'DeviceNotRegistered') return 'device';
  if (code === 'MessageRateExceeded') return 'transient';
  return 'permanent';
}

/** The generic message for one device token (no personal or attendance data; only an opaque reference for the tap). */
export function genericPushMessage(token, category, sourceKey, language = DEFAULT_LANGUAGE) {
  const texts = PUSH_TEXTS[language];
  const [source, id] = (sourceKey ?? '').split(':');
  return {
    to: token,
    title: texts.title,
    body: category === 'ANNOUNCEMENT' ? texts.announcement : texts.attendance,
    sound: 'default',
    priority: 'high',
    channelId: 'default',
    data: { kind: 'notification', ...(source && id && { source, id }) },
  };
}

/** Registers the Staff app's push token for this session (replacing an earlier token of the session or another session's copy of this token). */
export async function registerDevice({ userId, sessionId }, body) {
  const keys = Object.keys(body);
  if (keys.some((k) => !['token', 'platform'].includes(k))) throw badRequest('Send only token and platform.');
  if (typeof body.token !== 'string' || !TOKEN.test(body.token)) throw badRequest('Check the highlighted fields.', { token: 'This is not an Expo push token.' });
  if (!['android', 'ios'].includes(body.platform)) throw badRequest('Check the highlighted fields.', { platform: 'Choose android or ios.' });
  const prisma = getPrisma();
  // The token now belongs to this session only: a phone where another account signed in before
  // stops receiving that account's pushes.
  await prisma.$transaction([
    prisma.pushDevice.deleteMany({ where: { OR: [{ token: body.token }, { sessionId }] } }),
    prisma.pushDevice.create({ data: { userId, sessionId, token: body.token, platform: body.platform } }),
  ]);
  return { registered: true };
}

/** Removes this session's push token (the app turned push off or is signing out). */
export async function unregisterDevice({ sessionId }) {
  await getPrisma().pushDevice.deleteMany({ where: { sessionId } });
}

async function expoPost(url, body) {
  const headers = { accept: 'application/json', 'accept-encoding': 'gzip, deflate', 'content-type': 'application/json' };
  if (env.expoAccessToken) headers.authorization = `Bearer ${env.expoAccessToken}`;
  let response;
  try {
    response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  } catch (error) {
    throw new PushProviderError(`Push service unreachable: ${error.message}`, 'transient', 'NETWORK');
  }
  if (response.status === 429 || response.status >= 500) throw new PushProviderError(`Push service answered ${response.status}.`, 'transient', `HTTP_${response.status}`);
  const data = await response.json().catch(() => null);
  if (response.status === 401 || response.status === 403) throw new PushProviderError('Push service refused the credentials (EXPO_ACCESS_TOKEN).', 'permanent', 'UNAUTHORIZED');
  if (!response.ok) throw new PushProviderError(`Push service refused the request (${response.status}).`, 'permanent', `HTTP_${response.status}`);
  if (data?.errors?.length) throw new PushProviderError(`Push service error: ${data.errors.map((e) => e.code ?? e.message).join(', ')}`, 'permanent', data.errors[0]?.code ?? 'REQUEST_ERROR');
  return data;
}

/** POSTs up to 100 messages to Expo → one ticket per message ({ status: 'ok', id } | { status: 'error', message, details: { error } }). */
export async function expoSend(messages) {
  const data = await expoPost(env.expoPushUrl, messages);
  if (!Array.isArray(data?.data) || data.data.length !== messages.length) throw new PushProviderError('Push service answered without a ticket per message.', 'transient', 'BAD_RESPONSE');
  return data.data;
}

/** Reads receipts for ticket ids → { [ticketId]: { status: 'ok' } | { status: 'error', message, details: { error } } } (missing = not available). */
export async function expoReceipts(ids) {
  const data = await expoPost(env.expoReceiptsUrl, { ids });
  return data?.data ?? {};
}

/** The sources (notification or announcement) that still exist and have not expired. */
async function liveSources(client, messages, now) {
  const ids = (prefix) => messages.filter((m) => m.sourceKey.startsWith(prefix)).map((m) => m.sourceKey.slice(prefix.length));
  const [notifications, announcements] = await Promise.all([
    client.notification.findMany({ where: { id: { in: ids('notification:') }, expiresAt: { gt: now } }, select: { id: true } }),
    client.announcement.findMany({ where: { id: { in: ids('announcement:') }, status: 'PUBLISHED', expiresAt: { gt: now } }, select: { id: true } }),
  ]);
  return new Set([...notifications.map((n) => `notification:${n.id}`), ...announcements.map((a) => `announcement:${a.id}`)]);
}

/** The message state from its deliveries (after sending or after receipts). */
async function settleMessage(client, messageId, now, { retry = false, attempts = 0, lastError = null } = {}) {
  const deliveries = await client.pushDelivery.findMany({ where: { pushMessageId: messageId }, select: { status: true } });
  const accepted = deliveries.some((d) => d.status === 'ACCEPTED');
  const submitted = deliveries.some((d) => DELIVERED.includes(d.status));
  if (retry && attempts < PUSH_MAX_ATTEMPTS) {
    await client.pushMessage.update({
      where: { id: messageId },
      data: { status: 'PENDING', nextAttemptAt: new Date(now.getTime() + pushDelayMs(attempts)), lastError: lastError && String(lastError).slice(0, 300), ...(submitted && { submittedAt: now }) },
    });
    return 'retry';
  }
  const message = await client.pushMessage.findUnique({ where: { id: messageId }, select: { submittedAt: true, acceptedAt: true } });
  const status = accepted ? 'ACCEPTED' : submitted ? 'SUBMITTED' : 'FAILED';
  await client.pushMessage.update({
    where: { id: messageId },
    data: {
      status,
      lastError: status === 'FAILED' ? String(lastError ?? 'No device could be reached.').slice(0, 300) : null,
      ...(submitted && !message.submittedAt && { submittedAt: now }),
      ...(accepted && !message.acceptedAt && { acceptedAt: now }),
    },
  });
  return status === 'FAILED' ? 'failed' : 'submitted';
}

/**
 * Sends due push messages (oldest first). → { submitted, skipped, retry, failed }.
 * `send` is the Expo call (replaced in tests).
 */
export async function sendPendingPush({ now = new Date(), limit = 500, send = expoSend, stop = () => false } = {}) {
  const client = getPrisma();
  const counts = { submitted: 0, skipped: 0, retry: 0, failed: 0 };
  const settings = await platformNotificationSettings(client);
  while (!stop() && counts.submitted + counts.skipped + counts.retry + counts.failed < limit) {
    // Claim a batch: rows locked by another run are skipped, and the lease keeps them from being picked again meanwhile.
    const lease = new Date(now.getTime() + 2 * 60 * 1000);
    const claimed = await client.$queryRaw`
      UPDATE "PushMessage" SET "attempts" = "attempts" + 1, "nextAttemptAt" = ${lease}
      WHERE "id" IN (
        SELECT "id" FROM "PushMessage" WHERE "status" = 'PENDING' AND "nextAttemptAt" <= ${now}
        ORDER BY "createdAt" LIMIT ${Math.min(EXPO_BATCH, limit)} FOR UPDATE SKIP LOCKED
      )
      RETURNING "id"`;
    if (!claimed.length) break;
    const messages = await client.pushMessage.findMany({
      where: { id: { in: claimed.map((m) => m.id) } },
      include: {
        deliveries: { select: { token: true } },
        user: {
          select: {
            status: true,
            notificationPreference: { select: { pushEnabled: true } },
            pushDevices: { where: { session: { expiresAt: { gt: now } } }, select: { id: true, token: true, platform: true } },
          },
        },
      },
    });
    const live = await liveSources(client, messages, now);
    const skip = [];
    const outgoing = []; // { message, device }
    const nothingLeft = [];
    for (const m of messages) {
      if (!settings.pushEnabled || m.user.status !== 'ACTIVE' || m.user.notificationPreference?.pushEnabled === false || !live.has(m.sourceKey)) {
        skip.push(m.id);
        continue;
      }
      // A device gets a message at most once: a retry reaches only devices without a delivery yet.
      const reached = new Set(m.deliveries.map((d) => d.token));
      const devices = m.user.pushDevices.filter((d) => !reached.has(d.token));
      if (devices.length) for (const device of devices) outgoing.push({ message: m, device });
      else if (m.deliveries.length) nothingLeft.push(m);
      else skip.push(m.id);
    }
    if (skip.length) {
      await client.pushMessage.updateMany({ where: { id: { in: skip } }, data: { status: 'SKIPPED', lastError: null } });
      counts.skipped += skip.length;
    }
    for (const m of nothingLeft) counts[(await settleMessage(client, m.id, now)) === 'failed' ? 'failed' : 'submitted'] += 1;
    if (!outgoing.length) continue;

    const retryMessages = new Map(); // messageId → reason
    const deadDevices = [];
    const deliveries = [];
    for (let i = 0; i < outgoing.length; i += EXPO_BATCH) {
      const part = outgoing.slice(i, i + EXPO_BATCH);
      let tickets;
      try {
        tickets = await send(part.map(({ message, device }) => genericPushMessage(device.token, message.category, message.sourceKey)));
      } catch (error) {
        const kind = error instanceof PushProviderError ? error.kind : 'transient';
        for (const { message, device } of part) {
          if (kind === 'transient') retryMessages.set(message.id, error.message);
          else deliveries.push({ pushMessageId: message.id, token: device.token, platform: device.platform, status: 'FAILED', errorCode: error.code ?? 'REQUEST_ERROR', errorMessage: String(error.message).slice(0, 300), submittedAt: now });
        }
        continue;
      }
      part.forEach(({ message, device }, j) => {
        const ticket = tickets[j];
        if (ticket?.status === 'ok') {
          deliveries.push({ pushMessageId: message.id, token: device.token, platform: device.platform, status: 'SUBMITTED', ticketId: ticket.id ?? null, submittedAt: now });
          return;
        }
        const code = ticket?.details?.error ?? 'UNKNOWN';
        const kind = classifyPushError(code);
        if (kind === 'transient') {
          retryMessages.set(message.id, `${code}: ${ticket?.message ?? ''}`);
          return;
        }
        if (kind === 'device') deadDevices.push(device.id);
        deliveries.push({ pushMessageId: message.id, token: device.token, platform: device.platform, status: 'FAILED', errorCode: code, errorMessage: String(ticket?.message ?? '').slice(0, 300), submittedAt: now });
      });
    }
    if (deliveries.length) await client.pushDelivery.createMany({ data: deliveries, skipDuplicates: true });
    if (deadDevices.length) await client.pushDevice.deleteMany({ where: { id: { in: deadDevices } } });
    for (const m of new Set(outgoing.map((o) => o.message))) {
      const failedHere = deliveries.find((d) => d.pushMessageId === m.id && d.status === 'FAILED');
      const result = await settleMessage(client, m.id, now, { retry: retryMessages.has(m.id), attempts: m.attempts, lastError: retryMessages.get(m.id) ?? failedHere?.errorMessage ?? failedHere?.errorCode });
      counts[result === 'retry' ? 'retry' : result === 'failed' ? 'failed' : 'submitted'] += 1;
    }
  }
  return counts;
}

/**
 * Reads Expo receipts for deliveries submitted at least 15 minutes ago: ok → ACCEPTED (handed to
 * FCM/APNs), error → FAILED (DeviceNotRegistered also removes the device), still missing after
 * 24 hours → UNCONFIRMED. A temporary failure leaves them for the next run.
 * `getReceipts` is the Expo call (replaced in tests). → { accepted, failed, unconfirmed, pending }.
 */
export async function checkPushReceipts({ now = new Date(), limit = 1000, getReceipts = expoReceipts } = {}) {
  const client = getPrisma();
  const counts = { accepted: 0, failed: 0, unconfirmed: 0, pending: 0 };
  const due = await client.pushDelivery.findMany({
    where: { status: 'SUBMITTED', ticketId: { not: null }, submittedAt: { lte: new Date(now.getTime() - RECEIPT_DELAY_MS) } },
    orderBy: { submittedAt: 'asc' },
    take: limit,
    select: { id: true, ticketId: true, token: true, pushMessageId: true, submittedAt: true },
  });
  const touched = new Set();
  for (let i = 0; i < due.length; i += RECEIPT_BATCH) {
    const part = due.slice(i, i + RECEIPT_BATCH);
    let receipts;
    try {
      receipts = await getReceipts(part.map((d) => d.ticketId));
    } catch (error) {
      if (error instanceof PushProviderError && error.kind === 'permanent') console.error('[push] receipts refused:', error.message);
      counts.pending += part.length;
      continue;
    }
    for (const d of part) {
      const receipt = receipts[d.ticketId];
      if (!receipt) {
        const expired = now.getTime() - d.submittedAt.getTime() > RECEIPT_TTL_MS;
        await client.pushDelivery.update({ where: { id: d.id }, data: { receiptCheckedAt: now, ...(expired && { status: 'UNCONFIRMED' }) } });
        counts[expired ? 'unconfirmed' : 'pending'] += 1;
        continue;
      }
      if (receipt.status === 'ok') {
        await client.pushDelivery.update({ where: { id: d.id }, data: { status: 'ACCEPTED', receiptCheckedAt: now } });
        counts.accepted += 1;
      } else {
        const code = receipt.details?.error ?? 'UNKNOWN';
        if (classifyPushError(code) === 'device') await client.pushDevice.deleteMany({ where: { token: d.token } });
        await client.pushDelivery.update({ where: { id: d.id }, data: { status: 'FAILED', errorCode: code, errorMessage: String(receipt.message ?? '').slice(0, 300), receiptCheckedAt: now } });
        counts.failed += 1;
      }
      touched.add(d.pushMessageId);
    }
  }
  for (const id of touched) await settleMessage(client, id, now);
  return counts;
}

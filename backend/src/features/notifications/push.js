import { badRequest } from '../../common/httpError.js';
import { env } from '../../config/env.js';
import { getPrisma } from '../../config/prisma.js';
import { platformNotificationSettings } from './notificationSettings.service.js';
import { DEFAULT_LANGUAGE } from './notificationTypes.js';
import { PUSH_TEXTS } from './templates.js';

/*
 * Remote push (N2 phase 3) through the Expo push service, for the Staff app only (Managers and
 * Owners use the web app). A device token belongs to one session: it is removed with the session
 * (sign-out, suspension, password reset, expiry), so a signed-out phone receives nothing.
 *
 * The message is always generic (N21): "You have a new attendance notification" in Somali, with no
 * name, time, status, branch, reason or id; the details are read inside the signed-in app.
 * Delivery is at-least-once with retries (network errors, 429 and 5xx), and never blocks or undoes
 * the business change that caused it. Suspended users and expired notifications are skipped (N15).
 */

export const EXPO_BATCH = 100;
export const PUSH_MAX_ATTEMPTS = 5;
const pushDelayMs = (attempts) => [1, 5, 30, 120][Math.min(attempts - 1, 3)] * 60 * 1000;
const TOKEN = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/;

/** The generic message for one device token (no personal or attendance data). */
export function genericPushMessage(token, category, language = DEFAULT_LANGUAGE) {
  const texts = PUSH_TEXTS[language];
  return {
    to: token,
    title: texts.title,
    body: category === 'ANNOUNCEMENT' ? texts.announcement : texts.attendance,
    sound: 'default',
    priority: 'high',
    channelId: 'default',
    data: { kind: 'notification' },
  };
}

/** Registers the Staff app's push token for this session (replacing an earlier token of the session or another session's copy of this token). */
export async function registerDevice({ userId, sessionId }, body) {
  const keys = Object.keys(body);
  if (keys.some((k) => !['token', 'platform'].includes(k))) throw badRequest('Send only token and platform.');
  if (typeof body.token !== 'string' || !TOKEN.test(body.token)) throw badRequest('Check the highlighted fields.', { token: 'This is not an Expo push token.' });
  if (!['android', 'ios'].includes(body.platform)) throw badRequest('Check the highlighted fields.', { platform: 'Choose android or ios.' });
  const prisma = getPrisma();
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

/** POSTs messages to the Expo push service → per-message tickets ({ status: 'ok' } | { status: 'error', details }). */
export async function expoSend(messages) {
  const headers = { accept: 'application/json', 'content-type': 'application/json' };
  if (env.expoAccessToken) headers.authorization = `Bearer ${env.expoAccessToken}`;
  const response = await fetch(env.expoPushUrl, { method: 'POST', headers, body: JSON.stringify(messages), signal: AbortSignal.timeout(10_000) });
  if (response.status === 429 || response.status >= 500) throw Object.assign(new Error(`Push service answered ${response.status}.`), { retryable: true });
  const data = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(data?.data)) throw Object.assign(new Error(`Push service refused the request (${response.status}).`), { retryable: response.ok });
  return data.data;
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

/**
 * Sends due push messages (oldest first). A message is claimed (lease) before sending, so parallel
 * runs never send it twice. → { sent, skipped, retry, failed }.
 */
export async function sendPendingPush({ now = new Date(), limit = 500, send = expoSend, stop = () => false } = {}) {
  const client = getPrisma();
  const counts = { sent: 0, skipped: 0, retry: 0, failed: 0 };
  const settings = await platformNotificationSettings(client);
  while (!stop() && counts.sent + counts.skipped + counts.retry + counts.failed < limit) {
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
    const ids = claimed.map((m) => m.id);
    const messages = await client.pushMessage.findMany({
      where: { id: { in: ids } },
      include: {
        user: {
          select: {
            status: true,
            notificationPreference: { select: { pushEnabled: true } },
            pushDevices: { where: { session: { expiresAt: { gt: now } } }, select: { id: true, token: true } },
          },
        },
      },
    });
    const live = await liveSources(client, messages, now);
    const skip = [];
    const outgoing = []; // { message, device }
    for (const m of messages) {
      const devices = m.user.pushDevices;
      if (!settings.pushEnabled || m.user.status !== 'ACTIVE' || m.user.notificationPreference?.pushEnabled === false || !live.has(m.sourceKey) || !devices.length) {
        skip.push(m.id);
      } else {
        for (const device of devices) outgoing.push({ message: m, device });
      }
    }
    if (skip.length) {
      await client.pushMessage.updateMany({ where: { id: { in: skip } }, data: { status: 'SKIPPED', lastError: null } });
      counts.skipped += skip.length;
    }
    if (!outgoing.length) continue;

    let tickets;
    try {
      tickets = [];
      for (let i = 0; i < outgoing.length; i += EXPO_BATCH) {
        const part = outgoing.slice(i, i + EXPO_BATCH);
        tickets.push(...(await send(part.map(({ message, device }) => genericPushMessage(device.token, message.category)))));
      }
    } catch (error) {
      // The whole batch: retry later (or give up after the last attempt).
      for (const m of new Set(outgoing.map((o) => o.message))) {
        const failed = !error.retryable || m.attempts >= PUSH_MAX_ATTEMPTS;
        await client.pushMessage.update({
          where: { id: m.id },
          data: { status: failed ? 'FAILED' : 'PENDING', nextAttemptAt: new Date(now.getTime() + pushDelayMs(m.attempts)), lastError: String(error.message).slice(0, 300) },
        });
        counts[failed ? 'failed' : 'retry'] += 1;
      }
      continue;
    }

    const delivered = new Set();
    const deadDevices = [];
    const errors = new Map();
    outgoing.forEach(({ message, device }, i) => {
      const ticket = tickets[i];
      if (ticket?.status === 'ok') delivered.add(message.id);
      else {
        if (ticket?.details?.error === 'DeviceNotRegistered') deadDevices.push(device.id);
        errors.set(message.id, ticket?.message ?? 'Not delivered.');
      }
    });
    if (deadDevices.length) await client.pushDevice.deleteMany({ where: { id: { in: deadDevices } } });
    for (const m of new Set(outgoing.map((o) => o.message))) {
      if (delivered.has(m.id)) {
        await client.pushMessage.update({ where: { id: m.id }, data: { status: 'SENT', sentAt: now, lastError: null } });
        counts.sent += 1;
      } else {
        await client.pushMessage.update({ where: { id: m.id }, data: { status: 'FAILED', lastError: String(errors.get(m.id)).slice(0, 300) } });
        counts.failed += 1;
      }
    }
  }
  return counts;
}

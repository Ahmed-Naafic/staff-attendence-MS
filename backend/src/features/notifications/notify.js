import { getPrisma } from '../../config/prisma.js';
import { platformNotificationSettings } from './notificationSettings.service.js';
import { categoryOf, DEFAULT_LANGUAGE, RETENTION_MS, wantsCategory } from './notificationTypes.js';

/*
 * Creates personal notifications (one row per recipient, N19) and queues their push messages.
 *
 * items: [{ type, recipientId, schoolId?, branchId?, subjectType?, subjectId?, params, dedupeKey }]
 * - A recipient who turned the optional category off gets nothing (N12); mandatory categories always.
 * - Rows are inserted with skipDuplicates on the dedupe key: processing the same business event
 *   again creates nothing (N20).
 * - Suspended recipients still get the in-app notification (kept for after reactivation, N15) but
 *   never a push; push is queued only for active STAFF (the Staff app) who have not turned it off,
 *   while the platform allows push (N2 phase 3).
 * Returns the created rows ({ id, recipientId, category }).
 */
export async function createNotifications(items, { client = getPrisma(), now = new Date() } = {}) {
  if (!items.length) return [];
  const recipientIds = [...new Set(items.map((i) => i.recipientId))];
  const users = new Map(
    (
      await client.user.findMany({
        where: { id: { in: recipientIds } },
        select: { id: true, role: true, status: true, notificationPreference: { select: { disabledCategories: true, pushEnabled: true } } },
      })
    ).map((u) => [u.id, u]),
  );
  const expiresAt = new Date(now.getTime() + RETENTION_MS);
  const rows = items
    .filter((i) => {
      const user = users.get(i.recipientId);
      return user && wantsCategory(categoryOf(i.type), user.notificationPreference?.disabledCategories);
    })
    .map((i) => ({
      type: i.type,
      category: categoryOf(i.type),
      language: DEFAULT_LANGUAGE,
      recipientId: i.recipientId,
      schoolId: i.schoolId ?? null,
      branchId: i.branchId ?? null,
      subjectType: i.subjectType ?? null,
      subjectId: i.subjectId ?? null,
      params: i.params ?? {},
      dedupeKey: i.dedupeKey,
      createdAt: now,
      expiresAt,
    }));
  if (!rows.length) return [];
  const created = await client.notification.createManyAndReturn({ data: rows, skipDuplicates: true, select: { id: true, recipientId: true, category: true } });

  if (created.length && (await platformNotificationSettings(client)).pushEnabled) {
    const push = created
      .filter((n) => {
        const user = users.get(n.recipientId);
        return user.role === 'STAFF' && user.status === 'ACTIVE' && user.notificationPreference?.pushEnabled !== false;
      })
      .map((n) => ({ userId: n.recipientId, sourceKey: `notification:${n.id}`, category: n.category, createdAt: now, nextAttemptAt: now }));
    if (push.length) await client.pushMessage.createMany({ data: push, skipDuplicates: true });
  }
  return created;
}

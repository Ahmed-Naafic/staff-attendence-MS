import { Prisma } from '@prisma/client';
import { forbidden, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { pageWindow } from '../../common/listQuery.js';
import { getPrisma } from '../../config/prisma.js';
import { settleIfDue } from '../staff/transfers.service.js';
import { render } from './templates.js';

/*
 * The signed-in user's notification centre (Owner, Manager, Staff; N4, N10, N15, N18, N19).
 *
 * What a user sees is decided here, on the server, from the account — never from the request:
 *   personal notifications addressed to them that have not expired, and for a Manager only those of
 *   their current branch (or not tied to a branch): after a transfer the previous branch's
 *   notifications disappear at once, although they are not deleted (N10);
 *   announcements that are published, visible now (publishAt ≤ now < expiresAt), addressed to their
 *   role and to their school or all schools (N17, N19).
 * Read state is per user (Notification.readAt; AnnouncementRead). Users cannot delete history (N18).
 */

/** The viewer from the session and the database (re-read on every request): { userId, role, schoolId, branchId }. */
export async function notificationViewer(user) {
  const prisma = getPrisma();
  await settleIfDue();
  if (user.role === 'OWNER') {
    const school = await prisma.school.findUnique({ where: { ownerId: user.id }, select: { id: true } });
    if (!school) throw forbidden('No school is linked to your account.');
    return { userId: user.id, role: 'OWNER', schoolId: school.id, branchId: null };
  }
  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { branchId: true, branch: { select: { schoolId: true } } } });
  if (!row?.branchId) throw forbidden('No branch is assigned to your account.');
  return { userId: user.id, role: user.role, schoolId: row.branch.schoolId, branchId: row.branchId };
}

/** SQL condition: personal notifications this viewer may see now. */
const personalVisible = (v, now) => Prisma.sql`
  n."recipientId" = ${v.userId} AND n."expiresAt" > ${now}
  ${v.role === 'MANAGER' ? Prisma.sql`AND (n."branchId" IS NULL OR n."branchId" = ${v.branchId})` : Prisma.empty}`;

/** SQL condition: announcements this viewer may see now. */
const announcementVisible = (v, now) => Prisma.sql`
  a."status" = 'PUBLISHED' AND a."publishAt" <= ${now} AND a."expiresAt" > ${now}
  AND ${v.role}::"Role" = ANY (a."roles")
  AND (a."allSchools" OR EXISTS (SELECT 1 FROM "AnnouncementSchool" s WHERE s."announcementId" = a."id" AND s."schoolId" = ${v.schoolId}))`;

/** Prisma `where` for one announcement this viewer may see. */
const announcementWhere = (v, now, id) => ({
  id,
  status: 'PUBLISHED',
  publishAt: { lte: now },
  expiresAt: { gt: now },
  roles: { has: v.role },
  OR: [{ allSchools: true }, { schools: { some: { schoolId: v.schoolId } } }],
});
const personalWhere = (v, now, id) => ({
  ...(id && { id }),
  recipientId: v.userId,
  expiresAt: { gt: now },
  ...(v.role === 'MANAGER' && { OR: [{ branchId: null }, { branchId: v.branchId }] }),
});

/** Where opening a notification leads in the apps (the target page checks its own access). */
function linkFor(n) {
  const p = n.params ?? {};
  if (n.type === 'LATE_CHECK_IN') return { kind: 'attendanceRecords', date: p.date };
  if (n.type === 'BRANCH_DIGEST' || n.type === 'SCHOOL_DIGEST') return { kind: 'digest' };
  if (n.type === 'BRANCH_NO_SCHEDULE') return { kind: 'schedule' };
  if (n.type === 'BRANCH_NO_MANAGER') return { kind: 'managers' };
  return null;
}

export function toItem(n) {
  const { title, body } = render(n.type, n.params, n.language);
  return {
    source: 'notification',
    id: n.id,
    type: n.type,
    category: n.category,
    language: n.language,
    title,
    body,
    createdAt: n.createdAt.toISOString(),
    readAt: n.readAt?.toISOString() ?? null,
    expiresAt: n.expiresAt.toISOString(),
    link: linkFor(n),
    // Digests carry their counts for the digest view (counts only).
    data: n.category === 'DIGEST' ? n.params : null,
  };
}

export function toAnnouncementItem(a, readAt) {
  return {
    source: 'announcement',
    id: a.id,
    type: 'ANNOUNCEMENT',
    kind: a.kind,
    category: 'ANNOUNCEMENT',
    language: a.language,
    title: a.title,
    body: a.body,
    imageUrl: a.imageUrl,
    linkUrl: a.linkUrl,
    createdAt: a.publishAt.toISOString(),
    readAt: readAt?.toISOString() ?? null,
    expiresAt: a.expiresAt.toISOString(),
    link: null,
    data: null,
  };
}

/**
 * One page of the viewer's notifications and announcements, newest first.
 * filters: { unread?: boolean, category?: string, page, pageSize }.
 */
export async function listNotifications(viewer, { unread = false, category, page = 1, pageSize = 20 } = {}, now = new Date()) {
  const prisma = getPrisma();
  const wantPersonal = category !== 'ANNOUNCEMENT';
  const wantAnnouncements = !category || category === 'ANNOUNCEMENT';
  const parts = [];
  if (wantPersonal) {
    parts.push(Prisma.sql`
      SELECT 'notification' AS "source", n."id", n."createdAt" AS "at" FROM "Notification" n
      WHERE ${personalVisible(viewer, now)}
      ${category ? Prisma.sql`AND n."category" = ${category}::"NotificationCategory"` : Prisma.empty}
      ${unread ? Prisma.sql`AND n."readAt" IS NULL` : Prisma.empty}`);
  }
  if (wantAnnouncements) {
    parts.push(Prisma.sql`
      SELECT 'announcement' AS "source", a."id", a."publishAt" AS "at" FROM "Announcement" a
      WHERE ${announcementVisible(viewer, now)}
      ${unread ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM "AnnouncementRead" r WHERE r."announcementId" = a."id" AND r."userId" = ${viewer.userId})` : Prisma.empty}`);
  }
  const union = Prisma.join(parts, ' UNION ALL ');
  const [{ total }] = await prisma.$queryRaw`SELECT COUNT(*)::int AS "total" FROM (${union}) x`;
  const { skip, take, meta } = pageWindow(total, page, pageSize);
  const rows = await prisma.$queryRaw`SELECT * FROM (${union}) x ORDER BY "at" DESC, "id" DESC LIMIT ${take} OFFSET ${skip}`;

  const nIds = rows.filter((r) => r.source === 'notification').map((r) => r.id);
  const aIds = rows.filter((r) => r.source === 'announcement').map((r) => r.id);
  const [notifications, announcements, reads] = await Promise.all([
    nIds.length ? prisma.notification.findMany({ where: { id: { in: nIds } } }) : [],
    aIds.length ? prisma.announcement.findMany({ where: { id: { in: aIds } } }) : [],
    aIds.length ? prisma.announcementRead.findMany({ where: { userId: viewer.userId, announcementId: { in: aIds } } }) : [],
  ]);
  const nMap = new Map(notifications.map((n) => [n.id, n]));
  const aMap = new Map(announcements.map((a) => [a.id, a]));
  const readMap = new Map(reads.map((r) => [r.announcementId, r.readAt]));
  const items = rows
    .map((r) => (r.source === 'notification' ? nMap.get(r.id) && toItem(nMap.get(r.id)) : aMap.get(r.id) && toAnnouncementItem(aMap.get(r.id), readMap.get(r.id))))
    .filter(Boolean);
  return { items, ...meta, unreadCount: await unreadCount(viewer, now) };
}

/** Unread notifications and announcements the viewer can see. */
export async function unreadCount(viewer, now = new Date()) {
  const [{ count }] = await getPrisma().$queryRaw`
    SELECT (
      (SELECT COUNT(*) FROM "Notification" n WHERE ${personalVisible(viewer, now)} AND n."readAt" IS NULL)
      + (SELECT COUNT(*) FROM "Announcement" a WHERE ${announcementVisible(viewer, now)}
          AND NOT EXISTS (SELECT 1 FROM "AnnouncementRead" r WHERE r."announcementId" = a."id" AND r."userId" = ${viewer.userId}))
    )::int AS "count"`;
  return count;
}

const SOURCES = ['notification', 'announcement'];

/** One item the viewer may see; anything else (another user's, another branch's, expired) is 404. */
export async function getNotification(viewer, source, id, now = new Date()) {
  if (!SOURCES.includes(source) || !isUuid(id)) throw notFound('Notification not found.');
  const prisma = getPrisma();
  if (source === 'notification') {
    const n = await prisma.notification.findFirst({ where: personalWhere(viewer, now, id) });
    if (!n) throw notFound('Notification not found.');
    return toItem(n);
  }
  const a = await prisma.announcement.findFirst({ where: announcementWhere(viewer, now, id) });
  if (!a) throw notFound('Notification not found.');
  const read = await prisma.announcementRead.findUnique({ where: { announcementId_userId: { announcementId: id, userId: viewer.userId } } });
  return toAnnouncementItem(a, read?.readAt);
}

/** Marks one visible item read (idempotent). */
export async function markRead(viewer, source, id, now = new Date()) {
  const item = await getNotification(viewer, source, id, now);
  const prisma = getPrisma();
  if (source === 'notification') await prisma.notification.updateMany({ where: { id, readAt: null }, data: { readAt: now } });
  else await prisma.announcementRead.createMany({ data: [{ announcementId: id, userId: viewer.userId, readAt: now }], skipDuplicates: true });
  return { ...item, readAt: item.readAt ?? now.toISOString() };
}

/** Marks every visible unread item read. */
export async function markAllRead(viewer, now = new Date()) {
  const prisma = getPrisma();
  await prisma.$transaction([
    prisma.$executeRaw`UPDATE "Notification" n SET "readAt" = ${now} WHERE ${personalVisible(viewer, now)} AND n."readAt" IS NULL`,
    prisma.$executeRaw`
      INSERT INTO "AnnouncementRead" ("announcementId", "userId", "readAt")
      SELECT a."id", ${viewer.userId}, ${now} FROM "Announcement" a WHERE ${announcementVisible(viewer, now)}
      ON CONFLICT DO NOTHING`,
  ]);
  return { unreadCount: await unreadCount(viewer, now) };
}

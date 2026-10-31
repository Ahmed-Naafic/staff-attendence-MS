import { badRequest, conflict, notFound } from '../../common/httpError.js';
import { pageWindow } from '../../common/listQuery.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { ANNOUNCEMENT_KINDS, ANNOUNCEMENT_ROLES, DEFAULT_LANGUAGE, RETENTION_DAYS, RETENTION_MS } from './notificationTypes.js';
import { platformNotificationSettings } from './notificationSettings.service.js';

/*
 * Platform announcements (Super Admin, N17). An announcement is stored once with its audience —
 * roles (Owners, Managers, Staff) and all schools or chosen schools — and each user's notification
 * centre resolves it from their current role and school (N19); no copy per recipient is made.
 *
 * Lifecycle: DRAFT → PUBLISHED (now, or scheduled for a later publishAt) → WITHDRAWN. A published
 * announcement is visible from publishAt until expiresAt (at most 90 days later, N18). Withdrawn
 * announcements are never shown again and cannot be edited. Texts are written by the Super Admin in
 * Somali (N24; language 'so'). Every change records an audit event with old and new values (N22).
 */

const TITLE_MAX = 120;
const BODY_MAX = 2000;
const URL_MAX = 2048;
const SCHOOLS_MAX = 500;
const MAX_AHEAD_MS = 365 * 24 * 60 * 60 * 1000;
const PAST_TOLERANCE_MS = 60 * 1000;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
export const ANNOUNCEMENT_FILTERS = ['draft', 'scheduled', 'published', 'expired', 'withdrawn'];

const KIND_LABELS = { FEATURE: 'New feature', SEASONAL: 'Seasonal message', GUIDE: 'Guide or tutorial', UPDATE: 'Platform update', MAINTENANCE: 'Maintenance' };
const ROLE_TEXT = { OWNER: 'School Owners', MANAGER: 'Managers', STAFF: 'Staff' };

/** The state shown to the Super Admin. */
export function announcementState(a, now = new Date()) {
  if (a.status === 'WITHDRAWN') return 'withdrawn';
  if (a.status === 'DRAFT') return 'draft';
  if (a.expiresAt <= now) return 'expired';
  return a.publishAt > now ? 'scheduled' : 'published';
}

function httpsUrl(value, field, errors) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > URL_MAX) {
    errors[field] = `Enter an https:// address of at most ${URL_MAX} characters.`;
    return undefined;
  }
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !url.hostname.includes('.') || url.username || url.password) throw new Error();
    return url.toString();
  } catch {
    errors[field] = 'Enter a full https:// address, such as https://example.com/guide.';
    return undefined;
  }
}

function text(value, field, max, errors, { multiline = false } = {}) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    errors[field] = 'Enter text.';
    return undefined;
  }
  const trimmed = value.replace(/\r\n?/g, '\n').trim();
  if (!trimmed) errors[field] = 'This field is required.';
  else if ([...trimmed].length > max) errors[field] = `At most ${max} characters.`;
  else if (CONTROL.test(trimmed) || (!multiline && trimmed.includes('\n'))) errors[field] = multiline ? 'Remove tabs and other control characters.' : 'Use a single line.';
  return trimmed;
}

function date(value, field, errors) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const d = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) {
    errors[field] = 'Enter a date and time.';
    return undefined;
  }
  return d;
}

const FIELDS = ['kind', 'title', 'body', 'imageUrl', 'linkUrl', 'roles', 'allSchools', 'schoolIds', 'expiresAt'];

/** Validates the editable fields (all required on create). → values ready for the database. */
export function readAnnouncement(body, { create }) {
  const allowed = create ? [...FIELDS, 'action', 'publishAt'] : FIELDS;
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length) throw badRequest('Check the highlighted fields.', Object.fromEntries(unknown.map((k) => [k, 'This field cannot be set here.'])));
  const errors = {};
  const v = {};
  if (create || body.kind !== undefined) {
    if (!ANNOUNCEMENT_KINDS.includes(body.kind)) errors.kind = 'Choose the announcement type.';
    else v.kind = body.kind;
  }
  for (const [field, max, multiline] of [['title', TITLE_MAX, false], ['body', BODY_MAX, true]]) {
    if (create && body[field] === undefined) errors[field] = 'This field is required.';
    const value = text(body[field], field, max, errors, { multiline });
    if (value !== undefined && !errors[field]) v[field] = value;
  }
  for (const field of ['imageUrl', 'linkUrl']) {
    const value = httpsUrl(body[field], field, errors);
    if (value !== undefined) v[field] = value;
  }
  if (create || body.roles !== undefined) {
    const roles = body.roles;
    if (!Array.isArray(roles) || !roles.length || roles.some((r) => !ANNOUNCEMENT_ROLES.includes(r))) errors.roles = 'Choose at least one audience: School Owners, Managers or Staff.';
    else v.roles = ANNOUNCEMENT_ROLES.filter((r) => roles.includes(r));
  }
  if (create || body.allSchools !== undefined || body.schoolIds !== undefined) {
    const all = body.allSchools;
    const ids = body.schoolIds ?? [];
    if (typeof all !== 'boolean') errors.allSchools = 'Choose all schools or selected schools.';
    else if (!Array.isArray(ids) || ids.some((id) => !isUuid(id))) errors.schoolIds = 'Choose schools from the list.';
    else if (!all && !ids.length) errors.schoolIds = 'Choose at least one school.';
    else if (ids.length > SCHOOLS_MAX) errors.schoolIds = `Choose at most ${SCHOOLS_MAX} schools, or all schools.`;
    else {
      v.allSchools = all;
      v.schoolIds = all ? [] : [...new Set(ids)];
    }
  }
  if (create && body.expiresAt === undefined) errors.expiresAt = 'Choose when the announcement expires.';
  const expiresAt = date(body.expiresAt, 'expiresAt', errors);
  if (expiresAt) v.expiresAt = expiresAt;
  else if (expiresAt === null) errors.expiresAt = 'Choose when the announcement expires.';
  if (create) {
    if (!['draft', 'publish', 'schedule'].includes(body.action)) errors.action = 'Choose to save a draft, publish now or schedule.';
    v.action = body.action;
    const publishAt = date(body.publishAt, 'publishAt', errors);
    if (body.action === 'schedule' && !publishAt && !errors.publishAt) errors.publishAt = 'Choose when to publish.';
    if (publishAt) v.publishAt = publishAt;
  }
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return v;
}

/** Checks publish and expiry times together: publish not in the past (1 minute tolerance), at most a year ahead; expiry after it, at most 90 days later. */
function checkTimes({ publishAt, expiresAt }, now) {
  const errors = {};
  const start = publishAt ?? now;
  if (publishAt && publishAt.getTime() < now.getTime() - PAST_TOLERANCE_MS) errors.publishAt = 'The publish time cannot be in the past.';
  else if (publishAt && publishAt.getTime() > now.getTime() + MAX_AHEAD_MS) errors.publishAt = 'Schedule at most one year ahead.';
  if (expiresAt <= start) errors.expiresAt = 'The expiry must be after the publish time.';
  else if (expiresAt.getTime() - start.getTime() > RETENTION_MS) errors.expiresAt = `An announcement can be shown for at most ${RETENTION_DAYS} days.`;
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
}

function checkExpiry(start, expiresAt) {
  if (expiresAt <= start) throw badRequest('Check the highlighted fields.', { expiresAt: 'The expiry must be after the publish time.' });
  if (expiresAt.getTime() - start.getTime() > RETENTION_MS) throw badRequest('Check the highlighted fields.', { expiresAt: `An announcement can be shown for at most ${RETENTION_DAYS} days.` });
}

async function checkSchools(client, ids) {
  if (!ids.length) return;
  const found = await client.school.count({ where: { id: { in: ids } } });
  if (found !== ids.length) throw badRequest('Check the highlighted fields.', { schoolIds: 'One of the chosen schools does not exist.' });
}

const include = { schools: { include: { school: { select: { id: true, name: true, code: true } } }, orderBy: { school: { name: 'asc' } } } };

function toAnnouncement(a, now = new Date()) {
  return {
    id: a.id,
    kind: a.kind,
    title: a.title,
    body: a.body,
    language: a.language,
    imageUrl: a.imageUrl,
    linkUrl: a.linkUrl,
    roles: a.roles,
    allSchools: a.allSchools,
    schools: a.schools.map((s) => s.school),
    status: announcementState(a, now),
    publishAt: a.publishAt?.toISOString() ?? null,
    expiresAt: a.expiresAt.toISOString(),
    publishedAt: a.publishedAt?.toISOString() ?? null,
    withdrawnAt: a.withdrawnAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });
const target = (a) => ({ type: 'announcement', id: a.id, name: a.title });
const audienceText = (roles, allSchools, schools) => `${roles.map((r) => ROLE_TEXT[r]).join(', ')} — ${allSchools ? 'all schools' : `${schools.length} school${schools.length === 1 ? '' : 's'}`}`;
const when = (d) => (d ? d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'Not set');

/** Audit for publishing or scheduling. */
const publishAudit = (tx, a, user, req, now) =>
  recordAuditEvent({
    client: tx,
    action: a.publishAt > now ? AUDIT_ACTIONS.ANNOUNCEMENT_SCHEDULED : AUDIT_ACTIONS.ANNOUNCEMENT_PUBLISHED,
    actor: actorOf(user),
    target: target(a),
    description: a.publishAt > now ? `Announcement scheduled for ${when(a.publishAt)}, until ${when(a.expiresAt)}.` : `Announcement published until ${when(a.expiresAt)}.`,
    change: { fields: [{ field: 'Status', from: 'Draft', to: a.publishAt > now ? `Scheduled (${when(a.publishAt)})` : 'Published' }] },
    req,
  });

export async function listAnnouncements({ status, q, page = 1, pageSize = 10 } = {}, now = new Date()) {
  const where = {
    ...(q && { OR: [{ title: { contains: q, mode: 'insensitive' } }, { body: { contains: q, mode: 'insensitive' } }] }),
    ...(status === 'draft' && { status: 'DRAFT' }),
    ...(status === 'withdrawn' && { status: 'WITHDRAWN' }),
    ...(status === 'scheduled' && { status: 'PUBLISHED', publishAt: { gt: now }, expiresAt: { gt: now } }),
    ...(status === 'published' && { status: 'PUBLISHED', publishAt: { lte: now }, expiresAt: { gt: now } }),
    ...(status === 'expired' && { status: 'PUBLISHED', expiresAt: { lte: now } }),
  };
  const prisma = getPrisma();
  const total = await prisma.announcement.count({ where });
  const { skip, take, meta } = pageWindow(total, page, pageSize);
  const rows = await prisma.announcement.findMany({ where, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take });
  return { items: rows.map((a) => toAnnouncement(a, now)), ...meta };
}

async function findOrFail(client, id) {
  const a = isUuid(id) ? await client.announcement.findUnique({ where: { id }, include }) : null;
  if (!a) throw notFound('Announcement not found.');
  return a;
}

export async function getAnnouncement(id) {
  return toAnnouncement(await findOrFail(getPrisma(), id));
}

/** Creates an announcement: a draft, published now, or scheduled. Audited (and published/scheduled when so). */
export async function createAnnouncement(body, user, req, now = new Date()) {
  const { action, publishAt: requested, schoolIds, ...values } = readAnnouncement(body, { create: true });
  const publishAt = action === 'draft' ? null : action === 'publish' ? now : requested;
  checkTimes({ publishAt: action === 'schedule' ? publishAt : null, expiresAt: values.expiresAt }, now);
  const id = await getPrisma().$transaction(async (tx) => {
    await checkSchools(tx, schoolIds);
    const a = await tx.announcement.create({
      data: {
        ...values,
        language: DEFAULT_LANGUAGE,
        status: action === 'draft' ? 'DRAFT' : 'PUBLISHED',
        publishAt,
        publishedAt: action === 'draft' ? null : now,
        createdById: user.id,
        updatedById: user.id,
        schools: { create: schoolIds.map((schoolId) => ({ schoolId })) },
      },
      include,
    });
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.ANNOUNCEMENT_CREATED,
      actor: actorOf(user),
      target: target(a),
      description: `Announcement created (${KIND_LABELS[a.kind]}) for ${audienceText(a.roles, a.allSchools, schoolIds)}.`,
      change: {
        fields: [
          { field: 'Type', from: null, to: KIND_LABELS[a.kind] },
          { field: 'Title', from: null, to: a.title },
          { field: 'Audience', from: null, to: audienceText(a.roles, a.allSchools, schoolIds) },
          { field: 'Expires', from: null, to: when(a.expiresAt) },
        ],
      },
      req,
    });
    if (action !== 'draft') await publishAudit(tx, a, user, req, now);
    return a.id;
  });
  if (action === 'publish') await queueAnnouncementPush({ now }).catch(() => {});
  return getAnnouncement(id);
}

/** Edits a draft or published (also scheduled or expired) announcement; withdrawn ones cannot change. */
export async function updateAnnouncement(id, body, user, req, now = new Date()) {
  const { schoolIds, ...values } = readAnnouncement(body, { create: false });
  await getPrisma().$transaction(async (tx) => {
    const current = await findOrFail(tx, id);
    if (current.status === 'WITHDRAWN') throw conflict('ANNOUNCEMENT_WITHDRAWN', 'A withdrawn announcement cannot be edited.');
    const next = { ...current, ...values };
    // The expiry counts from the publish time (from now for a draft): after it, at most 90 days later.
    if (values.expiresAt) checkExpiry(current.status === 'DRAFT' ? now : current.publishAt, values.expiresAt);
    if (schoolIds) await checkSchools(tx, schoolIds);
    const fields = [];
    for (const [key, label, fmt] of [
      ['kind', 'Type', (x) => KIND_LABELS[x]],
      ['title', 'Title', (x) => x],
      ['body', 'Message', (x) => x],
      ['imageUrl', 'Image', (x) => x ?? 'None'],
      ['linkUrl', 'Guide link', (x) => x ?? 'None'],
      ['expiresAt', 'Expires', when],
    ]) {
      if (values[key] !== undefined && String(values[key]) !== String(current[key])) fields.push({ field: label, from: fmt(current[key]), to: fmt(values[key]) });
    }
    const oldSchools = current.schools.map((s) => s.school.id).sort();
    const newSchools = schoolIds ? [...schoolIds].sort() : oldSchools;
    const audienceChanged =
      (values.roles && values.roles.join() !== current.roles.join()) || (values.allSchools !== undefined && values.allSchools !== current.allSchools) || newSchools.join() !== oldSchools.join();
    if (audienceChanged) fields.push({ field: 'Audience', from: audienceText(current.roles, current.allSchools, oldSchools), to: audienceText(next.roles, next.allSchools, newSchools) });
    if (!fields.length) return;
    await tx.announcement.update({
      where: { id },
      data: {
        ...values,
        updatedById: user.id,
        ...(schoolIds && { schools: { deleteMany: {}, create: schoolIds.map((schoolId) => ({ schoolId })) } }),
      },
    });
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.ANNOUNCEMENT_UPDATED,
      actor: actorOf(user),
      target: target(next),
      description: `Announcement edited: ${fields.map((f) => f.field).join(', ')}.`,
      change: { fields },
      req,
    });
  });
  return getAnnouncement(id);
}

/** Publishes a draft now, or schedules it (publishAt). → 409 when it is not a draft. */
export async function publishAnnouncement(id, body, user, req, now = new Date()) {
  const unknown = Object.keys(body).filter((k) => k !== 'publishAt');
  if (unknown.length) throw badRequest('Send only publishAt.');
  const errors = {};
  const publishAt = date(body.publishAt, 'publishAt', errors) ?? now;
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  await getPrisma().$transaction(async (tx) => {
    const current = await findOrFail(tx, id);
    if (current.status !== 'DRAFT') throw conflict('INVALID_STATUS', 'Only a draft can be published or scheduled.');
    checkTimes({ publishAt: body.publishAt ? publishAt : null, expiresAt: current.expiresAt }, now);
    const { count } = await tx.announcement.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'PUBLISHED', publishAt, publishedAt: now, updatedById: user.id } });
    if (!count) throw conflict('INVALID_STATUS', 'Only a draft can be published or scheduled.');
    await publishAudit(tx, { ...current, publishAt }, user, req, now);
  });
  if (publishAt <= now) await queueAnnouncementPush({ now }).catch(() => {});
  return getAnnouncement(id);
}

/** Withdraws a draft, scheduled, published or expired announcement: it is never shown again. */
export async function withdrawAnnouncement(id, user, req, now = new Date()) {
  await getPrisma().$transaction(async (tx) => {
    const current = await findOrFail(tx, id);
    const state = announcementState(current, now);
    const { count } = await tx.announcement.updateMany({ where: { id, status: { not: 'WITHDRAWN' } }, data: { status: 'WITHDRAWN', withdrawnAt: now, updatedById: user.id } });
    if (!count) throw conflict('INVALID_STATUS', 'This announcement is already withdrawn.');
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.ANNOUNCEMENT_WITHDRAWN,
      actor: actorOf(user),
      target: target(current),
      description: 'Announcement withdrawn; it is no longer shown.',
      change: { field: 'Status', from: state[0].toUpperCase() + state.slice(1), to: 'Withdrawn' },
      req,
    });
  });
  return getAnnouncement(id);
}

/**
 * Queues one push per active staff member with a registered device in the audience of each
 * announcement that has become visible (once per announcement). Owners and Managers have no app,
 * so they see announcements in the web notification centre only.
 */
export async function queueAnnouncementPush({ now = new Date() } = {}) {
  const prisma = getPrisma();
  const due = await prisma.announcement.findMany({
    where: { status: 'PUBLISHED', publishAt: { lte: now }, expiresAt: { gt: now }, pushQueuedAt: null },
    select: { id: true, roles: true, allSchools: true },
    take: 50,
  });
  if (!due.length) return 0;
  const pushEnabled = (await platformNotificationSettings(prisma)).pushEnabled;
  let queued = 0;
  for (const a of due) {
    const claimed = await prisma.announcement.updateMany({ where: { id: a.id, pushQueuedAt: null }, data: { pushQueuedAt: now } });
    if (!claimed.count || !pushEnabled || !a.roles.includes('STAFF')) continue;
    queued += await prisma.$executeRaw`
      INSERT INTO "PushMessage" ("id", "userId", "sourceKey", "category", "status", "attempts", "nextAttemptAt", "createdAt")
      SELECT gen_random_uuid()::text, u."id", ${`announcement:${a.id}`}, 'ANNOUNCEMENT', 'PENDING', 0, ${now}, ${now}
      FROM "User" u JOIN "Branch" b ON b."id" = u."branchId"
      LEFT JOIN "NotificationPreference" p ON p."userId" = u."id"
      WHERE u."role" = 'STAFF' AND u."status" = 'ACTIVE' AND COALESCE(p."pushEnabled", true)
        AND EXISTS (SELECT 1 FROM "PushDevice" d WHERE d."userId" = u."id")
        AND (${a.allSchools} OR b."schoolId" IN (SELECT s."schoolId" FROM "AnnouncementSchool" s WHERE s."announcementId" = ${a.id}))
      ON CONFLICT ("userId", "sourceKey") DO NOTHING`;
  }
  return queued;
}

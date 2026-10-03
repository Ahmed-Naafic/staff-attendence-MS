import { notFound } from '../../common/httpError.js';
import { pageWindow } from '../../common/listQuery.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { ACTION_LABELS, ROLE_LABELS, SECURITY_ACTIONS } from './auditActions.js';
import { describeUserAgent } from './userAgent.js';

const DAY = 24 * 60 * 60 * 1000;

const eventSelect = {
  id: true,
  occurredAt: true,
  action: true,
  result: true,
  actorId: true,
  actorName: true,
  actorRole: true,
  targetType: true,
  targetId: true,
  targetName: true,
  description: true,
  change: true,
  ipAddress: true,
  userAgent: true,
  school: { select: { id: true, name: true, code: true, location: true } },
};

/** The event shape the web app uses. The raw user agent is reduced to browser and device. */
export function toEvent(e) {
  const target = { type: e.targetType, id: e.targetId, name: e.targetName ?? '' };
  if (e.targetType === 'school' && e.school) Object.assign(target, { code: e.school.code, location: e.school.location });
  if (e.targetType === 'owner' && e.school) target.schoolName = e.school.name;
  return {
    id: e.id,
    occurredAt: e.occurredAt.toISOString(),
    action: e.action,
    result: e.result === 'FAILURE' ? 'failure' : 'success',
    actor: { id: e.actorId, name: e.actorName ?? 'Unknown account', role: e.actorRole },
    target,
    school: e.school ? { id: e.school.id, name: e.school.name } : null,
    description: e.description,
    change: e.change ?? null,
    context: { ipAddress: e.ipAddress ?? '', ...describeUserAgent(e.userAgent) },
  };
}

function whereFor({ q, action, user, school, status, since, until }) {
  const and = [];
  if (q) {
    const needle = q.toLowerCase();
    const contains = { contains: q, mode: 'insensitive' };
    const actions = Object.entries(ACTION_LABELS).filter(([, label]) => label.toLowerCase().includes(needle)).map(([code]) => code);
    const roles = Object.entries(ROLE_LABELS).filter(([, label]) => label.toLowerCase().includes(needle)).map(([code]) => code);
    and.push({
      OR: [
        { actorName: contains },
        { targetName: contains },
        { description: contains },
        { school: { name: contains } },
        ...(actions.length ? [{ action: { in: actions } }] : []),
        ...(roles.length ? [{ actorRole: { in: roles } }] : []),
      ],
    });
  }
  if (action) and.push({ action });
  if (user) and.push({ actorId: user });
  if (school) and.push({ schoolId: school });
  if (status) and.push({ result: status === 'failure' ? 'FAILURE' : 'SUCCESS' });
  if (since) and.push({ occurredAt: { gte: since } });
  if (until) and.push({ occurredAt: { lt: until } });
  return and.length ? { AND: and } : {};
}

/** Summary figures for the whole log (not affected by filters). `dayStart` is the viewer's local midnight. */
async function summarise(dayStart) {
  const prisma = getPrisma();
  const now = Date.now();
  const notSecurity = { action: { notIn: SECURITY_ACTIONS } };
  const [total, lastWeek, today, yesterday, admin, school, owner, security, failed] = await Promise.all([
    prisma.auditEvent.count(),
    prisma.auditEvent.count({ where: { occurredAt: { gte: new Date(now - 7 * DAY) } } }),
    prisma.auditEvent.count({ where: { occurredAt: { gte: dayStart } } }),
    prisma.auditEvent.count({ where: { occurredAt: { gte: new Date(dayStart.getTime() - DAY), lt: dayStart } } }),
    prisma.auditEvent.count({ where: { actorRole: 'SUPER_ADMIN', ...notSecurity } }),
    prisma.auditEvent.count({ where: { targetType: 'school' } }),
    prisma.auditEvent.count({ where: { actorRole: 'OWNER', ...notSecurity } }),
    prisma.auditEvent.count({ where: { action: { in: SECURITY_ACTIONS } } }),
    prisma.auditEvent.count({ where: { action: { in: SECURITY_ACTIONS }, result: 'FAILURE' } }),
  ]);
  return { total, lastWeek, today, yesterday, admin, school, owner, security, failed };
}

/** Audit events, newest first, with filters, pagination, summary and the filter choices. */
export async function listAuditEvents(params) {
  const prisma = getPrisma();
  const where = whereFor(params);
  const [total, summary, actors, schools] = await Promise.all([
    prisma.auditEvent.count({ where }),
    summarise(params.dayStart ?? new Date(new Date().setUTCHours(0, 0, 0, 0))),
    prisma.auditEvent.findMany({ where: { actorId: { not: null } }, distinct: ['actorId'], select: { actorId: true, actorName: true, actor: { select: { name: true } } } }),
    prisma.school.findMany({ where: { auditEvents: { some: {} } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  const { skip, take, meta } = pageWindow(total, params.page, params.pageSize);
  const rows = await prisma.auditEvent.findMany({ where, select: eventSelect, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], skip, take });

  return {
    isDemo: false,
    items: rows.map(toEvent),
    ...meta,
    summary,
    users: actors
      .map((a) => ({ id: a.actorId, name: a.actor?.name ?? a.actorName ?? 'Unknown account' }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    schools,
  };
}

export async function getAuditEvent(id) {
  const event = isUuid(id) ? await getPrisma().auditEvent.findUnique({ where: { id }, select: eventSelect }) : null;
  if (!event) throw notFound('Audit event not found.');
  return toEvent(event);
}

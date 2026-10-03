import { notFound } from '../../common/httpError.js';
import { fromDbStatus, pageWindow, statusSummary, toDbStatus } from '../../common/listQuery.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';

const schoolSelect = {
  id: true,
  code: true,
  name: true,
  location: true,
  status: true,
  registeredAt: true,
  description: true,
  owner: { select: { id: true, name: true } },
};

/** The school shape the web app uses. */
export const toSchool = (school) => ({
  id: school.id,
  code: school.code,
  name: school.name,
  ownerName: school.owner?.name ?? null,
  ownerId: school.owner?.id ?? null,
  location: school.location,
  status: fromDbStatus(school.status),
  registeredAt: school.registeredAt.toISOString(),
  description: school.description ?? '',
});

/** Search (name, owner, location), status, location and registration-date filters, newest first. */
export async function listSchools({ q, status, location, registeredSince, page, pageSize }) {
  const prisma = getPrisma();
  const contains = (value) => ({ contains: value, mode: 'insensitive' });
  const where = {
    ...(q && { OR: [{ name: contains(q) }, { location: contains(q) }, { owner: { name: contains(q) } }] }),
    ...(status && { status: toDbStatus(status) }),
    ...(location && { location }),
    ...(registeredSince && { registeredAt: { gte: registeredSince } }),
  };

  const [total, groups, locations] = await Promise.all([
    prisma.school.count({ where }),
    prisma.school.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.school.findMany({ distinct: ['location'], select: { location: true }, orderBy: { location: 'asc' } }),
  ]);
  const { skip, take, meta } = pageWindow(total, page, pageSize);
  const rows = await prisma.school.findMany({ where, select: schoolSelect, orderBy: [{ registeredAt: 'desc' }, { id: 'asc' }], skip, take });

  return {
    items: rows.map(toSchool),
    ...meta,
    summary: statusSummary(groups),
    locations: locations.map((l) => l.location),
  };
}

export async function getSchool(id) {
  const school = isUuid(id) ? await getPrisma().school.findUnique({ where: { id }, select: schoolSelect }) : null;
  if (!school) throw notFound('School not found.');
  return toSchool(school);
}

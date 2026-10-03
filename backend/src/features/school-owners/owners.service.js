import { notFound } from '../../common/httpError.js';
import { fromDbStatus, pageWindow, statusSummary, toDbStatus } from '../../common/listQuery.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';

const ownerSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  status: true,
  createdAt: true,
  lastSignInAt: true,
  ownedSchool: { select: { id: true, name: true, location: true, registeredAt: true } },
};

/** The owner shape the web app uses. Never includes password hashes or sessions. */
export const toOwner = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email ?? '',
  phone: user.phone ?? '',
  status: fromDbStatus(user.status),
  registeredAt: user.createdAt.toISOString(),
  lastSignInAt: user.lastSignInAt?.toISOString() ?? null,
  school: user.ownedSchool
    ? { ...user.ownedSchool, registeredAt: user.ownedSchool.registeredAt.toISOString() }
    : null,
});

/** School owners (role OWNER): search (name, email, school), status, school location and registration-date filters. */
export async function listOwners({ q, status, location, registeredSince, page, pageSize }) {
  const prisma = getPrisma();
  const contains = (value) => ({ contains: value, mode: 'insensitive' });
  const owners = { role: 'OWNER' };
  const where = {
    ...owners,
    ...(q && { OR: [{ name: contains(q) }, { email: contains(q) }, { ownedSchool: { name: contains(q) } }] }),
    ...(status && { status: toDbStatus(status) }),
    ...(location && { ownedSchool: { location } }),
    ...(registeredSince && { createdAt: { gte: registeredSince } }),
  };

  const [total, groups, locations] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.groupBy({ by: ['status'], where: owners, _count: { _all: true } }),
    prisma.school.findMany({ where: { ownerId: { not: null } }, distinct: ['location'], select: { location: true }, orderBy: { location: 'asc' } }),
  ]);
  const { skip, take, meta } = pageWindow(total, page, pageSize);
  const rows = await prisma.user.findMany({ where, select: ownerSelect, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip, take });

  return {
    items: rows.map(toOwner),
    ...meta,
    summary: statusSummary(groups),
    locations: locations.map((l) => l.location),
  };
}

export async function getOwner(id) {
  const owner = isUuid(id) ? await getPrisma().user.findFirst({ where: { id, role: 'OWNER' }, select: ownerSelect }) : null;
  if (!owner) throw notFound('School owner not found.');
  return toOwner(owner);
}

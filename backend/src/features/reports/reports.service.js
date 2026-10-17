import { fromDbStatus } from '../../common/listQuery.js';
import { getPrisma } from '../../config/prisma.js';
import { lastMonths, monthStart, platformFigures, withoutTotal } from './platformStats.js';

export const REPORT_PERIODS = { '3m': 3, '6m': 6, '12m': 12 };

/**
 * Platform report for the last 3 / 6 / 12 calendar months (ending with the current month, in the
 * viewer's time zone). Lists contain the schools and owner accounts registered in the period.
 */
export async function getReport({ period, tz }) {
  const prisma = getPrisma();
  const now = new Date();
  const months = lastMonths(REPORT_PERIODS[period], tz, now);
  const periodStart = monthStart(months[0], tz);

  const [figures, schools, owners] = await Promise.all([
    platformFigures({ tz, months: months.length, since: periodStart }),
    prisma.school.findMany({
      where: { registeredAt: { gte: periodStart } },
      orderBy: [{ registeredAt: 'desc' }, { id: 'asc' }],
      select: { id: true, name: true, location: true, status: true, registeredAt: true, owner: { select: { name: true } } },
    }),
    prisma.user.findMany({
      where: { role: 'OWNER', createdAt: { gte: periodStart } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: { id: true, name: true, email: true, status: true, createdAt: true, ownedSchool: { select: { name: true, location: true } } },
    }),
  ]);
  const index = (month) => figures.growthMonths.indexOf(month);

  return {
    isDemo: false,
    period,
    periodStart: periodStart.toISOString(),
    periodEnd: now.toISOString(),
    generatedAt: now.toISOString(),
    summary: {
      totalSchools: { value: figures.schoolStatus.total, newInPeriod: figures.newSchools, trend: figures.schoolTotals.slice(-8) },
      totalOwners: { value: figures.ownerStatus.total, newInPeriod: figures.newOwners, trend: figures.ownerTotals.slice(-8) },
      activeSchools: { value: figures.schoolStatus.active },
      suspendedSchools: { value: figures.schoolStatus.suspended },
    },
    schoolGrowth: months.map((month) => ({ month, total: figures.schoolTotals[index(month)] })),
    registrations: months.map((month) => ({ month, count: figures.schoolCounts.get(month) ?? 0 })),
    schoolStatus: withoutTotal(figures.schoolStatus),
    ownerStatus: withoutTotal(figures.ownerStatus),
    schoolsByLocation: figures.schoolsByLocation,
    schools: schools.map((s) => ({
      id: s.id,
      name: s.name,
      ownerName: s.owner?.name ?? '',
      location: s.location,
      status: fromDbStatus(s.status),
      registeredAt: s.registeredAt.toISOString(),
    })),
    owners: owners.map((o) => ({
      id: o.id,
      name: o.name,
      email: o.email ?? '',
      schoolName: o.ownedSchool?.name ?? '',
      location: o.ownedSchool?.location ?? '',
      status: fromDbStatus(o.status),
      registeredAt: o.createdAt.toISOString(),
    })),
  };
}

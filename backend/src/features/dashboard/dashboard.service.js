import { getPrisma } from '../../config/prisma.js';
import { SECURITY_ACTIONS } from '../audit-logs/auditActions.js';
import { toSchool } from '../schools/schools.service.js';
import { platformFigures, withoutTotal } from '../reports/platformStats.js';

const DAY = 24 * 60 * 60 * 1000;
export const DASHBOARD_RANGES = { '30d': 30, '90d': 90, '12m': 365 };

/**
 * Platform overview for the dashboard. Change percentages are not returned: comparing periods
 * needs an approved definition (and status history, which is not stored).
 */
export async function getDashboard({ range, tz }) {
  const prisma = getPrisma();
  const now = new Date();
  const since = new Date(now.getTime() - DASHBOARD_RANGES[range] * DAY);
  const [figures, recentSchools, recentActivity] = await Promise.all([
    platformFigures({ tz, months: 12, since }),
    prisma.school.findMany({
      orderBy: [{ registeredAt: 'desc' }, { id: 'asc' }],
      take: 5,
      select: { id: true, code: true, name: true, location: true, status: true, registeredAt: true, description: true, owner: { select: { id: true, name: true } } },
    }),
    // Platform actions only: sign-ins and sign-outs belong to the audit log, not this summary.
    prisma.auditEvent.findMany({
      where: { action: { notIn: SECURITY_ACTIONS }, result: 'SUCCESS' },
      orderBy: { occurredAt: 'desc' },
      take: 5,
      select: { id: true, action: true, targetName: true, occurredAt: true },
    }),
  ]);
  const { growthMonths, schoolTotals, ownerTotals, schoolCounts, schoolStatus, ownerStatus } = figures;

  return {
    isDemo: false,
    range,
    generatedAt: now.toISOString(),
    summary: {
      totalSchools: { value: schoolStatus.total, newInPeriod: figures.newSchools, trend: schoolTotals.slice(-8) },
      activeSchools: { value: schoolStatus.active },
      pendingSchools: { value: schoolStatus.pending },
      suspendedSchools: { value: schoolStatus.suspended },
      totalOwners: { value: ownerStatus.total, trend: ownerTotals.slice(-8) },
    },
    statusDistribution: withoutTotal(schoolStatus),
    schoolsGrowth: growthMonths.map((month, i) => ({ month, total: schoolTotals[i] })),
    newSchools: growthMonths.slice(-6).map((month) => ({ month, count: schoolCounts.get(month) ?? 0 })),
    recentSchools: recentSchools.map(toSchool).map(({ id, name, location, ownerName, status, registeredAt }) => ({ id, name, location, ownerName, status, registeredAt })),
    recentActivity: recentActivity.map((e) => ({ id: e.id, type: e.action, subject: e.targetName ?? '', occurredAt: e.occurredAt.toISOString() })),
    schoolsByLocation: figures.schoolsByLocation,
  };
}

/*
 * DEMO DATA — NOT REAL PLATFORM DATA.
 *
 * Shapes the Super Admin dashboard response so the page can be built before the backend
 * exists. Values are illustrative only. Replace the source in loadDashboard.js with the
 * real API in Phase 9; the page and components consume the same shape.
 *
 * Shape:
 * {
 *   isDemo, range, generatedAt,
 *   summary: { totalSchools, activeSchools, pendingSchools, suspendedSchools, totalOwners }
 *            each { value, changePercent, newInPeriod?, trend: number[] }
 *   statusDistribution: { active, pending, suspended },
 *   schoolsGrowth: [{ month: 'YYYY-MM', total }],   // last 12 months, cumulative
 *   newSchools:    [{ month: 'YYYY-MM', count }],   // last 6 months
 *   recentSchools: [{ id, name, location, ownerName, status, registeredAt }],
 *   recentActivity:[{ id, type, subject, occurredAt }],
 *   schoolsByLocation: [{ location, count }],
 * }
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function lastMonths(count, now) {
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  });
}

const ago = (now, ms) => new Date(now.getTime() - ms).toISOString();

export function createMockDashboard({ range = '30d', now = new Date() } = {}) {
  const months = lastMonths(12, now);
  const totals = [3, 5, 7, 9, 11, 13, 14, 16, 19, 21, 24, 28];

  return {
    isDemo: true,
    range,
    generatedAt: now.toISOString(),
    summary: {
      totalSchools: { value: 28, changePercent: 12, newInPeriod: 4, trend: totals.slice(-8) },
      activeSchools: { value: 25, changePercent: 19, trend: [10, 12, 13, 15, 17, 19, 21, 25] },
      pendingSchools: { value: 3, changePercent: -25, trend: [3, 2, 4, 3, 4, 3, 4, 3] },
      suspendedSchools: { value: 0, changePercent: 0, trend: [0, 0, 0, 0, 0, 0, 0, 0] },
      totalOwners: { value: 28, changePercent: 12, trend: [11, 13, 14, 16, 19, 21, 24, 28] },
    },
    statusDistribution: { active: 25, pending: 3, suspended: 0 },
    schoolsGrowth: months.map((month, i) => ({ month, total: totals[i] })),
    newSchools: months.slice(-6).map((month, i) => ({ month, count: [1, 2, 3, 2, 3, 4][i] })),
    recentSchools: [
      { id: 'sch-028', name: 'Bright Future School', location: 'Kismayo', ownerName: 'Ayaan Ali', status: 'pending', registeredAt: ago(now, 2 * HOUR) },
      { id: 'sch-027', name: 'Sunrise School', location: 'Baidoa', ownerName: 'Hassan Mohamed', status: 'active', registeredAt: ago(now, 3 * DAY) },
      { id: 'sch-026', name: 'Somali Education Center', location: 'Garowe', ownerName: 'Khadija Osman', status: 'active', registeredAt: ago(now, 5 * DAY) },
      { id: 'sch-025', name: 'Horizon International', location: 'Hargeisa', ownerName: 'Omar Hassan', status: 'active', registeredAt: ago(now, 9 * DAY) },
      { id: 'sch-024', name: 'Al-Noor Academy', location: 'Mogadishu', ownerName: 'Fatima Ahmed', status: 'active', registeredAt: ago(now, 12 * DAY) },
    ],
    recentActivity: [
      { id: 'act-5', type: 'SCHOOL_REGISTERED', subject: 'Bright Future School', occurredAt: ago(now, 2 * HOUR) },
      { id: 'act-4', type: 'OWNER_CREATED', subject: 'Ayaan Ali', occurredAt: ago(now, 2 * HOUR + 10 * 60 * 1000) },
      { id: 'act-3', type: 'SCHOOL_APPROVED', subject: 'Sunrise School', occurredAt: ago(now, 6 * HOUR) },
      { id: 'act-2', type: 'SCHOOL_UPDATED', subject: 'Al-Noor Academy', occurredAt: ago(now, 1 * DAY) },
      { id: 'act-1', type: 'SCHOOL_APPROVED', subject: 'Somali Education Center', occurredAt: ago(now, 2 * DAY) },
    ],
    schoolsByLocation: [
      { location: 'Mogadishu', count: 12 },
      { location: 'Hargeisa', count: 5 },
      { location: 'Kismayo', count: 4 },
      { location: 'Garowe', count: 4 },
      { location: 'Baidoa', count: 3 },
    ],
  };
}

/** The same shape with nothing in it — used to preview empty states. */
export function createEmptyMockDashboard({ range = '30d', now = new Date() } = {}) {
  const months = lastMonths(12, now);
  const zero = { value: 0, changePercent: 0, trend: [0, 0, 0, 0, 0, 0, 0, 0] };
  return {
    isDemo: true,
    range,
    generatedAt: now.toISOString(),
    summary: {
      totalSchools: { ...zero, newInPeriod: 0 },
      activeSchools: zero,
      pendingSchools: zero,
      suspendedSchools: zero,
      totalOwners: zero,
    },
    statusDistribution: { active: 0, pending: 0, suspended: 0 },
    schoolsGrowth: months.map((month) => ({ month, total: 0 })),
    newSchools: months.slice(-6).map((month) => ({ month, count: 0 })),
    recentSchools: [],
    recentActivity: [],
    schoolsByLocation: [],
  };
}

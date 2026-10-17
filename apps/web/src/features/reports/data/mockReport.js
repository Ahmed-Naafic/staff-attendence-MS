/*
 * DEMO DATA — NOT REAL PLATFORM REPORTS.
 *
 * Computes the platform report from the Schools and School Owners demo sets (standing in for
 * the backend's aggregation), so every figure agrees with the other pages and changes with
 * the selected period. Replace the source in loadReport.js with the real API in Phase 9.
 *
 * Shape:
 * {
 *   isDemo, period, periodStart, periodEnd, generatedAt,
 *   summary: {
 *     totalSchools, totalOwners: { value, newInPeriod, trend: number[] },
 *     activeSchools, suspendedSchools: { value },
 *   },
 *   schoolGrowth:   [{ month: 'YYYY-MM', total }],     // schools at the end of each month
 *   registrations:  [{ month: 'YYYY-MM', count }],     // new schools per month
 *   schoolStatus:   { active, suspended },             // current
 *   ownerStatus:    { active, suspended },             // current
 *   schoolsByLocation: [{ location, count }],          // current, most first
 *   schools: [{ id, name, ownerName, location, status, registeredAt }], // registered in period, newest first
 *   owners:  [{ id, name, email, schoolName, location, status, registeredAt }], // registered in period
 * }
 */
import { createMockSchools } from '../../schools/data/mockSchools.js';
import { createMockOwners } from '../../school-owners/data/mockOwners.js';

export const periods = [
  { value: '3m', label: 'Last 3 months', months: 3 },
  { value: '6m', label: 'Last 6 months', months: 6 },
  { value: '12m', label: 'Last 12 months', months: 12 },
];

const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

// Statuses are ACTIVE / SUSPENDED only; the older sample data's 'pending' counts as active (as in the dev seed).
const countBy = (items, key) =>
  items.reduce(
    (counts, item) => {
      const status = item[key] === 'pending' ? 'active' : item[key];
      return { ...counts, [status]: counts[status] + 1 };
    },
    { active: 0, suspended: 0 },
  );

export function createMockReport({ period = '12m', now = new Date() } = {}) {
  const { months } = periods.find((p) => p.value === period) ?? periods[2];
  const { schools } = createMockSchools({ now });
  const { owners } = createMockOwners({ now });

  // Calendar months in the period, ending with the current month.
  const buckets = Array.from({ length: months }, (_, i) => new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1));
  const periodStart = buckets[0];
  const inPeriod = (iso) => new Date(iso) >= periodStart;
  const registeredBy = (end) => schools.filter((s) => new Date(s.registeredAt) < end).length;

  const schoolGrowth = buckets.map((start) => ({
    month: monthKey(start),
    total: registeredBy(new Date(start.getFullYear(), start.getMonth() + 1, 1)),
  }));
  const registrations = buckets.map((start) => ({
    month: monthKey(start),
    count: schools.filter((s) => monthKey(new Date(s.registeredAt)) === monthKey(start)).length,
  }));

  const schoolsInPeriod = schools.filter((s) => inPeriod(s.registeredAt));
  const ownersInPeriod = owners.filter((o) => inPeriod(o.registeredAt));
  const schoolStatus = countBy(schools, 'status');
  const trend = schoolGrowth.slice(-8).map((p) => p.total);

  const locations = {};
  schools.forEach((s) => (locations[s.location] = (locations[s.location] ?? 0) + 1));

  return {
    isDemo: true,
    period,
    periodStart: periodStart.toISOString(),
    periodEnd: now.toISOString(),
    generatedAt: now.toISOString(),
    summary: {
      totalSchools: { value: schools.length, newInPeriod: schoolsInPeriod.length, trend },
      totalOwners: { value: owners.length, newInPeriod: ownersInPeriod.length, trend },
      activeSchools: { value: schoolStatus.active },
      suspendedSchools: { value: schoolStatus.suspended },
    },
    schoolGrowth,
    registrations,
    schoolStatus,
    ownerStatus: countBy(owners, 'status'),
    schoolsByLocation: Object.entries(locations)
      .map(([location, count]) => ({ location, count }))
      .sort((a, b) => b.count - a.count || a.location.localeCompare(b.location)),
    schools: schoolsInPeriod.map(({ id, name, ownerName, location, status, registeredAt }) => ({
      id,
      name,
      ownerName,
      location,
      status,
      registeredAt,
    })),
    owners: ownersInPeriod.map((o) => ({
      id: o.id,
      name: o.name,
      email: o.email,
      schoolName: o.school.name,
      location: o.school.location,
      status: o.status,
      registeredAt: o.registeredAt,
    })),
  };
}

/** Same shape with nothing in it — used to preview the empty state. */
export function createEmptyMockReport({ period = '12m', now = new Date() } = {}) {
  const report = createMockReport({ period, now });
  const none = { active: 0, suspended: 0 };
  return {
    ...report,
    summary: {
      totalSchools: { value: 0, newInPeriod: 0, trend: [0, 0, 0, 0, 0, 0, 0, 0] },
      totalOwners: { value: 0, newInPeriod: 0, trend: [0, 0, 0, 0, 0, 0, 0, 0] },
      activeSchools: { value: 0 },
      suspendedSchools: { value: 0 },
    },
    schoolGrowth: report.schoolGrowth.map((p) => ({ ...p, total: 0 })),
    registrations: report.registrations.map((p) => ({ ...p, count: 0 })),
    schoolStatus: none,
    ownerStatus: none,
    schoolsByLocation: [],
    schools: [],
    owners: [],
  };
}

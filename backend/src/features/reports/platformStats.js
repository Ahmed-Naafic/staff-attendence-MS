import { getPrisma } from '../../config/prisma.js';
import { statusSummary } from '../../common/listQuery.js';

/*
 * Platform aggregates shared by the dashboard and Platform Reports. Every figure is a direct count
 * of stored records (schools, school-owner accounts, their statuses, cities and registration
 * dates). Months are calendar months in the viewer's time zone.
 */

/** 'YYYY-MM' of `date` in time zone `tz`. */
export function monthKey(date, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' }).formatToParts(date);
  return `${parts.find((p) => p.type === 'year').value}-${parts.find((p) => p.type === 'month').value}`;
}

/** The last `count` month keys ending with the current month in `tz`. */
export function lastMonths(count, tz, now = new Date()) {
  const [year, month] = monthKey(now, tz).split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(year, month - 1 - (count - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

// Offset of `tz` from UTC at instant `date`, in ms.
function tzOffset(date, tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant a month ('YYYY-MM') starts in `tz`. */
export function monthStart(key, tz) {
  const [year, month] = key.split('-').map(Number);
  const guess = new Date(Date.UTC(year, month - 1, 1));
  return new Date(guess.getTime() - tzOffset(guess, tz));
}

/** Registrations per month for schools or owner accounts: Map('YYYY-MM' → count). */
async function monthlyCounts(kind, tz) {
  const prisma = getPrisma();
  // Timestamps are stored in UTC without a zone: convert to UTC, then to the viewer's zone.
  const rows =
    kind === 'schools'
      ? await prisma.$queryRaw`
          SELECT to_char(("registeredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM') AS month, count(*)::int AS count
          FROM "School" GROUP BY 1`
      : await prisma.$queryRaw`
          SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, 'YYYY-MM') AS month, count(*)::int AS count
          FROM "User" WHERE "role" = 'OWNER' GROUP BY 1`;
  return new Map(rows.map((r) => [r.month, r.count]));
}

/** Totals at the end of each month in `months` (cumulative). */
function cumulative(counts, months) {
  let running = [...counts].filter(([month]) => month < months[0]).reduce((sum, [, n]) => sum + n, 0);
  return months.map((month) => (running += counts.get(month) ?? 0));
}

/** Everything the dashboard and the report need, for a window of `months` months. */
export async function platformFigures({ tz, months: monthCount, since }) {
  const prisma = getPrisma();
  const growthMonths = lastMonths(Math.max(monthCount, 12), tz);
  const [schoolCounts, ownerCounts, schoolGroups, ownerGroups, locations, newSchools, newOwners] = await Promise.all([
    monthlyCounts('schools', tz),
    monthlyCounts('owners', tz),
    prisma.school.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.user.groupBy({ by: ['status'], where: { role: 'OWNER' }, _count: { _all: true } }),
    prisma.school.groupBy({ by: ['location'], _count: { _all: true }, orderBy: [{ _count: { location: 'desc' } }, { location: 'asc' }] }),
    prisma.school.count({ where: { registeredAt: { gte: since } } }),
    prisma.user.count({ where: { role: 'OWNER', createdAt: { gte: since } } }),
  ]);

  return {
    growthMonths,
    schoolTotals: cumulative(schoolCounts, growthMonths),
    ownerTotals: cumulative(ownerCounts, growthMonths),
    schoolCounts,
    schoolStatus: statusSummary(schoolGroups),
    ownerStatus: statusSummary(ownerGroups),
    schoolsByLocation: locations.map((l) => ({ location: l.location, count: l._count._all })),
    newSchools,
    newOwners,
  };
}

const withoutTotal = ({ active, pending, suspended }) => ({ active, pending, suspended });
export { withoutTotal };

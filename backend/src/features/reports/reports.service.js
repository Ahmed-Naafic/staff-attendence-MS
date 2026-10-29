import { Prisma } from '@prisma/client';
import { toDbStatus } from '../../common/listQuery.js';
import { getPrisma } from '../../config/prisma.js';
import { dayStart, lastDays, lastMonths, monthStart } from './platformStats.js';

/*
 * Platform Reports (approved definitions, see docs/business-rules.md). Read-only: every figure is a
 * database aggregate of stored records, and nothing is written (no audit event for viewing).
 *
 * - Schools: School records. Owners: OWNER accounts assigned to a school (other roles never count).
 * - Statuses are ACTIVE and SUSPENDED only.
 * - Creation trends count schools by registration date (`registeredAt`) and owners by account
 *   creation date (`User.createdAt`), per calendar day or month in the platform time zone (General settings). Every
 *   day or month of the period is listed, with 0 when nothing was created.
 * - The school status and city filters apply to every school figure; owner figures are not filtered.
 */

/** Trend periods: the last 7 / 30 days (by day, ending today) or 3 / 6 / 12 calendar months (by month, ending this month). */
export const REPORT_PERIODS = {
  '7d': { unit: 'day', count: 7 },
  '30d': { unit: 'day', count: 30 },
  '3m': { unit: 'month', count: 3 },
  '6m': { unit: 'month', count: 6 },
  '12m': { unit: 'month', count: 12 },
};

// Owner accounts that count as School Owners: role OWNER with a school assigned.
const OWNER_WHERE = { role: 'OWNER', ownedSchool: { isNot: null } };

const schoolWhere = ({ status, city }) => ({ ...(status && { status: toDbStatus(status) }), ...(city && { location: city }) });

// The same school filters as SQL. Values are bound parameters, never part of the SQL text.
const schoolSqlFilter = ({ status, city }) =>
  Prisma.sql`${status ? Prisma.sql`AND "status" = ${toDbStatus(status)}::"SchoolStatus"` : Prisma.empty} ${city ? Prisma.sql`AND "location" = ${city}` : Prisma.empty}`;

/** The period's day or month keys and the instant it starts in `tz`. */
export function periodBuckets(period, tz, now = new Date()) {
  const { unit, count } = REPORT_PERIODS[period];
  const keys = unit === 'day' ? lastDays(count, tz, now) : lastMonths(count, tz, now);
  return { unit, keys, start: unit === 'day' ? dayStart(keys[0], tz) : monthStart(keys[0], tz) };
}

/** { total, active, suspended }. `total` counts every record; only the approved statuses are broken out. */
function statusCounts(groups) {
  const counts = { total: 0, active: 0, suspended: 0 };
  for (const group of groups) {
    counts.total += group._count._all;
    if (group.status === 'ACTIVE') counts.active = group._count._all;
    if (group.status === 'SUSPENDED') counts.suspended = group._count._all;
  }
  return counts;
}

// Most schools first, then city name A–Z; schools without a city ("Unknown", null) last among equals.
const byCountThenCity = (a, b) => b.count - a.count || (a.city === null) - (b.city === null) || (a.city ?? '').localeCompare(b.city ?? '', 'en');

/** Platform report for a trend period, with optional school status / city filters. */
export async function getReport({ period, status, city, tz }) {
  const prisma = getPrisma();
  const now = new Date();
  const { unit, keys, start } = periodBuckets(period, tz, now);
  const keyFormat = unit === 'day' ? 'YYYY-MM-DD' : 'YYYY-MM';
  const filters = { status, city };
  const since = start.toISOString();

  const [schoolGroups, ownerGroups, cityRows, schoolTrend, ownerTrend, cityOptions] = await Promise.all([
    prisma.school.groupBy({ by: ['status'], where: schoolWhere(filters), _count: { _all: true } }),
    prisma.user.groupBy({ by: ['status'], where: OWNER_WHERE, _count: { _all: true } }),
    // A blank city is reported as null ("Unknown") rather than dropped.
    prisma.$queryRaw`
      SELECT CASE WHEN btrim("location") = '' THEN NULL ELSE "location" END AS city, count(*)::int AS count
      FROM "School" WHERE TRUE ${schoolSqlFilter(filters)} GROUP BY 1`,
    // Timestamps are stored in UTC without a zone: convert to UTC, then to the platform time zone.
    prisma.$queryRaw`
      SELECT to_char(("registeredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, ${keyFormat}) AS key, count(*)::int AS count
      FROM "School"
      WHERE "registeredAt" >= (${since}::timestamptz AT TIME ZONE 'UTC') ${schoolSqlFilter(filters)}
      GROUP BY 1`,
    prisma.$queryRaw`
      SELECT to_char((u."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${tz}, ${keyFormat}) AS key, count(*)::int AS count
      FROM "User" u
      WHERE u."role" = 'OWNER' AND EXISTS (SELECT 1 FROM "School" s WHERE s."ownerId" = u."id")
        AND u."createdAt" >= (${since}::timestamptz AT TIME ZONE 'UTC')
      GROUP BY 1`,
    prisma.school.groupBy({ by: ['location'], where: { location: { not: '' } } }),
  ]);

  const zeroFilled = (rows) => {
    const counts = new Map(rows.map((r) => [r.key, r.count]));
    return keys.map((key) => ({ key, count: counts.get(key) ?? 0 }));
  };

  return {
    isDemo: false,
    generatedAt: now.toISOString(),
    timeZone: tz,
    filters: { period, status: status ?? null, city: city ?? null },
    period: { value: period, unit, start: since, end: now.toISOString() },
    // Every city with a school (unfiltered): the choices for the City filter.
    cities: cityOptions.map((c) => c.location).filter((c) => c.trim()).sort((a, b) => a.localeCompare(b, 'en')),
    schools: {
      summary: statusCounts(schoolGroups),
      byCity: cityRows.map((r) => ({ city: r.city, count: r.count })).sort(byCountThenCity),
      trend: zeroFilled(schoolTrend),
    },
    owners: {
      summary: statusCounts(ownerGroups),
      trend: zeroFilled(ownerTrend),
    },
  };
}

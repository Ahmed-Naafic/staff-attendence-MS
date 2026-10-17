import { optionalEnum, optionalInt, optionalString } from './validate.js';

const DAY = 24 * 60 * 60 * 1000;

/** Registration-date filter values used by the Schools and School Owners pages. */
export const REGISTERED_RANGES = { '7d': 7, '30d': 30, '90d': 90, '12m': 365 };

// School and owner-account statuses (approved lifecycles: ACTIVE ⇄ SUSPENDED).
export const SCHOOL_STATUSES = ['active', 'suspended'];
export const OWNER_STATUSES = ['active', 'suspended'];
export const toDbStatus = (status) => status?.toUpperCase();
export const fromDbStatus = (status) => status.toLowerCase();

/** Common list parameters: q, status (one of `statuses`), location, registered, page, pageSize. */
export function readListQuery(query, { statuses, defaultPageSize = 8, maxPageSize = 100 }) {
  const registered = optionalEnum(query, 'registered', Object.keys(REGISTERED_RANGES));
  return {
    q: optionalString(query, 'q', { max: 100 }),
    status: optionalEnum(query, 'status', statuses),
    location: optionalString(query, 'location', { max: 100 }),
    registeredSince: registered ? new Date(Date.now() - REGISTERED_RANGES[registered] * DAY) : undefined,
    page: optionalInt(query, 'page', { min: 1, max: 100000, fallback: 1 }),
    pageSize: optionalInt(query, 'pageSize', { min: 1, max: maxPageSize, fallback: defaultPageSize }),
  };
}

/** Clamps the page to the available range and returns Prisma skip/take plus the response metadata. */
export function pageWindow(total, page, pageSize) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pageCount);
  return { skip: (current - 1) * pageSize, take: pageSize, meta: { total, page: current, pageSize, pageCount } };
}

/** { total, <status>: count… } from a Prisma groupBy on status, with every listed status present. */
export function statusSummary(groups, statuses) {
  const summary = { total: 0, ...Object.fromEntries(statuses.map((s) => [s, 0])) };
  for (const group of groups) {
    summary[fromDbStatus(group.status)] = group._count._all;
    summary.total += group._count._all;
  }
  return summary;
}

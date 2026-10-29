import { badRequest } from '../../common/httpError.js';
import { isUuid, optionalDay, optionalEnum, optionalInt, optionalString } from '../../common/validate.js';
import { addDays } from '../schedules/schedules.service.js';

/*
 * Query parameters of the attendance reports (docs/reports/attendance-report-api.md). Dates are
 * branch-local work dates, inclusive at both ends, at most 62 days, never after today. Ids are only
 * checked for shape here; whether they are in the signed-in account's scope is decided by the
 * service (a branch or staff member outside it is not found).
 */

export const REPORT_MAX_DAYS = 62;
export const REPORT_STATUSES = ['present', 'late'];
/** Check-out state of a record (D9): recorded, open (not checked out yet), missing (no check-out), not_required. */
export const CHECK_OUT_STATES = ['recorded', 'open', 'missing', 'not_required'];
export const RECORD_SORTS = ['date', 'checkIn', 'staffName', 'staffId', 'branch', 'status'];
export const RECORDS_PAGE_SIZE = 20;

const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (from, to) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;

function optionalId(query, name, label) {
  const value = optionalString(query, name, { max: 64 });
  if (value !== undefined && !isUuid(value)) throw badRequest(`"${name}" must be an id.`, { [name]: `Choose a ${label} from the list.` });
  return value;
}

/** from / to (defaults: today; one given → the same day for the other), checked against `today`. */
export function readRange(query, today) {
  let from = optionalDay(query, 'from');
  let to = optionalDay(query, 'to');
  from ??= to ?? today;
  to ??= from;
  if (from > to) throw badRequest('The start date must be on or before the end date.', { from: 'The start date must be on or before the end date.' });
  if (to > today) throw badRequest('The end date cannot be after today.', { to: `The end date cannot be after today (${today}).` });
  if (daysBetween(from, to) + 1 > REPORT_MAX_DAYS) {
    throw badRequest(`Choose at most ${REPORT_MAX_DAYS} days.`, { from: `Choose at most ${REPORT_MAX_DAYS} days (from ${addDays(to, -(REPORT_MAX_DAYS - 1))} for this end date).` });
  }
  return { from, to };
}

/**
 * The filters shared by summary and records. `role` 'OWNER' | 'MANAGER': a Manager's branch comes
 * from the account, so a `branch` parameter is refused; an Owner's shift filter needs one branch.
 */
export function readFilters(query, { role, today }) {
  if (role === 'MANAGER' && query.branch !== undefined) {
    throw badRequest('Your reports are for your own branch; "branch" cannot be chosen.', { branch: 'The branch comes from your account.' });
  }
  const filters = {
    ...readRange(query, today),
    branch: role === 'OWNER' ? optionalId(query, 'branch', 'branch') : undefined,
    staff: optionalId(query, 'staff', 'staff member'),
    shift: optionalId(query, 'shift', 'shift'),
  };
  if (role === 'OWNER' && filters.shift && !filters.branch) throw badRequest('Choose a branch before choosing a shift.', { shift: 'Choose a branch first.' });
  return filters;
}

export function readSummaryQuery(query, context) {
  for (const name of ['status', 'checkOut']) {
    if (query[name] !== undefined) throw badRequest(`"${name}" is a records filter; the summary counts every status.`);
  }
  return readFilters(query, context);
}

export function readRecordsQuery(query, context) {
  const sorts = context.role === 'OWNER' ? RECORD_SORTS : RECORD_SORTS.filter((s) => s !== 'branch');
  return {
    ...readFilters(query, context),
    status: optionalEnum(query, 'status', REPORT_STATUSES),
    checkOut: optionalEnum(query, 'checkOut', CHECK_OUT_STATES),
    q: optionalString(query, 'q', { max: 100 }),
    sort: optionalEnum(query, 'sort', sorts) ?? 'date',
    order: optionalEnum(query, 'order', ['asc', 'desc']) ?? 'desc',
    page: optionalInt(query, 'page', { min: 1, max: 100000, fallback: 1 }),
    pageSize: optionalInt(query, 'pageSize', { min: 1, max: 100, fallback: RECORDS_PAGE_SIZE }),
  };
}

/** The records filters and sort for an export; `page` and `pageSize` do not apply (every matching row is exported). */
export function readExportQuery(query, context) {
  // eslint-disable-next-line no-unused-vars
  const { page, pageSize, ...filters } = readRecordsQuery({ ...query, page: undefined, pageSize: undefined }, context);
  return filters;
}

export function readOptionsQuery(query, context) {
  if (context.role === 'MANAGER' && query.branch !== undefined) {
    throw badRequest('Your reports are for your own branch; "branch" cannot be chosen.', { branch: 'The branch comes from your account.' });
  }
  return {
    ...readRange(query, context.today),
    branch: context.role === 'OWNER' ? optionalId(query, 'branch', 'branch') : undefined,
    staffQuery: optionalString(query, 'staffQuery', { max: 100 }),
  };
}

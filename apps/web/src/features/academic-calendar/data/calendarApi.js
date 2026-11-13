import { apiRequest } from '../../../lib/api.js';

/*
 * Academic calendar requests (docs/business-rules.md → Academic calendar). The school, and a
 * Manager's branch, are decided by the server from the signed-in account: nothing here names a
 * school, and a Manager never sends a branch. Writes throw ApiError: 400 VALIDATION_ERROR (details per
 * field), 403 FORBIDDEN, 404 NOT_FOUND, 409 DATES_OVERLAP / YEAR_CLOSED / BRANCH_WEEKDAYS_NOT_ALLOWED /
 * REOPENING_NOT_ALLOWED / VERSION_IN_EFFECT / ENTRY_IN_PAST / ENTRY_CANCELLED / HOLIDAY_CANCELLED /
 * SCHOOL_SUSPENDED / BRANCH_NOT_OPERATING.
 */
const base = (role) => (role === 'OWNER' ? '/owner' : '/manager');
const id = (value) => encodeURIComponent(value);

/** A year's calendar: { academicYear, today, firstEditableDate, branchWeekdaysAllowed, weekdays: { school, branches }, entries }. */
export const loadCalendar = (role, yearId) => apiRequest(`${base(role)}/academic-years/${id(yearId)}/calendar`);

/** Each day from..to for a branch: { branch, from, to, today, schoolDays, days: [{ date, weekday, schoolDay, reason, … }] }. */
export const loadSchoolDays = (role, { branch, from, to }) =>
  apiRequest(`${base(role)}/calendar/days`, { query: { from, to, branch: role === 'OWNER' ? branch : undefined } });

/** values: { days, effectiveFrom } or (Manager) { followsSchool: true, effectiveFrom } → the calendar. */
export const saveWeekdays = (role, yearId, values) => apiRequest(`${base(role)}/academic-years/${id(yearId)}/weekdays`, { method: 'PUT', body: values });

/** Cancels a scheduled change of school days → the calendar. */
export const cancelWeekdays = (role, yearId, versionId) =>
  apiRequest(`${base(role)}/academic-years/${id(yearId)}/weekdays/${id(versionId)}/cancel`, { method: 'POST' });

/** School Owner: whether Managers may set their branch's own school days in the year → the calendar. */
export const setBranchWeekdaysAllowed = (yearId, branchWeekdaysAllowed) =>
  apiRequest(`/owner/academic-years/${id(yearId)}/weekday-policy`, { method: 'PUT', body: { branchWeekdaysAllowed } });

/** values: { type, name, note, startDate, endDate, branch? (Owner), holiday? (reopening), allowBranchReopening? } → the entry. */
export const createEntry = async (role, yearId, values) =>
  (await apiRequest(`${base(role)}/academic-years/${id(yearId)}/calendar-entries`, { method: 'POST', body: values })).entry;

/** values: any of { name, note, startDate, endDate, allowBranchReopening } → the entry. */
export const updateEntry = async (role, entryId, values) => (await apiRequest(`${base(role)}/calendar-entries/${id(entryId)}`, { method: 'PATCH', body: values })).entry;

/** Cancels an entry that has not started, or ends a running one early → the entry. */
export const cancelEntry = async (role, entryId) => (await apiRequest(`${base(role)}/calendar-entries/${id(entryId)}/cancel`, { method: 'POST' })).entry;

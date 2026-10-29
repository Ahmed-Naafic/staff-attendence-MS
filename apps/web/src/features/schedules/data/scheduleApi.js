import { apiRequest } from '../../../lib/api.js';

/*
 * The Manager's branch schedule (GET/POST/DELETE /api/manager/schedule…). The branch is always the
 * Manager's own, decided by the server. Changes resolve to the schedule page data, or throw ApiError:
 * 400 VALIDATION_ERROR (details per field, `shifts.<i>.<field>` for a shift), 404 NOT_FOUND,
 * 409 BRANCH_NOT_OPERATING.
 */

/** { timeZone, today, earliestEffectiveDate, latestEffectiveDate, current, scheduled, canChange, notOperatingReasons } */
export const loadSchedule = () => apiRequest('/manager/schedule');

/** { timeZone, items: [{ …version, state, effectiveUntil }] }, newest effective date first. */
export const loadVersions = () => apiRequest('/manager/schedule/versions');

/** change: { effectiveFrom: 'YYYY-MM-DD', checkOutEnabled, shifts: [{ name, days, start, end, graceMinutes, absenceCutoffMinutes }] } */
export const saveSchedule = (change) => apiRequest('/manager/schedule', { method: 'POST', body: change });

export const cancelScheduledSchedule = () => apiRequest('/manager/schedule/scheduled', { method: 'DELETE' });

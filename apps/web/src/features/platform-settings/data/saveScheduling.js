import { apiRequest } from '../../../lib/api.js';

/**
 * Saves Scheduling & Assignments settings (PUT /api/platform/settings/scheduling) — `values` holds
 * effectiveDelayDays, immediateFirstSchedule and/or immediateFirstAssignment — and returns the
 * settings now in force.
 */
export async function saveScheduling(values) {
  return (await apiRequest('/platform/settings/scheduling', { method: 'PUT', body: values })).scheduling;
}

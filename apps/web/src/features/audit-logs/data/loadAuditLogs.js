import { apiRequest, previewDelay, previewState } from '../../../lib/api.js';
import { platformDayStart } from '../../../lib/format.js';
import { dateBounds } from '../utils/filterAuditLogs.js';

const EMPTY = {
  isDemo: false,
  items: [],
  total: 0,
  page: 1,
  pageSize: 10,
  pageCount: 1,
  summary: { total: 0, lastWeek: 0, today: 0, yesterday: 0, admin: 0, school: 0, owner: 0, security: 0, failed: 0 },
  users: [],
  schools: [],
};

const iso = (ms) => (ms === null || ms === undefined ? undefined : new Date(ms).toISOString());

/**
 * One page of audit events from the API (GET /api/platform/audit-logs), newest first, with the
 * summary figures and the filter choices (users, schools). Date ranges and "today" are worked out
 * in the platform time zone and sent as exact instants.
 *
 * Event (newest first):
 *   id, occurredAt, action, result: 'success' | 'failure',
 *   actor:  { id, name, role },
 *   target: { type: 'school' | 'owner' | 'system', id | null, name, code?, location?, schoolName? },
 *   school: { id, name } | null,     the school the event belongs to (for filtering)
 *   description,
 *   change: { field, from, to } | { fields: [{ field, from, to }] } | null,  status or settings changes
 *   context: { ipAddress, browser, device }
 */
export async function loadAuditLogs(filters, page, pageSize) {
  // Development only (removed from production builds): preview page states with ?demoState=loading | error | empty
  if (import.meta.env.DEV) {
    const preview = previewState();
    if (preview === 'loading') return new Promise(() => {});
    if (preview) await previewDelay();
    if (preview === 'error') throw new Error('Preview: audit log request failed');
    if (preview === 'empty') return { ...EMPTY, pageSize };
  }

  const { since, until, invalid } = dateBounds(filters);
  return apiRequest('/platform/audit-logs', {
    query: {
      q: filters.query,
      action: filters.action,
      user: filters.user,
      school: filters.school,
      status: filters.status,
      since: invalid ? undefined : iso(since),
      until: invalid ? undefined : iso(until),
      dayStart: new Date(platformDayStart()).toISOString(),
      page,
      pageSize,
    },
  });
}

/** One audit event by id (GET /api/platform/audit-logs/:id); null when it does not exist. */
export async function loadAuditEvent(id) {
  try {
    return (await apiRequest(`/platform/audit-logs/${encodeURIComponent(id)}`)).event;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

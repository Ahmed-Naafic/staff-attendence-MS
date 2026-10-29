import { apiRequest } from '../../../lib/api.js';
import { PAGE_SIZE } from '../utils/managerRules.js';

/*
 * School Owner Manager data (GET /api/owner/…). The school is always the signed-in owner's own,
 * decided by the server; nothing here names a school.
 */

/**
 * One page of the school's Managers: { items, total, page, pageSize, pageCount,
 * summary: { total, active, suspended }, branches }. Search, filters and pagination run on the server.
 */
export const loadManagers = ({ query, status, branch }, page) =>
  apiRequest('/owner/managers', { query: { q: query, status, branch, page, pageSize: PAGE_SIZE } });

/** One Manager with their assignment history; null when they are not a Manager of this school. */
export async function loadManager(id) {
  try {
    return (await apiRequest(`/owner/managers/${encodeURIComponent(id)}`)).manager;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

/** This Manager's audit events, newest first. */
export const loadManagerHistory = (manager) => apiRequest('/owner/audit-logs', { query: { manager, pageSize: 50 } });

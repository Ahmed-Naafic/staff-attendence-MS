import { apiRequest } from '../../../lib/api.js';
import { PAGE_SIZE } from '../utils/branchRules.js';

/*
 * School Owner branch data (GET /api/owner/…). The school is always the signed-in owner's own,
 * decided by the server; nothing here names a school.
 */

/** The owner's school: { id, code, name, status }. */
export const loadOwnerSchool = async () => (await apiRequest('/owner/school')).school;

/**
 * One page of the school's branches: { items, total, page, pageSize, pageCount,
 * summary: { total, active, suspended }, cities }. Search, filter and pagination run on the server.
 */
export const loadBranches = ({ query, status }, page) =>
  apiRequest('/owner/branches', { query: { q: query, status, page, pageSize: PAGE_SIZE } });

/** One branch with its current and scheduled location; null when it does not exist in this school. */
export async function loadBranch(id) {
  try {
    return (await apiRequest(`/owner/branches/${encodeURIComponent(id)}`)).branch;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

/** Location history, newest effective time first: [{ …, state: current | scheduled | previous | cancelled, effectiveUntil }]. */
export const loadLocations = async (id) => (await apiRequest(`/owner/branches/${encodeURIComponent(id)}/locations`)).items;

/** Branch audit events of this school (one branch when `branch` is given), newest first. */
export const loadBranchHistory = (branch) => apiRequest('/owner/audit-logs', { query: { branch, pageSize: 50 } });

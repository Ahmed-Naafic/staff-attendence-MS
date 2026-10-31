import { apiRequest } from '../../../lib/api.js';

/*
 * School Owner: the school's staff and their transfers between branches (docs/business-rules.md →
 * Staff transfers). The school is the signed-in Owner's; the server checks every id against it.
 */

export const PAGE_SIZE = 10;

export const loadSchoolStaff = ({ query, branch, status }, page) =>
  apiRequest('/owner/staff', { query: { q: query, branch, status, page, pageSize: PAGE_SIZE } });

export const loadSchoolStaffMember = async (id) => (await apiRequest(`/owner/staff/${encodeURIComponent(id)}`)).staff;

/** Every branch of the school (for the filter and the destination list). */
export const loadSchoolBranches = async () => (await apiRequest('/owner/branches', { query: { page: 1, pageSize: 100 } })).items;

/** The destination branch's shifts in the schedule in effect on the transfer date: { date, schedule: { effectiveFrom, timeZone, shifts } | null }. */
export const loadBranchShifts = (branchId, date, signal) => apiRequest(`/owner/branches/${encodeURIComponent(branchId)}/shifts`, { query: { date }, signal });

export const scheduleTransfer = async (staffId, body) => (await apiRequest(`/owner/staff/${encodeURIComponent(staffId)}/transfer`, { method: 'POST', body })).transfer;

export const cancelTransfer = async (staffId) => (await apiRequest(`/owner/staff/${encodeURIComponent(staffId)}/transfer/scheduled`, { method: 'DELETE' })).staff;

import { apiRequest } from '../../../lib/api.js';
import { PAGE_SIZE } from '../utils/staffRules.js';

/*
 * Staff of the Manager's branch (GET/POST/PATCH/DELETE /api/manager/staff…). The branch is always the
 * Manager's own, decided by the server. Changes resolve to the updated staff member (with
 * assignments), or throw ApiError: 400 VALIDATION_ERROR (details per field), 404 NOT_FOUND,
 * 409 PHONE_TAKEN / EMAIL_TAKEN / INVALID_STATUS / BRANCH_NOT_OPERATING. Passwords are sent once and
 * never returned.
 */
const path = (id, rest = '') => `/manager/staff/${encodeURIComponent(id)}${rest}`;

/** { items, total, page, pageSize, pageCount, summary: { total, active, suspended } } */
export const loadStaffList = ({ query, status }, page) => apiRequest('/manager/staff', { query: { q: query, status, page, pageSize: PAGE_SIZE } });

/** One staff member with assignments and the branch's shifts; null when not in this branch. */
export async function loadStaff(id) {
  try {
    return (await apiRequest(path(id))).staff;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

/** Every assignment set, newest effective date first: { items: [{ …, state, effectiveUntil }] }. */
export const loadAssignmentHistory = (id) => apiRequest(path(id, '/assignments'));

/** values: { name, phone, jobTitle, email?, password } */
export const createStaff = async (values) => (await apiRequest('/manager/staff', { method: 'POST', body: values })).staff;
/** values: any of { name, phone, jobTitle, email } */
export const updateStaff = async (id, values) => (await apiRequest(path(id), { method: 'PATCH', body: values })).staff;
export const suspendStaff = async (id, reason) => (await apiRequest(path(id, '/suspend'), { method: 'POST', body: { reason } })).staff;
export const reactivateStaff = async (id) => (await apiRequest(path(id, '/reactivate'), { method: 'POST' })).staff;
export const resetStaffPassword = async (id, password) => (await apiRequest(path(id, '/password'), { method: 'POST', body: { password } })).staff;
/** change: { effectiveFrom: 'YYYY-MM-DD', shifts: [{ shiftKey, days }] } */
export const saveAssignments = async (id, change) => (await apiRequest(path(id, '/assignments'), { method: 'POST', body: change })).staff;
export const cancelScheduledAssignments = async (id) => (await apiRequest(path(id, '/assignments/scheduled'), { method: 'DELETE' })).staff;

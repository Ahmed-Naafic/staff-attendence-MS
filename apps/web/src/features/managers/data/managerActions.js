import { apiRequest } from '../../../lib/api.js';

/*
 * Manager account requests (School Owner). Each resolves to the updated Manager (with assignment
 * history), or throws ApiError: 400 VALIDATION_ERROR (details per field), 404 NOT_FOUND,
 * 409 EMAIL_TAKEN / INVALID_STATUS / SCHOOL_SUSPENDED. Passwords are sent once and never returned.
 */
const path = (id, rest = '') => `/owner/managers/${encodeURIComponent(id)}${rest}`;

/** values: { name, email, phone, branchId, password } */
export const createManager = async (values) => (await apiRequest('/owner/managers', { method: 'POST', body: values })).manager;

/** values: any of { name, email, phone } (never the branch, status or password). */
export const updateManager = async (id, values) => (await apiRequest(path(id), { method: 'PATCH', body: values })).manager;

export const transferManager = async (id, branchId) => (await apiRequest(path(id, '/transfer'), { method: 'POST', body: { branchId } })).manager;

export const suspendManager = async (id, reason) => (await apiRequest(path(id, '/suspend'), { method: 'POST', body: { reason } })).manager;

export const reactivateManager = async (id) => (await apiRequest(path(id, '/reactivate'), { method: 'POST' })).manager;

export const resetManagerPassword = async (id, password) =>
  (await apiRequest(path(id, '/password'), { method: 'POST', body: { password } })).manager;

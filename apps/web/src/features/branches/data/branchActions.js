import { apiRequest } from '../../../lib/api.js';

/*
 * Branch Management requests (School Owner). Each resolves to the updated branch (with its
 * locations), or throws ApiError: 400 VALIDATION_ERROR (details per field), 404 NOT_FOUND,
 * 409 NAME_TAKEN / INVALID_STATUS / SCHOOL_SUSPENDED.
 */
const path = (id, rest = '') => `/owner/branches/${encodeURIComponent(id)}${rest}`;

/** values: { name, address, city, phone, location: { latitude, longitude, accuracy, confirmed: true } } */
export const createBranch = async (values) => (await apiRequest('/owner/branches', { method: 'POST', body: values })).branch;

/** values: any of { name, address, city, phone } (never the code, school, status or location). */
export const updateBranch = async (id, values) => (await apiRequest(path(id), { method: 'PATCH', body: values })).branch;

export const suspendBranch = async (id, reason) => (await apiRequest(path(id, '/suspend'), { method: 'POST', body: { reason } })).branch;

export const reactivateBranch = async (id) => (await apiRequest(path(id, '/reactivate'), { method: 'POST' })).branch;

/** change: { latitude, longitude, accuracy, confirmed: true, effectiveFrom: 'now' | ISO time } */
export const changeLocation = async (id, change) => (await apiRequest(path(id, '/locations'), { method: 'POST', body: change })).branch;

export const cancelScheduledLocation = async (id) => (await apiRequest(path(id, '/locations/scheduled'), { method: 'DELETE' })).branch;

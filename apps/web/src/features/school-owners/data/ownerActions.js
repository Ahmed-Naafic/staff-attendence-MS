import { apiRequest } from '../../../lib/api.js';

/*
 * School Owner Management requests (Super Admin). Each resolves to the owner in the same shape as
 * the list, or throws ApiError: 400 VALIDATION_ERROR (details per field), 404 NOT_FOUND,
 * 409 EMAIL_TAKEN / SCHOOL_HAS_OWNER / INVALID_STATUS.
 */

/** values: { name, email, phone, schoolId, password } — the password is sent once and never returned. */
export const addOwner = async (values) => (await apiRequest('/platform/owners', { method: 'POST', body: values })).owner;

/** values: any of { name, email, phone } (never the school or role). */
export const updateOwner = async (id, values) =>
  (await apiRequest(`/platform/owners/${encodeURIComponent(id)}`, { method: 'PATCH', body: values })).owner;

export const suspendOwner = async (id, reason) =>
  (await apiRequest(`/platform/owners/${encodeURIComponent(id)}/suspend`, { method: 'POST', body: { reason } })).owner;

export const reactivateOwner = async (id) =>
  (await apiRequest(`/platform/owners/${encodeURIComponent(id)}/reactivate`, { method: 'POST' })).owner;

const SCHOOL_CHOICES = 100;

/**
 * Schools that have no owner yet (the choices for Add Owner), by name:
 * { schools: [{ id, name, code, location }], total }. `total` can exceed the list (first 100).
 */
export async function loadSchoolsWithoutOwner() {
  const data = await apiRequest('/platform/schools', { query: { owner: 'none', pageSize: SCHOOL_CHOICES } });
  const schools = data.items
    .map(({ id, name, code, location }) => ({ id, name, code, location }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
  return { schools, total: data.total };
}

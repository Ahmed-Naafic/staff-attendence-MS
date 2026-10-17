import { apiRequest } from '../../../lib/api.js';

/*
 * School Management requests (Super Admin). Each resolves to the updated school in the same shape
 * as the list, or throws ApiError: 400 VALIDATION_ERROR (details per field), 404 NOT_FOUND,
 * 409 CODE_TAKEN / INVALID_STATUS.
 */

/** values: { name, code, phone, email, address, city, description, website } */
export const registerSchool = async (values) => (await apiRequest('/platform/schools', { method: 'POST', body: values })).school;

/** values: any of { name, phone, email, address, city, description, website } (never the code). */
export const updateSchool = async (id, values) =>
  (await apiRequest(`/platform/schools/${encodeURIComponent(id)}`, { method: 'PATCH', body: values })).school;

export const suspendSchool = async (id, reason) =>
  (await apiRequest(`/platform/schools/${encodeURIComponent(id)}/suspend`, { method: 'POST', body: { reason } })).school;

export const reactivateSchool = async (id) =>
  (await apiRequest(`/platform/schools/${encodeURIComponent(id)}/reactivate`, { method: 'POST' })).school;

/** A suggested School Code for a name, e.g. "Jamhuriya Academy" → "JA-001". */
export const suggestSchoolCode = async (name) => (await apiRequest('/platform/schools/code-suggestion', { query: { name } })).code;

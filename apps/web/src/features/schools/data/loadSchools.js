import { apiRequest, previewDelay, previewState } from '../../../lib/api.js';
import { PAGE_SIZE } from '../utils/filterSchools.js';

const EMPTY = { items: [], total: 0, page: 1, pageSize: PAGE_SIZE, pageCount: 1, summary: { total: 0, active: 0, pending: 0, suspended: 0 }, locations: [] };

/**
 * One page of schools from the API (GET /api/platform/schools). Search, filters and pagination
 * are applied by the server. Resolves to
 * { items: [{ id, code, name, ownerName, location, status, registeredAt, description }],
 *   total, page, pageSize, pageCount, summary: { total, active, pending, suspended }, locations }.
 */
export async function loadSchools({ query, status, location, registered }, page) {
  // Development only (removed from production builds): preview page states with ?demoState=loading | error | empty
  if (import.meta.env.DEV) {
    const preview = previewState();
    if (preview === 'loading') return new Promise(() => {});
    if (preview) await previewDelay();
    if (preview === 'error') throw new Error('Preview: schools request failed');
    if (preview === 'empty') return EMPTY;
  }

  return apiRequest('/platform/schools', { query: { q: query, status, location, registered, page, pageSize: PAGE_SIZE } });
}

/** One school by id (GET /api/platform/schools/:id); null when it does not exist. */
export async function loadSchool(id) {
  try {
    return (await apiRequest(`/platform/schools/${encodeURIComponent(id)}`)).school;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

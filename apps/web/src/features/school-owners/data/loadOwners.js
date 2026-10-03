import { apiRequest, previewDelay, previewState } from '../../../lib/api.js';
import { PAGE_SIZE } from '../utils/filterOwners.js';

const EMPTY = { items: [], total: 0, page: 1, pageSize: PAGE_SIZE, pageCount: 1, summary: { total: 0, active: 0, pending: 0, suspended: 0 }, locations: [] };

/**
 * One page of school owners from the API (GET /api/platform/owners). Search, filters and
 * pagination are applied by the server. Resolves to
 * { items: [{ id, name, email, phone, status, registeredAt, lastSignInAt, school: { id, name, location, registeredAt } | null }],
 *   total, page, pageSize, pageCount, summary: { total, active, pending, suspended }, locations }.
 */
export async function loadOwners({ query, status, location, registered }, page) {
  // Development only (removed from production builds): preview page states with ?demoState=loading | error | empty
  if (import.meta.env.DEV) {
    const preview = previewState();
    if (preview === 'loading') return new Promise(() => {});
    if (preview) await previewDelay();
    if (preview === 'error') throw new Error('Preview: school owners request failed');
    if (preview === 'empty') return EMPTY;
  }

  return apiRequest('/platform/owners', { query: { q: query, status, location, registered, page, pageSize: PAGE_SIZE } });
}

/** One owner by id (GET /api/platform/owners/:id); null when it does not exist. */
export async function loadOwner(id) {
  try {
    return (await apiRequest(`/platform/owners/${encodeURIComponent(id)}`)).owner;
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

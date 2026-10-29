import { apiRequest } from '../../../lib/api.js';

/**
 * Saves General settings (PUT /api/platform/settings/general) — only the fields given — and
 * returns the saved { information, localization, conflicts, display }.
 */
export async function saveGeneral(values) {
  return (await apiRequest('/platform/settings/general', { method: 'PUT', body: values })).general;
}

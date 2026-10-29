import { apiRequest } from '../../../lib/api.js';

/** Saves the platform name (PUT /api/platform/settings/branding) and returns the saved name. */
export async function saveBranding(platformName) {
  return (await apiRequest('/platform/settings/branding', { method: 'PUT', body: { platformName } })).branding.platformName;
}

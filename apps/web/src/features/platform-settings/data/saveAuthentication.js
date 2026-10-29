import { apiRequest } from '../../../lib/api.js';

/**
 * Saves Authentication Settings (PUT /api/platform/settings/authentication) — `values` holds
 * sessionLifetimeHours and/or inactivityTimeoutMinutes (null = disabled) — and returns the
 * Authentication Settings the server now enforces.
 */
export async function saveAuthentication(values) {
  return (await apiRequest('/platform/settings/authentication', { method: 'PUT', body: values })).authentication;
}

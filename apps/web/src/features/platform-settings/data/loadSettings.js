import { apiRequest, previewDelay, previewState } from '../../../lib/api.js';

/**
 * Loads the platform settings from the API (GET /api/platform/settings), shaped as documented in
 * mockSettings.js. Read-only: there is no save until settings persistence rules are approved.
 */
export async function loadSettings() {
  // Development only (removed from production builds): preview page states with ?demoState=loading | error
  if (import.meta.env.DEV) {
    const preview = previewState();
    if (preview === 'loading') return new Promise(() => {});
    if (preview) await previewDelay();
    if (preview === 'error') throw new Error('Preview: settings request failed');
  }

  return apiRequest('/platform/settings');
}

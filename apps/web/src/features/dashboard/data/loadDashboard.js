import { apiRequest, previewDelay, previewState } from '../../../lib/api.js';

/**
 * Loads the platform dashboard for a time range ('30d' | '90d' | '12m') from the API
 * (GET /api/platform/dashboard). Resolves to the shape documented in mockDashboardData.js.
 */
export async function loadDashboard(range) {
  // Development only (removed from production builds): preview page states with ?demoState=loading | error | empty
  if (import.meta.env.DEV) {
    const preview = previewState();
    if (preview === 'loading') return new Promise(() => {});
    if (preview) await previewDelay();
    if (preview === 'error') throw new Error('Preview: dashboard request failed');
    if (preview === 'empty') return { ...(await import('./mockDashboardData.js')).createEmptyMockDashboard({ range }), isDemo: false };
  }

  return apiRequest('/platform/dashboard', { query: { range } });
}

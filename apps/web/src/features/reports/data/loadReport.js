import { apiRequest, previewDelay, previewState, viewerTimeZone } from '../../../lib/api.js';

/**
 * Loads the platform report for a period ('3m' | '6m' | '12m') from the API
 * (GET /api/platform/reports). Resolves to the shape documented in mockReport.js.
 */
export async function loadReport(period) {
  // Development only (removed from production builds): preview page states with ?demoState=loading | error | empty
  if (import.meta.env.DEV) {
    const preview = previewState();
    if (preview === 'loading') return new Promise(() => {});
    if (preview) await previewDelay();
    if (preview === 'error') throw new Error('Preview: report request failed');
    if (preview === 'empty') return { ...(await import('./mockReport.js')).createEmptyMockReport({ period }), isDemo: false };
  }

  return apiRequest('/platform/reports', { query: { period, tz: viewerTimeZone() } });
}

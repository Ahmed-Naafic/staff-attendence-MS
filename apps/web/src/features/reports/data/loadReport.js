import { apiRequest, previewDelay, previewState } from '../../../lib/api.js';

/**
 * Loads the platform report (GET /api/platform/reports) for a trend period and optional school
 * filters. Days and months are in the platform time zone (`timeZone`, chosen by the server from
 * Platform Settings → General). Filtering and counting happen on the server.
 *
 * Response:
 * {
 *   isDemo: false, generatedAt, timeZone,
 *   filters: { period, status, city },        // status / city: null when not filtered
 *   period:  { value, unit: 'day' | 'month', start, end },
 *   cities:  string[],                        // every city with a school (City filter choices)
 *   schools: { summary: { total, active, suspended }, byCity: [{ city | null, count }], trend: [{ key, count }] },
 *   owners:  { summary: { total, active, suspended }, trend: [{ key, count }] },
 * }
 * Trend keys are 'YYYY-MM-DD' (day) or 'YYYY-MM' (month). `city: null` means no city ("Unknown").
 */
export async function loadReport({ period, status, city }) {
  const request = () => apiRequest('/platform/reports', { query: { period, status, city } });

  // Development only (removed from production builds): preview page states with ?demoState=loading | error | empty
  if (import.meta.env.DEV) {
    const preview = previewState();
    if (preview === 'loading') return new Promise(() => {});
    if (preview) await previewDelay();
    if (preview === 'error') throw new Error('Preview: report request failed');
    if (preview === 'empty') return emptied(await request());
  }

  return request();
}

// The real report with every count at zero (empty-state preview; no figures are invented).
function emptied(report) {
  const none = { total: 0, active: 0, suspended: 0 };
  const zero = (trend) => trend.map((p) => ({ ...p, count: 0 }));
  return {
    ...report,
    cities: [],
    schools: { summary: none, byCity: [], trend: zero(report.schools.trend) },
    owners: { summary: none, trend: zero(report.owners.trend) },
  };
}

import { createEmptyMockReport, createMockReport } from './mockReport.js';

/**
 * Loads the platform report for a period ('3m' | '6m' | '12m').
 *
 * SOURCE: demo data until the backend exists (Phase 9). Replace the body with the API call;
 * it must resolve to the shape documented in mockReport.js.
 */
export async function loadReport(period) {
  // Development only: preview page states with ?demoState=loading | error | empty
  const demoState = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('demoState') : null;
  if (demoState === 'loading') return new Promise(() => {});

  await new Promise((resolve) => setTimeout(resolve, 350)); // simulated network latency

  if (demoState === 'error') throw new Error('Demo: report request failed');
  if (demoState === 'empty') return createEmptyMockReport({ period });
  return createMockReport({ period });
}

import { createEmptyMockDashboard, createMockDashboard } from './mockDashboardData.js';

/**
 * Loads the platform dashboard for a time range ('30d' | '90d' | '12m').
 *
 * SOURCE: demo data until the backend exists (Phase 9). Replace the body with the API
 * call; it must resolve to the shape documented in mockDashboardData.js.
 */
export async function loadDashboard(range) {
  // Development only: preview page states with ?demoState=loading | error | empty
  const demoState = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('demoState') : null;
  if (demoState === 'loading') return new Promise(() => {});

  await new Promise((resolve) => setTimeout(resolve, 350)); // simulated network latency

  if (demoState === 'error') throw new Error('Demo: dashboard request failed');
  if (demoState === 'empty') return createEmptyMockDashboard({ range });
  return createMockDashboard({ range });
}

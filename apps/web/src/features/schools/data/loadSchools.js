import { createEmptyMockSchools, createMockSchools } from './mockSchools.js';

/**
 * Loads the platform's schools with summary figures.
 *
 * SOURCE: demo data until the backend exists (Phase 9). Replace the body with the API call;
 * it must resolve to the shape documented in mockSchools.js. Search, filters and pagination
 * are applied in the browser for now (see utils/filterSchools.js).
 */
export async function loadSchools() {
  // Development only: preview page states with ?demoState=loading | error | empty
  const demoState = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('demoState') : null;
  if (demoState === 'loading') return new Promise(() => {});

  await new Promise((resolve) => setTimeout(resolve, 350)); // simulated network latency

  if (demoState === 'error') throw new Error('Demo: schools request failed');
  if (demoState === 'empty') return createEmptyMockSchools();
  return createMockSchools();
}

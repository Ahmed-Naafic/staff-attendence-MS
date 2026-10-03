import { createMockSettings } from './mockSettings.js';

/**
 * Loads the platform settings.
 *
 * SOURCE: demo data until the backend exists (Phase 9). Replace the body with the API call;
 * it must resolve to the shape documented in mockSettings.js. There is no save yet: changes
 * stay in the page until settings persistence is implemented.
 */
export async function loadSettings() {
  // Development only: preview page states with ?demoState=loading | error
  const demoState = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('demoState') : null;
  if (demoState === 'loading') return new Promise(() => {});

  await new Promise((resolve) => setTimeout(resolve, 350)); // simulated network latency

  if (demoState === 'error') throw new Error('Demo: settings request failed');
  return createMockSettings();
}

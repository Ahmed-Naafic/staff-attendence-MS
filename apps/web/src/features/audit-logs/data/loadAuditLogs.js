import { createEmptyMockAuditLogs, createMockAuditLogs } from './mockAuditLogs.js';

/**
 * Loads the platform's audit events, newest first.
 *
 * SOURCE: demo data until the backend exists (Phase 9). Replace the body with the API call;
 * it must resolve to the shape documented in mockAuditLogs.js. Search, filters and pagination
 * are applied in the browser for now (see utils/filterAuditLogs.js).
 */
export async function loadAuditLogs() {
  // Development only: preview page states with ?demoState=loading | error | empty
  const demoState = import.meta.env.DEV ? new URLSearchParams(window.location.search).get('demoState') : null;
  if (demoState === 'loading') return new Promise(() => {});

  await new Promise((resolve) => setTimeout(resolve, 350)); // simulated network latency

  if (demoState === 'error') throw new Error('Demo: audit log request failed');
  if (demoState === 'empty') return createEmptyMockAuditLogs();
  return createMockAuditLogs();
}

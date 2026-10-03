import { useApiData } from '../../../hooks/useApiData.js';
import { loadAuditEvent, loadAuditLogs } from '../data/loadAuditLogs.js';

/** The current page of audit events: { status, data, retry }. Typing in search waits briefly. */
export function useAuditLogs(filters, page, pageSize) {
  return useApiData(() => loadAuditLogs(filters, page, pageSize), JSON.stringify([filters, page, pageSize]), { delayMs: 200 });
}

/** The event shown in the details panel: the row on the page, or fetched by id (e.g. a shared link). */
export function useAuditEventDetails(logId, rows) {
  const fromPage = logId ? rows?.find((e) => e.id === logId) : undefined;
  const fetched = useApiData(() => (logId && !fromPage ? loadAuditEvent(logId) : Promise.resolve(null)), `${logId}|${Boolean(fromPage)}`);
  if (!logId) return { event: null, notFound: false };
  if (fromPage) return { event: fromPage, notFound: false };
  return { event: fetched.data ?? null, notFound: fetched.status === 'success' && !fetched.data, error: fetched.status === 'error' };
}

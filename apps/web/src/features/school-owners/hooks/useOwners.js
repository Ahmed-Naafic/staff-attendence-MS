import { useApiData } from '../../../hooks/useApiData.js';
import { loadOwner, loadOwners } from '../data/loadOwners.js';

/**
 * The current page of school owners for the filters: { status, data, retry }. Typing in search
 * waits briefly. Changing `version` reloads (e.g. after an owner is added or changed).
 */
export function useOwners(filters, page, version = 0) {
  return useApiData(() => loadOwners(filters, page), JSON.stringify([filters, page, version]), { delayMs: 200 });
}

/** The owner shown in the details panel: the row on the page, or fetched by id (e.g. a shared link). */
export function useOwnerDetails(ownerId, rows, version = 0) {
  const fromPage = ownerId ? rows?.find((o) => o.id === ownerId) : undefined;
  const fetched = useApiData(() => (ownerId && !fromPage ? loadOwner(ownerId) : Promise.resolve(null)), `${ownerId}|${Boolean(fromPage)}|${version}`);
  if (!ownerId) return { owner: null, notFound: false };
  if (fromPage) return { owner: fromPage, notFound: false };
  return { owner: fetched.data ?? null, notFound: fetched.status === 'success' && !fetched.data, error: fetched.status === 'error' };
}

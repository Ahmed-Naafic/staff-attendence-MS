import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useApiData } from '../../../hooks/useApiData.js';
import { managerStatuses } from '../components/ManagerStatusBadge.jsx';
import { loadManager, loadManagers } from '../data/loadManagers.js';

const isId = (value) => /^[0-9a-f-]{36}$/i.test(value ?? '');

/** Search, status and branch filters and page kept in the URL (?q=&status=&branch=&page=), like Branches. */
export function useManagerFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(
    () => ({
      query: params.get('q') ?? '',
      status: managerStatuses[params.get('status')] ? params.get('status') : '',
      branch: isId(params.get('branch')) ? params.get('branch') : '',
    }),
    [params],
  );
  const page = Number(params.get('page')) || 1;
  const isFiltered = Boolean(filters.query || filters.status || filters.branch);

  // Changing a filter returns to page 1. Typing replaces the history entry instead of adding one.
  const setFilter = useCallback(
    (name, value) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          const key = name === 'query' ? 'q' : name;
          if (value) next.set(key, value);
          else next.delete(key);
          next.delete('page');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  const setPage = useCallback(
    (value) =>
      setParams((current) => {
        const next = new URLSearchParams(current);
        if (value > 1) next.set('page', String(value));
        else next.delete('page');
        return next;
      }),
    [setParams],
  );
  const reset = useCallback(() => setParams({}, { replace: true }), [setParams]);
  return { filters, page, isFiltered, setFilter, setPage, reset, search: params.toString() };
}

/** The current page of Managers; changing `version` reloads (after a change). */
export const useManagers = (filters, page, version) =>
  useApiData(() => loadManagers(filters, page), JSON.stringify([filters, page, version]), { delayMs: 200 });

/** The Manager shown in the details panel: { manager, notFound, error, retry }. */
export function useManagerDetails(managerId, version) {
  const fetched = useApiData(() => (managerId ? loadManager(managerId) : Promise.resolve(null)), `${managerId}|${version}`);
  if (!managerId) return { manager: null, notFound: false, error: false, retry: fetched.retry };
  return {
    manager: fetched.data ?? null,
    notFound: fetched.status === 'success' && !fetched.data,
    error: fetched.status === 'error',
    retry: fetched.retry,
  };
}

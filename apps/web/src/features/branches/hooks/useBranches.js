import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useApiData } from '../../../hooks/useApiData.js';
import { branchStatuses } from '../components/BranchStatusBadge.jsx';
import { loadBranch, loadBranches, loadOwnerSchool } from '../data/loadBranches.js';

/** Search, status filter and page kept in the URL (?q=&status=&page=), like the Schools page. */
export function useBranchFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(
    () => ({ query: params.get('q') ?? '', status: branchStatuses[params.get('status')] ? params.get('status') : '' }),
    [params],
  );
  const page = Number(params.get('page')) || 1;
  const isFiltered = Boolean(filters.query || filters.status);

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

/** The current page of branches; changing `version` reloads (after a change). */
export const useBranches = (filters, page, version) =>
  useApiData(() => loadBranches(filters, page), JSON.stringify([filters, page, version]), { delayMs: 200 });

/** The owner's school (name, code, status); reloads with `version`. */
export const useOwnerSchool = (version) => useApiData(loadOwnerSchool, String(version));

/**
 * The branch shown in the details panel, loaded on its own because list rows have no locations:
 * { branch, notFound, error, retry }.
 */
export function useBranchDetails(branchId, version) {
  const fetched = useApiData(() => (branchId ? loadBranch(branchId) : Promise.resolve(null)), `${branchId}|${version}`);
  if (!branchId) return { branch: null, notFound: false, error: false, retry: fetched.retry };
  return {
    branch: fetched.data ?? null,
    notFound: fetched.status === 'success' && !fetched.data,
    error: fetched.status === 'error',
    retry: fetched.retry,
  };
}

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useApiData } from '../../../hooks/useApiData.js';
import { loadStaff, loadStaffList } from '../data/staffApi.js';

const STATUSES = ['active', 'suspended'];

/** Search, status filter and page kept in the URL (?q=&status=&page=), like Branches. */
export function useStaffFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => ({ query: params.get('q') ?? '', status: STATUSES.includes(params.get('status')) ? params.get('status') : '' }), [params]);
  const page = Number(params.get('page')) || 1;
  const isFiltered = Boolean(filters.query || filters.status);
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

/** The current page of staff; changing `version` reloads (after a change). */
export const useStaffList = (filters, page, version) =>
  useApiData(() => loadStaffList(filters, page), JSON.stringify([filters, page, version]), { delayMs: 200 });

/** The staff member shown in the details panel: { staff, notFound, error, retry }. */
export function useStaffDetails(staffId, version) {
  const fetched = useApiData(() => (staffId ? loadStaff(staffId) : Promise.resolve(null)), `${staffId}|${version}`);
  if (!staffId) return { staff: null, notFound: false, error: false, retry: fetched.retry };
  return { staff: fetched.data ?? null, notFound: fetched.status === 'success' && !fetched.data, error: fetched.status === 'error', retry: fetched.retry };
}

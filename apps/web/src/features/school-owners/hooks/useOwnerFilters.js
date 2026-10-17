import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { ownerStatuses } from '../components/OwnerStatusBadge.jsx';

const KEYS = { query: 'q', status: 'status', location: 'location', registered: 'registered' };

/**
 * Search, filters and page kept in the URL (?q=&status=&location=&registered=&page=),
 * so opening an owner, going back, or sharing the link keeps the same view.
 */
export function useOwnerFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo(
    () => ({
      query: params.get(KEYS.query) ?? '',
      // Only current statuses; an old link (e.g. ?status=pending) shows all owners instead of an error.
      status: ownerStatuses[params.get(KEYS.status)] ? params.get(KEYS.status) : '',
      location: params.get(KEYS.location) ?? '',
      registered: params.get(KEYS.registered) ?? '',
    }),
    [params],
  );
  const page = Number(params.get('page')) || 1;
  const isFiltered = Object.values(filters).some(Boolean);

  // Changing any filter returns to page 1. Typing replaces the history entry instead of adding one.
  const setFilter = useCallback(
    (name, value) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value) next.set(KEYS[name], value);
          else next.delete(KEYS[name]);
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

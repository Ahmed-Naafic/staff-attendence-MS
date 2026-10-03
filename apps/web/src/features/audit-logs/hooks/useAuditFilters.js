import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from '../utils/filterAuditLogs.js';

const KEYS = {
  query: 'q',
  action: 'action',
  user: 'user',
  school: 'school',
  status: 'status',
  date: 'date',
  from: 'from',
  to: 'to',
};

/**
 * Search, filters, date range, page and page size kept in the URL
 * (?q=&action=&user=&school=&status=&date=&from=&to=&page=&size=), so opening an event,
 * going back, or sharing the link keeps the same view.
 */
export function useAuditFilters() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo(
    () => Object.fromEntries(Object.entries(KEYS).map(([name, key]) => [name, params.get(key) ?? ''])),
    [params],
  );
  const page = Number(params.get('page')) || 1;
  const size = Number(params.get('size'));
  const pageSize = PAGE_SIZES.includes(size) ? size : DEFAULT_PAGE_SIZE;
  const isFiltered = Object.values(filters).some(Boolean);

  // Changing any filter returns to page 1. Typing replaces the history entry instead of adding one.
  const setFilter = useCallback(
    (name, value) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value) next.set(KEYS[name], value);
          else next.delete(KEYS[name]);
          // Leaving the custom range drops its dates.
          if (name === 'date' && value !== 'custom') {
            next.delete(KEYS.from);
            next.delete(KEYS.to);
          }
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

  const setPageSize = useCallback(
    (value) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value !== DEFAULT_PAGE_SIZE) next.set('size', String(value));
          else next.delete('size');
          next.delete('page');
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  // Reset clears search and filters; the chosen page size stays.
  const reset = useCallback(
    () =>
      setParams(
        (current) => {
          const next = new URLSearchParams();
          if (current.get('size')) next.set('size', current.get('size'));
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  return { filters, page, pageSize, isFiltered, setFilter, setPage, setPageSize, reset, search: params.toString() };
}

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { isFiltered, readView } from '../utils/reportRules.js';

// Filters that change which rows exist: changing one returns to page 1.
const RESETS_PAGE = new Set(['range', 'from', 'to', 'branch', 'staff', 'shift', 'status', 'checkOut', 'q', 'sort']);

/**
 * The report view kept in the URL (?tab=&range=&from=&to=&branch=&staff=&shift=&status=&checkOut=&q=&sort=&page=)
 * so it can be bookmarked and Back works. update({ name: value, … }) sets several at once ('' removes);
 * choosing a branch (or none) also clears the shift (D16). reset() keeps the tab and returns to today.
 */
export function useReportView(role) {
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => readView(params, role), [params, role]);

  const update = useCallback(
    (changes) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [name, value] of Object.entries(changes)) {
            if (value === '' || value === undefined || value === null || (name === 'page' && value <= 1)) next.delete(name);
            else next.set(name, String(value));
            if (RESETS_PAGE.has(name)) next.delete('page');
          }
          if ('branch' in changes && !('shift' in changes)) next.delete('shift');
          if ('range' in changes && changes.range !== 'custom') {
            next.delete('from');
            next.delete('to');
          }
          return next;
        },
        { replace: !('tab' in changes) },
      ),
    [setParams],
  );

  const reset = useCallback(() => setParams(view.tab === 'overview' ? {} : { tab: view.tab }, { replace: true }), [setParams, view.tab]);

  return { view, filtered: isFiltered(view), update, reset };
}

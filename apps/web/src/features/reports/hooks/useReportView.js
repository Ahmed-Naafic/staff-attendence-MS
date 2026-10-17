import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { DEFAULT_PERIOD, periods, schoolStatusOptions } from '../data/reportOptions.js';

const statuses = schoolStatusOptions.map((o) => o.value).filter(Boolean);

/**
 * Report filters kept in the URL (?period=&status=&city=) so a report view can be shared.
 * Unknown values (e.g. an old ?status=pending link) fall back to the default instead of an error.
 */
export function useReportView() {
  const [params, setParams] = useSearchParams();

  const filters = useMemo(
    () => ({
      period: periods.some((p) => p.value === params.get('period')) ? params.get('period') : DEFAULT_PERIOD,
      status: statuses.includes(params.get('status')) ? params.get('status') : '',
      city: params.get('city') ?? '',
    }),
    [params],
  );
  const isFiltered = filters.period !== DEFAULT_PERIOD || Boolean(filters.status || filters.city);

  const setFilter = useCallback(
    (name, value) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value && !(name === 'period' && value === DEFAULT_PERIOD)) next.set(name, value);
          else next.delete(name);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const reset = useCallback(() => setParams({}, { replace: true }), [setParams]);

  return { filters, isFiltered, setFilter, reset };
}

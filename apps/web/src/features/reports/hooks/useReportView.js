import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { periods } from '../data/mockReport.js';

export const reportTabs = ['overview', 'schools', 'owners'];

/** Active tab and period kept in the URL (?tab=&period=) so a report view can be shared. */
export function useReportView() {
  const [params, setParams] = useSearchParams();
  const tab = reportTabs.includes(params.get('tab')) ? params.get('tab') : 'overview';
  const period = periods.some((p) => p.value === params.get('period')) ? params.get('period') : '12m';

  const update = useCallback(
    (key, value, fallback) =>
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value === fallback) next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  const setTab = useCallback((value) => update('tab', value, 'overview'), [update]);
  const setPeriod = useCallback((value) => update('period', value, '12m'), [update]);

  return { tab, period, setTab, setPeriod };
}

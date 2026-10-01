import { useCallback, useEffect, useState } from 'react';
import { loadDashboard } from '../data/loadDashboard.js';

/** { status: 'loading' | 'success' | 'error', data, retry } for the given time range. */
export function useDashboardData(range) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ status: 'loading', data: previous.data }));
    loadDashboard(range).then(
      (data) => !cancelled && setState({ status: 'success', data }),
      () => !cancelled && setState({ status: 'error', data: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [range, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}

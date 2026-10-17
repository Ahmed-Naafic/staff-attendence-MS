import { useCallback, useEffect, useState } from 'react';
import { loadReport } from '../data/loadReport.js';

/** { status: 'loading' | 'success' | 'error', data, retry } for the given filters. */
export function useReport({ period, status, city }) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ status: 'loading', data: previous.data }));
    loadReport({ period, status, city }).then(
      (data) => !cancelled && setState({ status: 'success', data }),
      () => !cancelled && setState({ status: 'error', data: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [period, status, city, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}

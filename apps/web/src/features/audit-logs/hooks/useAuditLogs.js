import { useCallback, useEffect, useState } from 'react';
import { loadAuditLogs } from '../data/loadAuditLogs.js';

/** { status: 'loading' | 'success' | 'error', data, retry } */
export function useAuditLogs() {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((previous) => ({ status: 'loading', data: previous.data }));
    loadAuditLogs().then(
      (data) => !cancelled && setState({ status: 'success', data }),
      () => !cancelled && setState({ status: 'error', data: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}

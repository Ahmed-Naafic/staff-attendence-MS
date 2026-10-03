import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Loads data with `load()` whenever `key` changes (e.g. the serialized filters), keeping the
 * previous data visible while the next request runs. Responses that arrive after a newer request
 * started are ignored. `delayMs` waits before requesting (typing in a search box).
 * Returns { status: 'loading' | 'success' | 'error', data, error, retry }.
 */
export function useApiData(load, key, { delayMs = 0 } = {}) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let active = true;
    setState((previous) => ({ status: 'loading', data: previous.data, error: null }));
    const timer = setTimeout(() => {
      loadRef.current().then(
        (data) => active && setState({ status: 'success', data, error: null }),
        (error) => active && setState({ status: 'error', data: null, error }),
      );
    }, delayMs);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [key, attempt, delayMs]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, retry };
}

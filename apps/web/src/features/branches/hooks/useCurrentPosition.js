import { useCallback, useEffect, useRef, useState } from 'react';
import { locationErrorMessage, positionProblem } from '../utils/branchRules.js';

const IDLE = { status: 'idle', position: null, problem: null, error: null };

/**
 * Captures the device's current position once per request (no tracking). State:
 * { status: 'idle' | 'locating' | 'captured' | 'error', position, problem, error }.
 * `position` is { latitude, longitude, accuracy, capturedAt }; `problem` says why a captured
 * position cannot be used (e.g. accuracy worse than 50 m); `error` why none was captured.
 */
export function useCurrentPosition() {
  const [state, setState] = useState(IDLE);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const capture = useCallback(() => {
    if (!window.isSecureContext) return setState({ ...IDLE, status: 'error', error: locationErrorMessage('insecure') });
    if (!navigator.geolocation) return setState({ ...IDLE, status: 'error', error: locationErrorMessage('unsupported') });
    setState({ ...IDLE, status: 'locating' });
    navigator.geolocation.getCurrentPosition(
      ({ coords, timestamp }) => {
        if (!mounted.current) return;
        const position = { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy, capturedAt: new Date(timestamp).toISOString() };
        setState({ status: 'captured', position, problem: positionProblem(position), error: null });
      },
      (failure) => mounted.current && setState({ ...IDLE, status: 'error', error: locationErrorMessage(failure.code) }),
      // A fresh, precise reading: never a cached one.
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }, []);

  const reset = useCallback(() => setState(IDLE), []);
  return { ...state, capture, reset };
}

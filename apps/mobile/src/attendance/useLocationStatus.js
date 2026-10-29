/*
 * The phone's position for the Home screen's location card, read while Home is in view (and again
 * on request). It never asks for permission: the check-in flow explains and asks
 * (screens/attendance/AttendanceScreen.js). Early feedback only; the check-in screen reads the
 * position again and the server judges the event.
 */
import { useFocusEffect } from '@react-navigation/native';
import * as Location from 'expo-location';
import { useCallback, useRef, useState } from 'react';

/** A reading older than this is shown as needing a new check. */
export const LOCATION_STALE_MS = 2 * 60 * 1000;

/**
 * useLocationStatus(active) → { status, position, locate }
 * status: 'idle' | 'locating' | 'permission' | 'denied' | 'servicesOff' | 'error' | 'ready'
 * position (when ready): { latitude, longitude, accuracy, readAt }.
 */
export function useLocationStatus(active) {
  const [state, setState] = useState({ status: 'idle', position: null });
  const run = useRef(0);

  const locate = useCallback(async () => {
    const id = ++run.current;
    // Only the latest reading counts, and none after Home loses focus.
    const set = (next) => {
      if (run.current === id) setState(next);
    };
    set({ status: 'locating', position: null });
    try {
      const permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted) return set({ status: permission.canAskAgain === false ? 'denied' : 'permission', position: null });
      if (!(await Location.hasServicesEnabledAsync())) return set({ status: 'servicesOff', position: null });
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest });
      set({ status: 'ready', position: { latitude: fix.coords.latitude, longitude: fix.coords.longitude, accuracy: fix.coords.accuracy ?? null, readAt: Date.now() } });
    } catch {
      set({ status: 'error', position: null });
    }
    return undefined;
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!active) return undefined;
      locate();
      return () => {
        run.current += 1;
      };
    }, [active, locate]),
  );

  return { ...state, locate };
}

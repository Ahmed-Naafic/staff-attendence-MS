import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { LoadingState } from '../../components/ui';
import { apiRequest } from '../../lib/api.js';
import { setDisplaySettings } from '../../lib/format.js';

const DisplaySettingsContext = createContext({ applyDisplaySettings: () => {} });

/**
 * Loads the platform display settings (time zone, date and time format from Platform Settings →
 * General) before the signed-in pages render, so every absolute date is shown in the platform time
 * zone from the first render (lib/format.js). Only a Super Admin can read platform settings; other
 * roles have no pages that show dates yet and keep the standard display (UTC). If the settings
 * cannot be loaded, the standard display is used rather than the viewer's own time zone.
 * `applyDisplaySettings(display)` replaces them after General is saved.
 */
export function DisplaySettingsProvider({ enabled, children }) {
  const [ready, setReady] = useState(!enabled);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    apiRequest('/platform/settings')
      .then((data) => setDisplaySettings(data?.settings?.display))
      .catch(() => setDisplaySettings(null))
      .finally(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, [enabled]);

  const applyDisplaySettings = useCallback((display) => setDisplaySettings(display), []);

  return (
    <DisplaySettingsContext.Provider value={{ applyDisplaySettings }}>
      {ready ? children : <LoadingState label="Loading…" />}
    </DisplaySettingsContext.Provider>
  );
}

export const useDisplaySettings = () => useContext(DisplaySettingsContext);

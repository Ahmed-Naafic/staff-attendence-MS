import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../lib/api.js';
import { DEFAULT_PLATFORM_NAME, validPlatformName } from './brandingRules.js';

const BrandingContext = createContext(null);

/**
 * The platform name shown in the sidebar, the browser tab and the sign-in page. Read once from the
 * public endpoint (GET /api/branding, no sign-in). The response is checked against the Branding
 * rules; when the name is not set, invalid, or the request fails, EduTrack is shown.
 * Until the request settles `loaded` is false, so callers can avoid showing one name, then another.
 */
export function BrandingProvider({ children }) {
  const [state, setState] = useState({ name: null, loaded: false });

  useEffect(() => {
    let active = true;
    apiRequest('/branding', { quietUnauthorized: true }).then(
      (data) => active && setState({ name: validPlatformName(data?.platformName), loaded: true }),
      () => active && setState({ name: null, loaded: true }),
    );
    return () => {
      active = false;
    };
  }, []);

  // After a Super Admin saves a new name, the whole app shows it without reloading.
  const setPlatformName = useCallback((value) => setState({ name: validPlatformName(value), loaded: true }), []);

  const value = useMemo(
    () => ({ platformName: state.name ?? DEFAULT_PLATFORM_NAME, loaded: state.loaded, setPlatformName }),
    [state, setPlatformName],
  );
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

/** { platformName (never empty: EduTrack when unavailable), loaded, setPlatformName }. */
export function useBranding() {
  const context = useContext(BrandingContext);
  if (!context) throw new Error('useBranding must be used inside <BrandingProvider>.');
  return context;
}

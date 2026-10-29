/*
 * Light and dark themes from shared tokens (src/theme/tokens.js). The preference — system, light
 * or dark — is saved on the device (key-value table) and applies on the next start too.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { getDatabase, readValue, writeValue } from '../db/database';
import { themes } from './tokens';

export const THEME_PREFERENCES = ['system', 'light', 'dark'];
const KEY = 'theme.preference';

const ThemeContext = createContext({ colors: themes.light, preference: 'system', setPreference: () => {} });

export function ThemeProvider({ children, openDatabase = getDatabase }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState('system');

  useEffect(() => {
    let cancelled = false;
    openDatabase()
      .then((db) => readValue(db, KEY))
      .then((saved) => {
        if (!cancelled && THEME_PREFERENCES.includes(saved)) setPreferenceState(saved);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [openDatabase]);

  const setPreference = useCallback(
    (next) => {
      if (!THEME_PREFERENCES.includes(next)) return;
      setPreferenceState(next);
      openDatabase()
        .then((db) => writeValue(db, KEY, next))
        .catch(() => {});
    },
    [openDatabase],
  );

  const scheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
  const value = useMemo(() => ({ colors: themes[scheme], scheme, preference, setPreference }), [scheme, preference, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);

/*
 * The account's theme, shared with the web app (PUT /api/auth/preferences; the session user carries
 * `theme`). The server's theme applies on this phone whenever it changes there (read with the
 * session: at start, on returning to the app and on the periodic account check). Choosing Light or
 * Dark here saves it to the account; "Use phone setting" stays on this phone only.
 */
import { useCallback, useEffect } from 'react';
import { saveTheme } from '../api/endpoints';
import { useSession } from '../auth/SessionProvider';
import { getDatabase, readValue, writeValue } from '../db/database';
import { useTheme } from './ThemeProvider';

// The account theme last applied on this phone (a device key: kept at sign-out).
const LAST = 'device:theme-account';

export function AccountThemeSync({ openDatabase = getDatabase }) {
  const { user } = useSession();
  const { setPreference } = useTheme();
  const theme = user?.theme;
  useEffect(() => {
    if (theme !== 'light' && theme !== 'dark') return undefined;
    let cancelled = false;
    (async () => {
      const db = await openDatabase();
      if ((await readValue(db, LAST)) === theme) return;
      await writeValue(db, LAST, theme);
      if (!cancelled) setPreference(theme);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [theme, openDatabase, setPreference]);
  return null;
}

/** Chooses a theme on this phone; Light and Dark are also saved to the account (best effort). */
export function useChooseTheme({ openDatabase = getDatabase } = {}) {
  const { api, user } = useSession();
  const { setPreference } = useTheme();
  return useCallback(
    async (next) => {
      setPreference(next);
      if (!user || (next !== 'light' && next !== 'dark')) return;
      await openDatabase()
        .then((db) => writeValue(db, LAST, next))
        .catch(() => {});
      await saveTheme(api, next).catch(() => {});
    },
    [api, user, openDatabase, setPreference],
  );
}

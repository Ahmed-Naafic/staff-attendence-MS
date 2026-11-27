/*
 * Server data for a screen, with an offline copy (docs/mobile/workspaces.md → Dashboards):
 * - loaded when the screen opens, when the branch or workspace changes (`version`), when the app
 *   returns to the foreground and on pull-to-refresh — never on a timer;
 * - each answer is kept on this phone (encrypted database, account cache: removed at sign-out) with
 *   the time it was fetched, and shown when the server cannot be reached, marked as saved;
 * - a saved copy stays until a newer answer replaces it.
 * `cache: false` keeps nothing on the phone (e.g. a student's financial details); `maxAgeMs` makes a
 * short-lived copy (older copies are not shown, e.g. financial dashboards: 24 hours).
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useSession } from '../auth/SessionProvider';
import { getDatabase, readValue, writeValue } from '../db/database';
import { useWorkspace } from '../workspace/WorkspaceProvider';

/**
 * useCachedResource(key, loader, { cache = true, deps = [] })
 * → { data, fetchedAt, saved, loading, error, reload }. `key` is per account and branch (added here).
 */
export function useCachedResource(key, loader, { cache = true, maxAgeMs = null, deps = [], openDatabase = getDatabase } = {}) {
  const { api, user } = useSession();
  const { branchId, version } = useWorkspace();
  const [state, setState] = useState({ data: null, fetchedAt: null, saved: false, loading: true, error: null });
  const cacheKey = `cache:${user?.id}:${branchId ?? '-'}:${key}`;
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await loaderRef.current(api, { branchId });
      const fetchedAt = new Date().toISOString();
      setState({ data, fetchedAt, saved: false, loading: false, error: null });
      if (cache) await writeValue(await openDatabase(), cacheKey, { data, fetchedAt }).catch(() => {});
    } catch (error) {
      let copy = cache ? await openDatabase().then((db) => readValue(db, cacheKey)).catch(() => null) : null;
      if (copy && maxAgeMs && Date.now() - Date.parse(copy.fetchedAt) > maxAgeMs) copy = null;
      setState((s) => {
        if (s.data && !s.saved) return { ...s, loading: false, error };
        return copy ? { data: copy.data, fetchedAt: copy.fetchedAt, saved: true, loading: false, error } : { ...s, loading: false, error };
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, cacheKey, cache, maxAgeMs, openDatabase, branchId, version, ...deps]);

  // Load on mount and whenever the inputs change; reload when the screen comes back into view.
  const mounted = useRef(false);
  useEffect(() => {
    reload();
  }, [reload]);
  useFocusEffect(
    useCallback(() => {
      if (mounted.current) reload();
      mounted.current = true;
    }, [reload]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') reload();
    });
    return () => sub?.remove?.();
  }, [reload]);

  return { ...state, reload };
}

/** "Updated 10:42" / "Updated 27 Nov, 10:42" for a fetch time. */
export function updatedText(fetchedAt, now = new Date()) {
  if (!fetchedAt) return '';
  const at = new Date(fetchedAt);
  const time = at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sameDay = at.toDateString() === now.toDateString();
  return sameDay ? `Updated ${time}` : `Updated ${at.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

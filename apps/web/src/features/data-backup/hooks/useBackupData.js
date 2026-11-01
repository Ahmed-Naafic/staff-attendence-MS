import { useCallback, useEffect, useRef, useState } from 'react';
import { loadConfiguration, loadOverview, loadRestores } from '../data/backupApi.js';

const POLL_MS = 5000;

/**
 * The Data & Backup overview, configuration and restores. Reloads every 5 s while a backup or a
 * staged restore is running (each load also advances them at the server; it never restores
 * production). → { status: 'loading' | 'ready' | 'error', overview, configuration, restores, reload }.
 */
export function useBackupData() {
  const [state, setState] = useState({ status: 'loading', overview: null, configuration: null, restores: [], error: null });
  const controller = useRef(null);
  const loading = useRef(false);

  // An explicit reload (after an action) replaces a load in flight; a poll waits for it instead,
  // so a slow answer is never cancelled over and over.
  const reload = useCallback(async ({ poll = false } = {}) => {
    if (poll && loading.current) return;
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    loading.current = true;
    try {
      const [overview, configuration, restores] = await Promise.all([loadOverview(ctrl.signal), loadConfiguration(ctrl.signal), loadRestores(ctrl.signal)]);
      if (!ctrl.signal.aborted) setState({ status: 'ready', overview, configuration, restores: restores.items, error: null });
    } catch (error) {
      if (error.name === 'AbortError') return;
      // 401: the app returns to the sign-in page.
      setState((s) => ({ ...s, status: s.overview ? 'ready' : 'error', error }));
    } finally {
      if (controller.current === ctrl) loading.current = false;
    }
  }, []);

  useEffect(() => {
    reload();
    return () => controller.current?.abort();
  }, [reload]);

  const busy = Boolean(state.overview?.runningBackup || state.overview?.activeRestore?.status === 'RUNNING');
  useEffect(() => {
    if (!busy) return undefined;
    const timer = setInterval(() => reload({ poll: true }), POLL_MS);
    return () => clearInterval(timer);
  }, [busy, reload]);

  return { ...state, reload };
}

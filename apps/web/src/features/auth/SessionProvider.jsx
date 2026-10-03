import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onUnauthorized } from '../../lib/api.js';
import { fetchSession, signIn as apiSignIn, signOut as apiSignOut } from './authApi.js';

// Single source of "who is signed in" for the web app: the API session (an httpOnly cookie the
// browser sends with every /api request). The browser never sees the session token itself.
const SessionContext = createContext(null);

/**
 * status: 'checking' (restoring the session on load) | 'signed-in' | 'signed-out' | 'unavailable'
 * (the API could not be reached while checking; `retry` checks again).
 */
export function SessionProvider({ children }) {
  const [state, setState] = useState({ status: 'checking', user: null, ended: false });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    fetchSession().then(
      (user) => active && setState({ status: user ? 'signed-in' : 'signed-out', user, ended: false }),
      () => active && setState({ status: 'unavailable', user: null, ended: false }),
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  // Any API call answered with 401 means the session expired or was revoked.
  useEffect(
    () =>
      onUnauthorized(() =>
        setState((current) => (current.status === 'signed-in' ? { status: 'signed-out', user: null, ended: true } : current)),
      ),
    [],
  );

  const signIn = useCallback(async (email, password) => {
    const user = await apiSignIn(email, password);
    setState({ status: 'signed-in', user, ended: false });
    return user;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await apiSignOut();
    } finally {
      setState({ status: 'signed-out', user: null, ended: false });
    }
  }, []);

  const retry = useCallback(() => {
    setState({ status: 'checking', user: null, ended: false });
    setAttempt((n) => n + 1);
  }, []);

  const value = useMemo(() => ({ ...state, signIn, signOut, retry }), [state, signIn, signOut, retry]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** { status, user: { id, name, role } | null, ended, signIn, signOut, retry }. */
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside <SessionProvider>.');
  return session;
}

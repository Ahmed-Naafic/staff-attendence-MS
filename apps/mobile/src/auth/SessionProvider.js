/*
 * The signed-in session (docs/business-rules.md → Staff mobile app → Sign-in and passwords).
 * status:
 *   'restoring'          reading the stored token and checking it with the server
 *   'signedOut'          no session (notice: why, e.g. the session ended)
 *   'mustChangePassword' a temporary password must be replaced before anything else
 *   'ready'              a STAFF session that can use attendance (offline: the stored account)
 * Only STAFF accounts use the app; any other account is signed out at once with an explanation.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, createApiClient } from '../api/client';
import { changeTemporaryPassword, readSession, signIn as apiSignIn, signOut as apiSignOut } from '../api/endpoints';
import { apiBaseUrl, REQUEST_TIMEOUT_MS } from '../config';
import * as defaultTokenStore from './tokenStore';

const SessionContext = createContext(null);

const NOT_STAFF = 'This app is for staff attendance. Attendance for Managers is not available in the app yet; use the EduTrack web app.';
export const SESSION_ENDED = 'Your session has ended. Sign in again.';

export function SessionProvider({ children, baseUrl = apiBaseUrl(), fetchImpl, tokenStore = defaultTokenStore, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const [state, setState] = useState({ status: 'restoring', user: null, notice: null, offline: false });
  const tokenRef = useRef(null);

  const endLocally = useCallback(
    async (notice) => {
      tokenRef.current = null;
      await tokenStore.clearStoredSession().catch(() => {});
      setState({ status: 'signedOut', user: null, notice, offline: false });
    },
    [tokenStore],
  );

  // The ref is read only when a request is made (getToken, onUnauthorized), never during render.
  /* eslint-disable react-hooks/refs */
  const api = useMemo(
    () =>
      createApiClient({
        baseUrl,
        fetchImpl,
        timeoutMs,
        getToken: async () => tokenRef.current,
        // The server ended the session (expiry, inactivity, suspension, reset): back to sign-in.
        // Queued events are kept on the device for this account.
        onUnauthorized: () => {
          if (tokenRef.current) endLocally(SESSION_ENDED);
        },
        onPasswordChangeRequired: () => setState((s) => (s.user ? { ...s, status: 'mustChangePassword', user: { ...s.user, mustChangePassword: true } } : s)),
      }),
    [baseUrl, fetchImpl, timeoutMs, endLocally],
  );
  /* eslint-enable react-hooks/refs */

  const statusFor = (user) => (user.mustChangePassword ? 'mustChangePassword' : 'ready');

  // Restore a stored session on start.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await tokenStore.readStoredSession().catch(() => null);
      if (!stored) return !cancelled && setState({ status: 'signedOut', user: null, notice: null, offline: false });
      tokenRef.current = stored.token;
      try {
        const user = await readSession(api);
        if (cancelled) return;
        if (!user) return endLocally(SESSION_ENDED);
        if (user.role !== 'STAFF') {
          await apiSignOut(api).catch(() => {});
          return endLocally(NOT_STAFF);
        }
        await tokenStore.storeUser(user).catch(() => {});
        setState({ status: statusFor(user), user, notice: null, offline: false });
      } catch (error) {
        if (cancelled) return;
        // No answer from the server: continue with the stored account (attendance is queued).
        if (error instanceof ApiError && error.retryable && stored.user?.role === 'STAFF') {
          setState({ status: statusFor(stored.user), user: stored.user, notice: null, offline: true });
        } else if (error instanceof ApiError && error.retryable) {
          setState({ status: 'signedOut', user: null, notice: 'No connection to the EduTrack server. Try again.', offline: true });
        } else {
          endLocally(SESSION_ENDED);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once on start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = useCallback(
    async ({ phone, password }) => {
      const { token, user } = await apiSignIn(api, { phone, password });
      tokenRef.current = token;
      if (user.role !== 'STAFF') {
        await apiSignOut(api).catch(() => {});
        tokenRef.current = null;
        throw new ApiError({ kind: 'http', status: 403, code: 'NOT_STAFF', message: NOT_STAFF });
      }
      await tokenStore.storeSession(token, user);
      setState({ status: statusFor(user), user, notice: null, offline: false });
      return user;
    },
    [api, tokenStore],
  );

  const changePassword = useCallback(
    async ({ currentPassword, newPassword }) => {
      const user = await changeTemporaryPassword(api, { currentPassword, newPassword });
      await tokenStore.storeUser(user).catch(() => {});
      setState({ status: statusFor(user), user, notice: null, offline: false });
      return user;
    },
    [api, tokenStore],
  );

  /** Ends the session on the server when reachable, and always on the device. */
  const signOut = useCallback(async () => {
    await apiSignOut(api).catch(() => {});
    await endLocally(null);
  }, [api, endLocally]);

  const configured = Boolean(baseUrl);
  const value = useMemo(() => ({ ...state, configured, api, signIn, signOut, changePassword }), [state, configured, api, signIn, signOut, changePassword]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider.');
  return value;
}

/*
 * The signed-in session (docs/business-rules.md → Staff mobile app → Sign-in and passwords).
 * status:
 *   'restoring'          reading the stored token and checking it with the server
 *   'signedOut'          no session (notice: why, e.g. the session ended)
 *   'mustChangePassword' a temporary password must be replaced before anything else
 *   'ready'              a STAFF, MANAGER or ACCOUNTANT session (offline: the stored account)
 * Owners and Platform Admins use the web app; they are signed out at once with an explanation.
 *
 * The account (role, Fee Management access, theme, status) is checked with the server every five
 * minutes while the app is open and whenever it returns to the foreground (`verified`: the last
 * check succeeded). A session the server no longer accepts ends here. When the check cannot reach
 * the server, `verified` is false: sensitive online actions and uploads wait, safe offline work
 * goes on. The server stays the authority on every request.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { ApiError, createApiClient } from '../api/client';
import { changeTemporaryPassword, readSession, signIn as apiSignIn, signOut as apiSignOut } from '../api/endpoints';
import { apiBaseUrl, REQUEST_TIMEOUT_MS } from '../config';
import * as defaultTokenStore from './tokenStore';
import { clearAccountCaches, getDatabase } from '../db/database';
import { checkRemoteWipe, deviceInfo, storeDeviceSecret } from '../devices/deviceIdentity';
import { MOBILE_ROLES } from '../workspace/workspaces';

export const ACCOUNT_CHECK_MS = 5 * 60_000;

/** Removes the signed-out account's cached copies from the device (waiting uploads are kept). */
const defaultClearCaches = async () => clearAccountCaches(await getDatabase());

const SessionContext = createContext(null);

const NOT_MOBILE = 'This account uses the EduTrack web app. The mobile app is for staff, Managers and Accountants.';
const mobileRole = (user) => MOBILE_ROLES.includes(user?.role);
export const SESSION_ENDED = 'Your session has ended. Sign in again.';
export const PHONE_WIPED = 'This phone was reported lost or stolen, so its EduTrack data was deleted. Sign in again to register it as a new phone.';

export function SessionProvider({ children, baseUrl = apiBaseUrl(), fetchImpl, tokenStore = defaultTokenStore, timeoutMs = REQUEST_TIMEOUT_MS, clearCaches = defaultClearCaches, checkWipe = checkRemoteWipe, device = deviceInfo }) {
  const [state, setState] = useState({ status: 'restoring', user: null, notice: null, offline: false, verified: false, checkedAt: null });
  const tokenRef = useRef(null);
  const wipeCheckRef = useRef(null);

  const endLocally = useCallback(
    async (notice) => {
      tokenRef.current = null;
      await tokenStore.clearStoredSession().catch(() => {});
      // Cached students, classes, timetable, day and profile leave the device with the session.
      await clearCaches().catch(() => {});
      setState({ status: 'signedOut', user: null, notice, offline: false, verified: false, checkedAt: null });
    },
    [tokenStore, clearCaches],
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
          if (!tokenRef.current) return;
          endLocally(SESSION_ENDED);
          // A revoked or lost phone: a registered wipe is carried out now.
          wipeCheckRef.current?.().then((result) => result === 'wiped' && setState({ status: 'signedOut', user: null, notice: PHONE_WIPED, offline: false, verified: false, checkedAt: null }));
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
      // A remote wipe comes first: before the session, any upload or any cached data is used.
      wipeCheckRef.current = () => checkWipe(api).catch(() => 'unknown');
      if ((await wipeCheckRef.current()) === 'wiped') {
        tokenRef.current = null;
        return !cancelled && setState({ status: 'signedOut', user: null, notice: PHONE_WIPED, offline: false, verified: false, checkedAt: null });
      }
      const stored = await tokenStore.readStoredSession().catch(() => null);
      if (!stored) return !cancelled && setState({ status: 'signedOut', user: null, notice: null, offline: false });
      tokenRef.current = stored.token;
      try {
        const user = await readSession(api);
        if (cancelled) return;
        if (!user) return endLocally(SESSION_ENDED);
        if (!mobileRole(user)) {
          await apiSignOut(api).catch(() => {});
          return endLocally(NOT_MOBILE);
        }
        await tokenStore.storeUser(user).catch(() => {});
        setState({ status: statusFor(user), user, notice: null, offline: false, verified: true, checkedAt: new Date().toISOString() });
      } catch (error) {
        if (cancelled) return;
        // No answer from the server: continue with the stored account (attendance is queued).
        if (error instanceof ApiError && error.retryable && mobileRole(stored.user)) {
          setState({ status: statusFor(stored.user), user: stored.user, notice: null, offline: true, verified: false, checkedAt: null });
        } else if (error instanceof ApiError && error.retryable) {
          setState({ status: 'signedOut', user: null, notice: 'No connection to the EduTrack server. Try again.', offline: true, verified: false, checkedAt: null });
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
      const login = await apiSignIn(api, { phone, password, device: await device().catch(() => null) });
      const { token, user } = login;
      tokenRef.current = token;
      // A newly registered phone gets its device secret once (for its status and a remote wipe).
      if (login.device?.secret) await storeDeviceSecret(login.device.secret).catch(() => {});
      if (!mobileRole(user)) {
        await apiSignOut(api).catch(() => {});
        tokenRef.current = null;
        throw new ApiError({ kind: 'http', status: 403, code: 'WEB_ONLY_ACCOUNT', message: NOT_MOBILE });
      }
      // Nothing of an earlier account stays cached for this one (its waiting uploads stay its own).
      await clearCaches().catch(() => {});
      await tokenStore.storeSession(token, user);
      setState({ status: statusFor(user), user, notice: null, offline: false, verified: true, checkedAt: new Date().toISOString() });
      return user;
    },
    [api, tokenStore, clearCaches, device],
  );

  const changePassword = useCallback(
    async ({ currentPassword, newPassword }) => {
      const user = await changeTemporaryPassword(api, { currentPassword, newPassword });
      await tokenStore.storeUser(user).catch(() => {});
      setState({ status: statusFor(user), user, notice: null, offline: false, verified: true, checkedAt: new Date().toISOString() });
      return user;
    },
    [api, tokenStore],
  );

  /**
   * Checks the account with the server: new permissions apply at once; a session the server no
   * longer accepts ends (via onUnauthorized); an account that may no longer use the app is signed
   * out. → true when verified.
   */
  const refreshAccount = useCallback(async () => {
    if (!tokenRef.current) return false;
    try {
      const user = await readSession(api);
      if (!user) {
        await endLocally(SESSION_ENDED);
        return false;
      }
      if (!mobileRole(user)) {
        await apiSignOut(api).catch(() => {});
        await endLocally(NOT_MOBILE);
        return false;
      }
      await tokenStore.storeUser(user).catch(() => {});
      setState((s) => (s.user ? { ...s, status: statusFor(user), user, offline: false, verified: true, checkedAt: new Date().toISOString() } : s));
      return true;
    } catch {
      // No answer: keep working offline, unverified (fail closed for sensitive actions).
      setState((s) => (s.user ? { ...s, offline: true, verified: false } : s));
      return false;
    }
  }, [api, endLocally, tokenStore]);

  // Every five minutes while the app is open, and on returning to it.
  const signedIn = state.status === 'ready' || state.status === 'mustChangePassword';
  useEffect(() => {
    if (!signedIn) return undefined;
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') refreshAccount();
    }, ACCOUNT_CHECK_MS);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') refreshAccount();
    });
    return () => {
      clearInterval(timer);
      sub?.remove?.();
    };
  }, [signedIn, refreshAccount]);

  /** Ends the session on the server when reachable, and always on the device. */
  const signOut = useCallback(async () => {
    await apiSignOut(api).catch(() => {});
    await endLocally(null);
  }, [api, endLocally]);

  const configured = Boolean(baseUrl);
  const value = useMemo(() => ({ ...state, configured, api, signIn, signOut, changePassword, refreshAccount }), [state, configured, api, signIn, signOut, changePassword, refreshAccount]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider.');
  return value;
}

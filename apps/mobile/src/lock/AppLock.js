/*
 * The app lock (docs/mobile/app-lock.md). With a PIN or fingerprint / face unlock turned on in
 * Settings, the app locks when it starts and after one minute in the background. Three failed
 * attempts ask for the EduTrack password, checked by the server (POST /api/auth/verify-password,
 * rate-limited like sign-in). Offline, the password cannot be checked: the app stays locked; signing
 * out is always possible and keeps waiting uploads for this account.
 * The lock covers the screens only; the session and every server check are unchanged.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { verifyPassword } from '../api/endpoints';
import { userMessage } from '../api/errors';
import { useSession } from '../auth/SessionProvider';
import { AppText, Button, Logo, Notice, Screen, TextField } from '../components/ui';
import { space } from '../theme/tokens';
import { checkPin, lockFor, MAX_FAILURES, shouldLock } from './lockStore';

const LockContext = createContext({ reloadLock: async () => {} });
export const useAppLock = () => useContext(LockContext);

/** Whether fingerprint / face unlock can be used on this phone. */
export async function biometricAvailable() {
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
  } catch {
    return false;
  }
}

export function AppLockGate({ children, clock = () => Date.now() }) {
  const { user } = useSession();
  const [lock, setLock] = useState(undefined); // undefined: not read yet
  const [locked, setLocked] = useState(false);
  const awaySince = useRef(null);
  const userId = user?.id;

  const reloadLock = useCallback(async () => {
    const current = userId ? await lockFor(userId) : null;
    setLock(current);
    return current;
  }, [userId]);

  // On start (and for a new account): locked when a lock is set.
  useEffect(() => {
    let cancelled = false;
    // State is set only after secure storage answers (asynchronously).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reloadLock().then((current) => {
      if (!cancelled) setLocked(Boolean(current));
    });
    return () => {
      cancelled = true;
    };
  }, [reloadLock]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background' || next === 'inactive') awaySince.current ??= clock();
      if (next === 'active') {
        const away = awaySince.current === null ? 0 : clock() - awaySince.current;
        awaySince.current = null;
        if (shouldLock(lock, away)) setLocked(true);
      }
    });
    return () => sub?.remove?.();
  }, [lock, clock]);

  if (lock === undefined) return null;
  return (
    <LockContext.Provider value={{ reloadLock }}>
      {locked && lock ? <LockScreen lock={lock} onUnlock={() => setLocked(false)} /> : children}
    </LockContext.Provider>
  );
}

function LockScreen({ lock, onUnlock }) {
  const { api, user, signOut } = useSession();
  const [failures, setFailures] = useState(0);
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const needPassword = failures >= MAX_FAILURES;

  const fail = (text) => {
    setFailures((n) => n + 1);
    setMessage(text);
  };

  async function biometric() {
    try {
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock EduTrack', disableDeviceFallback: true, cancelLabel: 'Use PIN' });
      if (result.success) return onUnlock();
      if (result.error !== 'user_cancel' && result.error !== 'system_cancel') fail('Not recognised. Try again.');
    } catch {
      fail('Fingerprint or face unlock is not available. Use your PIN.');
    }
  }

  useEffect(() => {
    // Offered once when the lock screen opens (state changes only after the system prompt answers).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (lock.biometric && !needPassword) biometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function enterPin() {
    if (await checkPin(lock, pin)) return onUnlock();
    setPin('');
    fail(failures + 1 >= MAX_FAILURES ? 'Too many attempts. Enter your EduTrack password.' : 'Wrong PIN.');
  }

  async function enterPassword() {
    setBusy(true);
    setMessage(null);
    try {
      await verifyPassword(api, password);
      onUnlock();
    } catch (e) {
      setPassword('');
      setMessage(e?.code === 'WRONG_PASSWORD' ? 'That is not your password.' : userMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.wrap}>
        <Logo size={56} />
        <AppText variant="section" style={{ marginTop: space(4) }}>
          EduTrack is locked
        </AppText>
        <AppText variant="small" style={{ marginBottom: space(5) }}>
          {user?.name}
        </AppText>
        {message ? <Notice tone="error" message={message} /> : null}
        {needPassword ? (
          <View style={styles.form}>
            <TextField testID="unlock-password" label="EduTrack password" icon="lock-closed-outline" value={password} onChangeText={setPassword} secure />
            <Button testID="unlock-with-password" title="Unlock" loading={busy} disabled={!password || busy} onPress={enterPassword} />
          </View>
        ) : (
          <View style={styles.form}>
            {lock.pin ? <TextField testID="unlock-pin" label="PIN" icon="keypad-outline" value={pin} onChangeText={(t) => setPin(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" secure /> : null}
            {lock.pin ? <Button testID="unlock-with-pin" title="Unlock" disabled={pin.length < 4} onPress={enterPin} /> : null}
            {lock.biometric ? <Button testID="unlock-biometric" title="Use fingerprint or face" variant="secondary" icon="finger-print" onPress={biometric} /> : null}
          </View>
        )}
        <Button testID="lock-sign-out" title="Sign out" variant="ghost" onPress={() => signOut()} style={{ marginTop: space(6) }} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space(6) },
  form: { alignSelf: 'stretch', gap: space(3), marginTop: space(3) },
});

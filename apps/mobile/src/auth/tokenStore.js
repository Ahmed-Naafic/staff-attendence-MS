/*
 * The session token, kept only in the platform's secure storage (Android Keystore-backed via
 * expo-secure-store). Never written to the device database, logs or screens.
 */
import * as SecureStore from 'expo-secure-store';

const TOKEN = 'edutrack.session.token';
const ACCOUNT = 'edutrack.session.account';

/** { token, user } or null. */
export async function readStoredSession() {
  const token = await SecureStore.getItemAsync(TOKEN);
  if (!token) return null;
  let user = null;
  try {
    user = JSON.parse((await SecureStore.getItemAsync(ACCOUNT)) ?? 'null');
  } catch {
    user = null;
  }
  return { token, user };
}

// The account fields kept for offline start (no secrets).
const account = (user) => JSON.stringify({ id: user.id, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword, feeAccess: user.feeAccess === true, theme: user.theme ?? null });

export async function storeSession(token, user) {
  await SecureStore.setItemAsync(TOKEN, token);
  await SecureStore.setItemAsync(ACCOUNT, account(user));
}

export async function storeUser(user) {
  await SecureStore.setItemAsync(ACCOUNT, account(user));
}

export async function clearStoredSession() {
  await SecureStore.deleteItemAsync(TOKEN);
  await SecureStore.deleteItemAsync(ACCOUNT);
  // The app lock (PIN hash, fingerprint setting) belongs to the session's account.
  await SecureStore.deleteItemAsync('edutrack.lock').catch(() => {});
}

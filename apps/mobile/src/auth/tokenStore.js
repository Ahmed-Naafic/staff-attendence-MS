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

export async function storeSession(token, user) {
  await SecureStore.setItemAsync(TOKEN, token);
  await SecureStore.setItemAsync(ACCOUNT, JSON.stringify({ id: user.id, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword }));
}

export async function storeUser(user) {
  await SecureStore.setItemAsync(ACCOUNT, JSON.stringify({ id: user.id, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword }));
}

export async function clearStoredSession() {
  await SecureStore.deleteItemAsync(TOKEN);
  await SecureStore.deleteItemAsync(ACCOUNT);
}

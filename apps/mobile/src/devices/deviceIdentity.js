/*
 * This phone's identity for device registration (docs/mobile/devices.md): a random installation id
 * made on first use and the device secret the server gives once at registration. Both are kept in
 * secure storage (this device only). They survive signing out, so the phone keeps its registration,
 * and are deleted by a remote wipe.
 *
 * Remote wipe: before anything else at start (and when the server ends a session), the phone asks
 * POST /api/devices/status with its secret (no session needed). When a wipe is registered, the
 * phone deletes, before any upload: the device database (waiting attendance events, lesson marks,
 * examination drafts, cached students, classes and fee data), its encryption key, the session,
 * the app lock and this identity; then it reports the wipe complete.
 */
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { APP_VERSION } from '../config';
import { wipeDatabase } from '../db/database';

const INSTALLATION = 'edutrack.device.installation';
const SECRET = 'edutrack.device.secret';
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const SESSION_KEYS = ['edutrack.session.token', 'edutrack.session.account', 'edutrack.lock'];

export async function installationId() {
  const existing = await SecureStore.getItemAsync(INSTALLATION, OPTIONS);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await SecureStore.setItemAsync(INSTALLATION, id, OPTIONS);
  return id;
}

/** The `device` object sent with a mobile sign-in. */
export async function deviceInfo() {
  return {
    installationId: await installationId(),
    name: (Constants.deviceName || (Platform.OS === 'ios' ? 'iPhone' : 'Android phone')).slice(0, 80),
    platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'other',
    model: Platform.constants?.Model ?? null,
    appVersion: APP_VERSION,
  };
}

export const storeDeviceSecret = (secret) => SecureStore.setItemAsync(SECRET, secret, OPTIONS);
const readSecret = () => SecureStore.getItemAsync(SECRET, OPTIONS);

/** Deletes everything EduTrack keeps on this phone. */
export async function wipeEverything() {
  await wipeDatabase();
  for (const key of [...SESSION_KEYS, SECRET, INSTALLATION]) await SecureStore.deleteItemAsync(key, OPTIONS).catch(() => {});
}

/**
 * Asks the server whether this phone must be wiped, and wipes it. → 'wiped' | 'ok' | 'unknown'
 * (no registration yet, or no answer: nothing changes).
 */
export async function checkRemoteWipe(api) {
  const [id, secret] = await Promise.all([SecureStore.getItemAsync(INSTALLATION, OPTIONS), readSecret()]);
  if (!id || !secret) return 'unknown';
  let answer;
  try {
    answer = (await api.request('/api/devices/status', { method: 'POST', auth: false, body: { installationId: id, secret } })).data;
  } catch {
    return 'unknown';
  }
  if (!answer?.wipe) return answer?.status === 'unknown' ? 'unknown' : 'ok';
  await wipeEverything();
  // Reported with the identity read before the wipe (best effort; the server already knows it was delivered).
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await api.request('/api/devices/wipe-complete', { method: 'POST', auth: false, body: { installationId: id, secret } });
      break;
    } catch {
      // Try again (no answer); the wipe on the phone is already done.
    }
  }
  return 'wiped';
}

/*
 * App lock settings on this phone (docs/mobile/app-lock.md): an optional PIN and optional
 * fingerprint / face unlock, for one account. Kept only in secure storage (Keystore / Keychain, this
 * device only). The PIN is never stored: only a salted SHA-256 hash. The lock is a convenience on
 * the phone and never replaces the server's sign-in: the session token still decides every request.
 * Removed at sign-out with the session.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

export const LOCK_KEY = 'edutrack.lock';
export const LOCK_AFTER_MS = 60_000;
export const MAX_FAILURES = 3;
const OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const hashOf = (salt, pin) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);

/** → { userId, pin: { salt, hash } | null, biometric: boolean } or null (no lock). */
export async function readLock() {
  try {
    const value = JSON.parse((await SecureStore.getItemAsync(LOCK_KEY, OPTIONS)) ?? 'null');
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

const write = (value) => SecureStore.setItemAsync(LOCK_KEY, JSON.stringify(value), OPTIONS);

/** The lock of this account, or null (another account's settings do not apply). */
export async function lockFor(userId) {
  const lock = await readLock();
  return lock && lock.userId === userId && (lock.pin || lock.biometric) ? lock : null;
}

export const isValidPin = (pin) => /^\d{4,6}$/.test(pin);

export async function setPin(userId, pin) {
  if (!isValidPin(pin)) throw new Error('A PIN is 4 to 6 digits.');
  const lock = (await readLock())?.userId === userId ? await readLock() : { userId, biometric: false };
  const salt = hex(await Crypto.getRandomBytesAsync(16));
  await write({ ...lock, userId, pin: { salt, hash: await hashOf(salt, pin) } });
}

export async function setBiometric(userId, on) {
  const lock = (await readLock())?.userId === userId ? await readLock() : { userId, pin: null };
  await write({ ...lock, userId, biometric: Boolean(on) });
}

/** Turns the lock off for this account. */
export async function clearLock() {
  await SecureStore.deleteItemAsync(LOCK_KEY, OPTIONS).catch(() => {});
}

export async function checkPin(lock, pin) {
  if (!lock?.pin || !isValidPin(pin)) return false;
  return (await hashOf(lock.pin.salt, pin)) === lock.pin.hash;
}

/** Whether the app should lock when it comes back after `awayMs` in the background. */
export const shouldLock = (lock, awayMs) => Boolean(lock) && awayMs >= LOCK_AFTER_MS;

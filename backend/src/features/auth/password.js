import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

// scrypt parameters (memory-hard). Stored with each hash so they can be raised later.
const N = 16384;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;

/** Hashes a password: "scrypt$N$r$p$salt$hash" (base64). */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, KEY_LENGTH, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$');
}

/** Constant-time comparison of a password with a stored hash. False for malformed hashes. */
export async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : [];
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// A real hash of a random password: checked when the account does not exist, so a missing
// account takes as long to reject as a wrong password.
const dummyHash = hashPassword(randomBytes(16).toString('hex'));
export const verifyAgainstDummy = async (password) => verifyPassword(password, await dummyHash);

/** Password rule for accounts created by the CLI script (a technical minimum, not a policy). */
export const MIN_PASSWORD_LENGTH = 12;

import { tooManyRequests } from '../../common/httpError.js';

/*
 * Failed sign-in limiter (in memory, per API process): after MAX_FAILURES failed attempts for
 * the same account and network address within WINDOW_MS, further attempts are refused until the
 * window passes. A technical safeguard against password guessing, not an approved lockout policy.
 */
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map();

const keyOf = (email, ip) => `${email}|${ip}`;

export function assertNotLimited(email, ip, now = Date.now()) {
  const entry = failures.get(keyOf(email, ip));
  if (entry && entry.count >= MAX_FAILURES && now - entry.first < WINDOW_MS) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - entry.first)) / 1000);
    throw tooManyRequests('Too many failed sign-in attempts. Try again later.', retryAfter);
  }
}

export function recordFailure(email, ip, now = Date.now()) {
  const key = keyOf(email, ip);
  const entry = failures.get(key);
  if (!entry || now - entry.first >= WINDOW_MS) failures.set(key, { count: 1, first: now });
  else entry.count += 1;
  // Keep memory bounded.
  if (failures.size > 10000) {
    for (const [k, v] of failures) if (now - v.first >= WINDOW_MS) failures.delete(k);
  }
}

export const clearFailures = (email, ip) => failures.delete(keyOf(email, ip));

/** Test helper. */
export const resetLimiter = () => failures.clear();

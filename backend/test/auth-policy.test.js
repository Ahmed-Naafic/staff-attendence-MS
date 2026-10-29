/*
 * Session lifetime fallback order (approved Authentication rules): a valid saved value; otherwise
 * SESSION_HOURS when it is a whole number from 1 to 72; otherwise 12. No database needed.
 */
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { env } from '../src/config/env.js';
import { effectiveLifetime } from '../src/features/auth/authPolicy.js';

const original = env.sessionHours;
after(() => {
  env.sessionHours = original;
});

test('a valid saved value wins over SESSION_HOURS', () => {
  env.sessionHours = 24;
  assert.deepEqual(effectiveLifetime(8), { hours: 8, source: 'setting' });
});

test('no valid saved value → a valid SESSION_HOURS is used', () => {
  env.sessionHours = 24;
  for (const stored of [null, 0, 73, 1.5, '8']) {
    assert.deepEqual(effectiveLifetime(stored), { hours: 24, source: 'environment' }, `stored ${String(stored)}`);
  }
  env.sessionHours = 1;
  assert.deepEqual(effectiveLifetime(null), { hours: 1, source: 'environment' });
  env.sessionHours = 72;
  assert.deepEqual(effectiveLifetime(null), { hours: 72, source: 'environment' });
});

test('SESSION_HOURS missing or outside the rules → 12 hours', () => {
  // undefined: not set; 0: SESSION_HOURS=""; NaN: not a number.
  for (const value of [undefined, 0, 73, 12.5, -1, Number.NaN]) {
    env.sessionHours = value;
    assert.deepEqual(effectiveLifetime(null), { hours: 12, source: 'default' }, `SESSION_HOURS ${String(value)}`);
  }
});

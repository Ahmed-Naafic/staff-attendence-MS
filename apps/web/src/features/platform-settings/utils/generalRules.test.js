// General Settings rules in the web app (immediate feedback; the API checks again).
// Run with `npm test --workspace apps/web`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkField, sameAsStored } from './generalRules.js';

const ok = (key, raw, value) => assert.deepEqual(checkField(key, raw), { value }, `${key} = ${JSON.stringify(raw)}`);
const bad = (key, raw) => assert.ok(checkField(key, raw).problem, `${key} = ${JSON.stringify(raw)} should be refused`);

test('optional text: empty means not set (null), values are trimmed', () => {
  for (const key of ['description', 'supportEmail', 'supportPhone', 'websiteUrl']) {
    ok(key, '', null);
    ok(key, '   ', null);
  }
  ok('description', '  Hello\r\nworld  ', 'Hello\nworld');
});

test('description: up to 500 characters (not bytes), line breaks only', () => {
  ok('description', 'x'.repeat(500), 'x'.repeat(500));
  ok('description', '😀'.repeat(500), '😀'.repeat(500));
  bad('description', 'x'.repeat(501));
  bad('description', 'a\tb');
  bad('description', 'a\u0007b');
});

test('support email: syntax, 254 characters, lower case', () => {
  ok('supportEmail', ' Help@Example.COM ', 'help@example.com');
  for (const raw of ['help', 'a@b', 'a b@example.com', 'a..b@example.com', '.a@example.com', 'a@example.c', `${'a'.repeat(65)}@example.com`]) bad('supportEmail', raw);
  const email = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.com`;
  assert.equal(email.length, 254);
  ok('supportEmail', email, email);
  bad('supportEmail', `a${email}`);
});

test('support phone: E.164 only', () => {
  ok('supportPhone', '+252612345678', '+252612345678');
  ok('supportPhone', '+123456789012345', '+123456789012345');
  for (const raw of ['252612345678', '+252 61 2345678', '+252-612345678', '+0252612345678', '+1234567890123456', '+252612345678x1', '+25261234567a']) bad('supportPhone', raw);
});

test('website: absolute https with a real host name, no credentials, 2,048 characters', () => {
  ok('websiteUrl', 'https://www.example.com/path', 'https://www.example.com/path');
  const long = `https://example.com/${'a'.repeat(2048 - 20)}`;
  assert.equal(long.length, 2048);
  ok('websiteUrl', long, long);
  for (const raw of ['http://example.com', 'example.com', 'https://user:pw@example.com', 'https://localhost', 'https://10.0.0.1', 'https://exa mple.com', `${long}a`]) bad('websiteUrl', raw);
});

test('choices: only the approved values', () => {
  ok('timezone', 'Africa/Mogadishu', 'Africa/Mogadishu');
  ok('timezone', 'UTC', 'UTC');
  for (const raw of ['', '+03:00', 'Mars/Base']) bad('timezone', raw);
  ok('language', 'en', 'en');
  bad('language', 'so');
  for (const f of ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY']) ok('dateFormat', f, f);
  bad('dateFormat', 'MMM DD, YYYY');
  ok('timeFormat', '12h', '12h');
  ok('timeFormat', '24h', '24h');
  bad('timeFormat', '24');
  ok('firstDayOfWeek', 'monday', 'monday');
  ok('firstDayOfWeek', 'sunday', 'sunday');
  bad('firstDayOfWeek', 'saturday');
});

test('sameAsStored ignores surrounding spaces and email case', () => {
  assert.ok(sameAsStored('supportEmail', 'help@example.com', ' HELP@example.com '));
  assert.ok(sameAsStored('description', '', '   '));
  assert.ok(!sameAsStored('supportPhone', '+252612345678', '+252612345679'));
});

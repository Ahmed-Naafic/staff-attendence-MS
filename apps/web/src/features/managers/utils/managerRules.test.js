import assert from 'node:assert/strict';
import { test } from 'node:test';
import { passwordProblem, validatePasswordChange } from '../../auth/passwordRules.js';
import { cleanManagerValues, validateManager, validateReason } from './managerRules.js';

const FIELDS = ['name', 'email', 'phone'];

test('details are cleaned like the server does', () => {
  assert.deepEqual(cleanManagerValues({ name: '  Asha   Ali ', email: ' Asha@Example.COM ', phone: ' +252 61 2345678 ' }, FIELDS), {
    name: 'Asha Ali',
    email: 'asha@example.com',
    phone: '+252 61 2345678',
  });
});

test('every detail problem is reported', () => {
  assert.deepEqual(Object.keys(validateManager({ name: 'A', email: 'nope', phone: '12' }, FIELDS)).sort(), ['email', 'name', 'phone']);
  assert.deepEqual(validateManager({ name: 'Asha Ali', email: 'asha@example.com', phone: '+252 61 2345678' }, FIELDS), {});
});

test('passwords: 12–128 characters, not only spaces, never trimmed', () => {
  assert.equal(passwordProblem(''), 'Enter a password.');
  assert.equal(passwordProblem('            '), 'The password cannot be only spaces.');
  assert.match(passwordProblem('short'), /at least 12/);
  assert.match(passwordProblem('x'.repeat(129)), /at most 128/);
  assert.equal(passwordProblem(' twelve chars '), null);
});

test('the first-sign-in change needs a different, confirmed new password', () => {
  assert.deepEqual(Object.keys(validatePasswordChange({})).sort(), ['currentPassword', 'newPassword']);
  const same = 'temporary-pass-1';
  assert.match(validatePasswordChange({ currentPassword: same, newPassword: same, confirmPassword: same }).newPassword, /different/);
  assert.equal(
    validatePasswordChange({ currentPassword: same, newPassword: 'chosen-pass-123', confirmPassword: 'chosen-pass-12' }).confirmPassword,
    'The passwords do not match.',
  );
  assert.deepEqual(validatePasswordChange({ currentPassword: same, newPassword: 'chosen-pass-123', confirmPassword: 'chosen-pass-123' }), {});
});

test('suspension reason: 3–500 characters', () => {
  assert.match(validateReason(''), /Enter the reason/);
  assert.match(validateReason('no'), /3–500/);
  assert.equal(validateReason('On leave'), null);
});

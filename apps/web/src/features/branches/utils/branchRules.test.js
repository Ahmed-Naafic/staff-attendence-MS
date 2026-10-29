// Branch Management rules in the web app (immediate feedback; the API checks again).
// Run with `npm run test:web`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanBranchValues,
  effectiveProblem,
  formatUtc,
  locationErrorMessage,
  nameKey,
  positionProblem,
  utcFromInput,
  validateBranch,
  validateReason,
} from './branchRules.js';

const FIELDS = ['name', 'address', 'city', 'phone'];

test('values are trimmed and spaces collapsed; required fields, phone format and lengths', () => {
  const cleaned = cleanBranchValues({ name: '  Main   Branch ', address: ' Road\t1 ', city: ' Mogadishu ', phone: '' }, FIELDS);
  assert.deepEqual(cleaned, { name: 'Main Branch', address: 'Road 1', city: 'Mogadishu', phone: '' });
  assert.deepEqual(validateBranch(cleaned, FIELDS), {});
  const problems = validateBranch({ name: '', address: '', city: '', phone: '12' }, FIELDS);
  assert.deepEqual(Object.keys(problems).sort(), ['address', 'city', 'name', 'phone']);
  assert.ok(validateBranch({ ...cleaned, name: 'x'.repeat(121) }, FIELDS).name);
  assert.ok(validateBranch({ ...cleaned, name: 'a\u0007b' }, FIELDS).name);
  assert.deepEqual(validateBranch({ ...cleaned, phone: '+252 61 2345678' }, FIELDS), {});
});

test('names compare without regard to capitalization, spacing or Unicode width', () => {
  assert.equal(nameKey('Main Branch'), nameKey('  MAIN   branch '));
  assert.equal(nameKey('Straße'), nameKey('STRASSE'));
  assert.equal(nameKey('Ｍａｉｎ'), nameKey('main'));
  assert.notEqual(nameKey('İstanbul'), nameKey('Istanbul'));
});

test('a captured position must be real and accurate to 50 m', () => {
  assert.equal(positionProblem({ latitude: 2.04, longitude: 45.31, accuracy: 50 }), null);
  assert.match(positionProblem({ latitude: 2.04, longitude: 45.31, accuracy: 50.5 }), /51 m|50 m or better/);
  assert.ok(positionProblem({ latitude: 0, longitude: 0, accuracy: 5 }));
  assert.ok(positionProblem({ latitude: 91, longitude: 0.1, accuracy: 5 }));
  assert.ok(positionProblem(null));
});

test('each device-location failure has its own explanation', () => {
  const messages = ['unsupported', 'insecure', 1, 2, 3, 'other'].map(locationErrorMessage);
  assert.equal(new Set(messages).size, messages.length);
  assert.match(locationErrorMessage(1), /denied/);
});

test('scheduled effective time: a full UTC date and time, in the future, at most a year ahead', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');
  assert.equal(utcFromInput('2026-10-25T08:30'), '2026-10-25T08:30:00.000Z');
  assert.equal(utcFromInput('2026-10-25'), null);
  assert.equal(effectiveProblem('2026-10-25T08:30', now), null);
  assert.ok(effectiveProblem('2026-10-24T11:59', now));
  assert.ok(effectiveProblem('2027-12-01T00:00', now));
  assert.ok(effectiveProblem('', now));
  assert.equal(formatUtc('2026-10-25T08:30:00.000Z'), '2026-10-25 08:30 UTC');
});

test('suspension reason: 3–500 characters', () => {
  assert.ok(validateReason('  '));
  assert.ok(validateReason('ab'));
  assert.equal(validateReason('Renovation'), null);
  assert.ok(validateReason('x'.repeat(501)));
});

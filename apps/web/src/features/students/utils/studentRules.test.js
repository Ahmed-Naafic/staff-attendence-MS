// Student rules in the web app. Run with `npm run test:web`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanProfile, EMPTY_PROFILE, groupChange, targetChoices, validateProfile } from './studentRules.js';

const valid = { ...EMPTY_PROFILE, firstName: ' Ayaan ', lastName: 'Ali', gender: 'female', dateOfBirth: '2014-03-01', guardianName: 'Hodan', guardianPhone: '+252 61 2345678' };

test('profile: required fields, date and phones', () => {
  assert.deepEqual(validateProfile(valid, { now: '2026-11-12' }), {});
  const problems = validateProfile(EMPTY_PROFILE, { now: '2026-11-12' });
  assert.deepEqual(Object.keys(problems).sort(), ['dateOfBirth', 'firstName', 'gender', 'guardianName', 'guardianPhone', 'lastName']);
  assert.ok(validateProfile({ ...valid, dateOfBirth: '2027-01-01' }, { now: '2026-11-12' }).dateOfBirth);
  assert.ok(validateProfile({ ...valid, phone: '12' }, { now: '2026-11-12' }).phone);
});

test('profile values for the API: trimmed, empty optional fields null, gender in capitals', () => {
  const v = cleanProfile(valid);
  assert.equal(v.firstName, 'Ayaan');
  assert.equal(v.gender, 'FEMALE');
  assert.equal(v.middleName, null);
});

test('group decisions keep each student on their own suggested section; choices follow the decision', () => {
  const rows = [
    { id: '1', from: { classSequence: 6 }, suggestions: { PROMOTE: '7A', REPEAT: '6A' } },
    { id: '2', from: { classSequence: 6 }, suggestions: { PROMOTE: null, REPEAT: '6B' } },
  ];
  assert.deepEqual(groupChange(rows, 'PROMOTE'), [
    { id: '1', decision: 'PROMOTE', targetSectionId: '7A' },
    { id: '2', decision: 'PROMOTE', targetSectionId: null },
  ]);
  assert.deepEqual(groupChange(rows, 'GRADUATE')[0].targetSectionId, null);
  const targets = [{ id: 'a', classSequence: 6 }, { id: 'b', classSequence: 7 }, { id: 'c', classSequence: 8 }];
  assert.deepEqual(targetChoices(targets, rows[0], 'PROMOTE').map((t) => t.id), ['b', 'c']);
  assert.deepEqual(targetChoices(targets, rows[0], 'REPEAT').map((t) => t.id), ['a']);
  assert.deepEqual(targetChoices(targets, rows[0], 'PENDING'), []);
});

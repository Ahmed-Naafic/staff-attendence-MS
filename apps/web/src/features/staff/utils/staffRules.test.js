import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanStaffValues, jobTitleFields, jobTitleFrom, OTHER_JOB_TITLE, shiftsOn, toRequestAssignments, validateAssignments, validateReason, validateStaff } from './staffRules.js';

const FIELDS = ['name', 'phone', 'jobTitle', 'email'];

test('details are cleaned like the server does; email is optional', () => {
  const cleaned = cleanStaffValues({ name: ' Asha  Ali ', phone: ' +252 61 2345678 ', jobTitle: ' Teacher ', email: '' }, FIELDS);
  assert.deepEqual(cleaned, { name: 'Asha Ali', phone: '+252 61 2345678', jobTitle: 'Teacher', email: '' });
  assert.deepEqual(validateStaff(cleaned, FIELDS), {});
});

test('every detail problem is reported', () => {
  assert.deepEqual(Object.keys(validateStaff({ name: 'A', phone: '12', jobTitle: '', email: 'nope' }, FIELDS)).sort(), ['email', 'jobTitle', 'name', 'phone']);
});

test('the shifts on a date come from the schedule in effect then', () => {
  const branchShifts = { current: { effectiveFrom: '2026-10-26', shifts: ['now'] }, scheduled: { effectiveFrom: '2026-11-01', shifts: ['later'] } };
  assert.deepEqual(shiftsOn(branchShifts, '2026-10-31').shifts, ['now']);
  assert.deepEqual(shiftsOn(branchShifts, '2026-11-01').shifts, ['later']);
  assert.equal(shiftsOn({ current: null, scheduled: null }, '2026-11-01'), null);
});

test('only shifts with ticked days are sent; dates are checked', () => {
  assert.deepEqual(toRequestAssignments({ a: ['MON'], b: [] }), [{ shiftKey: 'a', days: ['MON'] }]);
  const range = { earliest: '2026-10-27', latest: '2027-10-27' };
  assert.ok(validateAssignments({ effectiveFrom: '2026-10-26', picked: {}, schedule: {} }, range).effectiveFrom);
  assert.ok(validateAssignments({ effectiveFrom: '2026-10-28', picked: { a: ['MON'] }, schedule: null }, range).effectiveFrom);
  assert.deepEqual(validateAssignments({ effectiveFrom: '2026-10-28', picked: {}, schedule: null }, range), {}, 'an empty set needs no schedule');
});

test('suspension reason: 3–500 characters', () => {
  assert.match(validateReason(''), /Enter the reason/);
  assert.equal(validateReason('On leave'), null);
});

test('job title: Teacher and Accountant are choices; any other title is "Other" with the title typed', () => {
  assert.deepEqual(jobTitleFields('Teacher'), { jobTitleChoice: 'Teacher', jobTitleOther: '' });
  assert.deepEqual(jobTitleFields(' accountant '), { jobTitleChoice: 'Accountant', jobTitleOther: '' });
  assert.deepEqual(jobTitleFields('Guard'), { jobTitleChoice: OTHER_JOB_TITLE, jobTitleOther: 'Guard' });
  assert.deepEqual(jobTitleFields(''), { jobTitleChoice: '', jobTitleOther: '' });
  assert.equal(jobTitleFrom({ jobTitleChoice: 'Teacher', jobTitleOther: 'ignored' }), 'Teacher');
  assert.equal(jobTitleFrom({ jobTitleChoice: OTHER_JOB_TITLE, jobTitleOther: 'Librarian' }), 'Librarian');
  assert.equal(jobTitleFrom({ jobTitleChoice: OTHER_JOB_TITLE, jobTitleOther: '' }), '');
  assert.equal(jobTitleFrom({ jobTitleChoice: '', jobTitleOther: '' }), '');
});

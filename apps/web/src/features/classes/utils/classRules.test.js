// Class and section rules in the web app. Run with `npm run test:web`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickYear, sectionDisplayName, validateClass, validateSection, wholeNumber } from './classRules.js';

test('class form: name, order and description', () => {
  assert.deepEqual(validateClass({ name: ' Grade 7 ', description: '', sequence: '7' }), {});
  assert.deepEqual(Object.keys(validateClass({ name: '', description: 'x'.repeat(301), sequence: '' })).sort(), ['description', 'name', 'sequence']);
  assert.ok(validateClass({ name: 'G', sequence: '0' }).sequence);
  assert.ok(validateClass({ name: 'G', sequence: '2.5' }).sequence);
  assert.equal(wholeNumber(' 12 '), 12);
  assert.equal(wholeNumber(''), null);
});

test('section form: required choices when creating; optional capacity and room', () => {
  assert.deepEqual(validateSection({ name: 'A', capacity: '', room: '' }, { creating: false }), {});
  const problems = validateSection({ name: '', capacity: '0' }, { creating: true, needsBranch: true });
  assert.deepEqual(Object.keys(problems).sort(), ['academicYearId', 'branchId', 'capacity', 'classId', 'name']);
  assert.equal(validateSection({ name: 'A', classId: 'c', academicYearId: 'y' }, { creating: true, needsBranch: false }).branchId, undefined);
});

test('display names and the starting academic year', () => {
  assert.equal(sectionDisplayName('Grade 7', 'A'), 'Grade 7A');
  assert.equal(sectionDisplayName('Grade 7', 'Blue'), 'Grade 7 Blue');
  const years = [
    { id: '3', status: 'planned' },
    { id: '2', status: 'current' },
    { id: '1', status: 'closed' },
  ];
  assert.equal(pickYear(years, '1').id, '1');
  assert.equal(pickYear(years, 'gone').id, '2');
  assert.equal(pickYear([{ id: '3', status: 'planned' }], '').id, '3');
  assert.equal(pickYear([], ''), null);
});

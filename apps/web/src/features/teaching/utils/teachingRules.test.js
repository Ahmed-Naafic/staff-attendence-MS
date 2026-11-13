import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { assignmentActions, earliestLastDay, periodText, validateAssignment, validateSubject, weeklyLessons } from './teachingRules.js';

describe('subjects', () => {
  test('name required, code letters and digits, description limited', () => {
    assert.deepEqual(validateSubject({ name: 'Mathematics', code: 'math', description: '' }), {});
    assert.ok(validateSubject({ name: '  ' }).name);
    assert.ok(validateSubject({ name: 'Maths', code: 'A B' }).code);
    assert.ok(validateSubject({ name: 'Maths', code: 'TOOLONGCODE123' }).code);
  });

  test('lessons per week: empty, 1–40, else invalid', () => {
    assert.equal(weeklyLessons(''), null);
    assert.equal(weeklyLessons('5'), 5);
    assert.ok(Number.isNaN(weeklyLessons('0')));
    assert.ok(Number.isNaN(weeklyLessons('41')));
    assert.ok(Number.isNaN(weeklyLessons('2.5')));
  });
});

describe('teaching assignments', () => {
  const limits = { earliest: '2026-11-13', yearEnd: '2027-06-30' };

  test('a teacher, a subject for subject teachers, and dates from today within the year', () => {
    assert.deepEqual(validateAssignment({ role: 'class', teacher: 't', startDate: '2026-11-13' }, limits), {});
    assert.deepEqual(Object.keys(validateAssignment({ role: 'subject', startDate: '2026-11-12' }, limits)).sort(), ['startDate', 'subject', 'teacher']);
    assert.ok(validateAssignment({ role: 'class', teacher: 't', startDate: '2026-11-20', endDate: '2026-11-19' }, limits).endDate);
    assert.ok(validateAssignment({ role: 'class', teacher: 't', startDate: '2026-11-20', endDate: '2027-07-01' }, limits).endDate);
  });

  test('actions: not started → cancel or end; running → end; ended or not mine → nothing', () => {
    const fe = '2026-11-13';
    const a = (startDate, endDate, extra = {}) => ({ startDate, endDate, state: 'active', canManage: true, ...extra });
    assert.deepEqual(assignmentActions(a('2026-11-13', null), fe, { writable: true }), { cancel: true, end: true });
    assert.deepEqual(assignmentActions(a('2026-11-01', null), fe, { writable: true }), { cancel: false, end: true });
    assert.deepEqual(assignmentActions(a('2026-11-01', '2026-11-10'), fe, { writable: true }), { cancel: false, end: false });
    assert.deepEqual(assignmentActions(a('2026-11-01', null, { canManage: false }), fe, { writable: true }), { cancel: false, end: false });
    assert.deepEqual(assignmentActions(a('2026-11-01', null), fe, { writable: false }), { cancel: false, end: false });
    assert.equal(earliestLastDay(a('2026-11-01', null), fe), '2026-11-12');
    assert.equal(earliestLastDay(a('2026-11-13', null), fe), '2026-11-13');
    assert.equal(periodText(a('2026-11-01', null)), 'from 2026-11-01');
  });
});

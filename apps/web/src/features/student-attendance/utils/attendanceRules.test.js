import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { changedMarks, countsText, draftFrom, markProblems, markRemaining, needsReason, sessionBadge, settingsChanges } from './attendanceRules.js';

const s = (id, status = null, extra = {}) => ({ student: { id }, status, reason: null, note: null, version: status ? 1 : 0, ...extra });
const students = [s('a'), s('b', 'absent'), s('c', 'present')];

describe('marks', () => {
  test('only real changes are sent, with the version last seen', () => {
    const draft = { ...draftFrom(students), a: { status: 'present' }, b: { status: 'absent', reason: '' } };
    assert.deepEqual(changedMarks(students, draft), [{ student: 'a', status: 'present', version: 0 }]);
    assert.deepEqual(changedMarks(students, { ...draft, c: { status: 'late', reason: ' Bus ' } }).at(-1), { student: 'c', status: 'late', reason: 'Bus', version: 1 });
  });

  test('excused needs a reason; changing a mark needs one only when required', () => {
    const draft = { a: { status: 'excused' }, b: { status: 'present' } };
    assert.deepEqual(markProblems(students, draft, { reasonRequiredForChanges: false }), { a: 'Give the reason for the excuse.' });
    assert.deepEqual(Object.keys(markProblems(students, draft, { reasonRequiredForChanges: true })), ['a', 'b']);
    assert.equal(needsReason(students[1], { status: 'present' }, { reasonRequiredForChanges: true }), true);
    assert.equal(needsReason(students[0], { status: 'present' }, { reasonRequiredForChanges: true }), false, 'a first mark is not a change');
  });

  test('mark the rest present leaves existing marks', () => {
    const next = markRemaining(students, draftFrom(students), 'present');
    assert.deepEqual([next.a.status, next.b.status, next.c.status], ['present', 'absent', 'present']);
  });
});

describe('display', () => {
  test('overview badges and count text', () => {
    assert.equal(sessionBadge({ state: 'overdue', session: null }).label, 'Missing');
    assert.equal(sessionBadge({ state: 'locked', session: null }).label, 'Missed');
    assert.equal(sessionBadge({ state: 'open', session: { complete: false, counts: { notMarked: 3 } } }).label, '3 not marked');
    assert.equal(sessionBadge({ state: 'overdue', session: { complete: true } }).variant, 'success');
    assert.equal(countsText({ present: 2, absent: 0, late: 1, excused: 0, notMarked: 1 }), '2 present · 1 late · 1 not marked');
  });

  test('settings: only changed values are sent; empty means "use the level above"', () => {
    assert.deepEqual(settingsChanges({ a: 1, b: null, c: true }, { a: 1, b: 5, c: null }), { b: 5, c: null });
  });
});

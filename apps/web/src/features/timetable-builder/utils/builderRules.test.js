import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkUnavailable, classRows, fixLink, timetableGaps, lessonAt, limitValue, loadTone, masterColumns, orderDays, subjectHues, subjectStyle, teacherCells, unplacedTotal } from './builderRules.js';

test('class rows: period numbers with the times of the first day that has them', () => {
  const periods = {
    MON: [{ kind: 'lesson', number: 1, start: '07:30', end: '08:10' }, { kind: 'break', number: null }, { kind: 'lesson', number: 2, start: '08:30', end: '09:10' }],
    TUE: [{ kind: 'lesson', number: 1, start: '07:30', end: '08:10' }, { kind: 'lesson', number: 3, start: '09:10', end: '09:50' }],
  };
  const rows = classRows(periods, ['MON', 'TUE']);
  assert.deepEqual(rows.map((r) => [r.number, r.start, [...r.days]]), [[1, '07:30', ['MON', 'TUE']], [2, '08:30', ['MON']], [3, '09:10', ['TUE']]]);
});

test('master columns, lesson lookup, day order (Saturday first)', () => {
  const sections = [{ periods: { MON: [{ number: 1 }, { number: 2 }] } }, { periods: { MON: [{ number: 3 }], TUE: [{ number: 1 }] } }];
  assert.deepEqual(masterColumns(sections, 'MON'), [1, 2, 3]);
  assert.equal(lessonAt([{ weekday: 'MON', period: 2, x: 1 }], 'MON', 2).x, 1);
  assert.equal(lessonAt([], 'MON', 2), null);
  assert.deepEqual(orderDays(['MON', 'SAT', 'THU', 'SUN']), ['SAT', 'SUN', 'MON', 'THU']);
});

test('teacher cells group lessons by day and start time', () => {
  const cells = teacherCells({ lessons: [{ weekday: 'MON', start: '07:30', id: 1 }, { weekday: 'MON', start: '07:30', id: 2 }, { weekday: 'TUE', start: '08:10', id: 3 }] });
  assert.equal(cells.get('MON|07:30').length, 2);
  assert.equal(cells.get('TUE|08:10').length, 1);
});

test('unavailable times and limits are checked like the server does', () => {
  const { errors } = checkUnavailable([{ weekday: 'MON', start: '08:00', end: '09:00' }, { weekday: '', start: '08:00', end: '09:00' }, { weekday: 'TUE', start: '9:00', end: '10:00' }, { weekday: 'TUE', start: '10:00', end: '09:00' }]);
  assert.deepEqual(Object.keys(errors), ['1', '2', '3']);
  assert.equal(limitValue('', { min: 1, max: 20 }), null);
  assert.equal(limitValue('5', { min: 1, max: 20 }), 5);
  assert.ok(Number.isNaN(limitValue('25', { min: 1, max: 20 })));
  assert.ok(Number.isNaN(limitValue('2.5', { min: 1, max: 20 })));
});

test('teacher load tone, subject tone, lessons left out', () => {
  assert.equal(loadTone({ lessons: 31, capacity: 30 }), 'error');
  assert.equal(loadTone({ lessons: 27, capacity: 30 }), 'warning');
  assert.equal(loadTone({ lessons: 10, capacity: 30 }), 'success');
  const hues = subjectHues([{ subject: { id: 'm', name: 'Maths' } }, { subject: { id: 'a', name: 'Arabic' } }, { subject: { id: 'm', name: 'Maths' } }, { subject: null }]);
  assert.equal(hues.size, 2);
  assert.notEqual(hues.get('a'), hues.get('m'));
  const many = subjectHues(Array.from({ length: 12 }, (_, i) => ({ subject: { id: `s${i}`, name: `S${String(i).padStart(2, '0')}` } })));
  const sorted = [...many.values()].sort((x, y) => x - y);
  assert.ok(sorted.every((h, i) => i === 0 || h - sorted[i - 1] >= 10), 'twelve subjects, twelve clearly different hues');
  assert.equal(subjectStyle(undefined), undefined);
  assert.match(subjectStyle(120).backgroundColor, /hsl\(120 var\(--subject-s\)/);
  assert.equal(unplacedTotal({ unplaced: [{ count: 2 }, { count: 1 }] }), 3);
  assert.equal(unplacedTotal(null), 0);
});

test('fix links: lessons per week open the class page (the Owner edits, a Manager views)', () => {
  const item = { fix: 'class-subjects', classId: 'c1', className: 'Grade 7' };
  assert.deepEqual(fixLink(item, 'OWNER'), { to: '/classes/c1', label: 'Edit Grade 7’s subjects' });
  assert.match(fixLink(item, 'MANAGER').label, /School Owner edits/);
  assert.deepEqual(fixLink({ fix: 'subjects' }, 'OWNER'), { to: '/subjects', label: 'Open Subjects' });
  assert.equal(fixLink({ fix: 'setup' }, 'OWNER').tab, 'rules');
  assert.equal(fixLink({ fix: 'unknown' }, 'OWNER'), null);
});

test('timetable gaps: a published timetable that no longer fits the school week is reported; drafts and full ones are not', () => {
  const full = { empty: 0, offDay: 0, offDays: [] };
  const master = {
    kind: 'master',
    source: 'published',
    sections: [
      { displayName: 'Grade 7A', gaps: { empty: 3, offDay: 5, offDays: ['THU'] } },
      { displayName: 'Grade 7B', gaps: full },
      { displayName: 'Grade 8A', gaps: { empty: 2, offDay: 6, offDays: ['THU'] } },
    ],
  };
  assert.deepEqual(timetableGaps(master), { classes: ['Grade 7A', 'Grade 8A'], empty: 5, offDay: 11, offDays: ['THU'] });
  assert.equal(timetableGaps({ ...master, source: 'draft' }), null);
  assert.equal(timetableGaps({ kind: 'section', source: 'published', section: { displayName: 'Grade 7B' }, gaps: full }), null);
  assert.equal(timetableGaps({ kind: 'section', source: 'published', section: { displayName: 'Grade 7B' }, gaps: null }), null);
  assert.equal(timetableGaps({ kind: 'teacher', source: 'published' }), null);
});

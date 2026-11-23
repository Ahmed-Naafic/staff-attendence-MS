import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import * as api from '../../../../../../backend/src/features/examinations/examInput.js';
import { checkBands, checkWeights, examDefaultName, LETTER_SCALE, scheduleProblems, validateExamination, validateGenerate, parseMark } from './examRules.js';
import * as rules from './examRules.js';

const strip = (r) => (r.bands ? { bands: r.bands } : { error: Boolean(r.error) });

test('grade bands: the web checks the same rules as the API', () => {
  const cases = [
    LETTER_SCALE,
    [{ label: 'A', minPercent: 50, maxPercent: 100, passes: true }, { label: 'F', minPercent: 0, maxPercent: 45, passes: false }],
    [{ label: 'A', minPercent: 50, maxPercent: 100, passes: true }, { label: 'F', minPercent: 0, maxPercent: 60, passes: false }],
    [{ label: 'A', minPercent: 60, maxPercent: 90, passes: true }, { label: 'F', minPercent: 0, maxPercent: 59, passes: false }],
    [{ label: 'A', minPercent: 50, maxPercent: 100, passes: false }, { label: 'F', minPercent: 0, maxPercent: 49, passes: true }],
    [{ label: 'A', minPercent: 79.5, maxPercent: 100, passes: true }, { label: 'F', minPercent: 0, maxPercent: 79.49, passes: false }],
    [{ label: 'A', minPercent: 50, maxPercent: 100, passes: true }],
  ];
  for (const c of cases) {
    const numeric = c.map((b) => ({ ...b, minPercent: Number(b.minPercent), maxPercent: Number(b.maxPercent), points: b.points === undefined ? undefined : Number(b.points) }));
    assert.deepEqual(strip(checkBands(c)), strip(api.checkBands(numeric)), JSON.stringify(c));
  }
  const ok = checkBands(LETTER_SCALE);
  assert.deepEqual(ok.bands.map((b) => [b.label, b.minPercent, b.maxPercent, b.passes]), [['A', 80, 100, true], ['B', 70, 79, true], ['C', 60, 69, true], ['D', 50, 59, true], ['F', 0, 49, false]]);
  const bad = checkBands([{ label: 'A', minPercent: '80', maxPercent: '100', passes: true }, { label: 'F', minPercent: '0', maxPercent: '70', passes: false }]);
  assert.match(bad.details['bands.1.maxPercent'], /Gap below A/);
});

test('weights: whole percentages adding up to 100; empty and zero rows are left out', () => {
  assert.deepEqual(checkWeights([{ id: 'a', weight: '40' }, { id: 'b', weight: '60' }, { id: 'c', weight: '' }], 'examTypeId'), { weights: [{ examTypeId: 'a', weight: 40 }, { examTypeId: 'b', weight: 60 }], total: 100 });
  assert.match(checkWeights([{ id: 'a', weight: '40' }], 'examTypeId').error, /add up to 40%/);
  assert.ok(checkWeights([{ id: 'a', weight: '4.5' }], 'examTypeId').error);
  assert.deepEqual(checkWeights([], 'periodId'), { weights: [], total: 0 });
});

describe('examination form', () => {
  const year = { name: '2026/2027', startDate: '2026-09-01', endDate: '2027-06-30' };
  const period = { name: 'Term 1', startDate: '2026-09-01', endDate: '2026-12-31' };
  const ok = { examType: 't', startDate: '2026-11-24', endDate: '2026-11-28', name: '' };
  test('checks dates as the API does', () => {
    assert.deepEqual(validateExamination(ok, { year, period, today: '2026-11-22', creating: true }), {});
    assert.match(validateExamination({ ...ok, startDate: '2026-11-21' }, { year, period, today: '2026-11-22', creating: true }).startDate, /fixed/);
    assert.match(validateExamination({ ...ok, endDate: '2027-01-02' }, { year, period, today: '2026-11-22', creating: true }).endDate, /Term 1/);
    assert.match(validateExamination({ ...ok, endDate: '2026-11-23' }, { year, period, today: '2026-11-22', creating: true }).endDate, /before/);
    assert.match(validateExamination({ ...ok, name: '' }, { year, today: '2026-11-22', creating: false }).name, /required/);
    assert.ok(validateExamination({ ...ok, examType: '' }, { year, today: '2026-11-22', creating: true }).examType);
  });
  test('a started examination: the first day is fixed, the last day yesterday at the earliest', () => {
    const started = { ...ok, name: 'Mid', startDate: '2026-11-20', endDate: '2026-11-20' };
    const locked = ['startDate', 'classes'];
    assert.match(validateExamination(started, { year, today: '2026-11-22', locked }).endDate, /2026-11-21/);
    assert.deepEqual(validateExamination({ ...started, endDate: '2026-11-21' }, { year, today: '2026-11-22', locked }), {});
  });
  test('default name and what blocks scheduling', () => {
    assert.equal(examDefaultName({ name: 'Mid-Term' }, { name: 'Term 1' }), 'Mid-Term – Term 1');
    assert.equal(examDefaultName({ name: 'Final' }, null), 'Final');
    const detail = { examination: { startDate: '2026-11-24' }, classes: [{ name: 'Grade 7', papers: [] }] };
    assert.deepEqual(scheduleProblems(detail, '2026-11-22'), ['Add papers for Grade 7.']);
    assert.deepEqual(scheduleProblems({ examination: { startDate: '2026-11-20' }, classes: [] }, '2026-11-22').length, 2);
  });
});

describe('timetable form', () => {
  const ok = { shifts: [{ name: 'Morning', start: '08:00', sessions: 2 }, { name: 'Afternoon', start: '13:00', sessions: 1 }], gapMinutes: 30, rooms: [{ room: 'r', capacity: '' }] };
  test('checks shifts, gap and rooms as the API does', () => {
    assert.deepEqual(validateGenerate(ok), {});
    assert.match(validateGenerate({ ...ok, shifts: [ok.shifts[1], ok.shifts[0]] }).shifts, /order/);
    assert.match(validateGenerate({ ...ok, shifts: [{ name: 'M', start: '8:00', sessions: 1 }] }).shifts, /start time/);
    assert.match(validateGenerate({ ...ok, shifts: [{ name: 'M', start: '08:00', sessions: 5 }] }).shifts, /1–4/);
    assert.ok(validateGenerate({ ...ok, gapMinutes: '' }).gapMinutes);
    assert.ok(validateGenerate({ ...ok, rooms: [] }).rooms);
    assert.ok(validateGenerate({ ...ok, rooms: [{ room: 'r', capacity: 900 }] }).rooms);
  });
});

describe('marks', () => {
  test('typed marks', () => {
    assert.deepEqual(parseMark('', 50), { value: null });
    assert.deepEqual(parseMark('40,5', 50), { value: 40.5 });
    assert.ok(parseMark('51', 50).error);
    assert.ok(parseMark('-1', 50).error);
    assert.ok(parseMark('1.234', 50).error);
    assert.ok(parseMark('abc', 50).error);
  });
});

describe('timetable views', () => {
  const S = (id, date, shiftName, sequence, start) => ({ id, date, shiftName, sequence, start, end: '09:00' });
  const sessions = [S('c', '2026-11-29', 'Morning', 1, '07:00'), S('a', '2026-11-28', 'Morning', 1, '07:00'), S('b', '2026-11-28', 'Morning', 2, '09:30'), S('d', '2026-11-28', 'Afternoon', 3, '13:00')];
  test('weekday of a calendar date', () => {
    assert.equal(rules.weekdayOf('2026-11-28'), 'Saturday');
    assert.equal(rules.weekdayOf('2026-11-29'), 'Sunday');
  });
  test('the session shown: chosen, else today or the next day, its first shift and session', () => {
    assert.equal(rules.pickSession([], {}, '2026-11-01'), null);
    assert.equal(rules.pickSession(sessions, {}, '2026-11-01').id, 'a');
    assert.equal(rules.pickSession(sessions, {}, '2026-11-29').id, 'c');
    assert.equal(rules.pickSession(sessions, {}, '2026-12-30').id, 'a', 'after the examination: the first day');
    assert.equal(rules.pickSession(sessions, { date: '2026-11-28', shift: 'Afternoon' }).id, 'd');
    assert.equal(rules.pickSession(sessions, { date: '2026-11-28', shift: 'Night' }).id, 'a', 'an unknown shift falls back');
    assert.equal(rules.pickSession(sessions, { id: 'b' }).id, 'b');
  });
  test('selectors around a session', () => {
    const c = rules.sessionChoices(sessions, sessions[1]);
    assert.deepEqual(c.dates, [{ date: '2026-11-28', label: 'Saturday 2026-11-28' }, { date: '2026-11-29', label: 'Sunday 2026-11-29' }]);
    assert.deepEqual(c.shifts, ['Morning', 'Afternoon']);
    assert.deepEqual(c.list.map((s) => s.id), ['a', 'b']);
  });
});

describe('timetable tab: filters and groups', () => {
  const g5 = { id: 'g5', name: 'Grade 5', sequence: 5 };
  const g6 = { id: 'g6', name: 'Grade 6', sequence: 6 };
  const isl = { id: 'isl', name: 'Islamic Studies', code: 'ISL' };
  const som = { id: 'som', name: 'Somali', code: 'SOM' };
  const paper = (subject, cls) => ({ sittingId: `${subject.id}-${cls.id}`, subject, class: cls });
  const sessions = [
    { id: 'c', date: '2026-11-24', start: '08:00', shiftName: 'Morning', papers: [paper(som, g5)] },
    { id: 'b', date: '2026-11-23', start: '10:15', shiftName: 'Morning', papers: [paper(som, g6), paper(som, g5)] },
    { id: 'a', date: '2026-11-23', start: '08:00', shiftName: 'Morning', papers: [paper(isl, g5), paper(isl, g6)] },
    { id: 'd', date: '2026-11-24', start: '13:00', shiftName: 'Afternoon', papers: [paper(isl, g6)] },
  ];
  const ids = (list) => list.map((s) => s.id);

  test('filter options come from the sessions', () => {
    const o = rules.timetableFilterOptions(sessions);
    assert.deepEqual(o.shifts, ['Afternoon', 'Morning']);
    assert.deepEqual(o.grades.map((x) => x.id), ['g5', 'g6']);
    assert.deepEqual(o.subjects.map((x) => x.id), ['isl', 'som']);
  });

  test('filters combine; each session shows its matching papers', () => {
    const f = rules.EMPTY_TIMETABLE_FILTERS;
    assert.deepEqual(ids(rules.filterTimetableSessions(sessions, f)), ['a', 'b', 'c', 'd']);
    assert.deepEqual(ids(rules.filterTimetableSessions(sessions, { ...f, from: '2026-11-24' })), ['c', 'd']);
    assert.deepEqual(ids(rules.filterTimetableSessions(sessions, { ...f, to: '2026-11-23' })), ['a', 'b']);
    assert.deepEqual(ids(rules.filterTimetableSessions(sessions, { ...f, shift: 'Afternoon' })), ['d']);
    const picked = rules.filterTimetableSessions(sessions, { ...f, grade: 'g6', subject: 'som' });
    assert.deepEqual(ids(picked), ['b']);
    assert.deepEqual(picked[0].shown.map((p) => p.class.id), ['g6']);
    assert.equal(picked[0].papers.length, 2);
    assert.deepEqual(ids(rules.filterTimetableSessions(sessions, { ...f, q: '  islamic ' })), ['a', 'd']);
    assert.deepEqual(ids(rules.filterTimetableSessions(sessions, { ...f, q: 'grade 6', shift: 'Morning' })), ['a', 'b']);
    assert.deepEqual(rules.filterTimetableSessions(sessions, { ...f, q: 'som', from: '2026-11-25' }), []);
    assert.equal(rules.activeFilterCount(f), 0);
    assert.equal(rules.activeFilterCount({ ...f, q: ' x ', shift: 'Morning' }), 2);
  });

  test('sessions group by date in time order; papers group by subject', () => {
    const groups = rules.groupSessionsByDate(sessions);
    assert.deepEqual(groups.map((x) => [x.date, x.weekday, ids(x.sessions)]), [
      ['2026-11-23', 'Monday', ['a', 'b']],
      ['2026-11-24', 'Tuesday', ['c', 'd']],
    ]);
    const bySubject = rules.groupPapersBySubject(sessions[1].papers);
    assert.deepEqual(bySubject.map((x) => [x.subject.id, x.classes.map((c) => c.id)]), [['som', ['g5', 'g6']]]);
    assert.equal(rules.longDate('2026-11-23'), 'Monday, 23 November 2026');
    assert.equal(rules.sessionState({ date: '2026-11-23' }, '2026-11-24'), 'done');
    assert.equal(rules.sessionState({ date: '2026-11-24' }, '2026-11-24'), 'today');
    assert.equal(rules.sessionState({ date: '2026-11-25' }, '2026-11-24'), 'upcoming');
  });
});

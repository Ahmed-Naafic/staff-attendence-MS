/*
 * Results calculation (pure): paper and overall percents, grades, pass rules (paper pass mark,
 * overall pass mark, most failed subjects), absent and excused, ranks with ties, class summary, and
 * the year's final result by formula.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeSection, gradeFor, yearFinal } from '../src/features/examinations/resultsEngine.js';

const bands = [
  { label: 'A', minPercent: 80, maxPercent: 100, points: 4, passes: true },
  { label: 'B', minPercent: 65, maxPercent: 79.99, points: 3, passes: true },
  { label: 'C', minPercent: 50, maxPercent: 64.99, points: 2, passes: true },
  { label: 'F', minPercent: 0, maxPercent: 49.99, points: 0, passes: false },
];
const settings = { passPercent: 50, overallPassPercent: 50, maxFailedSubjects: 1, absentCountsAsZero: true };
const papers = [
  { id: 'm', subject: 'Math', maxMarks: 100 },
  { id: 'e', subject: 'English', maxMarks: 50 },
  { id: 's', subject: 'Science', maxMarks: 50 },
];
const students = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id.toUpperCase(), number: id }));
const entries = new Map(
  Object.entries({
    'm|a': { marks: 90 }, 'e|a': { marks: 45 }, 's|a': { marks: 40 },
    'm|b': { marks: 40 }, 'e|b': { marks: 20 }, 's|b': { marks: 40 },
    'm|c': { marks: 90 }, 'e|c': { marks: 45 }, 's|c': { marks: 40 },
    'm|d': { marks: null, absent: true }, 'e|d': { marks: 30 }, 's|d': { marks: null, excused: true },
    'm|e': { marks: 70 },
  }).map(([k, v]) => [k, { marks: null, absent: false, excused: false, ...v }]),
);

test('grades: the highest band reached', () => {
  assert.equal(gradeFor(bands, 79.99).label, 'B');
  assert.equal(gradeFor(bands, 80).label, 'A');
  assert.equal(gradeFor(bands, null), null);
});

test('a section’s results: percents, grades, pass rules, absent, excused, missing, ranks', () => {
  const { students: r, summary } = computeSection({ students, papers, entries, settings, bands });
  const of = (id) => r.find((x) => x.student.id === id);
  assert.deepEqual([of('a').totalMarks, of('a').totalMax, of('a').percent, of('a').grade, of('a').passed], [175, 200, 87.5, 'A', true]);
  // b: 40 %, 40 %, 80 % → 100/200 = 50 % (overall pass) but two papers failed (> 1): fails.
  assert.deepEqual([of('b').percent, of('b').failedPapers, of('b').passed], [50, 2, false]);
  // d: absent Math counts as 0; excused Science left out → 30/150 = 20 %.
  assert.deepEqual([of('d').totalMax, of('d').percent, of('d').papers.find((p) => p.paperId === 's').status], [150, 20, 'excused']);
  // e: English and Science missing → incomplete (counted on Math only).
  assert.equal(of('e').missingPapers, 2);
  assert.deepEqual([of('a').rank, of('c').rank, of('e').rank, of('b').rank], [1, 1, 3, 4], 'ties share a rank');
  assert.deepEqual([summary.students, summary.withResult, summary.passed, summary.incomplete], [5, 5, 3, 1]);
  assert.equal(summary.papers.find((p) => p.paperId === 'm').sat, 5);
  // Absent left out when the school says so.
  const left = computeSection({ students, papers, entries, settings: { ...settings, absentCountsAsZero: false }, bands }).students.find((x) => x.student.id === 'd');
  assert.deepEqual([left.totalMax, left.percent], [50, 60]);
});

test('the year’s final result: weighted by type and period, average, last', () => {
  const exams = [
    { examTypeId: 'mid', periodId: 't1', endDate: '2026-11-01', percent: 60 },
    { examTypeId: 'final', periodId: 't1', endDate: '2026-12-20', percent: 80 },
    { examTypeId: 'mid', periodId: 't2', endDate: '2027-03-01', percent: 70 },
    { examTypeId: 'final', periodId: 't2', endDate: '2027-06-10', percent: null },
  ];
  const weighted = { method: 'WEIGHTED', typeWeights: [{ examTypeId: 'mid', weight: 40 }, { examTypeId: 'final', weight: 60 }], periodWeights: [] };
  // t1: 0.4×60 + 0.6×80 = 72; t2: mid only → 70; average 71.
  assert.deepEqual(yearFinal(exams, weighted), { percent: 71, basis: 'weighted by type' });
  assert.equal(yearFinal(exams, { ...weighted, periodWeights: [{ periodId: 't1', weight: 25 }, { periodId: 't2', weight: 75 }] }).percent, 70.5);
  assert.equal(yearFinal(exams, { method: 'AVERAGE', typeWeights: [], periodWeights: [] }).percent, 70);
  assert.equal(yearFinal(exams, { method: 'LAST' }).percent, 70);
  assert.equal(yearFinal([], weighted).percent, null);
});

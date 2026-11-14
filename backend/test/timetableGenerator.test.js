import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { generateTimetable, hardViolations, random } from '../src/features/timetable-builder/generator.js';

// Pure tests of the timetable generator (no database).

const DAYS5 = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
/** n lesson periods a day from 08:00, 40 minutes each, a main break after period `breakAfter`. */
function bell(n, { days = DAYS5, start = 480, length = 40, breakAfter = Math.ceil(n / 2), breakLength = 20 } = {}) {
  const periods = [];
  let t = start;
  for (let i = 1; i <= n; i += 1) {
    periods.push({ number: i, startMinute: t, endMinute: t + length, half: i <= breakAfter ? 'before_break' : 'after_break' });
    t += length;
    if (i === breakAfter) t += breakLength;
  }
  return Object.fromEntries(days.map((d) => [d, periods]));
}
const section = (id, days) => ({ id, name: id, days });
const run = (input) => generateTimetable({ seed: 7, timeLimitMs: 20000, ...input });
const check = (input, result) => hardViolations({ sections: input.sections, lessons: result.lessons, teachers: input.teachers, rules: input.rules });
const countBy = (items, key) => items.reduce((m, x) => m.set(key(x), (m.get(key(x)) ?? 0) + 1), new Map());

describe('timetable generator', () => {
  test('places every lesson; shared teachers are never in two classes at once', () => {
    const days = bell(4);
    const input = {
      sections: [section('A', days), section('B', days)],
      units: [
        { sectionId: 'A', subjectId: 'math', teacherId: 't1', count: 5 },
        { sectionId: 'A', subjectId: 'eng', teacherId: 't2', count: 5 },
        { sectionId: 'A', subjectId: 'sci', teacherId: 't3', count: 5 },
        { sectionId: 'A', subjectId: 'so', teacherId: 't4', count: 5 },
        { sectionId: 'B', subjectId: 'math', teacherId: 't1', count: 5 },
        { sectionId: 'B', subjectId: 'eng', teacherId: 't2', count: 5 },
        { sectionId: 'B', subjectId: 'sci', teacherId: 't3', count: 5 },
        { sectionId: 'B', subjectId: 'so', teacherId: 't4', count: 5 },
      ],
      rules: { maxSubjectPerDay: 2 },
    };
    const result = run(input);
    assert.equal(result.lessons.length, 40);
    assert.deepEqual(result.unplaced, []);
    assert.deepEqual(check(input, result), []);
    assert.equal(result.score.spread, 0, 'one lesson of each subject a day');
  });

  test('a teacher teaches several subjects in one class; two teachers teach one subject in different classes at the same time', () => {
    // One period a day: both classes must have mathematics at the same time, with different teachers.
    const days = bell(1, { breakAfter: 1 });
    const input = {
      sections: [section('A', days), section('B', days)],
      units: [
        { sectionId: 'A', subjectId: 'math', teacherId: 't1', count: 3 },
        { sectionId: 'A', subjectId: 'phys', teacherId: 't1', count: 2 },
        { sectionId: 'B', subjectId: 'math', teacherId: 't2', count: 5 },
      ],
      rules: { maxSubjectPerDay: 1 },
    };
    const result = run(input);
    assert.deepEqual(result.unplaced, []);
    assert.deepEqual(check(input, result), []);
    const a = result.lessons.filter((l) => l.sectionId === 'A');
    assert.deepEqual([...countBy(a, (l) => l.subjectId)].sort(), [['math', 3], ['phys', 2]]);
    assert.ok(a.every((l) => l.teacherId === 't1'));
    const sameTime = result.lessons.filter((l) => l.sectionId === 'B' && a.some((x) => x.weekday === l.weekday && x.subjectId === 'math'));
    assert.equal(sameTime.length, 3, 'mathematics in A and B at the same time, by two teachers');
  });

  test('unavailable times and lessons elsewhere (another bell schedule) are respected, by clock time', () => {
    const days = bell(6);
    const input = {
      sections: [section('A', days)],
      units: [
        // Only period 4 (10:20–11:00) is left for t1 each day: exactly 5 lessons fit.
        { sectionId: 'A', subjectId: 'math', teacherId: 't1', count: 5 },
        { sectionId: 'A', subjectId: 'eng', teacherId: 't2', count: 25 },
      ],
      teachers: {
        t1: {
          name: 'Teacher One',
          unavailable: DAYS5.map((weekday) => ({ weekday, startMinute: 480, endMinute: 600 })), // 08:00–10:00
          // Teaching in another branch 11:30–12:10 every day (its bell differs: overlaps period 5).
          busy: DAYS5.map((weekday) => ({ weekday, startMinute: 690, endMinute: 730, label: 'Branch 2' })),
        },
      },
      rules: { maxSubjectPerDay: 5 },
    };
    const result = run(input);
    assert.deepEqual(result.unplaced, []);
    assert.deepEqual(check(input, result), []);
    const p = Object.fromEntries(days.MON.map((x) => [x.number, x]));
    for (const l of result.lessons.filter((x) => x.teacherId === 't1')) {
      const period = p[l.period];
      assert.ok(period.startMinute >= 600, `not before 10:00 (period ${l.period})`);
      assert.ok(!(period.startMinute < 730 && 690 < period.endMinute), `not during the lesson elsewhere (period ${l.period})`);
    }
    // One more lesson than fits: reported, with the reason.
    const more = run({ ...input, units: [{ ...input.units[0], count: 6 }, { ...input.units[1], count: 24 }] });
    assert.deepEqual(check(input, more), []);
    assert.equal(more.unplaced.length, 1);
    assert.equal(more.unplaced[0].count, 1);
    assert.ok(['teacher_unavailable', 'teacher_busy'].includes(more.unplaced[0].code));
  });

  test('daily limits: a teacher’s lessons per day and a subject’s lessons per day', () => {
    const days = bell(6);
    const input = {
      sections: [section('A', days), section('B', days)],
      units: [
        { sectionId: 'A', subjectId: 'math', teacherId: 't1', count: 6 },
        { sectionId: 'B', subjectId: 'math', teacherId: 't1', count: 6 },
        { sectionId: 'A', subjectId: 'eng', teacherId: 't2', count: 10 },
        { sectionId: 'B', subjectId: 'eng', teacherId: 't3', count: 10 },
      ],
      teachers: { t1: { name: 'T1', maxPerDay: 3 } },
      rules: { maxSubjectPerDay: 2 },
    };
    const result = run(input);
    assert.deepEqual(result.unplaced, []);
    assert.deepEqual(check(input, result), []);
    for (const n of countBy(result.lessons.filter((l) => l.teacherId === 't1'), (l) => l.weekday).values()) assert.ok(n <= 3);
    for (const n of countBy(result.lessons, (l) => `${l.sectionId}|${l.subjectId}|${l.weekday}`).values()) assert.ok(n <= 2);
  });

  test('without double lessons a subject never has two lessons in a row', () => {
    const days = bell(5);
    const input = {
      sections: [section('A', days)],
      units: [
        { sectionId: 'A', subjectId: 'math', teacherId: 't1', count: 10 },
        { sectionId: 'A', subjectId: 'eng', teacherId: 't2', count: 10 },
        { sectionId: 'A', subjectId: 'art', teacherId: 't3', count: 5 },
      ],
      rules: { maxSubjectPerDay: 2, allowDoubleLessons: false },
    };
    const result = run(input);
    assert.deepEqual(result.unplaced, []);
    assert.deepEqual(check(input, result), []);
  });

  test('fixed lessons stay exactly where they are; locked draft lessons too', () => {
    const days = bell(4);
    const input = {
      sections: [section('A', days)],
      units: [
        { sectionId: 'A', subjectId: 'pe', teacherId: 't1', count: 2 },
        { sectionId: 'A', subjectId: 'math', teacherId: 't2', count: 10 },
      ],
      fixed: [
        { sectionId: 'A', weekday: 'MON', period: 1, subjectId: 'pe', teacherId: 't1' },
        { sectionId: 'A', weekday: 'THU', period: 4, subjectId: 'math', teacherId: 't2', locked: true },
      ],
      rules: { maxSubjectPerDay: 2 },
    };
    const result = run(input);
    assert.equal(result.lessons.length, 12, 'fixed lessons count as lessons of their subject');
    assert.ok(result.lessons.some((l) => l.weekday === 'MON' && l.period === 1 && l.subjectId === 'pe' && l.fixed));
    assert.ok(result.lessons.some((l) => l.weekday === 'THU' && l.period === 4 && l.subjectId === 'math' && l.locked && !l.fixed));
    assert.deepEqual(check(input, result), []);
  });

  test('a fixed lesson that breaks a rule is reported, not placed', () => {
    const days = bell(4);
    const input = {
      sections: [section('A', days), section('B', days)],
      units: [],
      fixed: [
        { sectionId: 'A', weekday: 'MON', period: 1, subjectId: 'pe', teacherId: 't1' },
        { sectionId: 'B', weekday: 'MON', period: 1, subjectId: 'pe', teacherId: 't1' },
        { sectionId: 'B', weekday: 'MON', period: 9, subjectId: 'pe', teacherId: 't1' },
      ],
    };
    const result = run(input);
    assert.equal(result.lessons.length, 1);
    assert.deepEqual(result.problems.map((p) => p.code), ['teacher_clash', 'no_period']);
  });

  test('impossible loads: the lessons that do not fit are reported with the reason, the rest still placed', () => {
    const days = bell(4);
    const input = {
      sections: [section('A', days), section('B', days), section('C', days)],
      // t1 needs 24 lessons a week but there are only 20 periods.
      units: ['A', 'B', 'C'].map((s) => ({ sectionId: s, subjectId: 'math', teacherId: 't1', count: 8 })),
      rules: { maxSubjectPerDay: 2 },
    };
    const result = run(input);
    assert.deepEqual(check(input, result), [], 'never a broken rule, even when not everything fits');
    const left = result.unplaced.reduce((n, u) => n + u.count, 0);
    assert.equal(result.lessons.length + left, 24);
    assert.ok(left >= 4);
    assert.ok(result.unplaced.every((u) => ['teacher_clash', 'subject_day_limit'].includes(u.code) && u.reason));
  });

  test('free periods go at the end of the day, never before a class’s first lesson or between lessons', () => {
    const days = bell(7, { days: ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU'] });
    const sections = [section('A', days), section('B', days)];
    const subjects = [['math', 6], ['eng', 5], ['som', 5], ['arb', 4], ['sci', 5], ['sst', 4], ['isl', 4], ['ict', 2]]; // 35 of 42
    const units = sections.flatMap((s, i) => subjects.map(([subjectId, count], j) => ({ sectionId: s.id, subjectId, teacherId: `t${j}-${i % 2}`, count })));
    const input = { sections, units, rules: { maxSubjectPerDay: 2, allowDoubleLessons: false }, seed: 5, timeLimitMs: 20000 };
    const result = generateTimetable(input);
    assert.deepEqual(result.unplaced, []);
    assert.deepEqual(check(input, result), []);
    const late = [];
    for (const s of sections) {
      for (const [day, periods] of Object.entries(s.days)) {
        const taken = periods.map((p) => result.lessons.some((l) => l.sectionId === s.id && l.weekday === day && l.period === p.number));
        const lastTaken = taken.lastIndexOf(true);
        if (taken.slice(0, lastTaken + 1).includes(false)) late.push(`${s.id} ${day}: ${taken.map((t) => (t ? 'x' : '-')).join('')}`);
      }
    }
    assert.deepEqual(late, [], 'every free period after the last lesson of its day');
    assert.equal(result.score.holes, 0);
  });

  test('the same input and seed give the same timetable', () => {
    const days = bell(5);
    const input = {
      sections: [section('A', days), section('B', days)],
      units: [
        { sectionId: 'A', subjectId: 'math', teacherId: 't1', count: 8 },
        { sectionId: 'A', subjectId: 'eng', teacherId: 't2', count: 8 },
        { sectionId: 'A', subjectId: 'sci', teacherId: 't3', count: 9 },
        { sectionId: 'B', subjectId: 'math', teacherId: 't1', count: 8 },
        { sectionId: 'B', subjectId: 'eng', teacherId: 't3', count: 8 },
        { sectionId: 'B', subjectId: 'sci', teacherId: 't2', count: 9 },
      ],
      rules: { maxSubjectPerDay: 2 },
      maxIterations: 3000,
      timeLimitMs: 60000,
    };
    const a = generateTimetable({ ...input, seed: 42 });
    const b = generateTimetable({ ...input, seed: 42 });
    assert.deepEqual(a.lessons, b.lessons);
    assert.deepEqual(check(input, a), []);
  });

  test('a realistic branch: 12 classes, 6 days of 7 periods, shared teachers — everything placed, no conflict', () => {
    const days = bell(7, { days: ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU'] });
    const subjects = [
      ['math', 6], ['eng', 5], ['som', 5], ['arb', 4], ['sci', 5], ['so', 4], ['isl', 4], ['ict', 2], ['pe', 2], ['art', 1],
    ]; // 38 lessons of 42 periods
    const sections = Array.from({ length: 12 }, (_, i) => section(`S${i + 1}`, days));
    const rng = random(3);
    const units = [];
    // Each subject has teachers who each take up to 4 classes (more than one subject for some).
    const teacherFor = new Map();
    let next = 1;
    for (const [subject] of subjects) {
      for (let i = 0; i < sections.length; i += 1) {
        const group = Math.floor(i / 4);
        const key = `${subject}|${group}`;
        if (!teacherFor.has(key)) teacherFor.set(key, `t${next++}`);
      }
    }
    // Some teachers also teach a second subject in a class they already teach.
    for (const [i, s] of sections.entries()) {
      for (const [subject, count] of subjects) {
        const group = Math.floor(i / 4);
        let teacherId = teacherFor.get(`${subject}|${group}`);
        if (subject === 'art') teacherId = teacherFor.get(`so|${group}`);
        units.push({ sectionId: s.id, subjectId: subject, teacherId, count });
      }
    }
    const teachers = { [teacherFor.get('math|0')]: { name: 'Math 0', unavailable: [{ weekday: 'THU', startMinute: 600, endMinute: 900 }] } };
    const input = { sections, units, teachers, rules: { maxSubjectPerDay: 2, morningSubjectIds: ['math'], teacherMaxPerDay: 6 }, seed: Math.floor(rng() * 1000), timeLimitMs: 30000 };
    const result = generateTimetable(input);
    assert.deepEqual(result.unplaced, [], JSON.stringify(result.unplaced.slice(0, 3)));
    assert.equal(result.lessons.length, 12 * 38);
    assert.deepEqual(check(input, result), []);
    assert.ok(result.stats.ms < 30000);
  });
});

test('published views on the school days in effect: days no longer taught are left out, empty periods and lessons on those days are counted', async () => {
  const { onSchoolDays } = await import('../src/features/timetable-builder/views.service.js');
  const p = (n) => ({ kind: 'lesson', number: n });
  const grid = {
    periods: { SAT: [p(1), p(2), { kind: 'break', number: null }, p(3)], THU: [p(1), p(2), p(3)] },
    lessons: [
      { weekday: 'SAT', period: 2 },
      { weekday: 'SAT', period: 3 },
      { weekday: 'THU', period: 1 },
      { weekday: 'THU', period: 2 },
    ],
  };
  const seen = onSchoolDays(grid, ['SAT', 'SUN']);
  assert.deepEqual(Object.keys(seen.periods), ['SAT']);
  assert.equal(seen.lessons.length, 2);
  assert.deepEqual(seen.gaps, { empty: 1, offDay: 2, offDays: ['THU'] });
  // No school days set: nothing is hidden.
  assert.deepEqual(onSchoolDays(grid, []).gaps, { empty: 2, offDay: 0, offDays: [] });
  assert.equal(onSchoolDays(null, ['SAT']), null);
});

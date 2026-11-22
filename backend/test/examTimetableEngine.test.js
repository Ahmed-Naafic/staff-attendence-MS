/*
 * The examination timetable engine (pure): placing papers in sessions, session times, proportional
 * seating and invigilators by minimum-cost flow. No database.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { assignInvigilators, chooseRooms, minCostFlow, planPapers, seatSession, sessionTimes, toClock, toMinutes } from '../src/features/examinations/timetableEngine.js';

const DAYS = ['2026-12-01', '2026-12-02', '2026-12-03'];
const SHIFTS = [{ name: 'Morning', start: 480, sessions: 2 }];

describe('placing papers', () => {
  const papers = [
    { id: 'm7', classId: 'G7', subjectId: 'math', durationMinutes: 120, students: 40 },
    { id: 'm8', classId: 'G8', subjectId: 'math', durationMinutes: 90, students: 30 },
    { id: 'e7', classId: 'G7', subjectId: 'eng', durationMinutes: 60, students: 40 },
    { id: 'e8', classId: 'G8', subjectId: 'eng', durationMinutes: 60, students: 30 },
    { id: 's7', classId: 'G7', subjectId: 'sci', durationMinutes: 60, students: 40 },
  ];
  test('same subject together, one paper per class per session, spread over days', () => {
    const { slots, unplaced } = planPapers({ days: DAYS, shifts: SHIFTS, papers, maxPapersPerDay: 2, capacity: 100 });
    assert.deepEqual(unplaced, []);
    const slotOf = (id) => slots.find((s) => s.paperIds.includes(id));
    assert.equal(slotOf('m7'), slotOf('m8'), 'Mathematics together');
    assert.equal(slotOf('e7'), slotOf('e8'), 'English together');
    for (const s of slots) assert.equal(new Set(s.paperIds.map((id) => papers.find((p) => p.id === id).classId)).size, s.paperIds.length);
    const g7Days = ['m7', 'e7', 's7'].map((id) => slotOf(id).date);
    assert.equal(new Set(g7Days).size, 3, 'Grade 7’s three papers on three days');
  });
  test('limits: papers a day, seats, students', () => {
    const r = planPapers({ days: DAYS.slice(0, 1), shifts: SHIFTS, papers, maxPapersPerDay: 1, capacity: 100 });
    assert.equal(r.slots.length, 1);
    assert.equal(r.unplaced.length, 3, 'one paper a day for each class on one day');
    const seats = planPapers({ days: DAYS, shifts: SHIFTS, papers: papers.slice(0, 2), maxPapersPerDay: 2, capacity: 50 });
    assert.notEqual(seats.slots.find((s) => s.paperIds.includes('m7')), seats.slots.find((s) => s.paperIds.includes('m8')), 'split when the rooms cannot seat both');
    const big = planPapers({ days: DAYS, shifts: SHIFTS, papers: [{ ...papers[0], students: 500 }, { ...papers[1], students: 0 }], maxPapersPerDay: 2, capacity: 100 });
    assert.deepEqual(big.unplaced.map((u) => u.reason).sort(), ['no_students', 'too_many_students']);
  });
  test('times: longest paper, gap, shift start, midnight', () => {
    const slots = [
      { date: 'd', shift: 0, shiftName: 'Morning', index: 0, paperIds: ['a', 'b'] },
      { date: 'd', shift: 0, shiftName: 'Morning', index: 1, paperIds: ['c'] },
      { date: 'd', shift: 1, shiftName: 'Afternoon', index: 0, paperIds: ['d'] },
    ];
    const dur = { a: 120, b: 90, c: 60, d: 60 };
    const timed = sessionTimes(slots, [{ start: 480 }, { start: 660 }], 30, (id) => dur[id]);
    assert.deepEqual(timed.map((s) => [s.sequence, toClock(s.startMinute), toClock(s.endMinute)]), [[1, '08:00', '10:00'], [2, '10:30', '11:30'], [3, '12:00', '13:00']]);
    assert.throws(() => sessionTimes(slots, [{ start: 1380 }, { start: 1400 }], 30, (id) => dur[id]), { code: 'PAST_MIDNIGHT' });
    assert.equal(toMinutes('07:45'), 465);
    assert.equal(toMinutes('24:00'), null);
  });
});

describe('seating', () => {
  const students = (prefix, n) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, name: `${prefix} ${String(i).padStart(2, '0')}` }));
  const rooms = [{ id: 'R1', name: 'R1', capacity: 40 }, { id: 'R2', name: 'R2', capacity: 40 }, { id: 'R3', name: 'R3', capacity: 30 }];
  test('the fewest rooms that seat everyone, or all', () => {
    assert.deepEqual(chooseRooms(rooms, 70, false).map((r) => r.id), ['R1', 'R2']);
    assert.equal(chooseRooms(rooms, 70, true).length, 3);
  });
  test('every room gets its share of each class; seats alternate; everyone seated once', () => {
    const groups = [{ key: 'A', sittingId: 'p1', sectionId: 'A', students: students('A', 40) }, { key: 'B', sittingId: 'p2', sectionId: 'B', students: students('B', 30) }];
    const r = seatSession({ rooms, groups, distribution: 'alphabetical' });
    assert.deepEqual(r.unseated, []);
    assert.equal(r.seats.length, 70);
    assert.equal(new Set(r.seats.map((s) => s.studentId)).size, 70);
    for (const room of ['R1', 'R2']) {
      const here = r.seats.filter((s) => s.roomId === room);
      assert.equal(here.length, 35, 'equal rooms, equal shares');
      assert.deepEqual([here.filter((s) => s.sectionId === 'A').length, here.filter((s) => s.sectionId === 'B').length], [20, 15], 'proportional');
      const sorted = here.sort((a, b) => a.seatNumber - b.seatNumber);
      assert.notEqual(sorted[0].sectionId, sorted[1].sectionId, 'neighbours differ');
      assert.deepEqual(sorted.map((s) => s.seatNumber), Array.from({ length: 35 }, (_, i) => i + 1));
    }
    assert.ok(r.seats.filter((s) => s.roomId === 'R1' && s.sectionId === 'A').every((s) => Number(s.studentId.slice(1)) < 20), 'alphabetical: the first names fill the first room');
  });
  test('random order is seeded; rooms too small leave students unseated, never overfill', () => {
    const groups = [{ key: 'A', sittingId: 'p', sectionId: 'A', students: students('A', 50) }];
    const a = seatSession({ rooms, groups, distribution: 'random', seed: 7 });
    const b = seatSession({ rooms, groups, distribution: 'random', seed: 7 });
    assert.deepEqual(a.seats, b.seats);
    assert.notDeepEqual(a.seats.map((s) => s.studentId), seatSession({ rooms, groups, distribution: 'alphabetical' }).seats.map((s) => s.studentId));
    const small = seatSession({ rooms: [{ id: 'S', name: 'S', capacity: 20 }], groups, distribution: 'alphabetical' });
    assert.equal(small.seats.length, 20);
    assert.equal(small.unseated.length, 30);
  });
});

describe('invigilators', () => {
  test('minimum-cost flow', () => {
    // 0 → 1 → 3 (cost 1+1), 0 → 2 → 3 (cost 5+5); capacity 1 each: flow 2, cost 12.
    const r = minCostFlow(4, [[0, 1, 1, 1], [1, 3, 1, 1], [0, 2, 1, 5], [2, 3, 1, 5]], 0, 3);
    assert.deepEqual([r.flow, r.cost], [2, 12]);
  });
  const settings = { studentsPerInvigilator: 30, roomsPerInvigilator: 1, avoidOwnSubject: true };
  const sessions = [
    { id: 's1', date: 'd1', rooms: [{ roomId: 'R1', students: 40, subjects: [{ sectionId: 'A', subjectId: 'math' }] }, { roomId: 'R2', students: 20, subjects: [{ sectionId: 'B', subjectId: 'math' }] }] },
    { id: 's2', date: 'd2', rooms: [{ roomId: 'R1', students: 25, subjects: [{ sectionId: 'A', subjectId: 'eng' }] }] },
  ];
  const staff = ['t1', 't2', 't3', 't4'].map((id) => ({ id, teaches: new Set(id === 't1' ? ['A|math'] : []) }));
  test('one per N students, one room each per session, spread, no own subject', () => {
    const { assignments, shortfall } = assignInvigilators({ sessions, staff, settings });
    assert.deepEqual(shortfall, []);
    assert.equal(assignments.filter((a) => a.sessionId === 's1' && a.roomId === 'R1').length, 2, '40 students: two invigilators');
    assert.ok(!assignments.some((a) => a.staffId === 't1' && a.sessionId === 's1' && a.roomId === 'R1'), 'not the Mathematics teacher of section A');
    const s1 = assignments.filter((a) => a.sessionId === 's1').map((a) => a.staffId);
    assert.equal(new Set(s1).size, s1.length, 'nobody in two rooms at once');
    const duties = new Map();
    for (const a of assignments) duties.set(a.staffId, (duties.get(a.staffId) ?? 0) + 1);
    assert.ok(Math.max(...duties.values()) === 1, 'four duties over four people');
  });
  test('busy people are left out; a shortfall is reported', () => {
    const busy = new Set(['t2|s1', 't3|s1', 't4|s1']);
    const { shortfall } = assignInvigilators({ sessions, staff, busy, settings });
    assert.equal(shortfall.reduce((n, s) => n + s.missing, 0), 2, 'only t1 is free in s1 and may take R2 only');
  });
  test('rooms per invigilator', () => {
    const one = [{ id: 'x', teaches: new Set() }];
    const two = assignInvigilators({ sessions: [sessions[0]], staff: one, settings: { ...settings, roomsPerInvigilator: 2, studentsPerInvigilator: 100 } });
    assert.equal(two.assignments.length, 2);
    assert.deepEqual(two.shortfall, []);
  });
});

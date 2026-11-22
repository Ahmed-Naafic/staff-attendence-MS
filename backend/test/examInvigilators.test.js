/*
 * The invigilator matrix (pure): staff × examination days, rooms with their session times, filters,
 * and its exports. API coverage: examTimetable.test.js.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { exportRows, invigilatorMatrix, invigilatorMatrixPdf, invigilatorMatrixXlsx, weekdayOf } from '../src/features/examinations/examInvigilators.js';

const P = (id, name) => ({ id, name, staffId: `S-${id}` });
const ahmed = P('a', 'Ahmed');
const nasra = P('n', 'Nasra');
const room = (name, invigilators, students = 30, need = 1) => ({ room: { id: name, name }, students, invigilators, need });
const session = (id, date, sequence, start, end, rooms, shiftName = 'Morning') => ({ id, date, sequence, start, end, shiftName, rooms });
const T = {
  examination: { id: 'e', name: 'Mid-Term', startDate: '2026-11-28', endDate: '2026-11-30' },
  branch: { id: 'b', name: 'Main' },
  timetable: { publishedAt: '2026-11-20T08:00:00Z', changedSincePublish: false },
  sessions: [
    session('s1', '2026-11-28', 1, '07:00', '09:00', [room('R01', [ahmed]), room('R02', [nasra])]),
    session('s2', '2026-11-28', 2, '09:30', '12:00', [room('R05', [ahmed]), room('R06', [], 30, 1)]),
    session('s3', '2026-11-29', 1, '07:00', '09:00', [room('R02', [ahmed]), room('R01', [nasra])]),
    session('s4', '2026-11-30', 1, '13:00', '15:00', [room('R03', [nasra])], 'Afternoon'),
  ],
};

describe('invigilator matrix', () => {
  test('weekdays of calendar dates', () => {
    assert.equal(weekdayOf('2026-11-28'), 'Saturday');
    assert.equal(weekdayOf('2026-11-30'), 'Monday');
  });

  test('staff × days; two rooms on one day keep their own session times', () => {
    const m = invigilatorMatrix(T);
    assert.deepEqual(m.days, [{ date: '2026-11-28', weekday: 'Saturday' }, { date: '2026-11-29', weekday: 'Sunday' }, { date: '2026-11-30', weekday: 'Monday' }]);
    assert.deepEqual(m.rows.map((r) => r.staff.name), ['Ahmed', 'Nasra']);
    const a = m.rows[0];
    assert.deepEqual(a.cells['2026-11-28'].map((x) => [x.room.name, x.start, x.end, x.sequence]), [['R01', '07:00', '09:00', 1], ['R05', '09:30', '12:00', 2]]);
    assert.equal(a.cells['2026-11-30'], undefined, 'no duty that day');
    assert.equal(a.duties, 3);
    assert.deepEqual(m.summary, { staff: 2, duties: 6, days: 3, sessions: 4, roomsShort: 1 });
    assert.deepEqual(m.options, { shifts: ['Afternoon', 'Morning'], sessions: [1, 2], dates: ['2026-11-28', '2026-11-29', '2026-11-30'] });
  });

  test('filters: shift, session of the day, dates', () => {
    assert.deepEqual(invigilatorMatrix(T, { shift: 'Afternoon' }).rows.map((r) => r.staff.name), ['Nasra']);
    const second = invigilatorMatrix(T, { session: 2 });
    assert.deepEqual(second.days.map((d) => d.date), ['2026-11-28']);
    assert.deepEqual(second.rows[0].cells['2026-11-28'].map((x) => x.room.name), ['R05']);
    const range = invigilatorMatrix(T, { from: '2026-11-29', to: '2026-11-29' });
    assert.deepEqual(range.days.map((d) => d.date), ['2026-11-29']);
    assert.equal(range.summary.duties, 2);
    assert.equal(invigilatorMatrix(T, { from: '2026-12-01' }).days.length, 0);
  });

  test('export rows: staff names and room numbers only', () => {
    assert.deepEqual(exportRows(invigilatorMatrix(T)), [
      ['Ahmed', 'R01 | R05', 'R02', ''],
      ['Nasra', 'R02', 'R01', 'R03'],
    ]);
  });

  test('exports: PDF and Excel of the filtered matrix', () => {
    const m = invigilatorMatrix(T, { session: 1 });
    const pdf = invigilatorMatrixPdf({ school: { name: 'Hiigsi School' } }, m);
    assert.equal(pdf.buffer.subarray(0, 5).toString(), '%PDF-');
    assert.equal(pdf.filename, 'invigilators-Mid-Term-Main.pdf');
    const xlsx = invigilatorMatrixXlsx(m);
    assert.equal(xlsx.buffer.subarray(0, 2).toString(), 'PK');
    assert.equal(xlsx.filename, 'invigilators-Mid-Term-Main.xlsx');
    const empty = invigilatorMatrixPdf({ school: { name: '' } }, invigilatorMatrix(T, { from: '2026-12-01' }));
    assert.equal(empty.buffer.subarray(0, 5).toString(), '%PDF-');
  });
});

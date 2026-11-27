/*
 * Examination screens with a mocked API: an invigilator's duties and room attendance (rest present,
 * one absent), and a teacher's marks (typed, absent, limits, submit). UI tests with mocked responses:
 * they do not prove integration with the real backend (backend/test/examMarks.test.js does that).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { getDatabase, resetDatabaseForTests } from '../db/database';
import { attendanceChanges, attendanceCount, markChanges, parseMark, restPresent } from '../exams/examRules';
import { createServer, networkDown, renderApp, storeSession } from './harness';

beforeEach(() => {
  global.__secureStore.clear();
  resetDatabaseForTests();
  storeSession();
});

const seat = (id, name, n, attendance = null) => ({ seatNumber: n, student: { id, name, number: `S-${id}` }, section: { id: 'sec', name: 'Grade 7A' }, subject: 'Mathematics', paperId: 'p1', attendance, note: '', markedBy: null, markedAt: null });
const roomBody = (seats, canMark = true) => ({
  session: { id: 'ses-1', date: '2026-12-01', start: '08:00', end: '10:00', shiftName: 'Morning' },
  room: { id: 'r1', name: 'R1' },
  examination: { id: 'e1', name: 'Mid-Term' },
  canMark,
  seats,
  summary: { students: seats.length, present: 0, absent: 0, late: 0, excused: 0, notTaken: seats.length },
});
const dutiesBody = () => ({
  date: '2026-12-01',
  duties: [{ session: { id: 'ses-1', date: '2026-12-01', start: '08:00', end: '10:00', shiftName: 'Morning' }, room: { id: 'r1', name: 'R1' }, branch: { id: 'b', name: 'Main' }, examination: { id: 'e1', name: 'Mid-Term' }, papers: ['Mathematics · Grade 7'], summary: { students: 2, present: 0, absent: 0, late: 0, excused: 0, notTaken: 2 }, canMark: true }],
});
const student = (id, name, extra = {}) => ({ student: { id, name, number: `S-${id}` }, attendance: null, absent: false, excused: false, marks: null, lockedByAttendance: false, ...extra });
const sheetBody = (students, extra = {}) => ({
  paper: { id: 'p1', subject: { id: 'm', name: 'Mathematics' }, class: { id: 'c', name: 'Grade 7' }, maxMarks: 50 },
  section: { id: 'sec', name: 'Grade 7A', branch: { id: 'b', name: 'Main' } },
  examination: { id: 'e1', name: 'Mid-Term' },
  status: 'draft',
  deadline: '2026-12-08',
  opened: true,
  returnedReason: null,
  actions: { edit: true, submit: false, approve: false, return: false },
  stats: { students: students.length, entered: 0, absent: 0, excused: 0, average: null },
  students,
  ...extra,
});

test('rules: attendance changes, rest present, counts; typed marks', () => {
  const seats = [seat('a', 'Amina', 1), seat('b', 'Bashir', 2, 'present')];
  const draft = restPresent(seats, { b: 'absent' });
  expect(draft).toEqual({ a: 'present', b: 'absent' });
  expect(attendanceChanges(seats, draft)).toEqual([{ student: 'a', status: 'present' }, { student: 'b', status: 'absent' }]);
  expect(attendanceCount(seats, { a: 'late' })).toBe('1 present · 1 late');
  expect(parseMark('40,5', 50)).toEqual({ value: 40.5 });
  expect(parseMark('51', 50).error).toBeTruthy();
  const rows = [student('a', 'A'), student('b', 'B', { marks: 10 }), student('c', 'C', { attendance: 'absent', absent: true, lockedByAttendance: true })];
  expect(markChanges(rows, { a: '30', b: '10' }, { c: false }, 50)).toEqual({ entries: [{ student: 'a', marks: 30, absent: false }], errors: {} });
  expect(markChanges(rows, { a: '99' }, {}, 50).errors.a).toBe('At most 50');
  expect(markChanges(rows, {}, { b: true }, 50).entries).toEqual([{ student: 'b', marks: null, absent: true }]);
});

test('an invigilator takes a room’s attendance: rest present, one absent', async () => {
  const server = createServer({
    'GET /api/teacher/exams/duties': () => [200, dutiesBody()],
    'GET /api/teacher/exams/duties/ses-1/rooms/r1': () => [200, roomBody([seat('a', 'Amina Hassan', 1), seat('b', 'Bashir Ali', 2)])],
    'PUT /api/teacher/exams/attendance': ({ body }) => [200, roomBody([seat('a', 'Amina Hassan', 1, body.marks[0].status), seat('b', 'Bashir Ali', 2, body.marks[1].status)])],
  });
  await renderApp(server);
  await fireEvent.press(await screen.findByTestId('header-profile'));
  await fireEvent.press(await screen.findByTestId('profile-exam-duties'));
  await fireEvent.press(await screen.findByText('R1 · 08:00–10:00'));
  expect(await screen.findByText('1. Amina Hassan')).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('absent-b'));
  await fireEvent.press(screen.getByText('Rest present'));
  await fireEvent.press(screen.getByText('Save 2'));
  expect(await screen.findByText('Attendance saved.')).toBeOnTheScreen();
  expect(server.calls.find((c) => c.key === 'PUT /api/teacher/exams/attendance').body).toEqual({ session: 'ses-1', room: 'r1', marks: [{ student: 'a', status: 'present' }, { student: 'b', status: 'absent' }] });
});

test('a teacher enters marks (an absent student gets none) and submits them', async () => {
  let saved = null;
  const locked = () => student('c', 'Caamir Yusuf', { attendance: 'absent', absent: true, lockedByAttendance: true });
  const afterSave = () => [200, sheetBody([student('a', 'Amina Hassan', { marks: 42 }), locked()], { actions: { edit: true, submit: true, approve: false, return: false } })];
  const server = createServer({
    'GET /api/teacher/exams/marks': () => [200, { date: '2026-12-01', items: [{ paper: { id: 'p1', subject: { name: 'Mathematics' }, maxMarks: 50 }, section: { id: 'sec', name: 'Grade 7A' }, examination: { id: 'e1', name: 'Mid-Term' }, status: 'draft', deadline: '2026-12-08', opened: true, satOn: '2026-12-01', canEdit: true, entered: 0, students: 2 }] }],
    // The server answers with the sheet as stored (after a save: with the saved marks).
    'GET /api/teacher/exams/marks/p1/sec': () => (saved ? afterSave() : [200, sheetBody([student('a', 'Amina Hassan'), locked()])]),
    'PUT /api/teacher/exams/marks/p1/sec': ({ body }) => {
      saved = body;
      return afterSave();
    },
    'POST /api/teacher/exams/marks/p1/sec/submit': () => [200, sheetBody([student('a', 'Amina Hassan', { marks: 42 })], { status: 'submitted', actions: { edit: false, submit: false, approve: false, return: false } })],
  });
  await renderApp(server);
  await fireEvent.press(await screen.findByTestId('header-profile'));
  await fireEvent.press(await screen.findByTestId('profile-exam-marks'));
  await fireEvent.press(await screen.findByText('Mathematics · Grade 7A'));
  expect(await screen.findByTestId('marks-a')).toBeOnTheScreen();
  expect(screen.queryByTestId('marks-c')).toBeNull();
  await fireEvent.changeText(screen.getByTestId('marks-a'), '60');
  expect(await screen.findByText('At most 50')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByTestId('marks-a'), '42');
  await fireEvent.press(screen.getByText('Save 1'));
  expect(await screen.findByText('Marks saved.')).toBeOnTheScreen();
  expect(saved).toEqual({ marks: [{ student: 'a', marks: 42, absent: false }] });
  await fireEvent.press(screen.getByText('Submit for approval'));
  expect(await screen.findByText('Submitted for approval.')).toBeOnTheScreen();
});

test('offline: saved marks wait on the phone as a draft; submitting waits until they have uploaded', async () => {
  let up = false;
  let saved = null;
  const locked = () => student('c', 'Caamir Yusuf', { attendance: 'absent', absent: true, lockedByAttendance: true });
  const sheet = (marks) => [200, sheetBody([student('a', 'Amina Hassan', marks === undefined ? {} : { marks }), locked()], { actions: { edit: true, submit: true, approve: false, return: false } })];
  const server = createServer({
    'GET /api/teacher/exams/marks': () => [200, { date: '2026-12-01', items: [{ paper: { id: 'p1', subject: { name: 'Mathematics' }, maxMarks: 50 }, section: { id: 'sec', name: 'Grade 7A' }, examination: { id: 'e1', name: 'Mid-Term' }, status: 'draft', deadline: '2026-12-08', opened: true, satOn: '2026-12-01', canEdit: true, entered: 0, students: 2 }] }],
    'GET /api/teacher/exams/marks/p1/sec': () => sheet(saved ? 42 : undefined),
    'PUT /api/teacher/exams/marks/p1/sec': ({ body }) => {
      if (!up) return networkDown();
      saved = body;
      return sheet(42);
    },
  });
  await renderApp(server);
  await fireEvent.press(await screen.findByTestId('header-profile'));
  await fireEvent.press(await screen.findByTestId('profile-exam-marks'));
  await fireEvent.press(await screen.findByText('Mathematics · Grade 7A'));
  await fireEvent.changeText(await screen.findByTestId('marks-a'), '42');
  await fireEvent.press(screen.getByText('Save 1'));
  expect(await screen.findByText(/Saved on this phone/)).toBeOnTheScreen();
  expect(screen.getByText(/1 saved change is waiting to upload/)).toBeOnTheScreen();
  expect(screen.getByTestId('submit-marks')).toBeDisabled();
  const db = await getDatabase();
  const [row] = await db.getAllAsync('SELECT * FROM outbox');
  expect(row).toMatchObject({ kind: 'exam-marks', state: 'pending', label: 'Mathematics · Grade 7A' });
  expect(JSON.parse(row.payload)).toEqual({ paperId: 'p1', sectionId: 'sec', marks: [{ student: 'a', marks: 42, absent: false }] });
  // Back online: the same record uploads.
  up = true;
  await fireEvent.press(screen.getByLabelText('Back'));
  await fireEvent.press(screen.getByLabelText('Back'));
  await fireEvent.press(await screen.findByTestId('open-sync'));
  await fireEvent.press(await screen.findByTestId('sync-now'));
  await waitFor(async () => expect((await db.getFirstAsync('SELECT state FROM outbox')).state).toBe('recorded'));
  expect(saved).toEqual({ marks: [{ student: 'a', marks: 42, absent: false }] });
});

/*
 * The lesson screens with a mocked API: today's lessons, marking a class (all present, one absent),
 * the marks sent with their time, offline marks kept and uploaded later, Manager marks read only,
 * and the school switch. UI tests with mocked responses: they do not prove integration with the
 * real backend (backend/test/teacher-attendance.test.js does that).
 */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { getDatabase, resetDatabaseForTests } from '../db/database';
import { localDate } from '../lib/format';
import { createServer, networkDown, renderApp, storeSession, ZONE } from './harness';

beforeEach(() => {
  global.__secureStore.clear();
  resetDatabaseForTests();
  storeSession();
});

const today = () => localDate(new Date(), ZONE);
const student = (id, name, extra = {}) => ({ id, number: `S-${id}`, name, status: null, effective: 'pending', markedBy: null, setByManager: false, occurredAt: null, excuse: null, ...extra });
const lessonBody = (students, extra = {}) => ({
  key: `sec-a|${today()}|1`,
  date: today(),
  period: 1,
  start: '00:01',
  end: '23:58',
  half: 'whole_day',
  section: { id: 'sec-a', displayName: 'Grade 7A', branch: { id: 'b1', name: 'Main', code: 'M' } },
  subject: { id: 'sub-1', name: 'Mathematics', code: null },
  room: '',
  opensAt: new Date(Date.now() - 3600_000).toISOString(),
  deadlineAt: new Date(Date.now() + 3600_000).toISOString(),
  uploadUntil: new Date(Date.now() + 86_400_000).toISOString(),
  state: 'open',
  session: null,
  students,
  ...extra,
});
const dayBody = (lessons) => ({ date: today(), serverTime: new Date().toISOString(), teacher: { id: 'staff-1', name: 'Ayaan' }, lessons });

async function openLessons() {
  await fireEvent.press(await screen.findByText('Lessons'));
  expect(await screen.findByText('My lessons')).toBeOnTheScreen();
}

test('a teacher marks a class: all present, one absent; marks are sent with the time taken', async () => {
  const students = [student('s1', 'Amina Hassan'), student('s2', 'Bashir Ali'), student('s3', 'Caamir Yusuf', { status: 'late', effective: 'late', setByManager: true, markedBy: 'The Manager' })];
  const server = createServer({
    'GET /api/teacher/lessons': () => [200, dayBody([lessonBody(students)])],
    'PUT /api/teacher/lessons/marks': ({ body }) => [200, { results: body.marks.map((m) => ({ student: m.student, result: 'recorded' })), lesson: null }],
  });
  await renderApp(server);
  await openLessons();
  await fireEvent.press(await screen.findByText('Mathematics · Grade 7A'));
  expect(await screen.findByText('Set by The Manager')).toBeOnTheScreen();
  expect(screen.queryByTestId('present-s3')).toBeNull();
  await fireEvent.press(screen.getByText('All present'));
  await fireEvent.press(screen.getByTestId('absent-s2'));
  await fireEvent.press(screen.getByText('Save 2 marks'));
  expect(await screen.findByText('Attendance saved.')).toBeOnTheScreen();
  const sent = server.calls.find((c) => c.key === 'PUT /api/teacher/lessons/marks').body;
  expect(sent).toMatchObject({ section: 'sec-a', date: today(), period: 1 });
  expect(sent.marks.map((m) => [m.student, m.status])).toEqual([
    ['s1', 'present'],
    ['s2', 'absent'],
  ]);
  expect(Date.parse(sent.marks[0].occurredAt)).toBeLessThanOrEqual(Date.parse(sent.sentAt));
});

test('offline: the marks stay on the phone and upload later with their original time', async () => {
  let up = false;
  const server = createServer({
    'GET /api/teacher/lessons': () => [200, dayBody([lessonBody([student('s1', 'Amina Hassan')])])],
    'PUT /api/teacher/lessons/marks': ({ body }) => (up ? [200, { results: body.marks.map((m) => ({ student: m.student, result: 'recorded' })), lesson: null }] : networkDown()),
  });
  await renderApp(server);
  await openLessons();
  await fireEvent.press(await screen.findByText('Mathematics · Grade 7A'));
  await fireEvent.press(await screen.findByTestId('present-s1'));
  await fireEvent.press(screen.getByText('Save 1 mark'));
  expect(await screen.findByText(/Saved on this phone. 1 mark will upload/)).toBeOnTheScreen();
  expect(await screen.findByText('Waiting to upload')).toBeOnTheScreen();
  const db = await getDatabase();
  const [row] = await db.getAllAsync('SELECT state, occurred_at FROM lesson_mark_queue');
  expect(row.state).toBe('pending');

  up = true;
  await fireEvent.press(screen.getByLabelText('Back'));
  await fireEvent.press(await screen.findByText(/1 lesson mark waiting to upload/));
  await fireEvent.press(await screen.findByTestId('sync-now'));
  await waitFor(async () => expect((await db.getAllAsync('SELECT state FROM lesson_mark_queue'))[0].state).toBe('recorded'));
  const sent = server.calls.filter((c) => c.key === 'PUT /api/teacher/lessons/marks').at(-1).body;
  expect(sent.marks[0].occurredAt).toBe(row.occurred_at);
});

test('switched off for the school: a plain notice, nothing to mark', async () => {
  const server = createServer({ 'GET /api/teacher/lessons': () => [403, { error: 'Off', code: 'FEATURE_DISABLED' }] });
  await renderApp(server);
  await fireEvent.press(await screen.findByText('Lessons'));
  expect(await screen.findByText('Student attendance is not on')).toBeOnTheScreen();
});

test('no lessons today', async () => {
  const server = createServer({ 'GET /api/teacher/lessons': () => [200, dayBody([])] });
  await renderApp(server);
  await openLessons();
  expect(await screen.findByText('No lessons today')).toBeOnTheScreen();
});

test('My week: the teacher’s timetable by day (every branch), kept for offline use', async () => {
  let up = true;
  const week = {
    date: today(),
    days: ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU'],
    rows: [],
    lessons: [
      { weekday: 'MON', period: 1, start: '07:30', end: '08:10', section: { id: 'sec-a', displayName: 'Grade 7A', branch: { id: 'b1', name: 'Main' } }, subject: { id: 'sub-1', name: 'Mathematics' }, room: 'R1' },
      { weekday: 'TUE', period: 2, start: '08:10', end: '08:50', section: { id: 'sec-b', displayName: 'Grade 8B', branch: { id: 'b2', name: 'North' } }, subject: { id: 'sub-1', name: 'Mathematics' }, room: '' },
    ],
    perDay: { MON: 1, TUE: 1 },
    total: 2,
  };
  const server = createServer({
    'GET /api/teacher/lessons': () => [200, dayBody([])],
    'GET /api/teacher/timetable': () => (up ? [200, week] : networkDown()),
  });
  await renderApp(server);
  await openLessons();
  await fireEvent.press(screen.getByTestId('open-timetable'));
  expect(await screen.findByText('2 lessons a week')).toBeOnTheScreen();
  expect(screen.getByText('Mathematics · Grade 8B')).toBeOnTheScreen();
  expect(screen.getByText('North')).toBeOnTheScreen();
  // Offline: the saved week is shown.
  up = false;
  await fireEvent.press(screen.getByLabelText('Back'));
  await fireEvent.press(await screen.findByTestId('open-timetable'));
  await waitFor(() => expect(screen.getByText(/saved week|You’re offline/)).toBeOnTheScreen());
  expect(screen.getByText('Mathematics · Grade 7A')).toBeOnTheScreen();
});

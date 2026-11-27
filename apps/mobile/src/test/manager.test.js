/*
 * The Manager workspace with a mocked API: the branch dashboard, staff attendance review, and a
 * student attendance correction (an excuse needs a reason; the server records it).
 */
import { fireEvent, screen } from '@testing-library/react-native';
import { resetDatabaseForTests } from '../db/database';
import { createServer, renderApp, storeSession } from './harness';

const MANAGER = { id: 'mgr-1', name: 'Faadumo Nur', role: 'MANAGER', mustChangePassword: false, theme: 'light' };
const routes = (extra = {}) => ({
  'GET /api/auth/session': () => [200, { user: MANAGER }],
  'GET /api/manager/branch': () => [200, { branch: { id: 'b1', code: 'B1', name: 'Main Campus' }, school: { id: 's1', name: 'City School' } }],
  'GET /api/manager/dashboard': () => [200, { kpis: { students: { value: 320 }, staff: { value: 24 }, classes: { value: 8 }, sections: { value: 12 }, fees: null }, attendanceToday: { sections: 12, sectionsTaken: 9, sessionsMissing: 3 }, alerts: [{ key: 'missing', tone: 'warning', title: 'Attendance not taken', count: 3 }] }],
  'GET /api/manager/attendance/records': () => [200, { items: [{ id: 'r1', staff: { id: 'st', name: 'Ayaan Ahmed' }, shift: { name: 'Main' }, status: 'LATE', checkIn: { time: '07:58' }, checkOut: null }] }],
  'GET /api/manager/student-attendance/day': () => [200, { date: '2026-11-27', totals: { sessions: 1, taken: 1 }, items: [{ section: { id: 'sec', displayName: 'Grade 7A' }, schoolDay: true, halves: [{ half: 'whole', session: { id: 'ses-1' } }], lessons: [] }] }],
  'GET /api/manager/student-attendance/sessions/ses-1': () => [200, { students: [{ student: { id: 'a', name: 'Amina Hassan' }, status: 'absent', version: 2 }] }],
  ...extra,
});

beforeEach(() => {
  global.__secureStore.clear();
  resetDatabaseForTests();
  storeSession(MANAGER);
});

test('a Manager gets the branch dashboard and reviews staff attendance', async () => {
  const server = createServer(routes());
  await renderApp(server);
  expect(await screen.findByText('9/12')).toBeOnTheScreen();
  expect(screen.getByText('Attendance not taken (3)')).toBeOnTheScreen();
  expect(server.count('GET /api/attendance/today')).toBe(0);
  await fireEvent.press(screen.getByTestId('action-staff-att'));
  expect(await screen.findByText('Ayaan Ahmed')).toBeOnTheScreen();
  expect(screen.getByText('Late')).toBeOnTheScreen();
});

test('a Manager corrects a student mark; an excuse needs a reason', async () => {
  let sent = null;
  const server = createServer(
    routes({
      'PUT /api/manager/student-attendance/sessions/ses-1/marks': ({ body }) => {
        sent = body;
        return [200, { session: { id: 'ses-1' } }];
      },
    }),
  );
  await renderApp(server);
  await fireEvent.press(await screen.findByTestId('action-student-att'));
  await fireEvent.press(await screen.findByText('Day'));
  await fireEvent.press(await screen.findByTestId('mark-a-excused'));
  expect(screen.getByTestId('save-session-marks')).toBeDisabled();
  await fireEvent.changeText(screen.getByTestId('reason-a'), 'Hospital visit');
  await fireEvent.press(screen.getByTestId('save-session-marks'));
  expect(await screen.findByText(/The server recorded the changes/)).toBeOnTheScreen();
  expect(sent).toEqual({ marks: [{ student: 'a', status: 'excused', reason: 'Hospital visit', version: 2 }] });
});

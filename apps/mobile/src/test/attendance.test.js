/*
 * Attendance screens with a mocked API: check-in success only after the server confirms, one
 * submission per tap, offline queueing and later upload with the same id, refusals, the
 * on-device location check, history states, theme switching and sign-out with waiting events.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { getDatabase, readValue, resetDatabaseForTests } from '../db/database';
import { BRANCH, createServer, networkDown, recordedEvent, renderApp, storeSession, todayBody } from './harness';

const M_PER_DEG = (6_371_008.8 * Math.PI) / 180;

beforeEach(() => {
  global.__secureStore.clear();
  resetDatabaseForTests();
  storeSession();
  Location.getCurrentPositionAsync.mockImplementation(async () => ({ coords: { ...BRANCH, accuracy: 12 }, timestamp: Date.now() }));
  Location.getForegroundPermissionsAsync.mockImplementation(async () => ({ granted: true, status: 'granted', canAskAgain: true }));
});

async function openCheckIn() {
  await fireEvent.press(await screen.findByTestId('fingerprint-action'));
  expect(await screen.findByText('Your location')).toBeOnTheScreen();
}

const queueRows = async () => (await getDatabase()).getAllAsync('SELECT client_event_id, state, attempts, error_code FROM attendance_queue');

test('check-in: success is shown only after the server records it; a double tap sends once', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const server = createServer({
    'POST /api/attendance/events': async ({ body }) => {
      await gate;
      return [201, { event: recordedEvent(body) }];
    },
  });
  await renderApp(server);
  await openCheckIn();
  const confirm = screen.getByTestId('confirm');
  // Three taps before React re-renders (the button is not yet shown as busy), while the server
  // has not answered.
  await act(async () => {
    confirm.props.onClick({ nativeEvent: {} });
    confirm.props.onClick({ nativeEvent: {} });
    confirm.props.onClick({ nativeEvent: {} });
  });
  await waitFor(() => expect(server.count('POST /api/attendance/events')).toBe(1));
  expect(screen.queryByText('Checked in')).toBeNull();
  await act(async () => release());
  expect(await screen.findByText('Checked in')).toBeOnTheScreen();
  expect(screen.getByText('Present')).toBeOnTheScreen();
  expect(screen.getByText('28 m')).toBeOnTheScreen();
  expect(screen.getByText('12 m')).toBeOnTheScreen();
  expect(server.count('POST /api/attendance/events')).toBe(1);
  const sent = server.calls.find((c) => c.key === 'POST /api/attendance/events').body;
  expect(Object.keys(sent).sort()).toEqual(['clientEventId', 'occurredAt', 'position', 'sentAt', 'type']);
  expect(sent.type).toBe('CHECK_IN');
  expect((await queueRows())[0]).toMatchObject({ client_event_id: sent.clientEventId, state: 'recorded' });
});

test('offline check-in is saved, not shown as a success, and uploaded later with the same id', async () => {
  const server = createServer({ 'POST /api/attendance/events': networkDown });
  await renderApp(server);
  await openCheckIn();
  await fireEvent.press(screen.getByTestId('confirm'));
  expect(await screen.findByText('Saved on this phone')).toBeOnTheScreen();
  expect(screen.getByText('Waiting to upload')).toBeOnTheScreen();
  expect(screen.queryByText('Checked in')).toBeNull();
  const [row] = await queueRows();
  expect(row.state).toBe('pending');

  // Back online: Sync now uploads it with the stored id.
  server.routes['POST /api/attendance/events'] = ({ body }) => [201, { event: recordedEvent(body) }];
  await fireEvent.press(screen.getByText('View sync status'));
  expect(await screen.findByText('Pending uploads')).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('sync-now'));
  expect(await screen.findByText('Everything is uploaded')).toBeOnTheScreen();
  const posts = server.calls.filter((c) => c.key === 'POST /api/attendance/events');
  expect(posts.length).toBeGreaterThanOrEqual(2);
  expect(new Set(posts.map((p) => p.body.clientEventId))).toEqual(new Set([row.client_event_id]));
  expect(new Set(posts.map((p) => p.body.occurredAt)).size).toBe(1);
  expect((await queueRows())[0].state).toBe('recorded');
});

test('a refusal by the server is shown with its reason and is not a success', async () => {
  const server = createServer({
    'POST /api/attendance/events': () => [422, { error: 'Check-in is open from 30 minutes before your shift until it ends.', code: 'OUTSIDE_SHIFT_WINDOW' }],
  });
  await renderApp(server);
  await openCheckIn();
  await fireEvent.press(screen.getByTestId('confirm'));
  expect(await screen.findByText('Check-in is not open')).toBeOnTheScreen();
  expect(screen.getByText('Check-in is open from 30 minutes before your shift until it ends.')).toBeOnTheScreen();
  expect(screen.queryByText('Checked in')).toBeNull();
  expect((await queueRows())[0]).toMatchObject({ state: 'rejected', error_code: 'OUTSIDE_SHIFT_WINDOW' });
});

test('outside the geofence or with poor accuracy: confirm is disabled and nothing is saved or sent', async () => {
  Location.getCurrentPositionAsync.mockImplementation(async () => ({ coords: { latitude: BRANCH.latitude + 150 / M_PER_DEG, longitude: BRANCH.longitude, accuracy: 12 }, timestamp: Date.now() }));
  const server = createServer();
  await renderApp(server);
  await fireEvent.press(await screen.findByTestId('fingerprint-action'));
  expect(await screen.findByText('You are more than 100 m from your branch. Move closer and try again.')).toBeOnTheScreen();
  expect(screen.getByTestId('confirm')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('confirm'));
  expect(server.count('POST /api/attendance/events')).toBe(0);
  expect(await queueRows()).toHaveLength(0);
});

test('location permission is explained before the system prompt', async () => {
  Location.getForegroundPermissionsAsync.mockImplementation(async () => ({ granted: false, status: 'undetermined', canAskAgain: true }));
  await renderApp(createServer());
  await fireEvent.press(await screen.findByTestId('fingerprint-action'));
  expect(await screen.findByRole('header', { name: 'Allow location access' })).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('allow-location'));
  expect(Location.requestForegroundPermissionsAsync).toHaveBeenCalled();
  expect(await screen.findByText('Your location')).toBeOnTheScreen();
});

test('after check-in, Home offers check-out and shows the recorded time', async () => {
  const server = createServer({
    'GET /api/attendance/today': () => [200, todayBody({ events: [recordedEvent({ clientEventId: 'c-1', type: 'CHECK_IN', occurredAt: new Date(Date.now() - 60000).toISOString(), sentAt: new Date().toISOString() })] })],
  });
  await renderApp(server);
  expect(await screen.findByTestId('check-out')).toBeOnTheScreen();
  expect(screen.getByText('Checked In')).toBeOnTheScreen();
  expect(screen.getAllByText(/Present/).length).toBeGreaterThan(0);
});

test('history: an empty period, a failure with retry, then real records', async () => {
  let mode = 'empty';
  const server = createServer({
    'GET /api/attendance/history': ({ url }) => {
      if (mode === 'empty') return [200, { from: '2026-10-26', to: '2026-10-27', events: [] }];
      if (mode === 'fail') return [500, { error: 'Something went wrong.', code: 'INTERNAL_ERROR' }];
      const from = new URL(url).searchParams.get('from');
      return [200, { from, to: '2026-10-27', events: [recordedEvent({ clientEventId: 'h-1', type: 'CHECK_IN', occurredAt: '2026-10-27T04:58:00.000Z', sentAt: '2026-10-27T04:58:00.000Z' })] }];
    },
  });
  await renderApp(server);
  await fireEvent.press(await screen.findByText('History'));
  expect(await screen.findByText('No attendance recorded')).toBeOnTheScreen();
  mode = 'fail';
  await fireEvent.press(screen.getByText('This Month'));
  expect(await screen.findByText('History couldn’t be loaded')).toBeOnTheScreen();
  expect(screen.getByText(/on the server/)).toBeOnTheScreen();
  mode = 'ok';
  await fireEvent.press(screen.getByText('Try again'));
  expect(await screen.findByText('Checked in 07:58')).toBeOnTheScreen();
  const query = new URL(server.calls.filter((c) => c.key === 'GET /api/attendance/history').at(-1).url).searchParams;
  expect(query.get('from')).toMatch(/^\d{4}-\d{2}-01$/);
});

test('theme: choosing Dark is applied and saved on the phone', async () => {
  await renderApp(createServer());
  await fireEvent.press(await screen.findByText('Profile'));
  await fireEvent.press(await screen.findByTestId('open-settings'));
  const dark = await screen.findByTestId('theme-dark');
  expect(dark).not.toBeChecked();
  await fireEvent.press(dark);
  expect(screen.getByTestId('theme-dark')).toBeChecked();
  expect(screen.getByTestId('theme-system')).not.toBeChecked();
  await waitFor(async () => expect(await readValue(await getDatabase(), 'theme.preference')).toBe('dark'));
});

test('sign-out with events waiting: confirmation says they stay on the phone; they are kept', async () => {
  const server = createServer({ 'POST /api/attendance/events': networkDown });
  await renderApp(server);
  await openCheckIn();
  await fireEvent.press(screen.getByTestId('confirm'));
  await fireEvent.press(await screen.findByTestId('back-home'));
  expect(await screen.findByText('1 waiting to upload')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('Profile'));
  await fireEvent.press(await screen.findByTestId('sign-out'));
  expect(await screen.findByText(/1 attendance event has not been uploaded yet/)).toBeOnTheScreen();
  // The dialog's button (the profile row has the same label).
  await fireEvent.press(screen.getAllByText('Sign out').at(-1));
  expect(await screen.findByTestId('sign-in')).toBeOnTheScreen();
  expect(server.count('POST /api/auth/logout')).toBe(1);
  expect(global.__secureStore.size).toBe(0);
  expect((await queueRows())[0].state).toBe('pending');
});

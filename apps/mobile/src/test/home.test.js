/*
 * Home's fingerprint attendance control with a mocked API: when Check In is offered, that it opens
 * the existing check-in flow once, the location card's states, "Checked In" only for an event the
 * server recorded (a saved offline event is shown as waiting), when Check Out is offered, refusals,
 * and both themes.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { getDatabase, resetDatabaseForTests, writeValue } from '../db/database';
import { formatTime } from '../lib/format';
import { themes } from '../theme/tokens';
import { BRANCH, createServer, networkDown, recordedEvent, renderApp, storeSession, todayBody, ZONE } from './harness';

const M_PER_DEG = (6_371_008.8 * Math.PI) / 180;
const at = (coords) => async () => ({ coords, timestamp: Date.now() });
const minutesAgo = (n) => new Date(Date.now() - n * 60000).toISOString();
const serverEvent = (type, occurredAt, extra) => recordedEvent({ clientEventId: `c-${type}`, type, occurredAt, sentAt: occurredAt }, extra);

beforeEach(() => {
  global.__secureStore.clear();
  resetDatabaseForTests();
  storeSession();
  Location.getCurrentPositionAsync.mockReset();
  Location.getCurrentPositionAsync.mockImplementation(at({ ...BRANCH, accuracy: 12 }));
  Location.getForegroundPermissionsAsync.mockImplementation(async () => ({ granted: true, status: 'granted', canAskAgain: true }));
  Location.requestForegroundPermissionsAsync.mockClear();
  Location.hasServicesEnabledAsync.mockImplementation(async () => true);
});

const withEvents = (...events) => createServer({ 'GET /api/attendance/today': () => [200, todayBody({ events })] });

test('eligible to check in: the gold fingerprint control, and "Location ready" only after the position is checked', async () => {
  let release;
  Location.getCurrentPositionAsync.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ coords: { ...BRANCH, accuracy: 12 }, timestamp: Date.now() });
      }),
  );
  await renderApp(createServer());
  const control = await screen.findByTestId('fingerprint-action');
  expect(control).toBeEnabled();
  expect(screen.getByText('Check In')).toBeOnTheScreen();
  expect(screen.getByText('Tap to check in')).toBeOnTheScreen();
  expect(screen.getByText('Make sure you are at the school.')).toBeOnTheScreen();
  expect(await screen.findByText('Checking your location…')).toBeOnTheScreen();
  expect(screen.queryByText('Location ready')).toBeNull();
  expect(screen.getByTestId('fingerprint-action-face')).toHaveStyle({ borderColor: themes.light.accent });
  await act(async () => release());
  expect(await screen.findByText('Location ready')).toBeOnTheScreen();
  expect(screen.getByText('You are 0 m from your branch (within 100 m) · accuracy 12 m')).toBeOnTheScreen();
  // Home never asks for permission itself, never shows Check Out before a check-in.
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  expect(screen.queryByTestId('check-out')).toBeNull();
});

test('tapping the control opens the existing location check; quick repeated taps open it once', async () => {
  const server = createServer();
  await renderApp(server);
  const control = await screen.findByTestId('fingerprint-action');
  await act(async () => {
    control.props.onClick({ nativeEvent: {} });
    control.props.onClick({ nativeEvent: {} });
    control.props.onClick({ nativeEvent: {} });
  });
  expect(await screen.findByText('Your location')).toBeOnTheScreen();
  expect(screen.getByTestId('fingerprint-action', { includeHiddenElements: true })).toBeBusy();
  // One check-in screen: leaving it returns straight to Home, where the control is ready again.
  await fireEvent.press(screen.getByText('Cancel'));
  await waitFor(() => expect(screen.queryByText('Your location')).toBeNull());
  await waitFor(() => expect(screen.getByTestId('fingerprint-action')).not.toBeBusy());
  expect(screen.getByTestId('fingerprint-action')).toBeEnabled();
  expect(server.count('POST /api/attendance/events')).toBe(0);
});

test('a check-in recorded by the server: Home shows Checked In (green) with the recorded time, and Check Out', async () => {
  const server = createServer();
  await renderApp(server);
  await fireEvent.press(await screen.findByTestId('fingerprint-action'));
  await fireEvent.press(await screen.findByTestId('confirm'));
  await fireEvent.press(await screen.findByTestId('back-home'));
  const sent = server.calls.find((c) => c.key === 'POST /api/attendance/events').body;
  expect(await screen.findByText('Checked In')).toBeOnTheScreen();
  expect(screen.getByText(formatTime(sent.occurredAt, ZONE))).toBeOnTheScreen();
  expect(screen.getByText('You are checked in')).toBeOnTheScreen();
  expect(screen.getByTestId('fingerprint-status-face')).toHaveStyle({ borderColor: themes.light.success });
  expect(screen.getByTestId('fingerprint-status')).toHaveAccessibleName(/Recorded by the server/);
  expect(screen.queryByTestId('fingerprint-action')).toBeNull();
  await fireEvent.press(screen.getByTestId('check-out'));
  expect(await screen.findByText('Your location')).toBeOnTheScreen();
  expect(screen.getByTestId('confirm')).toHaveAccessibleName('Confirm check out');
});

test('an offline check-in waiting to upload is shown as saved, never as Checked In', async () => {
  await renderApp(createServer({ 'POST /api/attendance/events': networkDown }));
  await fireEvent.press(await screen.findByTestId('fingerprint-action'));
  await fireEvent.press(await screen.findByTestId('confirm'));
  await fireEvent.press(await screen.findByTestId('back-home'));
  expect(await screen.findByText('Saved')).toBeOnTheScreen();
  expect(screen.getByText(/is saved on this phone. It counts once the server records it./)).toBeOnTheScreen();
  expect(screen.getByTestId('fingerprint-status')).toHaveAccessibleName(/waiting to upload. It is not recorded yet./);
  expect(screen.getByTestId('fingerprint-status-face')).toHaveStyle({ borderColor: themes.light.info });
  expect(screen.queryByText('Checked In')).toBeNull();
  expect(screen.queryByText('You are checked in')).toBeNull();
  // The existing rule: check-out can be recorded offline after a check-in saved offline.
  expect(screen.getByTestId('check-out')).toBeOnTheScreen();
});

test('Check Out only while checked in: not after check-out, not where check-out is unused', async () => {
  const checkIn = serverEvent('CHECK_IN', minutesAgo(90));
  const checkOut = serverEvent('CHECK_OUT', minutesAgo(5), { status: null });

  const first = await renderApp(withEvents(checkIn, checkOut));
  expect(await screen.findByText('Checked Out')).toBeOnTheScreen();
  expect(screen.getByText('Your attendance for today is complete.')).toBeOnTheScreen();
  expect(screen.queryByTestId('check-out')).toBeNull();
  expect(screen.queryByTestId('fingerprint-action')).toBeNull();
  await first.unmount();

  resetDatabaseForTests();
  await renderApp(createServer({ 'GET /api/attendance/today': () => [200, todayBody({ checkOutEnabled: false, events: [checkIn] })] }));
  expect(await screen.findByText('Checked In')).toBeOnTheScreen();
  expect(screen.getByText('Check-out is not used at your branch.')).toBeOnTheScreen();
  expect(screen.queryByTestId('check-out')).toBeNull();
});

test('before check-in opens the control is disabled and says when it opens', async () => {
  // A shift whose check-in opens at 23:59 branch time (at 23:59 itself it has ended: nothing to test).
  if (formatTime(new Date(), ZONE) === '23:59') return;
  const shifts = [{ key: 'late', name: 'Late Shift', start: '23:59', end: '23:59', checkInOpensAt: '23:59', lateAfter: '23:59' }];
  await renderApp(createServer({ 'GET /api/attendance/today': () => [200, todayBody({ shifts })] }));
  const control = await screen.findByTestId('fingerprint-action');
  expect(control).toBeDisabled();
  expect(screen.getByText('Check-in opens at 23:59.')).toBeOnTheScreen();
  expect(screen.queryByTestId('location-status')).toBeNull();
  expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
});

test('location problems on Home: outside the radius, poor accuracy, no permission, unreadable then retried', async () => {
  Location.getCurrentPositionAsync.mockImplementation(at({ latitude: BRANCH.latitude + 150 / M_PER_DEG, longitude: BRANCH.longitude, accuracy: 12 }));
  const first = await renderApp(createServer());
  expect(await screen.findByText('Outside your school')).toBeOnTheScreen();
  expect(screen.getByText(/You are 150 m from your branch; it must be 100 m or less./)).toBeOnTheScreen();
  expect(screen.queryByText('Location ready')).toBeNull();

  // Tapping the card reads the position again.
  Location.getCurrentPositionAsync.mockImplementation(at({ ...BRANCH, accuracy: 80 }));
  await fireEvent.press(screen.getByTestId('location-status'));
  expect(await screen.findByText('Location not accurate enough')).toBeOnTheScreen();
  expect(screen.getByText('Accuracy 80 m; it must be 50 m or better. Move to an open spot.')).toBeOnTheScreen();
  await first.unmount();

  Location.getForegroundPermissionsAsync.mockImplementation(async () => ({ granted: false, status: 'undetermined', canAskAgain: true }));
  const second = await renderApp(createServer());
  expect(await screen.findByText('Location permission needed')).toBeOnTheScreen();
  expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  await second.unmount();

  Location.getForegroundPermissionsAsync.mockImplementation(async () => ({ granted: true, status: 'granted', canAskAgain: true }));
  Location.getCurrentPositionAsync.mockImplementation(async () => {
    throw new Error('Location unavailable');
  });
  await renderApp(createServer());
  expect(await screen.findByText('Location not available')).toBeOnTheScreen();
  Location.getCurrentPositionAsync.mockImplementation(at({ ...BRANCH, accuracy: 12 }));
  await fireEvent.press(screen.getByTestId('location-status'));
  expect(await screen.findByText('Location ready')).toBeOnTheScreen();
});

test('a check-in refused by the server leaves Home on Check In and reports the refusal', async () => {
  const server = createServer({
    'POST /api/attendance/events': () => [422, { error: 'Your account is suspended.', code: 'STAFF_SUSPENDED' }],
  });
  await renderApp(server);
  await fireEvent.press(await screen.findByTestId('fingerprint-action'));
  await fireEvent.press(await screen.findByTestId('confirm'));
  expect(await screen.findByText('Your account is suspended.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByText('Cancel'));
  expect(await screen.findByText('1 event not accepted')).toBeOnTheScreen();
  expect(screen.getByTestId('fingerprint-action')).toBeEnabled();
  expect(screen.queryByText('Checked In')).toBeNull();
});

test('dark theme: the controls use the dark tokens', async () => {
  await writeValue(await getDatabase(), 'theme.preference', 'dark');
  const first = await renderApp(createServer());
  await screen.findByTestId('fingerprint-action');
  await waitFor(() => expect(screen.getByTestId('fingerprint-action-face')).toHaveStyle({ borderColor: themes.dark.accent, backgroundColor: themes.dark.surface }));
  expect(await screen.findByText('Location ready')).toHaveStyle({ color: themes.dark.successFg });
  await first.unmount();

  await renderApp(withEvents(serverEvent('CHECK_IN', minutesAgo(30))));
  await waitFor(() => expect(screen.getByTestId('fingerprint-status-face')).toHaveStyle({ borderColor: themes.dark.success }));
  expect(screen.getByText('Checked In')).toHaveStyle({ color: themes.dark.successFg });
});

test('Home shows a live clock in the branch time zone, the same zone as the recorded times', async () => {
  await renderApp(createServer());
  const clock = await screen.findByTestId('home-clock');
  expect(clock).toHaveTextContent(/^\d{2}:\d{2}:\d{2}$/);
  // The branch zone's hour and minute, not the phone's (allowing for a minute rolling over).
  const shown = clock.props.children.slice(0, 5);
  const t = Date.now();
  expect([formatTime(t - 60000, ZONE), formatTime(t, ZONE)]).toContain(shown);
});

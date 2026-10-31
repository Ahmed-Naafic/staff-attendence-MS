/*
 * Staff transfer in the Staff app (docs/business-rules.md → Staff transfers) with a mocked API: the
 * profile shows a scheduled move; once the transfer has taken effect the app reloads the branch
 * context — today's shifts, the branch position the geofence watches, and the reminder settings —
 * and the transfer notice is in the notification centre. Staff have no transfer action.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import { AppState } from 'react-native';
import { resetDatabaseForTests } from '../db/database';
import { BRANCH, createServer, preferencesBody, profileBody, renderApp, storeSession, todayBody } from './harness';

const NEW_BRANCH = { latitude: BRANCH.latitude + 0.009, longitude: BRANCH.longitude };
const granted = { granted: true, status: 'granted', canAskAgain: true };

beforeEach(() => {
  global.__secureStore.clear();
  global.__scheduled.clear();
  resetDatabaseForTests();
  storeSession();
  Location.getBackgroundPermissionsAsync.mockImplementation(async () => granted);
  Location.startGeofencingAsync.mockClear();
});

function transferServer() {
  let moved = false;
  const consented = preferencesBody();
  consented.reminders.checkIn.consented = true;
  const server = createServer({
    'GET /api/attendance/profile': () => [
      200,
      moved
        ? { ...profileBody(), branch: { code: 'CIT-001-B002', name: 'North Campus' }, upcomingTransfer: null }
        : { ...profileBody(), upcomingTransfer: { effectiveFrom: '2026-11-02', branch: { code: 'CIT-001-B002', name: 'North Campus' } } },
    ],
    'GET /api/attendance/today': () => [
      200,
      moved
        ? todayBody({ shifts: [{ key: 'day', name: 'Day', start: '00:00', end: '23:59', checkInOpensAt: '00:00', lateAfter: '23:58' }], branchLocation: { ...NEW_BRANCH, effectiveFrom: '2026-01-01T00:00:00.000Z' } })
        : todayBody(),
    ],
    'GET /api/notifications/preferences': () => [200, moved ? { ...consented, reminders: { ...consented.reminders, checkIn: { ...consented.reminders.checkIn, leadMinutes: 7 } } } : consented],
    'GET /api/notifications': () => [
      200,
      {
        items: moved
          ? [{ source: 'notification', id: 'n9', type: 'STAFF_TRANSFERRED', category: 'TRANSFER', language: 'so', title: 'Waxaa laguu wareejiyay laan kale', body: 'Laga bilaabo 2026-11-02, laantaadu waa North Campus (CIT-001-B002).', createdAt: new Date().toISOString(), readAt: null, expiresAt: '2027-01-31T00:00:00.000Z', link: null, data: null }]
          : [],
        total: moved ? 1 : 0,
        page: 1,
        pageSize: 30,
        pageCount: 1,
        unreadCount: moved ? 1 : 0,
      },
    ],
  });
  server.move = () => {
    moved = true;
  };
  return server;
}

test('the profile shows a scheduled transfer; there is no transfer action for staff', async () => {
  await renderApp(transferServer());
  fireEvent.press(await screen.findByText('Profile'));
  expect(await screen.findByText('CIT-001-B002 · North Campus from 2026-11-02')).toBeOnTheScreen();
  expect(screen.queryByText(/Transfer/i)).toBeNull();
});

test('after the transfer the app reloads the branch context: shifts, the geofence of the new branch only, reminder settings and the notice', async () => {
  // The app's own refresh when it returns to the foreground (as when the staff member opens it on the new day).
  const listeners = [];
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((type, handler) => {
    listeners.push(handler);
    return { remove: () => {} };
  });
  const server = transferServer();
  await renderApp(server);
  // Before: the geofence watches the current branch.
  await waitFor(() => expect(Location.startGeofencingAsync).toHaveBeenCalled());
  expect(Location.startGeofencingAsync.mock.lastCall[1][0]).toMatchObject({ latitude: BRANCH.latitude, longitude: BRANCH.longitude, radius: 100 });

  server.move();
  await act(async () => listeners.forEach((handler) => handler('active')));
  // One region, now the new branch's (the old one is replaced, not added).
  await waitFor(() => expect(Location.startGeofencingAsync.mock.lastCall[1]).toEqual([expect.objectContaining({ latitude: NEW_BRANCH.latitude, longitude: NEW_BRANCH.longitude, radius: 100 })]));
  await waitFor(() => expect(server.count('GET /api/notifications/preferences')).toBeGreaterThanOrEqual(2));
  expect(await screen.findByText('Day')).toBeOnTheScreen();

  fireEvent.press(screen.getByTestId('notifications-bell'));
  expect(await screen.findByText('Waxaa laguu wareejiyay laan kale')).toBeOnTheScreen();
  spy.mockRestore();
});

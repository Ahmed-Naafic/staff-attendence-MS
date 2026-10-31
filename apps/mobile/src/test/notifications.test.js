/*
 * Staff notification centre and settings with a mocked API (N4, N12, N1, N2): the unread badge,
 * the list (Somali texts), opening one marks it read, mark all read, mandatory categories locked,
 * turning on check-in reminders only after the in-app agreement and the system permission, push
 * registration for the session, and the check-out reminder scheduled on the phone. UI tests with
 * mocked responses; the server rules are tested in backend/test/notifications.test.js.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { resetDatabaseForTests } from '../db/database';
import { localDate } from '../lib/format';
import { createServer, preferencesBody, recordedEvent, renderApp, storeSession, todayBody, ZONE } from './harness';

const ITEMS = [
  {
    source: 'notification',
    id: 'n1',
    type: 'ASSIGNMENT_CHANGED',
    category: 'ASSIGNMENT',
    language: 'so',
    title: 'Wareegyadaada shaqada waa la beddelay',
    body: 'Laga bilaabo 2026-11-01:\nSubax (Sabti) 07:30–13:00',
    createdAt: new Date(Date.now() - 5 * 60000).toISOString(),
    readAt: null,
    expiresAt: '2027-01-28T00:00:00.000Z',
    link: null,
    data: null,
  },
  {
    source: 'announcement',
    id: 'a1',
    type: 'ANNOUNCEMENT',
    category: 'ANNOUNCEMENT',
    language: 'so',
    title: 'Ramadan Kariim',
    body: 'Bil wanaagsan.',
    linkUrl: 'https://example.com/guide',
    createdAt: new Date(Date.now() - 60 * 60000).toISOString(),
    readAt: '2026-10-30T09:00:00.000Z',
    expiresAt: '2026-11-30T00:00:00.000Z',
    link: null,
    data: null,
  },
];

function notificationServer(extra = {}) {
  let unread = 1;
  let prefs = preferencesBody();
  const server = createServer({
    'GET /api/notifications/unread-count': () => [200, { unreadCount: unread }],
    'GET /api/notifications': () => [200, { items: unread ? ITEMS : ITEMS.map((i) => ({ ...i, readAt: i.readAt ?? '2026-10-30T10:00:00.000Z' })), total: 2, page: 1, pageSize: 30, pageCount: 1, unreadCount: unread }],
    'POST /api/notifications/notification/n1/read': () => {
      unread = 0;
      return [200, { item: { ...ITEMS[0], readAt: new Date().toISOString() } }];
    },
    'POST /api/notifications/read-all': () => {
      unread = 0;
      return [200, { unreadCount: 0 }];
    },
    'GET /api/notifications/preferences': () => [200, prefs],
    'PUT /api/notifications/preferences': ({ body }) => {
      const r = prefs.reminders;
      prefs = {
        ...prefs,
        reminders: {
          ...r,
          checkIn: { ...r.checkIn, enabled: body.checkInReminder ?? r.checkIn.enabled, consented: body.locationConsent ?? r.checkIn.consented },
          checkOut: { ...r.checkOut, enabled: body.checkOutReminder ?? r.checkOut.enabled },
        },
        categories: body.disabledCategories ? prefs.categories.map((c) => ({ ...c, enabled: c.mandatory || !body.disabledCategories.includes(c.key) })) : prefs.categories,
      };
      return [200, prefs];
    },
    ...extra,
  });
  return server;
}

beforeEach(() => {
  global.__secureStore.clear();
  global.__scheduled.clear();
  resetDatabaseForTests();
  storeSession();
  Location.getCurrentPositionAsync.mockImplementation(async () => ({ coords: { latitude: 2.046934, longitude: 45.318162, accuracy: 12 }, timestamp: Date.now() }));
  Location.getBackgroundPermissionsAsync.mockImplementation(async () => ({ granted: false, status: 'undetermined', canAskAgain: true }));
  Location.requestBackgroundPermissionsAsync.mockClear();
  Location.startGeofencingAsync.mockClear();
  Notifications.getExpoPushTokenAsync.mockClear();
});

test('the bell shows the unread count; the list opens with Somali texts; opening one marks it read; mark all read', async () => {
  const server = notificationServer();
  await renderApp(server);
  const bell = await screen.findByTestId('notifications-bell');
  await waitFor(() => expect(bell).toHaveProp('accessibilityLabel', 'Notifications, 1 unread'));
  fireEvent.press(bell);
  expect(await screen.findByText('Wareegyadaada shaqada waa la beddelay')).toBeOnTheScreen();
  expect(screen.getByText('Ramadan Kariim')).toBeOnTheScreen();
  expect(screen.getByTestId('notification-n1')).toHaveProp('accessibilityLabel', 'Unread. Wareegyadaada shaqada waa la beddelay');

  fireEvent.press(screen.getByTestId('notification-n1'));
  expect(await screen.findByText('Laga bilaabo 2026-11-01:\nSubax (Sabti) 07:30–13:00')).toBeOnTheScreen();
  await waitFor(() => expect(server.count('POST /api/notifications/notification/n1/read')).toBe(1));
  fireEvent.press(screen.getByLabelText('Back'));
  await waitFor(() => expect(screen.getByTestId('notification-n1')).toHaveProp('accessibilityLabel', 'Wareegyadaada shaqada waa la beddelay'));
});

test('mark all as read sends one request and clears the unread marks', async () => {
  const server = notificationServer();
  await renderApp(server);
  fireEvent.press(await screen.findByTestId('notifications-bell'));
  fireEvent.press(await screen.findByTestId('mark-all-read'));
  await waitFor(() => expect(server.count('POST /api/notifications/read-all')).toBe(1));
  await waitFor(() => expect(screen.queryByTestId('mark-all-read')).toBeNull());
});

test('settings: mandatory categories are locked; an optional one is turned off with the list of turned-off categories', async () => {
  const server = notificationServer();
  await renderApp(server);
  fireEvent.press(await screen.findByTestId('notifications-bell'));
  fireEvent.press(await screen.findByLabelText('Notification settings'));
  expect(await screen.findByTestId('category-STATUS')).toHaveProp('disabled', true);
  expect(screen.getByTestId('category-ANNOUNCEMENT')).toHaveProp('disabled', true);
  expect(screen.getByTestId('category-SCHEDULE')).toHaveProp('disabled', false);
  fireEvent(screen.getByTestId('category-SCHEDULE'), 'valueChange', false);
  await waitFor(() => expect(server.calls.find((c) => c.key === 'PUT /api/notifications/preferences')?.body).toEqual({ disabledCategories: ['SCHEDULE'] }));
});

test('check-in reminders: nothing is asked before the in-app agreement; agreeing asks for "all the time" location and saves the consent', async () => {
  const server = notificationServer();
  await renderApp(server);
  fireEvent.press(await screen.findByTestId('notifications-bell'));
  fireEvent.press(await screen.findByLabelText('Notification settings'));
  const toggle = await screen.findByTestId('checkin-switch');
  expect(toggle).toHaveProp('value', false);
  fireEvent(toggle, 'valueChange', true);
  expect(await screen.findByText('Turn on check-in reminders?')).toBeOnTheScreen();
  expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  const granted = { granted: true, status: 'granted', canAskAgain: true };
  Location.requestBackgroundPermissionsAsync.mockImplementationOnce(async () => {
    Location.getBackgroundPermissionsAsync.mockImplementation(async () => granted);
    return granted;
  });
  await act(async () => fireEvent.press(screen.getByText('Agree and continue')));
  expect(Location.requestBackgroundPermissionsAsync).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(server.calls.find((c) => c.key === 'PUT /api/notifications/preferences')?.body).toEqual({ checkInReminder: true, locationConsent: true }));
  await waitFor(() => expect(screen.getByTestId('checkin-switch')).toHaveProp('value', true));
  // With consent, permission and an operating branch, the OS watches the branch circle.
  await waitFor(() => expect(Location.startGeofencingAsync).toHaveBeenCalled());
});

test('a denied background permission is explained; the consent can be withdrawn', async () => {
  const server = notificationServer();
  Location.requestBackgroundPermissionsAsync.mockResolvedValueOnce({ granted: false, status: 'denied', canAskAgain: false });
  await renderApp(server);
  fireEvent.press(await screen.findByTestId('notifications-bell'));
  fireEvent.press(await screen.findByLabelText('Notification settings'));
  fireEvent(await screen.findByTestId('checkin-switch'), 'valueChange', true);
  const agree = await screen.findByText('Agree and continue');
  await act(async () => fireEvent.press(agree));
  expect(await screen.findByText(/turned off or restricted for EduTrack/)).toBeOnTheScreen();
  expect(screen.getByText('Open phone settings')).toBeOnTheScreen();
  expect(Location.startGeofencingAsync).not.toHaveBeenCalled();
  fireEvent(screen.getByTestId('checkin-switch'), 'valueChange', false);
  await waitFor(() => expect(server.calls.filter((c) => c.key === 'PUT /api/notifications/preferences').at(-1).body).toEqual({ checkInReminder: false, locationConsent: false }));
});

test('push: the session registers its Expo token; a check-out reminder is scheduled after a recorded check-in', async () => {
  const checkIn = recordedEvent({ clientEventId: 'c1', type: 'CHECK_IN', occurredAt: new Date(Date.now() - 60000).toISOString(), sentAt: new Date().toISOString() });
  // A shift ending in two hours (or at 23:59), so the reminder is in the future.
  const end = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const endText = localDate(end, ZONE) === localDate(new Date(), ZONE) ? new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(end) : '23:59';
  const shift = { key: 'main', name: 'Main Shift', start: '00:00', end: endText, checkInOpensAt: '00:00', lateAfter: '00:10' };
  const server = notificationServer({ 'GET /api/attendance/today': () => [200, todayBody({ shifts: [shift], events: [{ ...checkIn, shift }] })] });
  await renderApp(server);
  await waitFor(() => expect(server.calls.find((c) => c.key === 'POST /api/notifications/devices')?.body).toEqual({ token: 'ExponentPushToken[test-device-token]', platform: 'ios' }));
  await waitFor(() => expect([...global.__scheduled.keys()].some((k) => k.startsWith('edutrack.checkout:'))).toBe(true));
  const reminder = [...global.__scheduled.values()].find((r) => r.identifier.startsWith('edutrack.checkout:'));
  expect(reminder.content.title).toBe('Xasuusin: diiwaangeli bixitaankaaga');
  expect(reminder.trigger.date.getTime()).toBeGreaterThan(Date.now());
});

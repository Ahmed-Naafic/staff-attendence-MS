/*
 * Remote push in the Staff app (notification phase 3) with mocked Expo modules and a mocked API:
 * token registration on Android and iOS, permission denied, token refresh, a push received in the
 * foreground, a tap from a closed app and from the background opening the notification's details,
 * a notification of another account (404) opening the list, preferences, and sign-out clearing the
 * notifications shown. These are automated tests with mocks: they do not replace testing on a real
 * phone (docs/notifications/notification-test-plan.md → Real devices).
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { resetDatabaseForTests } from '../db/database';
import { createServer, preferencesBody, renderApp, storeSession } from './harness';

const ITEM = {
  source: 'notification',
  id: '6c1d2a40-1111-4b8e-9f00-0a1b2c3d4e5f',
  type: 'ASSIGNMENT_CHANGED',
  category: 'ASSIGNMENT',
  language: 'so',
  title: 'Wareegyadaada shaqada waa la beddelay',
  body: 'Laga bilaabo 2026-11-02:\nSubax (Sabti) 07:30–13:00',
  createdAt: new Date().toISOString(),
  readAt: null,
  expiresAt: '2027-01-31T00:00:00.000Z',
  link: null,
  data: null,
};
const tapResponse = (data, identifier = `push-${Math.random()}`) => ({ actionIdentifier: 'expo.modules.notifications.actions.DEFAULT', notification: { request: { identifier, content: { title: 'EduTrack', body: 'Waxaad leedahay ogeysiis cusub oo imaanshaha ah.', data } } } });
const lastCall = (mock) => mock.mock.calls.at(-1)?.[0];

function pushServer(extra = {}) {
  return createServer({
    [`GET /api/notifications/notification/${ITEM.id}`]: () => [200, { item: ITEM }],
    [`POST /api/notifications/notification/${ITEM.id}/read`]: () => [200, { item: { ...ITEM, readAt: new Date().toISOString() } }],
    ...extra,
  });
}

beforeEach(() => {
  global.__secureStore.clear();
  global.__scheduled.clear();
  resetDatabaseForTests();
  storeSession();
  [
    Notifications.getExpoPushTokenAsync,
    Notifications.addPushTokenListener,
    Notifications.addNotificationReceivedListener,
    Notifications.addNotificationResponseReceivedListener,
    Notifications.getLastNotificationResponseAsync,
    Notifications.dismissAllNotificationsAsync,
  ].forEach((fn) => fn.mockClear());
  Notifications.getPermissionsAsync.mockImplementation(async () => ({ granted: true, status: 'granted', canAskAgain: true }));
  Notifications.getExpoPushTokenAsync.mockImplementation(async () => ({ data: 'ExponentPushToken[test-device-token]' }));
  Notifications.getLastNotificationResponseAsync.mockImplementation(async () => null);
});

test.each([
  ['android', 'android'],
  ['ios', 'ios'],
])('%s: the Expo token is registered for the session with the platform', async (os, platform) => {
  const restore = jest.replaceProperty(Platform, 'OS', os);
  const server = pushServer();
  await renderApp(server);
  await waitFor(() => expect(server.calls.find((c) => c.key === 'POST /api/notifications/devices')?.body).toEqual({ token: 'ExponentPushToken[test-device-token]', platform }));
  expect(Notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'test-project' });
  restore.restore();
});

test('permission denied, or push turned off: nothing is registered', async () => {
  Notifications.getPermissionsAsync.mockImplementation(async () => ({ granted: false, status: 'denied', canAskAgain: false }));
  const denied = pushServer();
  await renderApp(denied);
  await waitFor(() => expect(denied.count('GET /api/notifications/preferences')).toBeGreaterThan(0));
  await act(async () => {});
  expect(denied.count('POST /api/notifications/devices')).toBe(0);
  expect(Notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
});

test('push turned off in the preferences: nothing is registered', async () => {
  const off = pushServer({ 'GET /api/notifications/preferences': () => [200, preferencesBody({ push: { available: true, enabled: false } })] });
  await renderApp(off);
  await waitFor(() => expect(off.count('GET /api/notifications/preferences')).toBeGreaterThan(0));
  await act(async () => {});
  expect(off.count('POST /api/notifications/devices')).toBe(0);
});

test('token refresh: a new token from the system is registered again', async () => {
  const server = pushServer();
  await renderApp(server);
  await waitFor(() => expect(server.count('POST /api/notifications/devices')).toBe(1));
  await waitFor(() => expect(Notifications.addPushTokenListener).toHaveBeenCalled());
  Notifications.getExpoPushTokenAsync.mockImplementation(async () => ({ data: 'ExponentPushToken[refreshed-device-token]' }));
  await act(async () => lastCall(Notifications.addPushTokenListener)({ type: 'android', data: 'new-fcm-token' }));
  await waitFor(() => expect(server.calls.filter((c) => c.key === 'POST /api/notifications/devices').at(-1).body.token).toBe('ExponentPushToken[refreshed-device-token]'));
});

test('foreground: a push received while the app is open updates the unread count', async () => {
  let unread = 0;
  const server = pushServer({ 'GET /api/notifications/unread-count': () => [200, { unreadCount: unread }] });
  await renderApp(server);
  const bell = await screen.findByTestId('notifications-bell');
  await waitFor(() => expect(Notifications.addNotificationReceivedListener).toHaveBeenCalled());
  unread = 1;
  await act(async () => lastCall(Notifications.addNotificationReceivedListener)({ request: { content: { data: { kind: 'notification', source: 'notification', id: ITEM.id } } } }));
  await waitFor(() => expect(bell).toHaveProp('accessibilityLabel', 'Notifications, 1 unread'));
});

test('closed app started by a tap: the notification’s details open and it is marked read', async () => {
  Notifications.getLastNotificationResponseAsync.mockImplementation(async () => tapResponse({ kind: 'notification', source: 'notification', id: ITEM.id }, 'cold-start-1'));
  const server = pushServer();
  await renderApp(server);
  expect(await screen.findByText('Laga bilaabo 2026-11-02:\nSubax (Sabti) 07:30–13:00')).toBeOnTheScreen();
  await waitFor(() => expect(server.count(`POST /api/notifications/notification/${ITEM.id}/read`)).toBe(1));
  expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalled();
});

test('app in the background: tapping the push opens the details; the same tap is handled once', async () => {
  const server = pushServer();
  await renderApp(server);
  await screen.findByTestId('notifications-bell');
  await waitFor(() => expect(Notifications.addNotificationResponseReceivedListener).toHaveBeenCalled());
  const response = tapResponse({ kind: 'notification', source: 'notification', id: ITEM.id }, 'background-1');
  await act(async () => lastCall(Notifications.addNotificationResponseReceivedListener)(response));
  expect(await screen.findByText('Wareegyadaada shaqada waa la beddelay')).toBeOnTheScreen();
  await act(async () => lastCall(Notifications.addNotificationResponseReceivedListener)(response));
  expect(server.count(`GET /api/notifications/notification/${ITEM.id}`)).toBe(1);
});

test('a push of another account (after switching accounts): the server answers 404 and the list opens, nothing of the other account', async () => {
  Notifications.getLastNotificationResponseAsync.mockImplementation(async () => tapResponse({ kind: 'notification', source: 'notification', id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' }, 'other-account-1'));
  const server = pushServer();
  await renderApp(server);
  expect(await screen.findByText('No notifications')).toBeOnTheScreen();
  expect(server.count('GET /api/notifications/notification/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')).toBe(1);
});

test('signing out clears the notifications shown on the phone; the server ends the session and its token', async () => {
  const server = pushServer();
  await renderApp(server);
  fireEvent.press(await screen.findByText('Profile'));
  fireEvent.press(await screen.findByTestId('sign-out'));
  await screen.findByText('Sign out?');
  const confirm = screen.getAllByText('Sign out').at(-1);
  await act(async () => fireEvent.press(confirm));
  await waitFor(() => expect(server.count('POST /api/auth/logout')).toBe(1));
  await waitFor(() => expect(Notifications.dismissAllNotificationsAsync).toHaveBeenCalled());
});

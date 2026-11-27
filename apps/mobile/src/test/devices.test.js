/*
 * Devices on the phone: the device secret is kept after sign-in; a remote wipe found at start
 * deletes everything before any upload and is reported complete; the 3-phone limit is explained;
 * a staff member reports another phone lost.
 */
import { fireEvent, screen } from '@testing-library/react-native';
import { getDatabase, resetDatabaseForTests } from '../db/database';
import { enqueue } from '../attendance/queue';
import { createServer, renderApp, STAFF, storeSession, TOKEN } from './harness';

const SECRET = 's3cret-0123456789abcdefghijklmnopqrstuvwxyz';

beforeEach(() => {
  global.__secureStore.clear();
  resetDatabaseForTests();
});

test('a new phone keeps its device secret; over the limit the reason is shown', async () => {
  const server = createServer({ 'POST /api/auth/login': () => [200, { user: STAFF, token: TOKEN, expiresAt: '2030-01-01T00:00:00.000Z', device: { id: 'd1', secret: SECRET } }] });
  await renderApp(server);
  await fireEvent.changeText(await screen.findByTestId('phone'), '0612345678');
  await fireEvent.changeText(screen.getByTestId('password'), 'correct-horse-battery');
  await fireEvent.press(screen.getByText('Sign in'));
  await screen.findByTestId('header-profile');
  expect(global.__secureStore.get('edutrack.device.secret')).toBe(SECRET);
  expect(global.__secureStore.get('edutrack.device.installation')).toMatch(/^[0-9a-f-]{36}$/);
});

test('the 3-phone limit is explained at sign-in', async () => {
  const server = createServer({ 'POST /api/auth/login': () => [403, { error: 'This account already uses 3 phones. Your Manager or School Owner can approve this phone; then sign in again.', code: 'DEVICE_LIMIT', details: { requestId: 'r1' } }] });
  await renderApp(server);
  await fireEvent.changeText(await screen.findByTestId('phone'), '0612345678');
  await fireEvent.changeText(screen.getByTestId('password'), 'correct-horse-battery');
  await fireEvent.press(screen.getByText('Sign in'));
  expect(await screen.findByText(/already uses 3 phones/)).toBeOnTheScreen();
});

test('a remote wipe at start deletes everything before any upload, then is reported complete', async () => {
  storeSession();
  global.__secureStore.set('edutrack.device.installation', 'inst-0123456789abcdef');
  global.__secureStore.set('edutrack.device.secret', SECRET);
  const db = await getDatabase();
  await enqueue(db, STAFF.id, { clientEventId: 'e1', type: 'CHECK_IN', occurredAt: new Date().toISOString(), position: { latitude: 2, longitude: 45, accuracy: 10 } });
  resetDatabaseForTests();
  const server = createServer({
    'POST /api/devices/status': ({ body }) => [200, body.secret === SECRET ? { status: 'lost', wipe: true } : { status: 'unknown', wipe: false }],
    'POST /api/devices/wipe-complete': () => [200, { done: true }],
  });
  await renderApp(server);
  expect(await screen.findByText(/reported lost or stolen/)).toBeOnTheScreen();
  // Nothing was uploaded or read with the session.
  expect(server.count('POST /api/attendance/events')).toBe(0);
  expect(server.count('GET /api/auth/session')).toBe(0);
  expect(server.count('POST /api/devices/wipe-complete')).toBe(1);
  expect([...global.__secureStore.keys()].filter((k) => k.startsWith('edutrack.'))).toEqual([]);
});

test('a staff member reports another of their phones lost', async () => {
  storeSession();
  let reported = null;
  const devices = () => ({
    max: 3,
    devices: [
      { id: 'd1', name: 'This Pixel', platform: 'android', status: 'active', current: true, registeredAt: '2026-11-01T08:00:00Z', lastSeenAt: '2026-11-27T08:00:00Z', wipe: null },
      { id: 'd2', name: 'Old Samsung', platform: 'android', status: reported ? 'lost' : 'active', current: false, registeredAt: '2026-10-01T08:00:00Z', lastSeenAt: '2026-11-20T08:00:00Z', revokedAt: reported ? '2026-11-27T09:00:00Z' : null, wipe: reported ? { state: 'requested' } : null },
    ],
    requests: [],
  });
  const server = createServer({
    'GET /api/devices/mine': () => [200, devices()],
    'POST /api/devices/d2/report-lost': () => {
      reported = true;
      return [200, { device: devices().devices[1] }];
    },
  });
  await renderApp(server);
  await fireEvent.press(await screen.findByTestId('header-profile'));
  await fireEvent.press(await screen.findByTestId('open-devices'));
  expect(await screen.findByText('This phone')).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('report-lost-d2'));
  await fireEvent.press(await screen.findByText('Report and wipe'));
  expect(await screen.findByText(/Old Samsung is blocked/)).toBeOnTheScreen();
  expect(await screen.findByText('Wipe requested')).toBeOnTheScreen();
});

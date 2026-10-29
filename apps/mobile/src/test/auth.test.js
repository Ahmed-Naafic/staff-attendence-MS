/* Sign-in, the mandatory password change, protected screens, session restore and expiry. */
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { resetDatabaseForTests } from '../db/database';
import { createServer, renderApp, STAFF, storeSession, TOKEN } from './harness';

beforeEach(() => {
  global.__secureStore.clear();
  resetDatabaseForTests();
});

const loginOk = (user = STAFF) => () => [200, { user, token: TOKEN, expiresAt: '2026-12-31T00:00:00.000Z' }];

async function signIn(phone = '0612345678', password = 'correct-horse-battery') {
  await fireEvent.changeText(await screen.findByTestId('phone'), phone);
  await fireEvent.changeText(screen.getByTestId('password'), password);
  await fireEvent.press(screen.getByTestId('sign-in'));
}

test('signed out: only the sign-in screen; empty fields are explained without a request', async () => {
  const server = createServer();
  await renderApp(server);
  await fireEvent.press(await screen.findByTestId('sign-in'));
  expect(screen.getByText('Enter your phone number.')).toBeOnTheScreen();
  expect(screen.getByText('Enter your password.')).toBeOnTheScreen();
  expect(server.count('POST /api/auth/login')).toBe(0);
  expect(screen.queryByText('Today’s shift')).toBeNull();
});

test('sign in with phone and password: the token goes to secure storage and Home shows real data', async () => {
  const server = createServer({ 'POST /api/auth/login': loginOk() });
  await renderApp(server);
  await signIn();
  expect(await screen.findByText('Ayaan Ahmed')).toBeOnTheScreen();
  expect(await screen.findByText('Teaching Assistant')).toBeOnTheScreen();
  expect(await screen.findByText('Main Shift')).toBeOnTheScreen();
  expect(screen.getByText('CIT-001-B001')).toBeOnTheScreen();
  const login = server.calls.find((c) => c.key === 'POST /api/auth/login');
  expect(login.body).toEqual({ identifier: '0612345678', password: 'correct-horse-battery', client: 'mobile' });
  expect(global.__secureStore.get('edutrack.session.token')).toBe(TOKEN);
  const today = server.calls.find((c) => c.key === 'GET /api/attendance/today');
  expect(today.headers.authorization).toBe(`Bearer ${TOKEN}`);
});

test('wrong credentials or a suspended account: the server’s message, nothing stored', async () => {
  const server = createServer({ 'POST /api/auth/login': () => [401, { error: 'The email, phone number or password is incorrect.', code: 'UNAUTHENTICATED' }] });
  await renderApp(server);
  await signIn();
  expect(await screen.findByText('The email, phone number or password is incorrect.')).toBeOnTheScreen();
  expect(global.__secureStore.size).toBe(0);
});

test('no connection at sign-in: a plain message', async () => {
  const server = createServer({
    'POST /api/auth/login': () => {
      throw new TypeError('Network request failed');
    },
  });
  await renderApp(server);
  await signIn();
  expect(await screen.findByText(/No connection to the EduTrack server/)).toBeOnTheScreen();
});

test('a Manager account is signed out at once with an explanation', async () => {
  const server = createServer({ 'POST /api/auth/login': loginOk({ ...STAFF, role: 'MANAGER' }) });
  await renderApp(server);
  await signIn();
  expect(await screen.findByText(/Attendance for Managers is not available in the app yet/)).toBeOnTheScreen();
  expect(server.count('POST /api/auth/logout')).toBe(1);
  expect(global.__secureStore.size).toBe(0);
});

test('a temporary password must be replaced before anything else', async () => {
  const server = createServer({
    'POST /api/auth/login': loginOk({ ...STAFF, mustChangePassword: true }),
    'POST /api/auth/password': ({ body }) =>
      body.currentPassword === 'temporary-pass-1'
        ? [200, { user: STAFF }]
        : [400, { error: 'Check the highlighted fields.', code: 'VALIDATION_ERROR', details: { currentPassword: 'The temporary password is incorrect.' } }],
  });
  await renderApp(server);
  await signIn('0612345678', 'temporary-pass-1');
  expect(await screen.findByText('Create a new password')).toBeOnTheScreen();
  expect(server.count('GET /api/attendance/today')).toBe(0);

  await fireEvent.changeText(screen.getByTestId('current-password'), 'wrong-temporary');
  await fireEvent.changeText(screen.getByTestId('new-password'), 'short');
  await fireEvent.press(screen.getByTestId('update-password'));
  expect(screen.getByText('Use at least 12 characters.')).toBeOnTheScreen();
  expect(server.count('POST /api/auth/password')).toBe(0);

  await fireEvent.changeText(screen.getByTestId('new-password'), 'a-new-long-password');
  await fireEvent.changeText(screen.getByTestId('confirm-password'), 'a-new-long-password');
  await fireEvent.press(screen.getByTestId('update-password'));
  expect(await screen.findByText('The temporary password is incorrect.')).toBeOnTheScreen();

  await fireEvent.changeText(screen.getByTestId('current-password'), 'temporary-pass-1');
  await fireEvent.press(screen.getByTestId('update-password'));
  expect(await screen.findByText('Main Shift')).toBeOnTheScreen();
  expect(server.calls.filter((c) => c.key === 'POST /api/auth/password').at(-1).body).toEqual({ currentPassword: 'temporary-pass-1', newPassword: 'a-new-long-password' });
});

test('a stored session is restored without signing in again', async () => {
  storeSession();
  const server = createServer();
  await renderApp(server);
  expect(await screen.findByText('Main Shift')).toBeOnTheScreen();
  expect(server.count('POST /api/auth/login')).toBe(0);
});

test('a stored session that has ended returns to sign-in with a notice', async () => {
  storeSession();
  const ended = createServer({ 'GET /api/auth/session': () => [200, { user: null }] });
  await renderApp(ended);
  expect(await screen.findByText('Your session has ended. Sign in again.')).toBeOnTheScreen();
  expect(global.__secureStore.size).toBe(0);
});

test('a session that expires while in use returns to sign-in (401 from any request)', async () => {
  storeSession();
  const server = createServer({ 'GET /api/attendance/today': () => [401, { error: 'Sign in to continue.', code: 'UNAUTHENTICATED' }] });
  await renderApp(server);
  expect(await screen.findByText('Your session has ended. Sign in again.')).toBeOnTheScreen();
  await waitFor(() => expect(global.__secureStore.has('edutrack.session.token')).toBe(false));
});

test('offline at start with a stored session: the app opens with the stored account', async () => {
  storeSession();
  const server = createServer({
    'GET /api/auth/session': () => {
      throw new TypeError('Network request failed');
    },
    'GET /api/attendance/today': () => {
      throw new TypeError('Network request failed');
    },
    'GET /api/attendance/profile': () => {
      throw new TypeError('Network request failed');
    },
  });
  await renderApp(server);
  expect(await screen.findByText('Today’s shift couldn’t be loaded')).toBeOnTheScreen();
  expect(screen.getByText('Ayaan Ahmed')).toBeOnTheScreen();
});

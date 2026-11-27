/*
 * The app lock: locked at start with a PIN set; three wrong PINs ask for the EduTrack password,
 * checked by the server; locking again after a minute in the background; removed at sign-out.
 */
import { act, fireEvent, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { resetDatabaseForTests } from '../db/database';
import { checkPin, lockFor, readLock, setPin, shouldLock } from '../lock/lockStore';
import { createServer, renderApp, STAFF, storeSession } from './harness';

beforeEach(() => {
  global.__secureStore.clear();
  resetDatabaseForTests();
  storeSession();
});

test('the PIN is stored only as a salted hash, for one account', async () => {
  await setPin(STAFF.id, '4821');
  const raw = global.__secureStore.get('edutrack.lock');
  expect(raw).not.toContain('4821');
  const lock = await lockFor(STAFF.id);
  expect(await checkPin(lock, '4821')).toBe(true);
  expect(await checkPin(lock, '0000')).toBe(false);
  expect(await lockFor('someone-else')).toBeNull();
  expect(shouldLock(lock, 59_000)).toBe(false);
  expect(shouldLock(lock, 60_000)).toBe(true);
});

test('three wrong PINs ask for the password, which the server checks', async () => {
  await setPin(STAFF.id, '4821');
  const server = createServer({ 'POST /api/auth/verify-password': ({ body }) => (body.password === 'correct horse battery' ? [204] : [422, { error: 'That is not your password.', code: 'WRONG_PASSWORD' }]) });
  await renderApp(server);
  expect(await screen.findByText('EduTrack is locked')).toBeOnTheScreen();
  for (let i = 0; i < 3; i += 1) {
    await fireEvent.changeText(screen.getByTestId('unlock-pin'), '1111');
    await fireEvent.press(screen.getByTestId('unlock-with-pin'));
  }
  expect(await screen.findByText('Too many attempts. Enter your EduTrack password.')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByTestId('unlock-password'), 'wrong');
  await fireEvent.press(screen.getByTestId('unlock-with-password'));
  expect(await screen.findByText('That is not your password.')).toBeOnTheScreen();
  // A wrong password does not end the session.
  expect(global.__secureStore.get('edutrack.session.token')).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId('unlock-password'), 'correct horse battery');
  await fireEvent.press(screen.getByTestId('unlock-with-password'));
  expect(await screen.findByTestId('header-profile')).toBeOnTheScreen();
});

test('the right PIN unlocks; a minute in the background locks again; sign-out removes the lock', async () => {
  await setPin(STAFF.id, '4821');
  let now = 1_000_000;
  const listeners = [];
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((type, fn) => {
    listeners.push(fn);
    return { remove: () => listeners.splice(listeners.indexOf(fn), 1) };
  });
  const server = createServer();
  await renderApp(server);
  await fireEvent.changeText(await screen.findByTestId('unlock-pin'), '4821');
  await fireEvent.press(screen.getByTestId('unlock-with-pin'));
  expect(await screen.findByTestId('header-profile')).toBeOnTheScreen();
  // Away for 61 seconds.
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  await act(async () => [...listeners].forEach((fn) => fn('background')));
  now += 61_000;
  await act(async () => [...listeners].forEach((fn) => fn('active')));
  expect(await screen.findByText('EduTrack is locked')).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('lock-sign-out'));
  expect(await screen.findByTestId('phone')).toBeOnTheScreen();
  expect(await readLock()).toBeNull();
  spy.mockRestore();
  jest.restoreAllMocks();
});

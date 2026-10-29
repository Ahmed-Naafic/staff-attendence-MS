/* API client: bearer token, timeout, network failure, session expiry and response checks. */
import { ApiError, createApiClient } from '../client';
import { fetchToday, signIn } from '../endpoints';
import { userMessage } from '../errors';

const response = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });

function client(fetchImpl, extra = {}) {
  return createApiClient({ baseUrl: 'http://api.test', getToken: async () => 'tok_abcdefghijklmnopqrstuvwxyz', fetchImpl, timeoutMs: 50, ...extra });
}

test('sends the session as a bearer token, never for sign-in', async () => {
  const fetchImpl = jest.fn(async () => response(200, { user: null }));
  const api = client(fetchImpl);
  await api.request('/api/auth/session');
  expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe('Bearer tok_abcdefghijklmnopqrstuvwxyz');
  fetchImpl.mockResolvedValueOnce(response(200, { user: { id: 'u', name: 'A', role: 'STAFF', mustChangePassword: false }, token: 'x'.repeat(43), expiresAt: '2026-10-28T00:00:00Z' }));
  await signIn(api, { phone: '0612345678', password: 'secret' });
  const [url, init] = fetchImpl.mock.calls[1];
  expect(url).toBe('http://api.test/api/auth/login');
  expect(init.headers.authorization).toBeUndefined();
  expect(JSON.parse(init.body)).toEqual({ identifier: '0612345678', password: 'secret', client: 'mobile' });
});

test('a slow server times out; no connection is a network error; both can be retried', async () => {
  const slow = client((url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))));
  await expect(slow.request('/x')).rejects.toMatchObject({ kind: 'timeout', retryable: true });
  const down = client(async () => {
    throw new TypeError('Network request failed');
  });
  const error = await down.request('/x').catch((e) => e);
  expect(error).toBeInstanceOf(ApiError);
  expect(error.kind).toBe('network');
  expect(error.retryable).toBe(true);
  expect(userMessage(error)).toMatch(/No connection/);
});

test('401 reports the ended session; 403 PASSWORD_CHANGE_REQUIRED asks for the password change', async () => {
  const onUnauthorized = jest.fn();
  const onPasswordChangeRequired = jest.fn();
  const api = client(jest.fn(async () => response(401, { error: 'Sign in to continue.', code: 'UNAUTHENTICATED' })), { onUnauthorized, onPasswordChangeRequired });
  const expired = await api.request('/api/attendance/today').catch((e) => e);
  expect(onUnauthorized).toHaveBeenCalledTimes(1);
  expect(userMessage(expired)).toBe('Your session has ended. Sign in again.');
  const api2 = client(jest.fn(async () => response(403, { error: 'Change your temporary password before you continue.', code: 'PASSWORD_CHANGE_REQUIRED' })), { onUnauthorized, onPasswordChangeRequired });
  await api2.request('/api/attendance/today').catch(() => {});
  expect(onPasswordChangeRequired).toHaveBeenCalledTimes(1);
});

test('a failed sign-in shows the server’s message and does not end a session', async () => {
  const onUnauthorized = jest.fn();
  const api = client(jest.fn(async () => response(401, { error: 'The email, phone number or password is incorrect.', code: 'UNAUTHENTICATED' })), { onUnauthorized });
  const error = await signIn(api, { phone: '1', password: '2' }).catch((e) => e);
  expect(onUnauthorized).not.toHaveBeenCalled();
  expect(userMessage(error)).toBe('The email, phone number or password is incorrect.');
});

test('server errors are not shown raw; unexpected answers are reported as unreadable', async () => {
  const api = client(jest.fn(async () => response(500, { error: 'Something went wrong.', code: 'INTERNAL_ERROR' })));
  expect(userMessage(await api.request('/x').catch((e) => e))).toMatch(/on the server/);
  const odd = client(jest.fn(async () => response(200, { date: 'nope' })));
  const error = await fetchToday(odd).catch((e) => e);
  expect(error.kind).toBe('invalid_response');
  expect(error.retryable).toBe(false);
});

test('no server address configured', async () => {
  const api = createApiClient({ baseUrl: null, getToken: async () => null });
  await expect(api.request('/x')).rejects.toMatchObject({ kind: 'config' });
});

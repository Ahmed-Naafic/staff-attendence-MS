/*
 * The EduTrack API client: JSON requests with the session as `Authorization: Bearer <token>`
 * (docs/architecture.md → Mobile sessions), a timeout, and one error type for every failure.
 * The server's `{ error, code, details }` body is kept on the error; the screens decide what to
 * show (src/api/errors.js), never a stack trace or raw response.
 */

export class ApiError extends Error {
  /**
   * kind: 'network' (no connection), 'timeout', 'http' (the server answered with an error),
   * 'invalid_response' (the answer does not have the expected shape), 'config' (no API address).
   */
  constructor({ kind, status = null, code = null, message, details = null }) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** True when the server did not decide anything (the request can be sent again). */
  get retryable() {
    return this.kind === 'network' || this.kind === 'timeout' || (this.kind === 'http' && this.status >= 500);
  }
}

/**
 * createApiClient({ baseUrl, getToken, onUnauthorized, onPasswordChangeRequired, fetchImpl, timeoutMs })
 * → { request(path, { method, body, auth, signal }) }.
 * `onUnauthorized` is called for a 401 on an authenticated request (the session ended);
 * `onPasswordChangeRequired` for 403 PASSWORD_CHANGE_REQUIRED.
 */
export function createApiClient({ baseUrl, getToken, onUnauthorized, onPasswordChangeRequired, fetchImpl = fetch, timeoutMs = 15000 }) {
  async function request(path, { method = 'GET', body, auth = true, signal } = {}) {
    if (!baseUrl) throw new ApiError({ kind: 'config', message: 'The app has no server address. Set EXPO_PUBLIC_API_URL and restart it.' });
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abortFromCaller = () => controller.abort();
    signal?.addEventListener?.('abort', abortFromCaller);

    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const token = auth ? await getToken() : null;
    if (token) headers.authorization = `Bearer ${token}`;

    let response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      if (timedOut) throw new ApiError({ kind: 'timeout', message: 'The server took too long to answer.' });
      if (signal?.aborted) throw new ApiError({ kind: 'network', code: 'ABORTED', message: 'The request was cancelled.' });
      throw new ApiError({ kind: 'network', message: 'No connection to the server.' });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', abortFromCaller);
    }

    let data = null;
    const text = await response.text().catch(() => '');
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (response.ok) throw new ApiError({ kind: 'invalid_response', status: response.status, message: 'The server sent an answer the app cannot read.' });
      }
    }

    if (!response.ok) {
      const error = new ApiError({
        kind: 'http',
        status: response.status,
        code: typeof data?.code === 'string' ? data.code : null,
        message: typeof data?.error === 'string' ? data.error : `The server answered with an error (${response.status}).`,
        details: data?.details ?? null,
      });
      if (auth && response.status === 401) onUnauthorized?.(error);
      if (auth && response.status === 403 && error.code === 'PASSWORD_CHANGE_REQUIRED') onPasswordChangeRequired?.(error);
      throw error;
    }
    return { status: response.status, data };
  }

  return { request };
}

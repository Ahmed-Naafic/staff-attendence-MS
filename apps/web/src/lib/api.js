/*
 * The web app's only way to call the API. Sends the session cookie, encodes JSON and query
 * parameters, and turns failures into ApiError { status, code, message }. A 401 from any call
 * (except the session check and sign-in themselves) means the session ended: listeners
 * registered with onUnauthorized are told so the app can return to the sign-in page.
 */
// import.meta.env is set by Vite; under `node --test` it is absent and the default applies.
const BASE_URL = (import.meta.env?.VITE_API_URL || '/api').replace(/\/$/, '');

/** status (0 = network), code (e.g. VALIDATION_ERROR), message, and per-field `details` when the API sends them. */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const unauthorizedListeners = new Set();
export function onUnauthorized(listener) {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

function buildUrl(path, query) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return `${BASE_URL}${path}${search ? `?${search}` : ''}`;
}

/** apiRequest('/platform/schools', { query, method, body, signal, quietUnauthorized }) → parsed JSON (or null for 204). */
export async function apiRequest(path, { method = 'GET', query, body, signal, quietUnauthorized = false } = {}) {
  let response;
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      signal,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'The server could not be reached. Check your connection and try again.');
  }

  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (response.ok) return data;

  if (response.status === 401 && !quietUnauthorized) unauthorizedListeners.forEach((listener) => listener());
  throw new ApiError(response.status, data?.code ?? 'HTTP_ERROR', data?.error ?? 'Something went wrong. Try again later.', data?.details);
}

/** The file name from a Content-Disposition header, if it is a plain safe name; otherwise `fallback`. */
export function filenameFrom(disposition, fallback = 'download.csv') {
  const match = /filename="([^"]+)"/.exec(disposition ?? '');
  return match && /^[A-Za-z0-9._-]+$/.test(match[1]) ? match[1] : fallback;
}

/**
 * apiDownload('/owner/attendance/export.csv', { query, signal }) → { blob, filename, rows } for a file
 * response (rows: the X-Export-Rows header, or null). Failures throw ApiError as apiRequest does; a
 * download cut off while the file was arriving throws DOWNLOAD_INTERRUPTED, so a partial file is never
 * handed on as complete.
 */
export async function apiDownload(path, { query, signal } = {}) {
  let response;
  try {
    response = await fetch(buildUrl(path, query), { method: 'GET', signal, credentials: 'same-origin', headers: { Accept: 'text/csv, application/json' } });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'The server could not be reached. Check your connection and try again.');
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (response.status === 401) unauthorizedListeners.forEach((listener) => listener());
    throw new ApiError(response.status, data?.code ?? 'HTTP_ERROR', data?.error ?? 'Something went wrong. Try again later.', data?.details);
  }
  let blob;
  try {
    blob = await response.blob();
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    throw new ApiError(0, 'DOWNLOAD_INTERRUPTED', 'The download was interrupted before the file was complete. Try again.');
  }
  const rows = response.headers.get('x-export-rows');
  return { blob, filename: filenameFrom(response.headers.get('content-disposition')), rows: rows === null ? null : Number(rows) };
}

/**
 * Development-only previews of page states (?demoState=loading | error | empty), kept from the
 * demo-data phases. Never active in production builds; never replaces a real API failure.
 */
export function previewState() {
  return import.meta.env.DEV ? new URLSearchParams(window.location.search).get('demoState') : null;
}

/** Previews wait like a real request, so loading states are visible (e.g. after "Try again"). */
export const previewDelay = () => new Promise((resolve) => setTimeout(resolve, 350));

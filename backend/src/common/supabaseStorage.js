import { HttpError } from './httpError.js';
import { env } from '../config/env.js';

/*
 * Supabase Storage (REST, no SDK) for private files: one private bucket (env.supabaseExamBucket),
 * reached with the service role key, which stays on the server. Browsers never get the key: they
 * upload to a one-time signed upload URL and download from a signed URL that expires within minutes.
 *
 * Calls go through `transport` (fetch by default) so tests can stand in for the service. Any failure
 * of the service is reported as 502 STORAGE_ERROR; a missing configuration as 503 STORAGE_NOT_CONFIGURED.
 */

let transport = (url, init) => fetch(url, init);
/** Tests only: replaces the HTTP transport (null restores fetch). */
export const setStorageTransport = (fn) => {
  transport = fn ?? ((url, init) => fetch(url, init));
};

export const storageConfigured = () => Boolean(env.supabaseUrl && env.supabaseServiceKey);
export const NOT_CONFIGURED = () => new HttpError(503, 'STORAGE_NOT_CONFIGURED', 'File storage is not set up yet. Ask EduTrack support to connect it.');
const FAILED = (what) => new HttpError(502, 'STORAGE_ERROR', `File storage did not answer (${what}). Try again in a moment.`);
const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

async function call(method, path, { body, headers = {}, raw = false } = {}) {
  if (!storageConfigured()) throw NOT_CONFIGURED();
  let response;
  try {
    response = await transport(`${env.supabaseUrl}/storage/v1${path}`, {
      method,
      headers: { authorization: `Bearer ${env.supabaseServiceKey}`, apikey: env.supabaseServiceKey, ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw FAILED('unreachable');
  }
  if (raw) return response;
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: response.status, ok: response.ok, data };
}

/** Makes sure the bucket exists and is private (creates it private when missing; refuses a public one). */
export async function ensureBucket({ fileSizeLimit, mimeTypes }) {
  const bucket = env.supabaseExamBucket;
  const found = await call('GET', `/bucket/${encodeURIComponent(bucket)}`);
  if (found.ok) {
    if (found.data?.public) throw new HttpError(409, 'STORAGE_BUCKET_PUBLIC', `The storage bucket "${bucket}" is public. Make it private before examination papers are stored in it.`);
    return;
  }
  const created = await call('POST', '/bucket', { body: { id: bucket, name: bucket, public: false, file_size_limit: fileSizeLimit, allowed_mime_types: mimeTypes } });
  if (!created.ok && created.status !== 409) throw FAILED('bucket');
}

/** A one-time URL the browser PUTs the file to: { url } (absolute). */
export async function signedUploadUrl(key) {
  const r = await call('POST', `/object/upload/sign/${encodeURIComponent(env.supabaseExamBucket)}/${encodePath(key)}`);
  if (!r.ok || !r.data?.url) throw FAILED('upload link');
  return { url: `${env.supabaseUrl}/storage/v1${r.data.url}` };
}

/** The stored object's size, or null when it is not there. */
export async function objectSize(key) {
  const response = await call('HEAD', `/object/authenticated/${encodeURIComponent(env.supabaseExamBucket)}/${encodePath(key)}`, { raw: true });
  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok) throw FAILED('check');
  const length = response.headers.get('content-length');
  return length === null ? null : Number(length);
}

/** A download URL valid for `seconds`, saving the file under `fileName`: { url, expiresAt }. */
export async function signedDownloadUrl(key, seconds, fileName) {
  const r = await call('POST', `/object/sign/${encodeURIComponent(env.supabaseExamBucket)}/${encodePath(key)}`, { body: { expiresIn: seconds } });
  const signed = r.data?.signedURL ?? r.data?.signedUrl;
  if (!r.ok || !signed) throw FAILED('download link');
  const url = `${env.supabaseUrl}/storage/v1${signed}${signed.includes('?') ? '&' : '?'}download=${encodeURIComponent(fileName)}`;
  return { url, expiresAt: new Date(Date.now() + seconds * 1000).toISOString() };
}

/** Deletes a stored object (missing objects are fine). */
export async function removeObject(key) {
  const r = await call('DELETE', `/object/${encodeURIComponent(env.supabaseExamBucket)}`, { body: { prefixes: [key] } });
  if (!r.ok && r.status !== 404) throw FAILED('remove');
}

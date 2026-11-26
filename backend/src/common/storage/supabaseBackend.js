import { createClient } from '@supabase/supabase-js';

/*
 * The Supabase Storage backend: the official SDK (@supabase/supabase-js) with the project's secret
 * key, server side only. storageService.js is the only caller; features never use this directly.
 *
 * The secret key bypasses Storage RLS, so this module does no authorization of its own: EduTrack
 * decides who may touch a file before storageService.js is called (docs/storage/supabase-storage.md
 * → Why the backend authorizes). No session is kept and nothing is read from a URL.
 *
 * Every method throws a StorageBackendError whose `kind` is:
 *   not_found    the bucket or object does not exist
 *   denied       the key was refused (wrong key, revoked key)
 *   conflict     the object already exists (uploads never overwrite)
 *   unavailable  network failure, timeout or a server error (worth one retry)
 */

export class StorageBackendError extends Error {
  constructor(kind, operation, status) {
    super(`Storage ${operation} failed (${kind}${status ? `, ${status}` : ''}).`);
    this.kind = kind;
    this.operation = operation;
    this.status = status;
  }
}

const REQUEST_TIMEOUT_MS = 20_000;

function classify(error, operation) {
  // Storage answers e.g. HTTP 400 with { statusCode: "404", error: "not_found" }: the body's code wins.
  const status = Number(error?.statusCode) || Number(error?.status) || undefined;
  const code = error?.code ?? error?.error ?? (Number.isNaN(Number(error?.statusCode)) ? error?.statusCode : undefined);
  const text = `${error?.message ?? ''} ${code ?? ''}`;
  if (status === 404 || code === 'NoSuchKey' || code === 'NoSuchBucket' || /not.?found/i.test(text)) return new StorageBackendError('not_found', operation, status);
  if (status === 409 || code === 'Duplicate' || /already exists/i.test(text)) return new StorageBackendError('conflict', operation, status);
  if (status === 401 || status === 403 || code === 'InvalidJWT' || /unauthori[sz]ed|invalid.*(jwt|key|signature)/i.test(text)) return new StorageBackendError('denied', operation, status);
  return new StorageBackendError('unavailable', operation, status);
}

/** Runs an SDK call that answers { data, error }; returns data or throws a StorageBackendError. */
async function run(operation, fn) {
  let result;
  try {
    result = await fn();
  } catch (error) {
    throw classify(error, operation);
  }
  if (result?.error) throw classify(result.error, operation);
  return result?.data;
}

/**
 * A backend for the given project. `fetch` is injectable (tests); every request gets a timeout.
 * The key never leaves this closure: URLs handed out are signed, single-object and short-lived.
 */
export function createSupabaseBackend({ url, secretKey, fetch: fetchImpl = globalThis.fetch }) {
  const timedFetch = (input, init = {}) => fetchImpl(input, { ...init, signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: timedFetch, headers: { 'x-client-info': 'edutrack-backend' } },
  });
  const storage = client.storage;

  return {
    /** { public } of an existing bucket; throws not_found when it does not exist. */
    async getBucket(bucket) {
      const data = await run('bucket check', () => storage.getBucket(bucket));
      return { public: Boolean(data?.public), fileSizeLimit: data?.file_size_limit ?? null, allowedMimeTypes: data?.allowed_mime_types ?? null };
    },

    /** A one-time upload URL for a new object (never overwrites): { url }. */
    async createUploadUrl(bucket, key) {
      const data = await run('upload link', () => storage.from(bucket).createSignedUploadUrl(key, { upsert: false }));
      if (!data?.signedUrl) throw new StorageBackendError('unavailable', 'upload link');
      return { url: data.signedUrl };
    },

    /** { size, contentType } of a stored object, or null when it does not exist. */
    async stat(bucket, key) {
      try {
        const data = await run('check', () => storage.from(bucket).info(key));
        const size = Number(data?.size ?? data?.metadata?.size);
        return { size: Number.isFinite(size) ? size : null, contentType: data?.contentType ?? data?.metadata?.mimetype ?? null };
      } catch (error) {
        if (error.kind === 'not_found') return null;
        throw error;
      }
    },

    /** The first `bytes` bytes of an object (one ranged request through a 60-second signed URL). */
    async readHead(bucket, key, bytes) {
      const data = await run('read', () => storage.from(bucket).createSignedUrl(key, 60));
      let response;
      try {
        response = await timedFetch(data.signedUrl, { headers: { range: `bytes=0-${bytes - 1}` } });
      } catch {
        throw new StorageBackendError('unavailable', 'read');
      }
      if (response.status === 404 || response.status === 400) throw new StorageBackendError('not_found', 'read', response.status);
      if (!response.ok) throw new StorageBackendError('unavailable', 'read', response.status);
      // A server that ignores Range sends the whole file: read only what is needed, then stop.
      const reader = response.body.getReader();
      const chunks = [];
      let length = 0;
      while (length < bytes) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        length += value.length;
      }
      await reader.cancel().catch(() => {});
      return Buffer.concat(chunks).subarray(0, bytes);
    },

    /** A signed download URL valid for `seconds`; `download` (a file name) makes browsers save it. */
    async createDownloadUrl(bucket, key, seconds, { download } = {}) {
      const data = await run('download link', () => storage.from(bucket).createSignedUrl(key, seconds, download ? { download } : undefined));
      if (!data?.signedUrl) throw new StorageBackendError('unavailable', 'download link');
      return data.signedUrl;
    },

    /** Deletes objects; objects that are already gone are fine. */
    async remove(bucket, keys) {
      await run('remove', () => storage.from(bucket).remove(keys));
    },

    /** Server-side upload of a Buffer (never overwrites). */
    async upload(bucket, key, body, contentType) {
      await run('upload', () => storage.from(bucket).upload(key, body, { contentType, upsert: false, cacheControl: 'private, max-age=0' }));
    },
  };
}

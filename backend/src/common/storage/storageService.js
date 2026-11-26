import { env } from '../../config/env.js';
import { HttpError } from '../httpError.js';
import { checkStorageConfig } from './storageConfig.js';
import { SNIFF_BYTES, sniffType } from './fileTypes.js';
import { assertKeyOfSchool } from './storageKeys.js';
import { createSupabaseBackend, StorageBackendError } from './supabaseBackend.js';

/*
 * The one storage service every module uses (docs/storage/supabase-storage.md). It knows nothing
 * about examinations, students or staff: callers decide WHO may do WHAT to WHICH record (EduTrack
 * RBAC, school and branch scope) and keep the file's metadata in Neon; this service then works on
 * the object whose key the caller built with storageKeys.js. Every call names the school, and the
 * key is checked to lie inside that school's prefix before anything is sent to Supabase.
 *
 * Errors (HttpError, safe to show):
 *   503 STORAGE_NOT_CONFIGURED   URL/key missing or invalid (details on the server log only)
 *   503 STORAGE_BUCKET_MISSING   the configured bucket does not exist (it is never created here)
 *   503 STORAGE_BUCKET_PUBLIC    the bucket is public: refused, files would be readable by anyone
 *   503 STORAGE_ACCESS_DENIED    Supabase refused the key
 *   502 STORAGE_ERROR            Supabase did not answer / failed (after one retry where safe)
 *   404 FILE_MISSING             the object is not in storage
 * Signed URLs are never logged or stored; they are returned to the caller for one response.
 */

let backendOverride = null;
let cached = null; // { url, key, backend }
const bucketChecks = new Map(); // bucket → { ok: true, until } after a successful privacy check
const BUCKET_CHECK_MS = 5 * 60 * 1000;

/** Tests only: replaces the Supabase backend with a stand-in (null restores the real one). */
export function setStorageBackend(backend) {
  backendOverride = backend;
  bucketChecks.clear();
}

/** The configured bucket (SUPABASE_STORAGE_BUCKET, default edutrack-files). */
export const storageBucket = () => env.storageBucket;
/** The largest accepted file, in bytes (STORAGE_MAX_FILE_MB). */
export const maxFileBytes = () => Math.floor(env.storageMaxFileMb * 1024 * 1024);
/** Whether storage features can be offered (configuration only; the bucket is checked on use). */
export const storageConfigured = () => checkStorageConfig(env).configured;

const notConfigured = () => new HttpError(503, 'STORAGE_NOT_CONFIGURED', 'File storage is not set up yet. Ask EduTrack support to connect it.');

function backend() {
  if (!storageConfigured()) throw notConfigured();
  if (backendOverride) return backendOverride;
  if (!cached || cached.url !== env.supabaseUrl || cached.key !== env.supabaseSecretKey) {
    cached = { url: env.supabaseUrl, key: env.supabaseSecretKey, backend: createSupabaseBackend({ url: env.supabaseUrl, secretKey: env.supabaseSecretKey }) };
    bucketChecks.clear();
  }
  return cached.backend;
}

function toHttp(error) {
  if (error instanceof HttpError) return error;
  if (error instanceof StorageBackendError) {
    if (error.kind === 'denied') {
      console.error(`[storage] Supabase refused the secret key during "${error.operation}". Check SUPABASE_SECRET_KEY.`);
      return new HttpError(503, 'STORAGE_ACCESS_DENIED', 'File storage refused the connection. Ask EduTrack support to check it.');
    }
    if (error.kind === 'not_found') return new HttpError(404, 'FILE_MISSING', 'The stored file could not be found.');
    if (error.kind === 'conflict') return new HttpError(409, 'FILE_EXISTS', 'A file is already stored at this location.');
    console.error(`[storage] ${error.message}`);
    return new HttpError(502, 'STORAGE_ERROR', `File storage did not answer (${error.operation}). Try again in a moment.`);
  }
  console.error('[storage] unexpected error', error);
  return new HttpError(502, 'STORAGE_ERROR', 'File storage did not answer. Try again in a moment.');
}

/** Runs a storage call; safe (idempotent) calls get one retry after a network or server failure. */
async function attempt(fn, { retry = true } = {}) {
  try {
    return await fn();
  } catch (error) {
    if (retry && error instanceof StorageBackendError && error.kind === 'unavailable') {
      await new Promise((resolve) => setTimeout(resolve, 300));
      try {
        return await fn();
      } catch (again) {
        throw toHttp(again);
      }
    }
    throw toHttp(error);
  }
}

/**
 * Makes sure storage can be used: configured, the bucket exists and is PRIVATE. The bucket is
 * never created or changed here (it is managed in the Supabase dashboard). Cached for 5 minutes.
 */
export async function assertStorageReady(bucket = storageBucket()) {
  const b = backend();
  const known = bucketChecks.get(bucket);
  if (known && known.until > Date.now()) return;
  let info;
  try {
    info = await attempt(() => b.getBucket(bucket));
  } catch (error) {
    if (error.code === 'FILE_MISSING') {
      console.error(`[storage] The bucket "${bucket}" does not exist in the Supabase project.`);
      throw new HttpError(503, 'STORAGE_BUCKET_MISSING', 'File storage is not ready (its storage area is missing). Ask EduTrack support to check it.');
    }
    throw error;
  }
  if (info.public) {
    console.error(`[storage] The bucket "${bucket}" is PUBLIC. EduTrack refuses to use it until it is made private.`);
    throw new HttpError(503, 'STORAGE_BUCKET_PUBLIC', 'File storage is not safe to use (its storage area is public). Ask EduTrack support to make it private.');
  }
  bucketChecks.set(bucket, { until: Date.now() + BUCKET_CHECK_MS });
}

/**
 * A one-time URL the browser PUTs the file to (it cannot overwrite an existing object). The URL is
 * scoped to this one key and carries no credentials: { url, method, headers }.
 */
export async function createUploadUrl({ schoolId, key, contentType, bucket = storageBucket() }) {
  assertKeyOfSchool(key, schoolId);
  await assertStorageReady(bucket);
  const { url } = await attempt(() => backend().createUploadUrl(bucket, key));
  return { url, method: 'PUT', headers: { 'content-type': contentType, 'x-upsert': 'false' } };
}

/** Whether an object exists. */
export async function objectExists({ schoolId, key, bucket = storageBucket() }) {
  assertKeyOfSchool(key, schoolId);
  return (await attempt(() => backend().stat(bucket, key))) !== null;
}

/**
 * Checks an uploaded object: it exists, has exactly `size` bytes, and its first bytes match `ext`.
 * { ok: true } or { ok: false, reason: 'missing' | 'size' | 'content' }.
 */
export async function verifyUploadedObject({ schoolId, key, size, ext, bucket = storageBucket() }) {
  assertKeyOfSchool(key, schoolId);
  const b = backend();
  const stat = await attempt(() => b.stat(bucket, key));
  if (!stat) return { ok: false, reason: 'missing' };
  if (stat.size !== null && stat.size !== size) return { ok: false, reason: 'size' };
  let head;
  try {
    head = await attempt(() => b.readHead(bucket, key, SNIFF_BYTES));
  } catch (error) {
    if (error.code === 'FILE_MISSING') return { ok: false, reason: 'missing' };
    throw error;
  }
  if (!sniffType(head, ext)) return { ok: false, reason: 'content' };
  return { ok: true };
}

/**
 * A short-lived signed URL for an authorized reader: { url, expiresAt }. `fileName` makes the browser
 * save the file under that name; without it (view) the browser shows it if it can.
 */
export async function createDownloadUrl({ schoolId, key, seconds, fileName, bucket = storageBucket() }) {
  assertKeyOfSchool(key, schoolId);
  if (!Number.isInteger(seconds) || seconds < 10 || seconds > 3600) throw new HttpError(500, 'STORAGE_ERROR', 'Invalid link lifetime.');
  const url = await attempt(() => backend().createDownloadUrl(bucket, key, seconds, { download: fileName }));
  return { url, expiresAt: new Date(Date.now() + seconds * 1000).toISOString() };
}

/** Deletes an object (already gone is fine). Throws on failure so callers can retry later. */
export async function deleteObject({ schoolId, key, bucket = storageBucket() }) {
  assertKeyOfSchool(key, schoolId);
  await attempt(() => backend().remove(bucket, [key]));
}

/** Deletes an object, reporting instead of throwing: true when it is gone. */
export async function tryDeleteObject(args) {
  try {
    await deleteObject(args);
    return true;
  } catch (error) {
    console.error(`[storage] could not delete an object yet (${error.code ?? 'error'}); it will be retried by storage maintenance.`);
    return false;
  }
}

/**
 * Server-side upload of a small file the server already holds (generated documents, imports).
 * The caller validates the type; the content is checked against `ext` here. Never overwrites.
 */
export async function uploadBuffer({ schoolId, key, buffer, ext, contentType, bucket = storageBucket() }) {
  assertKeyOfSchool(key, schoolId);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new HttpError(400, 'VALIDATION_ERROR', 'The file is empty.');
  if (buffer.length > maxFileBytes()) throw new HttpError(400, 'VALIDATION_ERROR', 'The file is too large.');
  if (!sniffType(buffer.subarray(0, SNIFF_BYTES), ext)) throw new HttpError(400, 'VALIDATION_ERROR', 'The file content does not match its type.');
  await assertStorageReady(bucket);
  await attempt(() => backend().upload(bucket, key, buffer, contentType), { retry: false });
}

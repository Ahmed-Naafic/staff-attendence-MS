import { env as defaultEnv } from '../../config/env.js';

/*
 * Checks the file-storage configuration (docs/storage/supabase-storage.md → Environment variables).
 * Never includes a key's value in a message: only which variable is wrong and why.
 *
 *   configured  URL and key are present and look right: storage features are available.
 *   problems    what is missing or wrong (empty when configured, or when storage is simply not set up).
 *
 * Storage is optional unless STORAGE_REQUIRED=true: without it, storage features answer
 * 503 STORAGE_NOT_CONFIGURED and the rest of EduTrack works. A half-done or wrong configuration
 * (URL without key, a publishable/anon key, a public URL that is not a Supabase project…) is always
 * reported, because it is a mistake rather than a choice.
 */

const BUCKET_NAME = /^[a-z0-9][a-z0-9._-]{1,62}$/;

/** The role claimed by a legacy JWT key (anon / service_role), or null. Reads the payload only. */
function legacyKeyRole(key) {
  const parts = key.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))?.role ?? null;
  } catch {
    return null;
  }
}

/** { configured, missing, problems: string[] } for the given environment (default: env.js). */
export function checkStorageConfig(env = defaultEnv) {
  const problems = [];
  const { supabaseUrl: url, supabaseSecretKey: key, storageBucket: bucket, storageMaxFileMb: maxMb } = env;
  const missing = !url && !key;
  if (url && !key) problems.push('SUPABASE_SECRET_KEY is missing (SUPABASE_URL is set).');
  if (key && !url) problems.push('SUPABASE_URL is missing (SUPABASE_SECRET_KEY is set).');
  if (url) {
    let parsed = null;
    try {
      parsed = new URL(url);
    } catch {
      problems.push('SUPABASE_URL is not a valid URL (expected https://<project-ref>.supabase.co).');
    }
    if (parsed && parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) problems.push('SUPABASE_URL must use https.');
    if (parsed && parsed.pathname !== '/' && parsed.pathname !== '') problems.push('SUPABASE_URL must be the project URL only, without a path (no /storage/v1).');
  }
  if (key) {
    if (key.startsWith('sb_publishable_')) problems.push('SUPABASE_SECRET_KEY holds a publishable key. Use a secret key (sb_secret_…) from Project Settings → API Keys.');
    else if (!key.startsWith('sb_secret_')) {
      const role = legacyKeyRole(key);
      if (role === 'anon') problems.push('SUPABASE_SECRET_KEY holds the anon key. Use a secret key (sb_secret_…).');
      else if (role !== 'service_role') problems.push('SUPABASE_SECRET_KEY is not a Supabase secret key (expected sb_secret_… or a legacy service_role key).');
    }
  }
  if (!BUCKET_NAME.test(bucket ?? '')) problems.push('SUPABASE_STORAGE_BUCKET is not a valid bucket name.');
  if (!Number.isFinite(maxMb) || maxMb <= 0 || maxMb > 5000) problems.push('STORAGE_MAX_FILE_MB must be a number of megabytes above 0.');
  return { configured: !missing && problems.length === 0, missing, problems };
}

let reported = false;
/**
 * Startup check (app.js): reports problems once on the server log (no secrets) and, with
 * STORAGE_REQUIRED=true, stops the server when storage is missing or wrong.
 */
export function validateStorageConfigAtStartup(env = defaultEnv, log = console) {
  const result = checkStorageConfig(env);
  if (env.storageRequired && !result.configured) {
    const why = result.missing ? ['SUPABASE_URL and SUPABASE_SECRET_KEY are not set.'] : result.problems;
    throw new Error(`File storage is required (STORAGE_REQUIRED=true) but not configured correctly: ${why.join(' ')}`);
  }
  if (!reported && result.problems.length) {
    reported = true;
    log.error(`[storage] File storage is disabled until its configuration is fixed: ${result.problems.join(' ')}`);
  }
  return result;
}

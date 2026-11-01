import { env } from '../../config/env.js';

/*
 * Neon API client for Data & Backup (docs/data-backup/backup-architecture.md). Backups are Neon
 * snapshots of this deployment's branch; restores are staged on a new branch and finalized into it.
 * The branch is found from this server's own database endpoint (DATABASE_URL), because a restore
 * changes it: Neon moves the endpoint onto the restored branch and the old branch id becomes the
 * recovery point (confirmed by the real drill, 2026-11-01). NEON_BRANCH_ID is only an expectation
 * that is checked. Only ids, names, times and sizes leave this module: never the API key,
 * and connection strings only to the server-side restore check (verify.js).
 * Reference: https://neon.com/docs/guides/backup-restore and https://neon.com/docs/reference/api.
 */

const TIMEOUT_MS = 20_000;

/** A Neon API failure: code (PROVIDER_UNAUTHORIZED, NOT_FOUND, PROVIDER_BUSY, RATE_LIMITED, PROVIDER_UNAVAILABLE, PROVIDER_REJECTED, NOT_CONFIGURED), HTTP status, and Neon's own message (no secrets). */
export class ProviderError extends Error {
  constructor(code, message, status = null) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export const providerConfigured = () => Boolean(env.neonApiKey && env.neonProjectId);

/** What the page may show about the provider: never the key. `branchId` is the expected one (NEON_BRANCH_ID). */
export const providerInfo = () => ({
  provider: 'neon',
  configured: providerConfigured(),
  projectId: env.neonProjectId ?? null,
  branchId: env.neonBranchId ?? null,
  apiKeySet: Boolean(env.neonApiKey),
});

function requireConfig() {
  if (!providerConfigured()) throw new ProviderError('NOT_CONFIGURED', 'Backups are not configured: NEON_API_KEY and NEON_PROJECT_ID must be set on the server.');
}

// ---- the deployment's branch ------------------------------------------------------------------

const BRANCH_CACHE_MS = 60_000;
let branchOverride = null;
let branchCache = null;

/** The Neon endpoint id of this server's database (from DATABASE_URL; "-pooler" removed). */
export function databaseEndpointId() {
  try {
    return new URL(env.databaseUrl).hostname.split('.')[0].replace(/-pooler$/, '') || null;
  } catch {
    return null;
  }
}

/** Scripts only (the restore drill works on branches it creates): use this branch instead. null clears. */
export function setBranchOverride(branchId) {
  branchOverride = branchId;
  branchCache = null;
}

/** Forget the cached branch (after a production restore the endpoint moves to another branch). */
export function forgetDeploymentBranch() {
  branchCache = null;
}

/**
 * The branch this deployment's database runs on, read from Neon through the database's endpoint
 * (cached one minute). → { branchId, endpointId, configuredBranchId, mismatch }. `mismatch`: the
 * NEON_BRANCH_ID setting names another branch (for example the recovery point after a restore).
 */
export async function deploymentBranch({ fresh = false } = {}) {
  if (branchOverride) return { branchId: branchOverride, endpointId: null, configuredBranchId: env.neonBranchId ?? null, mismatch: false };
  // Only the branch id is cached; the comparison with NEON_BRANCH_ID is made on every call.
  const withSetting = ({ branchId, endpointId }) => ({ branchId, endpointId, configuredBranchId: env.neonBranchId ?? null, mismatch: Boolean(env.neonBranchId && env.neonBranchId !== branchId) });
  if (!fresh && branchCache && Date.now() - branchCache.at < BRANCH_CACHE_MS) return withSetting(branchCache.value);
  const endpointId = databaseEndpointId();
  if (!endpointId) throw new ProviderError('NOT_CONFIGURED', "DATABASE_URL is not set, so this server's Neon branch cannot be found.");
  let branchId;
  try {
    branchId = (await neon(`${project()}/endpoints/${encodeURIComponent(endpointId)}`))?.endpoint?.branch_id;
  } catch (error) {
    if (error.code !== 'NOT_FOUND') throw error;
  }
  if (!branchId) throw new ProviderError('NOT_CONFIGURED', `This server's database (${endpointId}) is not a compute of Neon project ${env.neonProjectId}. Check NEON_PROJECT_ID.`);
  branchCache = { value: { branchId, endpointId }, at: Date.now() };
  return withSetting(branchCache.value);
}
const currentBranch = async () => (await deploymentBranch()).branchId;

/** Neon's message without anything that looks like a credential or connection string. */
const clean = (text) => String(text ?? '').replace(/postgres(ql)?:\/\/\S+/gi, '[connection string]').replace(/napi_[A-Za-z0-9]+/g, '[key]').slice(0, 300);

async function neon(path, { method = 'GET', query, body } = {}) {
  requireConfig();
  const url = new URL(`${env.neonApiUrl}${path}`);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${env.neonApiKey}`, Accept: 'application/json', ...(body !== undefined && { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new ProviderError('PROVIDER_UNAVAILABLE', error.name === 'TimeoutError' ? 'Neon did not answer in time.' : 'Neon could not be reached.');
  }
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (response.ok) return data;
  const message = clean(data?.message ?? `Neon answered ${response.status}.`);
  if (response.status === 401 || response.status === 403) throw new ProviderError('PROVIDER_UNAUTHORIZED', `Neon refused the API key: ${message}`, response.status);
  if (response.status === 404) throw new ProviderError('NOT_FOUND', message, 404);
  if (response.status === 409 || response.status === 423) throw new ProviderError('PROVIDER_BUSY', `Neon is busy with another operation on this project: ${message}`, response.status);
  if (response.status === 429) throw new ProviderError('RATE_LIMITED', 'Neon rate limit reached. Try again in a minute.', 429);
  if (response.status >= 500) throw new ProviderError('PROVIDER_UNAVAILABLE', `Neon is unavailable: ${message}`, response.status);
  throw new ProviderError('PROVIDER_REJECTED', message, response.status);
}

const project = () => `/projects/${encodeURIComponent(env.neonProjectId)}`;
const opIds = (data) => (data?.operations ?? []).map((o) => o.id).filter(Boolean);

const toSnapshot = (s) => ({
  id: s.id,
  name: s.name ?? s.id,
  sourceBranchId: s.source_branch_id ?? null,
  createdAt: s.created_at ?? null,
  expiresAt: s.expires_at ?? null,
  manual: s.manual !== false,
  lsn: s.lsn ?? null,
  timestamp: s.timestamp ?? null,
  // Manual snapshots report full_size; later scheduled ones the change since the previous (diff_size).
  sizeBytes: s.full_size ?? s.diff_size ?? null,
  sizeKind: s.full_size != null ? 'full' : s.diff_size != null ? 'incremental' : null,
});

/**
 * The project's snapshots, newest first. Not filtered by branch: snapshots taken before a restore
 * keep the old branch id as their source and are still this database's backups. (Neon snapshots
 * root branches only, so a child branch such as dev never adds snapshots.)
 */
export async function listSnapshots() {
  const data = await neon(`${project()}/snapshots`);
  return (data?.snapshots ?? [])
    .map(toSnapshot)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** Starts a snapshot of the branch now (asynchronous at Neon): → { snapshot, operationIds }. */
export async function createSnapshot({ name, expiresAt }) {
  const data = await neon(`${project()}/branches/${encodeURIComponent(await currentBranch())}/snapshot`, {
    method: 'POST',
    query: { name, expires_at: expiresAt ? new Date(expiresAt).toISOString() : undefined },
  });
  return { snapshot: toSnapshot(data?.snapshot ?? {}), operationIds: opIds(data) };
}

/** expiresAt: a date, or null for no expiry (protected). */
export async function setSnapshotExpiry(id, expiresAt) {
  await neon(`${project()}/snapshots/${encodeURIComponent(id)}`, { method: 'PATCH', body: { snapshot: { expires_at: expiresAt ? new Date(expiresAt).toISOString() : null } } });
}

export async function deleteSnapshot(id) {
  const data = await neon(`${project()}/snapshots/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return { operationIds: opIds(data) };
}

/** Neon's states: scheduling, running, finished, failed, error, cancelling, cancelled, skipped. → 'running' | 'finished' | 'failed'. */
export async function operationsState(ids) {
  if (!ids?.length) return 'finished';
  const states = await Promise.all(ids.map(async (id) => (await neon(`${project()}/operations/${encodeURIComponent(id)}`))?.operation?.status));
  if (states.some((s) => ['failed', 'error', 'cancelled'].includes(s))) return 'failed';
  if (states.every((s) => ['finished', 'skipped'].includes(s))) return 'finished';
  return 'running';
}

// ---- schedule (Neon runs scheduled snapshots itself; paid plans) ---------------------------

export async function getSchedule() {
  const data = await neon(`${project()}/branches/${encodeURIComponent(await currentBranch())}/backup_schedule`);
  return (data?.schedule ?? []).map((e) => ({
    frequency: e.frequency,
    hour: e.hour ?? 0,
    day: e.day ?? null,
    retentionSeconds: e.retention_seconds ?? null,
  }));
}

export async function setSchedule({ frequency, hour, day, retentionSeconds }) {
  await neon(`${project()}/branches/${encodeURIComponent(await currentBranch())}/backup_schedule`, {
    method: 'PUT',
    body: { schedule: [{ frequency, hour, ...(day != null && { day }), retention_seconds: retentionSeconds }] },
  });
}

// ---- restore -------------------------------------------------------------------------------

/** Restores a snapshot onto a NEW branch (finalize_restore: false); production is untouched. → { branchId, branchName, operationIds }. */
export async function stageRestore(snapshotId, name) {
  const data = await neon(`${project()}/snapshots/${encodeURIComponent(snapshotId)}/restore`, {
    method: 'POST',
    body: { name, target_branch_id: await currentBranch(), finalize_restore: false },
  });
  return { branchId: data?.branch?.id ?? null, branchName: data?.branch?.name ?? name, operationIds: opIds(data) };
}

/**
 * Makes the staged branch the deployment's branch: Neon moves the computes onto it (connection
 * details unchanged) and keeps the replaced branch under `preserveName` (the recovery point).
 */
export async function finalizeRestore(stagedBranchId, preserveName) {
  const data = await neon(`${project()}/branches/${encodeURIComponent(stagedBranchId)}/finalize_restore`, { method: 'POST', body: { name: preserveName } });
  // The database's endpoint now belongs to the restored branch: find it again on the next call.
  forgetDeploymentBranch();
  return { operationIds: opIds(data) };
}

export async function deleteBranch(branchId) {
  const data = await neon(`${project()}/branches/${encodeURIComponent(branchId)}`, { method: 'DELETE' });
  return { operationIds: opIds(data) };
}

export async function getBranch(branchId) {
  return (await neon(`${project()}/branches/${encodeURIComponent(branchId)}`))?.branch ?? null;
}

/** A compute on the staged branch for the check: an existing one, or a new one (→ { endpointId, created }). */
export async function ensureEndpoint(branchId) {
  const existing = (await neon(`${project()}/branches/${encodeURIComponent(branchId)}/endpoints`))?.endpoints ?? [];
  if (existing.length) return { endpointId: existing[0].id, created: false, operationIds: [] };
  const data = await neon(`${project()}/endpoints`, { method: 'POST', body: { endpoint: { branch_id: branchId, type: 'read_write' } } });
  return { endpointId: data?.endpoint?.id ?? null, created: true, operationIds: opIds(data) };
}

export async function deleteEndpoint(endpointId) {
  await neon(`${project()}/endpoints/${encodeURIComponent(endpointId)}`, { method: 'DELETE' });
}

/** Server-side only: the staged branch's connection string for the restore check. Never returned to a client. */
export async function connectionUri(branchId, endpointId, { roleName }) {
  const data = await neon(`${project()}/connection_uri`, {
    query: { branch_id: branchId, endpoint_id: endpointId, database_name: env.neonDatabaseName, role_name: roleName, pooled: false },
  });
  if (!data?.uri) throw new ProviderError('PROVIDER_REJECTED', 'Neon returned no connection details for the staged branch.');
  return data.uri;
}

import { badRequest, conflict, notFound } from '../../common/httpError.js';
import { env } from '../../config/env.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { OPERATION_TIMEOUT_MS, PRODUCTION_CONFIRMATION, stampName } from './backupRules.js';
import { providerHttpError, startOperation } from './backups.service.js';
import * as neon from './neon.js';
import { verifyStagedDatabase } from './verify.js';

/*
 * Restore Management (docs/data-backup/recovery-procedures.md). Two separate, explicit steps:
 *
 * 1. Stage (POST /restores): Neon restores the snapshot onto a NEW branch; production is untouched.
 *    EduTrack then checks the staged database (verify.js) → VERIFIED or FAILED.
 * 2. Restore production (POST /restores/:id/finalize, typed confirmation): Neon makes the staged
 *    branch the deployment's branch; the replaced branch is kept under a recovery-point name.
 *    Or discard (POST /restores/:id/discard): the staged branch is deleted.
 *
 * Only step 2 changes production, and only from that request: refreshing (page loads) never does.
 * After step 2 the database is the backup's, so EduTrack writes the restore's own record, the
 * backup records and the audit events back into it.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const LEASE_MS = 2 * 60 * 1000;
const FINALIZE_WAIT_MS = 120_000;
const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });
const target = (op, name) => ({ type: 'backup', id: op.snapshotId, name: name ?? op.snapshotId });
/** The database role for the check: NEON_ROLE_NAME, or the user of DIRECT_URL / DATABASE_URL. */
function roleName() {
  if (env.neonRoleName) return env.neonRoleName;
  for (const url of [process.env.DIRECT_URL, process.env.DATABASE_URL]) {
    try {
      if (url) return decodeURIComponent(new URL(url).username);
    } catch {
      // not a URL
    }
  }
  return 'neondb_owner';
}

const view = (op) =>
  op && {
    id: op.id,
    status: op.status,
    snapshotId: op.snapshotId,
    stagedBranch: op.branchName,
    phase: op.result?.phase ?? null,
    verification: op.result?.verification ?? null,
    recoveryPoint: op.result?.recoveryPoint ?? null,
    branchAfter: op.result?.branchAfter ?? null,
    startedAt: op.startedAt,
    finishedAt: op.finishedAt,
    requestedBy: op.requestedByName,
    error: op.errorMessage,
  };

async function fail(op, code, message, { actor, req, now = new Date(), cleanup = true } = {}) {
  const prisma = getPrisma();
  if (cleanup && op.branchId) await neon.deleteBranch(op.branchId).catch(() => {});
  await prisma.backupOperation.update({ where: { id: op.id }, data: { status: 'FAILED', finishedAt: now, errorCode: code, errorMessage: String(message).slice(0, 300) } });
  await recordAuditEvent({
    action: AUDIT_ACTIONS.RESTORE_FAILED,
    result: 'FAILURE',
    actor: actor ?? (op.requestedById ? { id: op.requestedById, name: op.requestedByName, role: 'SUPER_ADMIN' } : null),
    target: target(op),
    description: `Restore from backup ${op.snapshotId} failed: ${String(message).slice(0, 200)}${cleanup && op.branchId ? ' The staged branch was removed.' : ''} Production was not changed.`,
    req,
  });
}

// ---- 1. stage --------------------------------------------------------------------------------

/** Restores the backup onto a new branch for checking. Body: { snapshotId, confirm: true }. */
export async function startRestore(body, user, req, { now = new Date() } = {}) {
  const prisma = getPrisma();
  const snapshotId = typeof body?.snapshotId === 'string' ? body.snapshotId : '';
  if (!snapshotId) throw badRequest('Choose the backup to restore.', { snapshotId: 'Choose a backup.' });
  if (body.confirm !== true) throw badRequest('Confirm that you want to stage this restore.', { confirm: 'Required.' });
  if (!neon.providerConfigured()) throw providerHttpError(new neon.ProviderError('NOT_CONFIGURED', 'Backups are not configured on this server.'));
  let snapshot;
  try {
    snapshot = (await neon.listSnapshots()).find((s) => s.id === snapshotId);
  } catch (error) {
    throw providerHttpError(error);
  }
  if (!snapshot) throw notFound('Backup not found at Neon (it may have expired or been deleted).');
  const op = await startOperation({ type: 'RESTORE', lane: 'restore', snapshotId, requestedById: user.id, requestedByName: user.name, result: { phase: 'staging' } });
  const name = stampName('edutrack-restore', now);
  try {
    const staged = await neon.stageRestore(snapshotId, name);
    if (!staged.branchId) throw new neon.ProviderError('PROVIDER_REJECTED', 'Neon returned no branch for the restore.');
    const updated = await prisma.backupOperation.update({
      where: { id: op.id },
      data: { branchId: staged.branchId, branchName: staged.branchName, providerOperationIds: staged.operationIds, result: { phase: 'staging', snapshotName: snapshot.name } },
    });
    await recordAuditEvent({
      action: AUDIT_ACTIONS.RESTORE_STARTED,
      actor: actorOf(user),
      target: target(op, snapshot.name),
      description: `Restore of backup ${snapshot.name} (${snapshot.createdAt}) staged on the new branch ${staged.branchName}. Production is not changed.`,
      req,
    });
    return view(updated);
  } catch (error) {
    await fail(op, error.code ?? 'ERROR', error.message, { actor: actorOf(user), req, now });
    throw providerHttpError(error);
  }
}

// ---- checking (on refresh; never touches production) ----------------------------------------

/** Claims the check of a staged restore for 2 minutes, so two refreshes do not check at once. */
async function claim(op, now) {
  const rows = await getPrisma().$queryRaw`
    UPDATE "BackupOperation"
    SET "result" = jsonb_set(COALESCE("result", '{}'::jsonb), '{lease}', to_jsonb(${now.toISOString()}::text))
    WHERE "id" = ${op.id} AND "status" = 'RUNNING'
      AND (("result"->>'lease') IS NULL OR ("result"->>'lease')::timestamptz < ${new Date(now.getTime() - LEASE_MS).toISOString()}::timestamptz)
    RETURNING "id"`;
  return rows.length > 0;
}

const setResult = (op, patch) => getPrisma().backupOperation.update({ where: { id: op.id }, data: { result: { ...(op.result ?? {}), ...patch, lease: null } } });

/** Advances a staged restore: waits for Neon, starts a compute, checks the data. → the operation. */
export async function refreshRestore(op, { now = new Date(), verify = verifyStagedDatabase } = {}) {
  if (op.status !== 'RUNNING' || !op.branchId) return op;
  if (now - op.startedAt > OPERATION_TIMEOUT_MS) {
    await fail(op, 'TIMED_OUT', 'The staged restore did not finish within 2 hours.', { now });
    return getPrisma().backupOperation.findUnique({ where: { id: op.id } });
  }
  if (!(await claim(op, now))) return op;
  try {
    const state = await neon.operationsState(op.providerOperationIds);
    if (state === 'failed') {
      await fail(op, 'PROVIDER_FAILED', 'Neon reported that restoring the snapshot failed.', { now });
      return getPrisma().backupOperation.findUnique({ where: { id: op.id } });
    }
    if (state === 'running') return setResult(op, { phase: 'staging' });
    let endpoint = op.result?.endpoint;
    if (!endpoint) {
      const e = await neon.ensureEndpoint(op.branchId);
      endpoint = { id: e.endpointId, created: e.created, operationIds: e.operationIds };
      if (e.operationIds.length) return setResult(op, { phase: 'starting compute', endpoint });
    } else if ((await neon.operationsState(endpoint.operationIds)) === 'running') {
      return setResult(op, { phase: 'starting compute', endpoint });
    }
    const uri = await neon.connectionUri(op.branchId, endpoint.id, { roleName: roleName() });
    const verification = await verify(uri, { now });
    // A compute EduTrack added only for the check is removed: at finalize Neon moves production's computes onto the branch.
    if (endpoint.created) await neon.deleteEndpoint(endpoint.id).catch(() => {});
    if (!verification.ok) {
      await setResult(op, { phase: 'checked', verification, endpoint: null });
      const fresh = await getPrisma().backupOperation.findUnique({ where: { id: op.id } });
      await fail(fresh, 'VERIFICATION_FAILED', `The restored data did not pass the check: ${verification.checks.filter((c) => !c.ok && !c.warning).map((c) => c.label).join('; ')}.`, { now });
      return getPrisma().backupOperation.findUnique({ where: { id: op.id } });
    }
    const updated = await getPrisma().backupOperation.update({
      where: { id: op.id },
      data: { status: 'VERIFIED', result: { ...(op.result ?? {}), phase: 'checked', verification, endpoint: null, lease: null } },
    });
    await recordAuditEvent({
      action: AUDIT_ACTIONS.RESTORE_VERIFIED,
      actor: op.requestedById ? { id: op.requestedById, name: op.requestedByName, role: 'SUPER_ADMIN' } : null,
      target: target(op, op.result?.snapshotName),
      description: `Staged restore of backup ${op.result?.snapshotName ?? op.snapshotId} checked: ${verification.missingMigrations.length ? `usable, ${verification.missingMigrations.length} migration(s) behind` : 'passed'}.`,
    });
    return updated;
  } catch (error) {
    // Neon or the staged database not reachable yet: release the claim and try again on the next refresh.
    await setResult(op, { phase: op.result?.phase ?? 'staging', lastError: String(error.message).slice(0, 200) }).catch(() => {});
    return getPrisma().backupOperation.findUnique({ where: { id: op.id } });
  }
}

export async function getRestore(id, options) {
  let op = await getPrisma().backupOperation.findUnique({ where: { id } });
  if (!op || op.type !== 'RESTORE') throw notFound('Restore not found.');
  if (op.status === 'RUNNING') op = await refreshRestore(op, options);
  return view(op);
}

export async function listRestores({ limit = 10 } = {}, options) {
  const prisma = getPrisma();
  const active = await prisma.backupOperation.findFirst({ where: { lane: 'restore', status: 'RUNNING' } });
  if (active) await refreshRestore(active, options);
  const rows = await prisma.backupOperation.findMany({ where: { type: 'RESTORE' }, orderBy: { startedAt: 'desc' }, take: limit });
  return { items: rows.map(view) };
}

// ---- 2a. discard -----------------------------------------------------------------------------

export async function discardRestore(id, user, req, { now = new Date() } = {}) {
  const prisma = getPrisma();
  const op = await prisma.backupOperation.findUnique({ where: { id } });
  if (!op || op.type !== 'RESTORE') throw notFound('Restore not found.');
  if (!['RUNNING', 'VERIFIED'].includes(op.status)) throw conflict('INVALID_STATUS', 'Only a staged restore can be discarded.');
  if (op.branchId) {
    try {
      await neon.deleteBranch(op.branchId);
    } catch (error) {
      if (!(error instanceof neon.ProviderError && error.code === 'NOT_FOUND')) throw providerHttpError(error);
    }
  }
  const updated = await prisma.backupOperation.update({ where: { id }, data: { status: 'DISCARDED', finishedAt: now } });
  await recordAuditEvent({
    action: AUDIT_ACTIONS.RESTORE_DISCARDED,
    actor: actorOf(user),
    target: target(op, op.result?.snapshotName),
    description: `Staged restore of backup ${op.result?.snapshotName ?? op.snapshotId} discarded: the staged branch ${op.branchName ?? ''} was deleted. Production was not changed.`,
    req,
  });
  return view(updated);
}

// ---- 2b. restore production ------------------------------------------------------------------

/** Writes into the (restored) database, retrying while Neon moves the computes and connections drop. */
async function writeAfterRestore(write) {
  let last;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      return await write(getPrisma());
    } catch (error) {
      last = error;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw last;
}

/**
 * Replaces production with the staged, checked restore. Body: { confirmation: "RESTORE PRODUCTION",
 * snapshotId (must match), acknowledgeSchemaGap: true when the backup is behind the application's migrations }.
 */
export async function finalizeRestore(id, body, user, req, { now = new Date(), waitMs = FINALIZE_WAIT_MS, pollMs = 2000 } = {}) {
  const prisma = getPrisma();
  const op = await prisma.backupOperation.findUnique({ where: { id } });
  if (!op || op.type !== 'RESTORE') throw notFound('Restore not found.');
  if (op.status !== 'VERIFIED') throw conflict('NOT_VERIFIED', 'Only a staged restore that passed its check can replace production.');
  const errors = {};
  if (body?.confirmation !== PRODUCTION_CONFIRMATION) errors.confirmation = `Type ${PRODUCTION_CONFIRMATION} to confirm.`;
  if (body?.snapshotId !== op.snapshotId) errors.snapshotId = 'The backup does not match this restore.';
  const gap = op.result?.verification?.missingMigrations ?? [];
  if (gap.length && body?.acknowledgeSchemaGap !== true) errors.acknowledgeSchemaGap = 'Confirm that you will apply the missing migrations right after the restore.';
  if (Object.keys(errors).length) throw badRequest('Production restore not confirmed.', errors);

  const preserveName = stampName('edutrack-before-restore', now);
  // Recorded before the switch: this event stays in the replaced database (the recovery point).
  await recordAuditEvent({
    action: AUDIT_ACTIONS.RESTORE_PRODUCTION_STARTED,
    actor: actorOf(user),
    target: target(op, op.result?.snapshotName),
    description: `Production restore from backup ${op.result?.snapshotName ?? op.snapshotId} started. The current database is kept as the Neon branch ${preserveName}.`,
    req,
  });
  // EduTrack's own records, written back after the switch (the backup's database does not have them).
  const records = await prisma.backupRecord.findMany();
  const otherOps = await prisma.backupOperation.findMany({ where: { id: { not: op.id }, startedAt: { gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) } } });

  let finalize;
  try {
    finalize = await neon.finalizeRestore(op.branchId, preserveName);
  } catch (error) {
    // Neon refused: nothing was switched. The staged restore stays for another attempt or discarding.
    await recordAuditEvent({
      action: AUDIT_ACTIONS.RESTORE_FAILED,
      result: 'FAILURE',
      actor: actorOf(user),
      target: target(op, op.result?.snapshotName),
      description: `Production restore refused by Neon: ${String(error.message).slice(0, 200)} Production was not changed; the staged restore is kept.`,
      req,
    });
    throw providerHttpError(error);
  }
  let state = 'running';
  const until = Date.now() + waitMs;
  while (state === 'running' && Date.now() < until) {
    await sleep(pollMs);
    state = await neon.operationsState(finalize.operationIds).catch(() => 'running');
  }
  const finishedAt = new Date();
  // The database's branch after the switch (a new id; the old one is the recovery point).
  const after = await neon.deploymentBranch({ fresh: true }).catch(() => null);
  const result = {
    ...(op.result ?? {}),
    phase: state === 'finished' ? 'restored' : state === 'failed' ? 'failed' : 'switch pending at Neon',
    recoveryPoint: preserveName,
    branchAfter: after?.branchId ?? null,
    lease: null,
  };
  const status = state === 'failed' ? 'FAILED' : 'COMPLETED';
  await writeAfterRestore(async (client) => {
    for (const r of records) {
      const { snapshotId, ...rest } = r;
      await client.backupRecord.upsert({ where: { snapshotId }, create: r, update: rest });
    }
    // The records read just before the switch are the latest: they replace the backup's older copies
    // (for example the backup's own creation, still RUNNING when its snapshot was taken).
    for (const o of otherOps) {
      const { id, ...rest } = o;
      await client.backupOperation.upsert({ where: { id }, create: o, update: rest }).catch(() => {});
    }
    const data = { ...op, status, finishedAt, result, ...(state === 'failed' && { errorCode: 'PROVIDER_FAILED', errorMessage: 'Neon reported that the switch failed. Check the project in the Neon console.' }) };
    await client.backupOperation.upsert({ where: { id: op.id }, create: data, update: { status, finishedAt, result, errorCode: data.errorCode ?? null, errorMessage: data.errorMessage ?? null } });
    await recordAuditEvent({
      client,
      action: state === 'failed' ? AUDIT_ACTIONS.RESTORE_FAILED : AUDIT_ACTIONS.RESTORE_COMPLETED,
      result: state === 'failed' ? 'FAILURE' : 'SUCCESS',
      actor: { id: null, name: user.name, role: user.role },
      target: target(op, op.result?.snapshotName),
      description:
        state === 'failed'
          ? `Production restore from backup ${op.result?.snapshotName ?? op.snapshotId} failed at Neon. Check the Neon console; the previous database is the branch ${preserveName}.`
          : `Production restored from backup ${op.result?.snapshotName ?? op.snapshotId}${state === 'running' ? ' (Neon was still finishing the switch)' : ''}. The previous database is kept as the Neon branch ${preserveName}.${after ? ` The database now runs on branch ${after.branchId}: set NEON_BRANCH_ID to it.` : ''}${(op.result?.verification?.missingMigrations ?? []).length ? ' Apply the missing migrations now (prisma migrate deploy).' : ''}`,
      req,
    });
  });
  return view({ ...op, status, finishedAt, result });
}

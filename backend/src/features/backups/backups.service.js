import { conflict, HttpError, notFound } from '../../common/httpError.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import {
  MANUAL_RETENTION_DAYS,
  nextScheduledAt,
  OPERATION_TIMEOUT_MS,
  readConfiguration,
  scheduleOverdue,
  scheduleText,
  stampName,
} from './backupRules.js';
import * as neon from './neon.js';

/*
 * Data & Backup (Super Admin; docs/data-backup/). A backup is a Neon snapshot of this deployment's
 * branch. Neon makes scheduled snapshots itself (no EduTrack job runs backups) and keeps them
 * outside this database; EduTrack starts manual snapshots, protects, checks and deletes them, and
 * records who did what (BackupRecord, BackupOperation, AuditEvent). Restores: restore.service.js.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Neon failures → API errors (the provider's message, never a secret). */
export function providerHttpError(error) {
  if (!(error instanceof neon.ProviderError)) return error;
  const status = { NOT_CONFIGURED: 503, NOT_FOUND: 404, PROVIDER_BUSY: 409, RATE_LIMITED: 429, PROVIDER_UNAVAILABLE: 503 }[error.code] ?? 502;
  return new HttpError(status, error.code === 'NOT_CONFIGURED' ? 'BACKUPS_NOT_CONFIGURED' : error.code, error.message);
}

const actorOf = (user) => ({ id: user.id, name: user.name, role: user.role });
const target = (snapshotId, name) => ({ type: 'backup', id: snapshotId, name: name ?? snapshotId });

export async function backupSettings(client = getPrisma()) {
  const row = await client.backupSettings.findUnique({ where: { id: 'platform' } });
  return { manualRetentionDays: row?.manualRetentionDays ?? MANUAL_RETENTION_DAYS.fallback };
}

/** Neon's schedule for the branch in EduTrack's terms, or { schedule: null, error } when it cannot be read. */
async function readSchedule() {
  try {
    const [first] = await neon.getSchedule();
    if (!first) return { schedule: null, error: null };
    return {
      schedule: {
        frequency: first.frequency,
        hour: first.hour,
        day: first.day,
        retentionDays: first.retentionSeconds ? Math.round(first.retentionSeconds / 86400) : 35,
      },
      error: null,
    };
  } catch (error) {
    return { schedule: null, error: error instanceof neon.ProviderError ? { code: error.code, message: error.message } : { code: 'ERROR', message: 'The schedule could not be read.' } };
  }
}

// ---- operations ------------------------------------------------------------------------------

/**
 * Brings running backup creations and deletions up to date with Neon (idempotent; safe on any
 * page load: it never starts a backup or a restore). Steps running longer than 2 h fail.
 */
export async function refreshBackupOperations({ now = new Date() } = {}) {
  const prisma = getPrisma();
  const running = await prisma.backupOperation.findMany({ where: { lane: 'backup', status: 'RUNNING' } });
  for (const op of running) {
    let state;
    try {
      state = await neon.operationsState(op.providerOperationIds);
    } catch {
      continue; // Neon unreachable: try again on the next refresh.
    }
    const timedOut = state === 'running' && now - op.startedAt > OPERATION_TIMEOUT_MS;
    if (state === 'running' && !timedOut) continue;
    const ok = state === 'finished';
    const updated = await prisma.backupOperation.updateMany({
      where: { id: op.id, status: 'RUNNING' },
      data: { status: ok ? 'COMPLETED' : 'FAILED', finishedAt: now, ...(!ok && { errorCode: timedOut ? 'TIMED_OUT' : 'PROVIDER_FAILED', errorMessage: timedOut ? 'Neon did not finish within 2 hours.' : 'Neon reported that the operation failed.' }) },
    });
    if (!updated.count || ok) continue;
    await recordAuditEvent({
      action: op.type === 'DELETE' ? AUDIT_ACTIONS.BACKUP_DELETED : AUDIT_ACTIONS.BACKUP_CREATED,
      result: 'FAILURE',
      actor: op.requestedById ? { id: op.requestedById, name: op.requestedByName, role: 'SUPER_ADMIN' } : null,
      target: target(op.snapshotId ?? op.id),
      description: `${op.type === 'DELETE' ? 'Backup deletion' : 'Backup'} failed at Neon${timedOut ? ' (timed out)' : ''}.`,
    });
  }
}

/** Starts an operation in a lane; another active one in the same lane → 409. */
export async function startOperation(data, client = getPrisma()) {
  try {
    return await client.backupOperation.create({ data });
  } catch (error) {
    if (error.code === 'P2002') {
      throw data.lane === 'restore'
        ? conflict('RESTORE_IN_PROGRESS', 'A restore is already in progress. Finish or discard it first.')
        : conflict('BACKUP_IN_PROGRESS', 'A backup operation is already running. Wait until it finishes.');
    }
    throw error;
  }
}

// ---- history ---------------------------------------------------------------------------------

/**
 * Every backup: Neon's snapshots joined with EduTrack's records, plus backups that failed before
 * Neon created anything and records of snapshots Neon no longer has (expired or deleted).
 * Status: COMPLETED | RUNNING | RESTORING | FAILED | EXPIRED | DELETED.
 */
async function allBackups({ now, snapshots, schedule }) {
  const prisma = getPrisma();
  const [records, ops] = await Promise.all([
    prisma.backupRecord.findMany(),
    prisma.backupOperation.findMany({ where: { OR: [{ status: { in: ['RUNNING', 'VERIFIED'] } }, { type: 'CREATE', status: 'FAILED', snapshotId: null }] }, orderBy: { startedAt: 'desc' }, take: 200 }),
  ]);
  const byId = new Map(records.map((r) => [r.snapshotId, r]));
  const creating = new Set(ops.filter((o) => o.type === 'CREATE' && o.status === 'RUNNING').map((o) => o.snapshotId));
  const restoring = new Set(ops.filter((o) => o.type === 'RESTORE').map((o) => o.snapshotId));
  const scheduleRetentionMs = (schedule?.retentionDays ?? 35) * DAY_MS;
  const items = snapshots.map((s) => {
    const r = byId.get(s.id);
    const kind = r?.kind ?? (s.manual ? 'MANUAL' : 'SCHEDULED');
    const expiresAt = s.expiresAt ?? (kind === 'SCHEDULED' && s.createdAt ? new Date(new Date(s.createdAt).getTime() + scheduleRetentionMs).toISOString() : null);
    return {
      id: s.id,
      name: s.name,
      kind,
      status: restoring.has(s.id) ? 'RESTORING' : creating.has(s.id) ? 'RUNNING' : 'COMPLETED',
      createdAt: s.createdAt,
      sizeBytes: s.sizeBytes,
      sizeKind: s.sizeKind,
      provider: 'Neon snapshot',
      providerRef: s.id,
      expiresAt,
      // A manual snapshot without expiry never expires: it is treated as protected (deleteBackup agrees).
      protected: Boolean(r?.protected) || (kind === 'MANUAL' && !s.expiresAt),
      createdBy: r?.createdByName ?? (kind === 'SCHEDULED' ? 'Neon schedule' : 'Neon console'),
      verifiedAt: r?.verifiedAt ?? null,
      verification: r?.verification ?? null,
      pointInTime: s.timestamp ?? s.createdAt,
    };
  });
  const listed = new Set(snapshots.map((s) => s.id));
  for (const r of records) {
    if (listed.has(r.snapshotId)) continue;
    items.push({
      id: r.snapshotId,
      name: r.name,
      kind: r.kind,
      status: r.deletedAt ? 'DELETED' : 'EXPIRED',
      createdAt: r.createdAt.toISOString(),
      sizeBytes: null,
      sizeKind: null,
      provider: 'Neon snapshot',
      providerRef: r.snapshotId,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      protected: false,
      createdBy: r.createdByName ?? '—',
      verifiedAt: r.verifiedAt,
      verification: r.verification,
      deletedAt: r.deletedAt,
      deletedBy: r.deletedByName,
      pointInTime: null,
    });
  }
  for (const o of ops.filter((x) => x.type === 'CREATE' && x.status === 'FAILED' && !x.snapshotId)) {
    items.push({
      id: o.id,
      name: 'Backup not created',
      kind: 'MANUAL',
      status: 'FAILED',
      createdAt: o.startedAt.toISOString(),
      sizeBytes: null,
      sizeKind: null,
      provider: 'Neon snapshot',
      providerRef: null,
      expiresAt: null,
      protected: false,
      createdBy: o.requestedByName ?? '—',
      error: o.errorMessage,
      pointInTime: null,
    });
  }
  // Records of snapshots Neon has expired are EXPIRED from their expiry on, even if Neon still lists them for a moment.
  for (const item of items) if (item.status === 'COMPLETED' && item.expiresAt && new Date(item.expiresAt) <= now && !item.protected) item.status = 'EXPIRED';
  return items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

async function providerState(now) {
  if (!neon.providerConfigured()) return { snapshots: [], schedule: null, scheduleError: null, providerError: null, branch: null };
  await refreshBackupOperations({ now });
  let snapshots = [];
  let providerError = null;
  let branch = null;
  try {
    branch = await neon.deploymentBranch();
    snapshots = await neon.listSnapshots();
  } catch (error) {
    providerError = { code: error.code ?? 'ERROR', message: error.message };
  }
  const { schedule, error: scheduleError } = branch ? await readSchedule() : { schedule: null, error: null };
  return { snapshots, schedule, scheduleError, providerError, branch };
}

export async function listBackups({ status, kind, page = 1, pageSize = 10 } = {}, { now = new Date() } = {}) {
  const state = await providerState(now);
  const all = await allBackups({ now, ...state });
  const filtered = all.filter((b) => (!status || b.status === status) && (!kind || b.kind === kind));
  return {
    items: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    pageSize,
    providerError: state.providerError,
  };
}

// ---- overview --------------------------------------------------------------------------------

export async function getOverview({ now = new Date() } = {}) {
  const prisma = getPrisma();
  const state = await providerState(now);
  const provider = { ...neon.providerInfo(), ...(state.branch && { branchId: state.branch.branchId, configuredBranchId: state.branch.configuredBranchId, branchMismatch: state.branch.mismatch }) };
  const backups = provider.configured ? await allBackups({ now, ...state }) : [];
  const available = backups.filter((b) => ['COMPLETED', 'RESTORING'].includes(b.status));
  const lastSuccessful = available[0] ?? null;
  const lastScheduled = available.find((b) => b.kind === 'SCHEDULED') ?? null;
  const [failedCount, lastRestore, activeRestore, runningBackup, settings] = await Promise.all([
    prisma.backupOperation.count({ where: { type: 'CREATE', status: 'FAILED' } }),
    prisma.backupOperation.findFirst({ where: { type: 'RESTORE' }, orderBy: { startedAt: 'desc' } }),
    prisma.backupOperation.findFirst({ where: { lane: 'restore', status: { in: ['RUNNING', 'VERIFIED'] } } }),
    prisma.backupOperation.findFirst({ where: { lane: 'backup', status: 'RUNNING' } }),
    backupSettings(prisma),
  ]);
  const lastCreate = await prisma.backupOperation.findFirst({ where: { type: 'CREATE', status: { in: ['COMPLETED', 'FAILED'] } }, orderBy: { startedAt: 'desc' } });
  const storageBytes = available.some((b) => b.sizeBytes != null) ? available.reduce((sum, b) => sum + (b.sizeBytes ?? 0), 0) : null;

  const alerts = [];
  if (!provider.configured) {
    alerts.push({ level: 'error', code: 'NOT_CONFIGURED', text: 'Backups are not configured on this server: EduTrack cannot see or create backups. Neon may still keep its own history; see Storage Configuration.' });
  }
  if (state.providerError) alerts.push({ level: 'error', code: 'PROVIDER_ERROR', text: `Neon could not be read: ${state.providerError.message}` });
  if (state.branch?.mismatch) {
    alerts.push({
      level: 'warning',
      code: 'BRANCH_CHANGED',
      text: `This database now runs on Neon branch ${state.branch.branchId} (for example after a restore); NEON_BRANCH_ID still says ${state.branch.configuredBranchId}. Backups follow the database; update NEON_BRANCH_ID in the server settings.`,
    });
  }
  if (provider.configured && !state.schedule && !state.scheduleError) alerts.push({ level: 'warning', code: 'NO_SCHEDULE', text: 'No backup schedule is set: only manual backups are made.' });
  if (state.scheduleError) alerts.push({ level: 'warning', code: 'SCHEDULE_UNAVAILABLE', text: `The backup schedule could not be read: ${state.scheduleError.message}` });
  if (scheduleOverdue(state.schedule, lastScheduled?.createdAt, now)) {
    alerts.push({ level: 'error', code: 'OVERDUE', text: `The scheduled backup is overdue: the latest one is from ${lastScheduled.createdAt}.` });
  }
  if (lastCreate?.status === 'FAILED') alerts.push({ level: 'error', code: 'LAST_BACKUP_FAILED', text: `The latest manual backup failed: ${lastCreate.errorMessage ?? 'see Backup History'}.` });
  if (lastRestore?.status === 'FAILED') alerts.push({ level: 'error', code: 'RESTORE_FAILED', text: `The latest restore failed: ${lastRestore.errorMessage ?? 'see Restore Management'}.` });
  if (activeRestore?.status === 'VERIFIED' && now - activeRestore.startedAt > DAY_MS) {
    alerts.push({ level: 'warning', code: 'RESTORE_WAITING', text: 'A staged restore has been waiting for a decision for more than a day. Restore production from it or discard it.' });
  }
  if (provider.configured && !lastSuccessful && !state.providerError) alerts.push({ level: 'warning', code: 'NO_BACKUP', text: 'No backup is available yet.' });

  return {
    provider,
    schedule: state.schedule ? { ...state.schedule, text: scheduleText(state.schedule) } : null,
    nextScheduledAt: nextScheduledAt(state.schedule, now)?.toISOString() ?? null,
    settings,
    stats: {
      total: available.length,
      completed: backups.filter((b) => b.status === 'COMPLETED').length,
      failed: failedCount,
      expired: backups.filter((b) => b.status === 'EXPIRED').length,
      storageBytes,
    },
    lastSuccessful,
    latest: backups[0] ?? null,
    runningBackup: runningBackup && { id: runningBackup.id, startedAt: runningBackup.startedAt, type: runningBackup.type },
    activeRestore: activeRestore && { id: activeRestore.id, status: activeRestore.status, snapshotId: activeRestore.snapshotId },
    lastRestore: lastRestore && {
      id: lastRestore.id,
      status: lastRestore.status,
      snapshotId: lastRestore.snapshotId,
      startedAt: lastRestore.startedAt,
      finishedAt: lastRestore.finishedAt,
      requestedBy: lastRestore.requestedByName,
      error: lastRestore.errorMessage,
    },
    alerts,
    coverage: COVERAGE,
  };
}

/** What a backup covers (docs/data-backup/backup-architecture.md → Scope). */
export const COVERAGE = {
  covered: ['The PostgreSQL database of this deployment (all schools, branches, accounts, schedules, attendance, notifications, settings and audit events)'],
  notCovered: [
    'Server configuration and secrets (Vercel environment variables): keep a copy in a password manager',
    'Application code (kept in Git and by Vercel deployments)',
    'Staff app builds and push credentials (Expo/EAS, Firebase)',
    'Off-site copies: snapshots stay inside the Neon project; deleting the project deletes them',
  ],
  files: 'EduTrack stores no uploaded files or documents (logo uploads are not available), so there is no file storage to back up.',
};

// ---- actions ---------------------------------------------------------------------------------

/** "Create Backup Now": a Neon snapshot of the branch now, kept `manualRetentionDays` days. */
export async function createBackupNow(user, req, { now = new Date() } = {}) {
  const prisma = getPrisma();
  if (!neon.providerConfigured()) throw providerHttpError(new neon.ProviderError('NOT_CONFIGURED', 'Backups are not configured on this server.'));
  await refreshBackupOperations({ now });
  const { manualRetentionDays } = await backupSettings(prisma);
  const op = await startOperation({ type: 'CREATE', lane: 'backup', requestedById: user.id, requestedByName: user.name });
  const name = stampName('edutrack-manual', now);
  const expiresAt = new Date(now.getTime() + manualRetentionDays * DAY_MS);
  try {
    const { snapshot, operationIds } = await neon.createSnapshot({ name, expiresAt });
    if (!snapshot.id) throw new neon.ProviderError('PROVIDER_REJECTED', 'Neon returned no snapshot.');
    await prisma.backupRecord.upsert({
      where: { snapshotId: snapshot.id },
      create: { snapshotId: snapshot.id, name: snapshot.name ?? name, kind: 'MANUAL', expiresAt, createdById: user.id, createdByName: user.name },
      update: {},
    });
    const done = !operationIds.length;
    await prisma.backupOperation.update({
      where: { id: op.id },
      data: { snapshotId: snapshot.id, providerOperationIds: operationIds, ...(done && { status: 'COMPLETED', finishedAt: now }) },
    });
    await recordAuditEvent({
      action: AUDIT_ACTIONS.BACKUP_CREATED,
      actor: actorOf(user),
      target: target(snapshot.id, snapshot.name ?? name),
      description: `Manual backup ${snapshot.name ?? name} started (Neon snapshot), kept until ${expiresAt.toISOString().slice(0, 10)}.`,
      req,
    });
    return { operationId: op.id, snapshotId: snapshot.id, status: done ? 'COMPLETED' : 'RUNNING' };
  } catch (error) {
    await prisma.backupOperation.update({ where: { id: op.id }, data: { status: 'FAILED', finishedAt: now, errorCode: error.code ?? 'ERROR', errorMessage: String(error.message).slice(0, 300) } });
    await recordAuditEvent({ action: AUDIT_ACTIONS.BACKUP_CREATED, result: 'FAILURE', actor: actorOf(user), target: target(op.id, 'Manual backup'), description: `Manual backup failed: ${String(error.message).slice(0, 200)}`, req });
    throw providerHttpError(error);
  }
}

export async function getOperation(id) {
  await refreshBackupOperations();
  const op = await getPrisma().backupOperation.findUnique({ where: { id } });
  if (!op || op.lane !== 'backup') throw notFound('Backup operation not found.');
  return { id: op.id, type: op.type, status: op.status, snapshotId: op.snapshotId, startedAt: op.startedAt, finishedAt: op.finishedAt, error: op.errorMessage };
}

async function snapshotOrFail(snapshotId) {
  let snapshots;
  try {
    snapshots = await neon.listSnapshots();
  } catch (error) {
    throw providerHttpError(error);
  }
  const snapshot = snapshots.find((s) => s.id === snapshotId);
  if (!snapshot) throw notFound('Backup not found at Neon (it may have expired or been deleted).');
  return snapshot;
}

/** Protect (no expiry, cannot be deleted) or unprotect (expires `manualRetentionDays` from now). */
export async function setProtection(snapshotId, protect, user, req, { now = new Date() } = {}) {
  const prisma = getPrisma();
  const snapshot = await snapshotOrFail(snapshotId);
  const { manualRetentionDays } = await backupSettings(prisma);
  const expiresAt = protect ? null : new Date(now.getTime() + manualRetentionDays * DAY_MS);
  try {
    await neon.setSnapshotExpiry(snapshotId, expiresAt);
  } catch (error) {
    throw providerHttpError(error);
  }
  const before = await prisma.backupRecord.findUnique({ where: { snapshotId } });
  await prisma.backupRecord.upsert({
    where: { snapshotId },
    create: { snapshotId, name: snapshot.name, kind: snapshot.manual ? 'MANUAL' : 'SCHEDULED', protected: protect, expiresAt },
    update: { protected: protect, expiresAt },
  });
  await recordAuditEvent({
    action: AUDIT_ACTIONS.BACKUP_PROTECTION_CHANGED,
    actor: actorOf(user),
    target: target(snapshotId, snapshot.name),
    description: protect ? `Backup ${snapshot.name} protected: it no longer expires and cannot be deleted.` : `Protection removed from backup ${snapshot.name}: it expires on ${expiresAt.toISOString().slice(0, 10)}.`,
    change: { field: 'Protected', from: before?.protected ? 'Yes' : 'No', to: protect ? 'Yes' : 'No' },
    req,
  });
  return { snapshotId, protected: protect, expiresAt };
}

/** Deletes a backup at Neon. Protected backups, and the backup of an active restore, cannot be deleted. */
export async function deleteBackup(snapshotId, user, req, { now = new Date() } = {}) {
  const prisma = getPrisma();
  const record = await prisma.backupRecord.findUnique({ where: { snapshotId } });
  if (record?.protected) throw conflict('BACKUP_PROTECTED', 'This backup is protected. Remove its protection before deleting it.');
  const snapshot = await snapshotOrFail(snapshotId);
  if (!snapshot.expiresAt && snapshot.manual) {
    // A manual snapshot without expiry (protected here, or made in the Neon console) is treated as protected.
    throw conflict('BACKUP_PROTECTED', 'This backup has no expiry date (protected at Neon). Remove its protection before deleting it.');
  }
  const restoring = await prisma.backupOperation.findFirst({ where: { lane: 'restore', status: { in: ['RUNNING', 'VERIFIED'] }, snapshotId } });
  if (restoring) throw conflict('BACKUP_IN_USE', 'A restore from this backup is in progress. Finish or discard it first.');
  await refreshBackupOperations({ now });
  const op = await startOperation({ type: 'DELETE', lane: 'backup', snapshotId, requestedById: user.id, requestedByName: user.name });
  try {
    const { operationIds } = await neon.deleteSnapshot(snapshotId);
    await prisma.backupOperation.update({ where: { id: op.id }, data: { providerOperationIds: operationIds, status: 'COMPLETED', finishedAt: now } });
  } catch (error) {
    await prisma.backupOperation.update({ where: { id: op.id }, data: { status: 'FAILED', finishedAt: now, errorCode: error.code ?? 'ERROR', errorMessage: String(error.message).slice(0, 300) } });
    await recordAuditEvent({ action: AUDIT_ACTIONS.BACKUP_DELETED, result: 'FAILURE', actor: actorOf(user), target: target(snapshotId, snapshot.name), description: `Deleting backup ${snapshot.name} failed: ${String(error.message).slice(0, 200)}`, req });
    throw providerHttpError(error);
  }
  await prisma.backupRecord.upsert({
    where: { snapshotId },
    create: { snapshotId, name: snapshot.name, kind: snapshot.manual ? 'MANUAL' : 'SCHEDULED', deletedAt: now, deletedByName: user.name },
    update: { deletedAt: now, deletedByName: user.name },
  });
  await recordAuditEvent({ action: AUDIT_ACTIONS.BACKUP_DELETED, actor: actorOf(user), target: target(snapshotId, snapshot.name), description: `Backup ${snapshot.name} deleted at Neon.`, req });
  return { snapshotId, deleted: true };
}

/**
 * Integrity check of a backup at the provider: Neon lists it for this branch, it is complete (no
 * Neon operation running), not expired, and has a size. The full check (restore and read the data)
 * is the staged restore in Restore Management.
 */
export async function verifyBackup(snapshotId, user, req, { now = new Date() } = {}) {
  const prisma = getPrisma();
  await refreshBackupOperations({ now });
  let snapshot = null;
  let listError = null;
  try {
    snapshot = (await neon.listSnapshots()).find((s) => s.id === snapshotId) ?? null;
  } catch (error) {
    listError = error;
  }
  if (listError) throw providerHttpError(listError);
  const running = await prisma.backupOperation.findFirst({ where: { type: 'CREATE', status: 'RUNNING', snapshotId } });
  const checks = [
    { key: 'listed', label: 'Neon lists the snapshot for this database branch', ok: Boolean(snapshot) },
    { key: 'complete', label: 'Snapshot creation finished', ok: Boolean(snapshot) && !running },
    { key: 'unexpired', label: 'Not expired', ok: Boolean(snapshot) && (!snapshot.expiresAt || new Date(snapshot.expiresAt) > now) },
  ];
  const ok = checks.every((c) => c.ok);
  const verification = { level: 'provider', ok, checks, sizeBytes: snapshot?.sizeBytes ?? null, checkedAt: now.toISOString(), checkedBy: user.name };
  if (snapshot) {
    await prisma.backupRecord.upsert({
      where: { snapshotId },
      create: { snapshotId, name: snapshot.name, kind: snapshot.manual ? 'MANUAL' : 'SCHEDULED', verifiedAt: now, verification },
      update: { verifiedAt: now, verification },
    });
  }
  await recordAuditEvent({
    action: AUDIT_ACTIONS.BACKUP_VERIFIED,
    result: ok ? 'SUCCESS' : 'FAILURE',
    actor: actorOf(user),
    target: target(snapshotId, snapshot?.name),
    description: ok ? `Backup ${snapshot.name} checked at Neon: complete and available.` : `Backup check failed: ${checks.filter((c) => !c.ok).map((c) => c.label).join('; ')}.`,
    req,
  });
  return verification;
}

// ---- configuration ---------------------------------------------------------------------------

export async function getConfiguration() {
  const settings = await backupSettings();
  const { schedule, error } = neon.providerConfigured() ? await readSchedule() : { schedule: null, error: null };
  return { schedule: schedule && { ...schedule, text: scheduleText(schedule) }, scheduleError: error, ...settings, provider: neon.providerInfo() };
}

const changesOf = (before, after, labels) =>
  Object.entries(labels)
    .filter(([k]) => after[k] !== undefined && String(before?.[k] ?? '') !== String(after[k] ?? ''))
    .map(([k, field]) => ({ field, from: before?.[k] == null ? '—' : String(before[k]), to: after[k] == null ? '—' : String(after[k]) }));

/**
 * Saves the schedule (at Neon: frequency, hour UTC, day, retention ≤ 35 days) and the manual backup
 * retention (EduTrack). Audited: BACKUP_SCHEDULE_UPDATED and BACKUP_RETENTION_UPDATED.
 */
export async function updateConfiguration(body, user, req) {
  const prisma = getPrisma();
  const current = await getConfiguration();
  const next = readConfiguration(body, current);
  if (next.schedule) {
    if (!neon.providerConfigured()) throw providerHttpError(new neon.ProviderError('NOT_CONFIGURED', 'Backups are not configured on this server.'));
    try {
      await neon.setSchedule({ frequency: next.schedule.frequency, hour: next.schedule.hour, day: next.schedule.day, retentionSeconds: next.schedule.retentionDays * 86400 });
    } catch (error) {
      if (error instanceof neon.ProviderError && error.code === 'PROVIDER_REJECTED') {
        throw new HttpError(502, 'SCHEDULE_REJECTED', `Neon refused the schedule: ${error.message} Scheduled snapshots need a paid Neon plan.`);
      }
      throw providerHttpError(error);
    }
  }
  if (next.manualRetentionDays !== undefined) {
    await prisma.backupSettings.upsert({
      where: { id: 'platform' },
      create: { id: 'platform', manualRetentionDays: next.manualRetentionDays, updatedById: user.id },
      update: { manualRetentionDays: next.manualRetentionDays, updatedById: user.id },
    });
  }
  const scheduleChanges = next.schedule ? changesOf(current.schedule, next.schedule, { frequency: 'Frequency', hour: 'Hour (UTC)', day: 'Day' }) : [];
  const retentionChanges = [
    ...(next.schedule ? changesOf(current.schedule, next.schedule, { retentionDays: 'Scheduled backup retention (days)' }) : []),
    ...(next.manualRetentionDays !== undefined ? changesOf(current, next, { manualRetentionDays: 'Manual backup retention (days)' }) : []),
  ];
  const settingsTarget = { type: 'system', id: 'backup-settings', name: 'Data & Backup settings' };
  if (scheduleChanges.length) {
    await recordAuditEvent({ action: AUDIT_ACTIONS.BACKUP_SCHEDULE_UPDATED, actor: actorOf(user), target: settingsTarget, description: `Backup schedule changed: ${scheduleText(next.schedule)}.`, change: scheduleChanges, req });
  }
  if (retentionChanges.length) {
    await recordAuditEvent({ action: AUDIT_ACTIONS.BACKUP_RETENTION_UPDATED, actor: actorOf(user), target: settingsTarget, description: 'Backup retention changed. Existing backups keep the expiry they were created with.', change: retentionChanges, req });
  }
  return getConfiguration();
}

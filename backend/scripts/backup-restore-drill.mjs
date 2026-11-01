/*
 * Real backup-and-restore drill against Neon (docs/data-backup/testing.md → Real restore drill).
 * Uses the same Neon client and check as the Data & Backup module, on THROWAWAY branches only:
 *
 *   1. creates a drill branch from NEON_BRANCH_ID (the source is only read) and writes a marker;
 *   2. takes a snapshot of the drill branch (a real Neon snapshot);
 *   3. "damages" the drill branch (changes the marker);
 *   4. stages a restore of the snapshot on a new branch and checks it (marker as before the damage,
 *      EduTrack's verification);
 *   5. finalizes the restore into the drill branch and reads it again through the drill branch's
 *      ORIGINAL connection string (the marker is back; the damaged state is kept as the recovery point);
 *   6. deletes everything it created (snapshot and branches), also after a failure.
 *
 * Two modes, chosen by the settings file (run from backend/):
 *   - drill: node --env-file=.env.drill scripts/backup-restore-drill.mjs
 *            a separate, disposable Neon project with its own key: the drill runs on that project's
 *            root branch, which must hold an EduTrack schema (migrations applied).
 *   - dev:   node --env-file=.env.dev scripts/backup-restore-drill.mjs
 *            drill branch created from the dev branch. Neon snapshots ROOT branches only and dev is a
 *            child of production, so this mode stops at the snapshot (confirmed 2026-11-01).
 * Production is never a target: production's branch is resolved from backend/.env's database host,
 * and the drill refuses a project or branch that holds the production or dev database.
 * Prints ids, names, timings and results only (no key, no connection string).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../src/config/env.js';
import * as neon from '../src/features/backups/neon.js';
import { verifyStagedDatabase } from '../src/features/backups/verify.js';
import { stampName } from '../src/features/backups/backupRules.js';

const mode = process.env.EDUTRACK_DB_BRANCH;
if (mode !== 'dev' && mode !== 'drill') throw new Error('Run with --env-file=.env.drill (or .env.dev); the drill never runs with production settings.');
if (!neon.providerConfigured()) throw new Error('Set NEON_API_KEY, NEON_PROJECT_ID and NEON_BRANCH_ID first (docs/data-backup/environment-configuration.md).');

// dev mode: NEON_BRANCH_ID (checked below). Drill mode: the branch .env.drill's database runs on
// (a restore changes the branch id; the module follows the database the same way).
let sourceBranch = env.neonBranchId;
const api = async (path, { method = 'GET', body } = {}) => {
  const response = await fetch(`${env.neonApiUrl}/projects/${env.neonProjectId}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.neonApiKey}`, Accept: 'application/json', ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Neon ${method} ${path} → ${response.status}: ${data?.message ?? ''}`);
  return data;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitOps(ids, label, timeoutMs = 300_000) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const state = await neon.operationsState(ids);
    if (state === 'finished') return;
    if (state === 'failed') throw new Error(`${label}: Neon operation failed`);
    if (Date.now() > until) throw new Error(`${label}: timed out`);
    await sleep(3000);
  }
}
const client = (uri) => new PrismaClient({ adapter: new PrismaPg({ connectionString: uri, connectionTimeoutMillis: 60_000 }) });
const marker = async (db) => (await db.$queryRawUnsafe('SELECT v FROM "_restore_drill" LIMIT 1'))[0]?.v ?? null;

const created = { branches: new Set(), snapshots: new Set() };
const results = [];
const step = async (name, fn) => {
  const started = Date.now();
  try {
    const value = await fn();
    results.push({ step: name, ok: true, seconds: ((Date.now() - started) / 1000).toFixed(1), ...(value && typeof value === 'object' ? value : {}) });
    console.log(`✔ ${name} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    return value;
  } catch (error) {
    results.push({ step: name, ok: false, error: String(error.message).replace(/postgres(ql)?:\/\/\S+/g, '[connection string]') });
    console.log(`✖ ${name}: ${results.at(-1).error}`);
    throw error;
  }
};

// ---- Production guard ------------------------------------------------------------------------
// Production's branch is resolved from production's own database host (backend/.env DIRECT_URL,
// read for its host name only) through the Neon API. The drill refuses to start unless the source
// is the dev branch (the branch of .env.dev's endpoint) and is not production, the default branch
// or a root branch. Every write afterwards is checked to target only a branch the drill created.
const { readFileSync } = await import('node:fs');
const endpointOf = (file) => {
  const url = readFileSync(new URL(file, import.meta.url), 'utf8').match(/^DIRECT_URL="?([^"\n]+)/m)?.[1];
  if (!url) throw new Error(`Cannot read the database host from ${file}: the drill cannot tell production apart, so it stops.`);
  return new URL(url).hostname.split('.')[0].replace(/-pooler$/, '');
};
const refuse = (why) => {
  throw new Error(`Drill refused: ${why}`);
};
const prodEndpoint = endpointOf('../.env');
const devEndpoint = endpointOf('../.env.dev');
const ownEndpoint = new URL(process.env.DIRECT_URL).hostname.split('.')[0].replace(/-pooler$/, '');
const projectEndpoints = (await api('/endpoints')).endpoints;
const projectBranches = (await api('/branches')).branches;
const productionBranch = projectEndpoints.find((e) => e.id === prodEndpoint)?.branch_id ?? null;
const devBranch = projectEndpoints.find((e) => e.id === devEndpoint)?.branch_id ?? null;
if (mode === 'drill') {
  const resolved = projectEndpoints.find((e) => e.id === ownEndpoint)?.branch_id;
  if (resolved && resolved !== sourceBranch) console.log(`Note: .env.drill's database now runs on branch ${resolved} (NEON_BRANCH_ID says ${sourceBranch ?? 'nothing'}, e.g. after an earlier restore).`);
  sourceBranch = resolved ?? sourceBranch;
}
const source = projectBranches.find((b) => b.id === sourceBranch);
if (!source) refuse(`NEON_BRANCH_ID ${sourceBranch} is not a branch of project ${env.neonProjectId}.`);
if (devEndpoint === prodEndpoint) refuse('.env.dev and .env use the same database.');
if (sourceBranch === productionBranch) refuse('NEON_BRANCH_ID is the production branch.');
/** Branches the drill must never write to or delete. */
const untouchable = new Set([productionBranch, devBranch].filter(Boolean));
/** Existing branches the drill may write to (drill project only); deleted only if named after this run. */
const writable = new Set();
if (mode === 'dev') {
  if (devBranch !== sourceBranch) refuse(`NEON_BRANCH_ID is not the branch of the dev database (${devEndpoint}).`);
  if (source.default || !source.parent_id) refuse('NEON_BRANCH_ID is a default or root branch.');
  for (const b of projectBranches.filter((x) => x.default || !x.parent_id)) untouchable.add(b.id);
  untouchable.add(sourceBranch);
} else {
  // Drill project: it must not hold production or dev at all, and .env.drill's database must be its root branch.
  if (productionBranch || devBranch) refuse('this Neon project holds the production or dev database; the drill project must be separate.');
  if ([prodEndpoint, devEndpoint].includes(ownEndpoint)) refuse('.env.drill points at the production or dev database.');
  if (projectEndpoints.find((e) => e.id === ownEndpoint)?.branch_id !== sourceBranch) refuse(".env.drill's database does not belong to NEON_BRANCH_ID.");
  if (source.parent_id) refuse("NEON_BRANCH_ID must be the drill project's root branch (Neon snapshots root branches only).");
  writable.add(sourceBranch);
}
const assertOwn = (branchId, action) => {
  if (!branchId || untouchable.has(branchId) || !(created.branches.has(branchId) || writable.has(branchId))) refuse(`${action} would touch ${branchId}, which the drill did not create.`);
};
console.log(
  mode === 'dev'
    ? `Guard (dev): production ${productionBranch}; source ${sourceBranch} only read; only branches created by this drill are written or deleted.`
    : `Guard (drill project ${env.neonProjectId}): holds neither production nor dev; root branch ${sourceBranch} is disposable; only branches named after this run are deleted.`,
);

const roleName = env.neonRoleName ?? decodeURIComponent(new URL(process.env.DIRECT_URL).username);
const drillName = stampName('edutrack-drill', new Date());

// ---- --module: the same recovery through the Data & Backup module's own code -----------------
// Drill project only. The drill database plays production: the module's services create a backup,
// stage, check and finalize a restore, delete a backup and back up again, writing their records and
// audit events into the drill database, exactly as on the live platform.
if (process.argv.includes('--module')) {
  if (mode !== 'drill') refuse('--module runs only in the drill project (--env-file=.env.drill).');
  const svc = await import('../src/features/backups/backups.service.js');
  const rst = await import('../src/features/backups/restore.service.js');
  const { getPrisma } = await import('../src/config/prisma.js');
  const prisma = getPrisma();
  const admin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN', status: 'ACTIVE' } });
  if (!admin) refuse('the drill database has no active Super Admin.');
  const user = { id: admin.id, name: admin.name, role: admin.role };
  const own = { snapshots: new Set(), branchNames: new Set() };
  const db = client(process.env.DIRECT_URL);
  const until = async (label, fn, timeoutMs = 300_000) => {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const value = await fn();
      if (value) return value;
      if (Date.now() > end) throw new Error(`${label}: timed out`);
      await sleep(3000);
    }
  };
  const t1 = Date.now();
  try {
    await step('Module: write marker "before"', async () => {
      await db.$executeRawUnsafe('DROP TABLE IF EXISTS "_restore_drill"');
      await db.$executeRawUnsafe('CREATE TABLE "_restore_drill" (v text)');
      await db.$executeRawUnsafe(`INSERT INTO "_restore_drill" VALUES ('before')`);
    });
    const first = await step('Module: Create Backup Now (createBackupNow)', async () => {
      const r = await svc.createBackupNow(user, null);
      own.snapshots.add(r.snapshotId);
      const op = await until('backup', async () => {
        const o = await svc.getOperation(r.operationId);
        if (o.status === 'FAILED') throw new Error(`backup failed: ${o.error}`);
        return o.status === 'COMPLETED' && o;
      });
      return { snapshotId: r.snapshotId, operation: op.status };
    });
    await step('Module: damage (marker "after")', () => db.$executeRawUnsafe(`UPDATE "_restore_drill" SET v = 'after'`));
    const staged = await step('Module: stage restore (startRestore) and check (getRestore)', async () => {
      const { id } = await rst.startRestore({ snapshotId: first.snapshotId, confirm: true }, user, null);
      const restore = await until('restore check', async () => {
        const r = await rst.getRestore(id);
        if (r.status === 'FAILED') throw new Error(`restore failed: ${r.error}`);
        return r.status === 'VERIFIED' && r;
      });
      own.branchNames.add(restore.stagedBranch);
      return { restoreId: id, stagedBranch: restore.stagedBranch, checks: restore.verification.checks.map((c) => `${c.ok ? 'ok' : c.warning ? 'warn' : 'FAIL'} ${c.key}`).join(', ') };
    });
    const before = await neon.deploymentBranch({ fresh: true });
    const done = await step('Module: Restore production (finalizeRestore, typed confirmation)', async () => {
      const r = await rst.finalizeRestore(staged.restoreId, { confirmation: 'RESTORE PRODUCTION', snapshotId: first.snapshotId }, user, null);
      if (r.recoveryPoint) own.branchNames.add(r.recoveryPoint);
      if (r.status !== 'COMPLETED') throw new Error(`finalize ended ${r.status}: ${r.error}`);
      return { recoveryPoint: r.recoveryPoint, branchBefore: before.branchId, branchAfter: r.branchAfter };
    });
    await step('Module: data restored, read through the original connection string', async () => {
      let value;
      for (let i = 0; i < 10 && value === undefined; i += 1) value = await marker(db).catch(async () => (await sleep(3000), undefined));
      if (value !== 'before') throw new Error(`marker is ${value}, expected "before"`);
      const op = await prisma.backupOperation.findFirst({ where: { id: staged.restoreId } });
      if (op?.status !== 'COMPLETED') throw new Error(`the restore record in the restored database is ${op?.status ?? 'missing'}`);
      const audit = await prisma.auditEvent.count({ where: { action: 'RESTORE_COMPLETED', targetId: first.snapshotId } });
      if (!audit) throw new Error('RESTORE_COMPLETED audit event missing in the restored database');
    });
    await step('Module: branch id changed and is followed', async () => {
      const after = await neon.deploymentBranch({ fresh: true });
      if (after.branchId === before.branchId) throw new Error('the branch id did not change (unexpected)');
      if (after.branchId !== done.branchAfter) throw new Error(`module reports ${done.branchAfter}, Neon says ${after.branchId}`);
      return { branchNow: after.branchId };
    });
    await step('Module: delete the first backup (deleteBackup)', async () => {
      await svc.deleteBackup(first.snapshotId, user, null);
      own.snapshots.delete(first.snapshotId);
      if ((await neon.listSnapshots()).some((s) => s.id === first.snapshotId)) throw new Error('the snapshot is still listed');
    });
    await step('Module: back up again: the snapshot copies the RESTORED branch', async () => {
      const r = await svc.createBackupNow(user, null);
      own.snapshots.add(r.snapshotId);
      await until('second backup', async () => (await svc.getOperation(r.operationId)).status === 'COMPLETED');
      const snap = (await neon.listSnapshots()).find((s) => s.id === r.snapshotId);
      const now = (await neon.deploymentBranch({ fresh: true })).branchId;
      if (snap?.sourceBranchId !== now) throw new Error(`snapshot source ${snap?.sourceBranchId}, database branch ${now}`);
      return { snapshotId: r.snapshotId, source: snap.sourceBranchId };
    });
    results.push({ step: 'Total (module)', ok: true, seconds: ((Date.now() - t1) / 1000).toFixed(1) });
  } finally {
    await db.$disconnect().catch(() => {});
    for (const id of own.snapshots) await neon.deleteSnapshot(id).catch((e) => console.log(`cleanup: snapshot ${id}: ${e.message}`));
    try {
      const current = (await neon.deploymentBranch({ fresh: true }).catch(() => null))?.branchId;
      const branches = (await api('/branches')).branches;
      // Only the recovery point and staged branches this run created; never the branch the database runs on.
      for (const b of branches.filter((x) => own.branchNames.has(x.name) && x.id !== current && !untouchable.has(x.id))) {
        await neon.deleteBranch(b.id).catch((e) => console.log(`cleanup: branch ${b.name}: ${e.message}`));
      }
    } catch (error) {
      console.log(`cleanup: ${error.message}`);
    }
    await prisma.$disconnect().catch(() => {});
    console.log('\nRESULTS (module)');
    console.log(JSON.stringify({ project: env.neonProjectId, results }, null, 2));
  }
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}

let drill;
let drillDb;
const t0 = Date.now();
try {
  if (mode === 'dev') {
    drill = await step('Create drill branch from the dev branch (source only read)', async () => {
      const data = await api('/branches', { method: 'POST', body: { branch: { parent_id: sourceBranch, name: drillName }, endpoints: [{ type: 'read_write' }] } });
      created.branches.add(data.branch.id);
      await waitOps(data.operations.map((o) => o.id), 'create drill branch');
      return { branchId: data.branch.id, branchName: data.branch.name, endpointId: data.endpoints?.[0]?.id };
    });
  } else {
    drill = { branchId: sourceBranch, branchName: source.name };
  }
  const drillUri = mode === 'dev' ? await neon.connectionUri(drill.branchId, drill.endpointId, { roleName }) : process.env.DIRECT_URL;
  drillDb = client(drillUri);
  await step('Write marker "before" on the drill branch', async () => {
    await drillDb.$executeRawUnsafe('DROP TABLE IF EXISTS "_restore_drill"');
    await drillDb.$executeRawUnsafe('CREATE TABLE "_restore_drill" (v text)');
    await drillDb.$executeRawUnsafe(`INSERT INTO "_restore_drill" VALUES ('before')`);
  });

  assertOwn(drill.branchId, 'Using the drill branch');
  // From here the module's Neon client works on the drill branch (dev mode: a branch the drill created).
  if (mode === 'dev') neon.setBranchOverride(drill.branchId);
  const snap = await step('Take a Neon snapshot of the drill branch', async () => {
    const { snapshot, operationIds } = await neon.createSnapshot({ name: `${drillName}-snapshot`, expiresAt: new Date(Date.now() + 86400_000) });
    created.snapshots.add(snapshot.id);
    await waitOps(operationIds, 'snapshot');
    const listed = (await neon.listSnapshots()).find((s) => s.id === snapshot.id);
    if (!listed) throw new Error('the snapshot is not listed for the drill branch');
    return { snapshotId: snapshot.id, sizeBytes: listed.sizeBytes, sizeKind: listed.sizeKind };
  });

  await step('Damage the drill branch (marker "after")', async () => {
    await drillDb.$executeRawUnsafe(`UPDATE "_restore_drill" SET v = 'after'`);
    if ((await marker(drillDb)) !== 'after') throw new Error('marker not changed');
  });

  const staged = await step('Stage the restore on a new branch', async () => {
    const s = await neon.stageRestore(snap.snapshotId, `${drillName}-restore`);
    created.branches.add(s.branchId);
    await waitOps(s.operationIds, 'stage restore');
    return s;
  });
  await step('Check the staged branch (EduTrack verification + marker)', async () => {
    const e = await neon.ensureEndpoint(staged.branchId);
    await waitOps(e.operationIds, 'staged compute');
    const uri = await neon.connectionUri(staged.branchId, e.endpointId, { roleName });
    const stagedDb = client(uri);
    try {
      const value = await marker(stagedDb);
      if (value !== 'before') throw new Error(`staged marker is ${value}, expected "before"`);
    } finally {
      await stagedDb.$disconnect();
    }
    const verification = await verifyStagedDatabase(uri, { current: drillDb });
    if (e.created) await neon.deleteEndpoint(e.endpointId);
    if (!verification.ok) throw new Error(`verification failed: ${JSON.stringify(verification.checks.filter((c) => !c.ok))}`);
    return { verification: verification.checks.map((c) => `${c.ok ? 'ok' : c.warning ? 'warn' : 'FAIL'} ${c.key}`).join(', ') };
  });

  const preserveName = `${drillName}-before-restore`;
  await step('Finalize the restore into the drill branch (recovery point kept)', async () => {
    await drillDb.$disconnect();
    assertOwn(staged.branchId, 'Finalizing');
    assertOwn((await neon.deploymentBranch({ fresh: true })).branchId, 'Finalizing into');
    const { operationIds } = await neon.finalizeRestore(staged.branchId, preserveName);
    await waitOps(operationIds, 'finalize restore');
    return { recoveryPoint: preserveName };
  });
  await step('Read the drill branch again through its ORIGINAL connection string', async () => {
    let value;
    for (let i = 0; i < 10; i += 1) {
      const db = client(drillUri);
      try {
        value = await marker(db);
        break;
      } catch {
        await sleep(3000);
      } finally {
        await db.$disconnect().catch(() => {});
      }
    }
    if (value !== 'before') throw new Error(`after the restore the marker is ${value}, expected "before"`);
    if (mode === 'drill') {
      // The fix for the changing branch id: the database is now found on the restored branch.
      const after = await neon.deploymentBranch({ fresh: true });
      if (after.branchId !== staged.branchId) throw new Error(`the database's branch is ${after.branchId}, expected the restored branch ${staged.branchId}`);
    }
    const branches = (await api('/branches')).branches;
    const kept = branches.find((b) => b.name === preserveName);
    if (!kept) throw new Error('the recovery-point branch was not found');
    return { recoveryPointBranch: kept.id };
  });
  results.push({ step: 'Total', ok: true, seconds: ((Date.now() - t0) / 1000).toFixed(1) });
} finally {
  await drillDb?.$disconnect().catch(() => {});
  neon.setBranchOverride(null);
  // Clean up everything the drill created (children before parents).
  for (const id of created.snapshots) await neon.deleteSnapshot(id).catch((e) => console.log(`cleanup: snapshot ${id}: ${e.message}`));
  try {
    const branches = (await api('/branches')).branches;
    // Only branches named after this run are deleted (after a finalize, Neon gives the restored branch
    // the original's name and the original the recovery-point name). Never production or dev.
    // Neon refuses to delete a branch that still has children: repeat until nothing is left.
    let left = branches.filter((b) => b.name.startsWith(drillName) && !untouchable.has(b.id)).map((b) => b.id);
    for (let pass = 0; pass < 4 && left.length; pass += 1) {
      const next = [];
      for (const id of left) if (!untouchable.has(id)) await neon.deleteBranch(id).catch(() => next.push(id)); // never production or dev
      left = next;
      if (left.length) await sleep(3000);
    }
    if (left.length) console.log(`cleanup: delete these branches in the Neon console: ${left.join(', ')}`);
  } catch (error) {
    console.log(`cleanup: ${error.message}. Delete branches named ${drillName}* in the Neon console.`);
  }
  console.log('\nRESULTS');
  console.log(JSON.stringify({ drill: drillName, project: env.neonProjectId, source: sourceBranch, results }, null, 2));
}

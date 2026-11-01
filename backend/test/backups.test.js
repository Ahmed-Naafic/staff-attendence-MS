/*
 * Data & Backup (docs/data-backup/): Super Admin authorization, manual backups (confirmation,
 * duplicate prevention, completion, failures), history (filters, pagination, expired and deleted
 * backups), protection and deletion rules, integrity checks, schedule and retention configuration,
 * overdue warnings, and the restore workflow (stage → check → restore production or discard), with
 * audit events and no secrets in any response.
 *
 * MOCKED PROVIDER: Neon's API is replaced by a local HTTP stub (no Neon project is touched). The
 * staged-restore check is real: it reads the Neon dev branch as the "staged" database. These tests do
 * not prove that Neon restores data; the real restore drill is in docs/data-backup/testing.md.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import app from '../src/app.js';
import { env } from '../src/config/env.js';
import { getPrisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/features/auth/password.js';
import { databaseEndpointId, forgetDeploymentBranch } from '../src/features/backups/neon.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Backup tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const KEY = `napi_test${randomBytes(6).toString('hex')}`;
const PROJECT = 'proj-test';
const BRANCH = 'br-production';
const tag = randomBytes(3).toString('hex');
const people = {};
const savedEnv = {};
let server;
let base;
let stub;
let stubUrl;
let savedSettings;
const startedAt = new Date();

// ---- Neon stub -------------------------------------------------------------------------------

function freshNeon() {
  return {
    snapshots: new Map(),
    ops: new Map(),
    branches: new Map(),
    endpoints: new Map(),
    schedule: [],
    calls: [],
    finalized: [],
    failNext: new Map(), // "METHOD path-prefix" → [status, message]
    opStatus: 'finished', // status of new operations
    seq: 0,
    rejectSchedule: false,
    // As at Neon: this server's database endpoint belongs to a branch, and a finalized restore moves it.
    currentBranch: BRANCH,
    endpointKnown: true,
  };
}
let neonState = freshNeon();

const op = (action) => {
  neonState.seq += 1;
  const id = `op-${neonState.seq}`;
  neonState.ops.set(id, { id, action, status: neonState.opStatus });
  return { id, action, status: neonState.opStatus };
};

function addSnapshot({ id, name, createdAt = new Date(), manual = true, expiresAt = null, size = 1024, source = BRANCH }) {
  neonState.snapshots.set(id, {
    id,
    name: name ?? id,
    source_branch_id: source,
    created_at: createdAt.toISOString(),
    expires_at: expiresAt ? expiresAt.toISOString() : null,
    manual,
    ...(manual ? { full_size: size } : { diff_size: size }),
  });
}

async function neonHandler(req, res) {
  const url = new URL(req.url, 'http://stub');
  let body = '';
  for await (const chunk of req) body += chunk;
  const json = body ? JSON.parse(body) : null;
  const send = (status, data) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(data === undefined ? '' : JSON.stringify(data));
  };
  neonState.calls.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body: json, auth: req.headers.authorization });
  if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { message: 'authentication required' });
  for (const [key, [status, message]] of neonState.failNext) {
    const [method, prefix] = key.split(' ');
    if (req.method === method && url.pathname.startsWith(prefix)) {
      neonState.failNext.delete(key);
      return send(status, { message });
    }
  }
  const p = url.pathname.replace(`/projects/${PROJECT}`, '');
  let m;
  if (req.method === 'GET' && p === '/snapshots') return send(200, { snapshots: [...neonState.snapshots.values()] });
  if (req.method === 'GET' && (m = p.match(/^\/endpoints\/([^/]+)$/))) {
    if (!neonState.endpointKnown || m[1] !== databaseEndpointId()) return send(404, { message: 'endpoint not found' });
    return send(200, { endpoint: { id: m[1], branch_id: neonState.currentBranch, type: 'read_write' } });
  }
  if (req.method === 'POST' && (m = p.match(/^\/branches\/([^/]+)\/snapshot$/))) {
    if (m[1] !== neonState.currentBranch) return send(400, { message: `stub: snapshot of ${m[1]}, but the database runs on ${neonState.currentBranch}` });
    neonState.seq += 1;
    const id = `snap-${tag}-${neonState.seq}`;
    addSnapshot({ id, name: url.searchParams.get('name'), source: m[1], expiresAt: url.searchParams.get('expires_at') ? new Date(url.searchParams.get('expires_at')) : null });
    const { full_size: _size, ...snapshot } = neonState.snapshots.get(id);
    return send(201, { snapshot, operations: [op('timeline_archive')] });
  }
  if ((m = p.match(/^\/snapshots\/([^/]+)$/))) {
    if (!neonState.snapshots.has(m[1])) return send(404, { message: 'snapshot not found' });
    if (req.method === 'PATCH') {
      neonState.snapshots.get(m[1]).expires_at = json.snapshot.expires_at;
      return send(200, { snapshot: neonState.snapshots.get(m[1]) });
    }
    if (req.method === 'DELETE') {
      neonState.snapshots.delete(m[1]);
      return send(200, { operations: [op('delete_snapshot')] });
    }
  }
  if ((m = p.match(/^\/operations\/([^/]+)$/))) return send(200, { operation: neonState.ops.get(m[1]) ?? { status: 'finished' } });
  if (p === `/branches/${neonState.currentBranch}/backup_schedule`) {
    if (req.method === 'GET') return send(200, { schedule: neonState.schedule });
    if (neonState.rejectSchedule) return send(400, { message: 'scheduled snapshots are not available on the free plan' });
    neonState.schedule = json.schedule;
    return send(200, {});
  }
  if (req.method === 'POST' && (m = p.match(/^\/snapshots\/([^/]+)\/restore$/))) {
    if (!neonState.snapshots.has(m[1])) return send(404, { message: 'snapshot not found' });
    neonState.seq += 1;
    const branch = { id: `br-restore-${neonState.seq}`, name: json.name, restore_status: 'restored' };
    neonState.branches.set(branch.id, branch);
    return send(201, { branch, endpoints: [], operations: [op('create_branch')] });
  }
  if (req.method === 'GET' && (m = p.match(/^\/branches\/([^/]+)\/endpoints$/))) return send(200, { endpoints: [...neonState.endpoints.values()].filter((e) => e.branch_id === m[1]) });
  if (req.method === 'POST' && p === '/endpoints') {
    neonState.seq += 1;
    const endpoint = { id: `ep-${neonState.seq}`, branch_id: json.endpoint.branch_id, type: json.endpoint.type };
    neonState.endpoints.set(endpoint.id, endpoint);
    return send(201, { endpoint, operations: [op('start_compute')] });
  }
  if (req.method === 'DELETE' && (m = p.match(/^\/endpoints\/([^/]+)$/))) {
    neonState.endpoints.delete(m[1]);
    return send(200, { operations: [] });
  }
  if (req.method === 'GET' && p === '/connection_uri') {
    // The "staged branch" is the dev branch itself: the check really connects and reads it.
    return send(200, { uri: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
  }
  if (req.method === 'POST' && (m = p.match(/^\/branches\/([^/]+)\/finalize_restore$/))) {
    neonState.finalized.push({ branchId: m[1], name: json?.name });
    neonState.currentBranch = m[1]; // the restored branch takes over the endpoint; the old id is the recovery point
    return send(200, { operations: [op('finalize_restore')] });
  }
  if (req.method === 'DELETE' && (m = p.match(/^\/branches\/([^/]+)$/))) {
    if (!neonState.branches.delete(m[1])) return send(404, { message: 'branch not found' });
    return send(200, { operations: [op('delete_branch')] });
  }
  return send(404, { message: `stub: no route ${req.method} ${url.pathname}` });
}

// ---- helpers ---------------------------------------------------------------------------------

async function call(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(method !== 'GET' && { origin: ORIGIN }), ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  // No response may ever carry the API key or a connection string.
  assert.ok(!text.includes(KEY), `${method} ${path} leaked the API key`);
  assert.ok(!/postgres(ql)?:\/\//i.test(text), `${method} ${path} leaked a connection string`);
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const as = (key, path, options = {}) => call(path, { ...options, cookie: people[key]?.cookie });
const admin = (path, options) => as('admin', path, options);

async function webUser(key, role, extra = {}) {
  const password = `pw-${randomBytes(9).toString('base64url')}`;
  const user = await prisma.user.create({ data: { name: `Backup ${key} ${tag}`, email: `test-backup-${key.toLowerCase()}-${tag}@test.edutrack.example`, role, passwordHash: await hashPassword(password), ...extra } });
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email: user.email, password }) });
  assert.equal(res.status, 200, `${key} sign-in`);
  people[key] = { ...user, cookie: res.headers.get('set-cookie').split(';')[0] };
  return people[key];
}

const audits = (action) => prisma.auditEvent.findMany({ where: { action, occurredAt: { gte: startedAt }, actorName: { contains: tag } }, orderBy: { occurredAt: 'asc' } });
const configure = () => Object.assign(env, { neonApiKey: KEY, neonProjectId: PROJECT, neonBranchId: BRANCH, neonApiUrl: stubUrl });
async function clearOperations() {
  await prisma.backupOperation.deleteMany({ where: { requestedByName: { contains: tag } } });
  await prisma.backupRecord.deleteMany({ where: { snapshotId: { contains: tag } } });
}

before(async () => {
  for (const k of ['neonApiKey', 'neonProjectId', 'neonBranchId', 'neonApiUrl']) savedEnv[k] = env[k];
  stub = createServer((req, res) => neonHandler(req, res).catch((e) => { res.writeHead(500); res.end(String(e)); }));
  await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve));
  stubUrl = `http://127.0.0.1:${stub.address().port}`;
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  const active = await prisma.backupOperation.count({ where: { status: { in: ['RUNNING', 'VERIFIED'] } } });
  if (active) throw new Error('The dev database has an active backup or restore operation; finish it before running these tests.');
  savedSettings = await prisma.backupSettings.findUnique({ where: { id: 'platform' } });
  await prisma.backupSettings.deleteMany({ where: { id: 'platform' } });
  await webUser('admin', 'SUPER_ADMIN');
  await webUser('owner', 'OWNER');
});

beforeEach(async () => {
  neonState = freshNeon();
  configure();
  forgetDeploymentBranch();
  await clearOperations();
});

after(async () => {
  Object.assign(env, savedEnv);
  await clearOperations();
  await prisma.backupSettings.deleteMany({ where: { id: 'platform' } });
  if (savedSettings) await prisma.backupSettings.create({ data: savedSettings });
  const ids = Object.values(people).map((p) => p.id);
  await prisma.auditEvent.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { actorName: { contains: tag } }] } });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  server?.close();
  stub?.close();
});

// ---- tests -----------------------------------------------------------------------------------

describe('authorization', () => {
  test('only a Super Admin reaches Data & Backup; signed out → 401', async () => {
    assert.equal((await call('/api/platform/backups/overview')).status, 401);
    for (const [method, path, body] of [
      ['GET', '/api/platform/backups/overview'],
      ['GET', '/api/platform/backups'],
      ['POST', '/api/platform/backups', { confirm: true }],
      ['PUT', '/api/platform/backups/configuration', { hour: 3 }],
      ['POST', '/api/platform/backups/restores', { snapshotId: 'x', confirm: true }],
      ['POST', '/api/platform/backups/restores/00000000-0000-4000-8000-000000000000/finalize', { confirmation: 'RESTORE PRODUCTION' }],
      ['DELETE', '/api/platform/backups/snap-x'],
    ]) {
      assert.equal((await as('owner', path, { method, body })).status, 403, `${method} ${path}`);
    }
    assert.equal(neonState.calls.length, 0, 'Neon was never called for a refused request');
  });
});

describe('not configured', () => {
  test('without the Neon settings the page says so and nothing can be created', async () => {
    Object.assign(env, { neonApiKey: undefined });
    const overview = await admin('/api/platform/backups/overview');
    assert.equal(overview.status, 200);
    assert.equal(overview.body.provider.configured, false);
    assert.ok(overview.body.alerts.some((a) => a.code === 'NOT_CONFIGURED'));
    assert.equal(overview.body.coverage.covered.length, 1);
    const create = await admin('/api/platform/backups', { method: 'POST', body: { confirm: true } });
    assert.equal(create.status, 503);
    assert.equal(create.body.code, 'BACKUPS_NOT_CONFIGURED');
  });
});

describe('manual backup', () => {
  test('confirmation, Neon snapshot with retention, one at a time, completion and audit', async () => {
    assert.equal((await admin('/api/platform/backups', { method: 'POST', body: {} })).status, 400);
    neonState.opStatus = 'running';
    const started = await admin('/api/platform/backups', { method: 'POST', body: { confirm: true } });
    assert.equal(started.status, 202);
    assert.equal(started.body.status, 'RUNNING');
    const call = neonState.calls.find((c) => c.method === 'POST' && c.path.endsWith('/snapshot'));
    assert.match(call.query.name, /^edutrack-manual-\d{8}-\d{6}$/);
    const days = (new Date(call.query.expires_at) - Date.now()) / 86400000;
    assert.ok(days > 29.9 && days <= 30, 'kept 30 days by default');
    assert.equal(call.auth, `Bearer ${KEY}`);

    const again = await admin('/api/platform/backups', { method: 'POST', body: { confirm: true } });
    assert.equal(again.status, 409);
    assert.equal(again.body.code, 'BACKUP_IN_PROGRESS');
    assert.equal(neonState.calls.filter((c) => c.path.endsWith('/snapshot')).length, 1, 'no second snapshot');

    let list = await admin('/api/platform/backups');
    assert.equal(list.body.items[0].status, 'RUNNING');
    for (const o of neonState.ops.values()) o.status = 'finished';
    const done = await admin(`/api/platform/backups/operations/${started.body.operationId}`);
    assert.equal(done.body.status, 'COMPLETED');
    list = await admin('/api/platform/backups');
    assert.equal(list.body.items[0].status, 'COMPLETED');
    assert.equal(list.body.items[0].createdBy, people.admin.name);
    assert.equal(list.body.items[0].kind, 'MANUAL');
    assert.equal(list.body.items[0].sizeBytes, 1024);
    const [audit] = await audits('BACKUP_CREATED');
    assert.equal(audit.result, 'SUCCESS');
    assert.equal(audit.targetId, started.body.snapshotId);
    assert.ok(!JSON.stringify(audit).includes(KEY));
  });

  test('a Neon failure is recorded (FAILED, audit, warning) and the next backup is allowed', async () => {
    neonState.failNext.set(`POST /projects/${PROJECT}/branches/${BRANCH}/snapshot`, [500, 'internal error']);
    const failed = await admin('/api/platform/backups', { method: 'POST', body: { confirm: true } });
    assert.equal(failed.status, 503);
    const list = await admin('/api/platform/backups?status=FAILED');
    assert.equal(list.body.total, 1);
    assert.match(list.body.items[0].error, /Neon is unavailable/);
    const overview = await admin('/api/platform/backups/overview');
    assert.ok(overview.body.alerts.some((a) => a.code === 'LAST_BACKUP_FAILED'));
    assert.equal(overview.body.stats.failed >= 1, true);
    assert.equal((await audits('BACKUP_CREATED')).at(-1).result, 'FAILURE');
    assert.equal((await admin('/api/platform/backups', { method: 'POST', body: { confirm: true } })).status, 202, 'the next backup is allowed');
  });

  test('a refused API key is reported without the key', async () => {
    Object.assign(env, { neonApiKey: `${KEY}-wrong` });
    const res = await admin('/api/platform/backups', { method: 'POST', body: { confirm: true } });
    assert.equal(res.status, 502);
    assert.equal(res.body.code, 'PROVIDER_UNAUTHORIZED');
    assert.ok(!res.body.error.includes('wrong'));
  });

  test('an action right after a backup finished at Neon is not blocked by its stale RUNNING record', async () => {
    // As after a production restore: the database holds a backup's record from before Neon finished it.
    neonState.opStatus = 'running';
    const started = await admin('/api/platform/backups', { method: 'POST', body: { confirm: true } });
    for (const o of neonState.ops.values()) o.status = 'finished';
    const deleted = await admin(`/api/platform/backups/${started.body.snapshotId}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  });

  test('a backup running too long fails (2 h)', async () => {
    neonState.opStatus = 'running';
    const started = await admin('/api/platform/backups', { method: 'POST', body: { confirm: true } });
    await prisma.backupOperation.update({ where: { id: started.body.operationId }, data: { startedAt: new Date(Date.now() - 3 * 3600_000) } });
    const op = await admin(`/api/platform/backups/operations/${started.body.operationId}`);
    assert.equal(op.body.status, 'FAILED');
    assert.match(op.body.error, /2 hours/);
  });
});

describe('history, protection and deletion', () => {
  test('filters, pagination, expired and deleted backups, protection rules', async () => {
    const now = Date.now();
    for (let i = 0; i < 12; i += 1) addSnapshot({ id: `snap-${tag}-h${i}`, createdAt: new Date(now - (i + 1) * 3600_000), manual: i % 3 === 0, expiresAt: i % 3 === 0 ? new Date(now + 86400_000) : null });
    await prisma.backupRecord.create({ data: { snapshotId: `snap-${tag}-gone`, name: 'old', kind: 'MANUAL', expiresAt: new Date(now - 86400_000), createdAt: new Date(now - 40 * 86400_000) } });
    const page1 = await admin('/api/platform/backups?pageSize=5');
    assert.equal(page1.body.total, 13);
    assert.equal(page1.body.items.length, 5);
    assert.equal((await admin('/api/platform/backups?pageSize=5&page=3')).body.items.length, 3);
    assert.equal((await admin('/api/platform/backups?kind=SCHEDULED')).body.total, 8);
    const expired = await admin('/api/platform/backups?status=EXPIRED');
    assert.equal(expired.body.total, 1);
    assert.equal(expired.body.items[0].id, `snap-${tag}-gone`);
    assert.equal((await admin('/api/platform/backups?status=BOGUS')).status, 400);

    const id = `snap-${tag}-h0`;
    assert.equal((await admin(`/api/platform/backups/${id}/protection`, { method: 'POST', body: { protected: true } })).status, 200);
    assert.equal(neonState.snapshots.get(id).expires_at, null, 'no expiry at Neon');
    const refused = await admin(`/api/platform/backups/${id}`, { method: 'DELETE' });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'BACKUP_PROTECTED');
    assert.ok(neonState.snapshots.has(id));
    const off = await admin(`/api/platform/backups/${id}/protection`, { method: 'POST', body: { protected: false } });
    assert.ok(new Date(off.body.expiresAt) > new Date());
    assert.ok(neonState.snapshots.get(id).expires_at);
    assert.equal((await admin(`/api/platform/backups/${id}`, { method: 'DELETE' })).status, 200);
    assert.ok(!neonState.snapshots.has(id));
    const deleted = await admin('/api/platform/backups?status=DELETED');
    assert.equal(deleted.body.items[0].id, id);
    assert.equal(deleted.body.items[0].deletedBy, people.admin.name);
    assert.equal((await audits('BACKUP_PROTECTION_CHANGED')).filter((e) => e.targetId === id).length, 2);
    assert.equal((await audits('BACKUP_DELETED')).filter((e) => e.targetId === id).length, 1);
    assert.equal((await admin('/api/platform/backups/snap-unknown', { method: 'DELETE' })).status, 404);
  });

  test('integrity check: complete and available, or failed for a missing backup', async () => {
    addSnapshot({ id: `snap-${tag}-v`, expiresAt: new Date(Date.now() + 86400_000) });
    const ok = await admin(`/api/platform/backups/snap-${tag}-v/verify`, { method: 'POST', body: {} });
    assert.equal(ok.body.verification.ok, true);
    assert.equal(ok.body.verification.level, 'provider');
    const missing = await admin(`/api/platform/backups/snap-${tag}-none/verify`, { method: 'POST', body: {} });
    assert.equal(missing.body.verification.ok, false);
    const events = await audits('BACKUP_VERIFIED');
    assert.deepEqual(events.map((e) => e.result), ['SUCCESS', 'FAILURE']);
  });
});

describe('configuration and overview', () => {
  test('schedule and retention: validation, saved at Neon, audited separately', async () => {
    const bad = await admin('/api/platform/backups/configuration', { method: 'PUT', body: { frequency: 'hourly', retentionDays: 40, manualRetentionDays: 0 } });
    assert.equal(bad.status, 400);
    assert.deepEqual(Object.keys(bad.body.details).sort(), ['frequency', 'manualRetentionDays', 'retentionDays']);
    assert.equal((await admin('/api/platform/backups/configuration', { method: 'PUT', body: { password: 'x' } })).status, 400);
    const saved = await admin('/api/platform/backups/configuration', { method: 'PUT', body: { frequency: 'weekly', day: 1, hour: 2, retentionDays: 21, manualRetentionDays: 60 } });
    assert.equal(saved.status, 200);
    assert.deepEqual(neonState.schedule, [{ frequency: 'weekly', hour: 2, day: 1, retention_seconds: 21 * 86400 }]);
    assert.equal(saved.body.manualRetentionDays, 60);
    assert.equal(saved.body.schedule.text, 'Weekly on Monday at 02:00 UTC');
    assert.equal((await audits('BACKUP_SCHEDULE_UPDATED')).length, 1);
    const [retention] = await audits('BACKUP_RETENTION_UPDATED');
    assert.deepEqual(retention.change.map((c) => c.field).sort(), ['Manual backup retention (days)', 'Scheduled backup retention (days)']);
    neonState.rejectSchedule = true;
    const rejected = await admin('/api/platform/backups/configuration', { method: 'PUT', body: { hour: 4 } });
    assert.equal(rejected.status, 502);
    assert.equal(rejected.body.code, 'SCHEDULE_REJECTED');
    assert.match(rejected.body.error, /paid Neon plan/);
  });

  test('overview: last backup, next run, storage, overdue warning', async () => {
    neonState.schedule = [{ frequency: 'daily', hour: 2, retention_seconds: 14 * 86400 }];
    addSnapshot({ id: `snap-${tag}-s1`, manual: false, createdAt: new Date(Date.now() - 50 * 3600_000), size: 2048 });
    addSnapshot({ id: `snap-${tag}-m1`, manual: true, createdAt: new Date(Date.now() - 3600_000), expiresAt: new Date(Date.now() + 86400_000), size: 1000 });
    const { body } = await admin('/api/platform/backups/overview');
    assert.equal(body.schedule.text, 'Daily at 02:00 UTC');
    assert.equal(new Date(body.nextScheduledAt).getUTCHours(), 2);
    assert.ok(new Date(body.nextScheduledAt) > new Date());
    assert.equal(body.lastSuccessful.id, `snap-${tag}-m1`);
    assert.equal(body.stats.total, 2);
    assert.equal(body.stats.storageBytes, 3048);
    assert.ok(body.alerts.some((a) => a.code === 'OVERDUE'), 'scheduled backup 50 h old is overdue');
  });
});

describe('restore', () => {
  test('stage → check → restore production, with confirmations, one restore at a time, audit', async () => {
    addSnapshot({ id: `snap-${tag}-r`, expiresAt: new Date(Date.now() + 86400_000) });
    assert.equal((await admin('/api/platform/backups/restores', { method: 'POST', body: { snapshotId: `snap-${tag}-r` } })).status, 400);
    assert.equal((await admin('/api/platform/backups/restores', { method: 'POST', body: { snapshotId: `snap-${tag}-none`, confirm: true } })).status, 404);
    const staged = await admin('/api/platform/backups/restores', { method: 'POST', body: { snapshotId: `snap-${tag}-r`, confirm: true } });
    assert.equal(staged.status, 202);
    const id = staged.body.restore.id;
    const [stagedBranchId] = neonState.branches.keys();
    const restoreCall = neonState.calls.find((c) => c.path.endsWith('/restore'));
    assert.equal(restoreCall.body.finalize_restore, false, 'staged on a new branch, never in place');
    assert.equal(restoreCall.body.target_branch_id, BRANCH);

    const second = await admin('/api/platform/backups/restores', { method: 'POST', body: { snapshotId: `snap-${tag}-r`, confirm: true } });
    assert.equal(second.body.code, 'RESTORE_IN_PROGRESS');
    assert.equal((await admin(`/api/platform/backups/snap-${tag}-r`, { method: 'DELETE' })).body.code, 'BACKUP_IN_USE');
    assert.equal((await admin(`/api/platform/backups/restores/${id}/finalize`, { method: 'POST', body: { confirmation: 'RESTORE PRODUCTION', snapshotId: `snap-${tag}-r` } })).body.code, 'NOT_VERIFIED');

    // Page loads advance the check: compute started, then the staged database is read.
    let restore = (await admin(`/api/platform/backups/restores/${id}`)).body.restore;
    assert.equal(restore.status, 'RUNNING');
    assert.equal(restore.phase, 'starting compute');
    restore = (await admin(`/api/platform/backups/restores/${id}`)).body.restore;
    assert.equal(restore.status, 'VERIFIED', JSON.stringify(restore));
    assert.equal(restore.verification.ok, true);
    assert.ok(restore.verification.counts.User.backup > 0);
    assert.ok(restore.verification.checks.find((c) => c.key === 'admin').ok);
    assert.equal(neonState.endpoints.size, 0, 'the compute added for the check was removed');
    assert.equal(neonState.finalized.length, 0, 'reading and checking never touch production');

    const wrong = await admin(`/api/platform/backups/restores/${id}/finalize`, { method: 'POST', body: { confirmation: 'restore production', snapshotId: `snap-${tag}-r` } });
    assert.equal(wrong.status, 400);
    assert.ok(wrong.body.details.confirmation);
    assert.equal(neonState.finalized.length, 0);

    const done = await admin(`/api/platform/backups/restores/${id}/finalize`, { method: 'POST', body: { confirmation: 'RESTORE PRODUCTION', snapshotId: `snap-${tag}-r` } });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.restore.status, 'COMPLETED');
    assert.match(done.body.restore.recoveryPoint, /^edutrack-before-restore-/);
    assert.deepEqual(neonState.finalized, [{ branchId: stagedBranchId, name: done.body.restore.recoveryPoint }], 'the staged branch replaces production, the old one is kept');
    for (const action of ['RESTORE_STARTED', 'RESTORE_VERIFIED', 'RESTORE_PRODUCTION_STARTED', 'RESTORE_COMPLETED']) assert.equal((await audits(action)).length, 1, action);
    const overview = await admin('/api/platform/backups/overview');
    assert.equal(overview.body.lastRestore.status, 'COMPLETED');
    assert.equal(overview.body.activeRestore, null);

    // After the switch the database runs on the restored branch (new id): backups follow it.
    assert.equal(done.body.restore.branchAfter, stagedBranchId);
    assert.equal(overview.body.provider.branchId, stagedBranchId);
    assert.ok(overview.body.alerts.some((a) => a.code === 'BRANCH_CHANGED'), 'NEON_BRANCH_ID still names the old branch');
    const [completed] = await audits('RESTORE_COMPLETED');
    assert.match(completed.description, new RegExp(`set NEON_BRANCH_ID to it`));
    const next = await admin('/api/platform/backups', { method: 'POST', body: { confirm: true } });
    assert.equal(next.status, 202);
    assert.equal(neonState.snapshots.get(next.body.snapshotId).source_branch_id, stagedBranchId, 'the next backup copies the restored database, not the recovery point');
    const history = await admin('/api/platform/backups');
    assert.ok(history.body.items.some((b) => b.id === `snap-${tag}-r`), 'backups taken before the restore are still listed');
    Object.assign(env, { neonBranchId: stagedBranchId });
    assert.ok(!(await admin('/api/platform/backups/overview')).body.alerts.some((a) => a.code === 'BRANCH_CHANGED'), 'no warning once NEON_BRANCH_ID is updated');
  });

  test("a database that is not a compute of the Neon project is reported, and nothing is created", async () => {
    neonState.endpointKnown = false;
    const overview = await admin('/api/platform/backups/overview');
    assert.ok(overview.body.alerts.some((a) => a.code === 'PROVIDER_ERROR' && /not a compute of Neon project/.test(a.text)));
    const create = await admin('/api/platform/backups', { method: 'POST', body: { confirm: true } });
    assert.equal(create.status, 503);
    assert.equal(neonState.calls.filter((c) => c.path.endsWith('/snapshot')).length, 0);
  });

  test('discard removes the staged branch; Neon refusing the switch leaves production unchanged', async () => {
    addSnapshot({ id: `snap-${tag}-d`, expiresAt: new Date(Date.now() + 86400_000) });
    const staged = await admin('/api/platform/backups/restores', { method: 'POST', body: { snapshotId: `snap-${tag}-d`, confirm: true } });
    const branchId = [...neonState.branches.keys()][0];
    const discarded = await admin(`/api/platform/backups/restores/${staged.body.restore.id}/discard`, { method: 'POST', body: {} });
    assert.equal(discarded.body.restore.status, 'DISCARDED');
    assert.ok(!neonState.branches.has(branchId));
    assert.equal((await audits('RESTORE_DISCARDED')).length, 1);

    const again = await admin('/api/platform/backups/restores', { method: 'POST', body: { snapshotId: `snap-${tag}-d`, confirm: true } });
    const id = again.body.restore.id;
    await admin(`/api/platform/backups/restores/${id}`);
    assert.equal((await admin(`/api/platform/backups/restores/${id}`)).body.restore.status, 'VERIFIED');
    neonState.failNext.set(`POST /projects/${PROJECT}/branches/`, [423, 'project is locked by another operation']);
    const refused = await admin(`/api/platform/backups/restores/${id}/finalize`, { method: 'POST', body: { confirmation: 'RESTORE PRODUCTION', snapshotId: `snap-${tag}-d` } });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'PROVIDER_BUSY');
    assert.equal((await admin(`/api/platform/backups/restores/${id}`)).body.restore.status, 'VERIFIED', 'kept for another attempt');
    const [failure] = await audits('RESTORE_FAILED');
    assert.match(failure.description, /Production was not changed/);
    await admin(`/api/platform/backups/restores/${id}/discard`, { method: 'POST', body: {} });
  });

  test('a failed Neon restore fails the operation and frees the lane', async () => {
    addSnapshot({ id: `snap-${tag}-f`, expiresAt: new Date(Date.now() + 86400_000) });
    neonState.opStatus = 'failed';
    const staged = await admin('/api/platform/backups/restores', { method: 'POST', body: { snapshotId: `snap-${tag}-f`, confirm: true } });
    const restore = (await admin(`/api/platform/backups/restores/${staged.body.restore.id}`)).body.restore;
    assert.equal(restore.status, 'FAILED');
    assert.equal(neonState.branches.size, 0, 'the failed staged branch was removed');
    assert.equal((await admin('/api/platform/backups/overview')).body.alerts.some((a) => a.code === 'RESTORE_FAILED'), true);
    neonState.opStatus = 'finished';
    assert.equal((await admin('/api/platform/backups/restores', { method: 'POST', body: { snapshotId: `snap-${tag}-f`, confirm: true } })).status, 202);
    const list = await admin('/api/platform/backups/restores');
    await admin(`/api/platform/backups/restores/${list.body.items[0].id}/discard`, { method: 'POST', body: {} });
  });
});

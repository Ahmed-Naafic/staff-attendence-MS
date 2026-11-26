/*
 * Examination paper files through the shared storage layer (docs/storage/supabase-storage.md):
 * upload / verify / replace / download / remove, school isolation, branch and role authorization,
 * audit, and consistency between Neon records and stored objects. Supabase is replaced by an
 * in-memory stand-in (setStorageBackend); nothing here talks to a real Supabase project.
 * Runs on the Neon dev branch (`npm test`); everything it creates is removed afterwards.
 */
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import app from '../src/app.js';
import { setStorageBackend } from '../src/common/storage/storageService.js';
import { StorageBackendError } from '../src/common/storage/supabaseBackend.js';
import { env } from '../src/config/env.js';
import { getPrisma } from '../src/config/prisma.js';
import { calendarToday } from '../src/features/academic-calendar/calendar.service.js';
import { addDays, asDbDay } from '../src/features/academic-calendar/schoolDays.js';
import { hashPassword } from '../src/features/auth/password.js';
import { resetLimiter } from '../src/features/auth/rateLimit.js';
import { sweepExamPaperFiles } from '../src/features/examinations/examFiles.service.js';
import { branchFor, removeTestBranches } from './support/testBranch.js';

if (process.env.EDUTRACK_DB_BRANCH !== 'dev') throw new Error('Examination tests only run against the Neon dev branch (npm test).');

const prisma = getPrisma();
const ORIGIN = 'http://localhost:5173';
const tag = randomBytes(3).toString('hex').toUpperCase();
const lower = tag.toLowerCase();
const KEY = `sb_secret_test_${tag}`;
const cookies = {};
const schools = {};
const branches = {};
const ctx = {};
let server;
let base;
const saved = {};

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const EXE = Buffer.from('MZ\x90\x00\x03\x00\x00\x00 this is not a pdf');

// ---- the Supabase stand-in -------------------------------------------------------------------
const store = {
  bucket: { name: 'edutrack-files', public: false },
  objects: new Map(), // `${bucket}/${key}` → Buffer
  calls: [],
  fail: {}, // operation → kind, once
  pendingUploads: new Map(), // url → { bucket, key }
};
const take = (op) => {
  const kind = store.fail[op];
  if (kind) {
    delete store.fail[op];
    throw new StorageBackendError(kind, op);
  }
};
const fake = {
  async getBucket(bucket) {
    store.calls.push(['getBucket', bucket]);
    take('getBucket');
    if (!store.bucket || store.bucket.name !== bucket) throw new StorageBackendError('not_found', 'bucket check');
    return { public: store.bucket.public };
  },
  async createUploadUrl(bucket, key) {
    store.calls.push(['createUploadUrl', bucket, key]);
    take('createUploadUrl');
    const url = `https://storage.test/storage/v1/object/upload/sign/${bucket}/${key}?token=${randomBytes(4).toString('hex')}`;
    store.pendingUploads.set(url, { bucket, key });
    return { url };
  },
  async stat(bucket, key) {
    store.calls.push(['stat', bucket, key]);
    take('stat');
    const o = store.objects.get(`${bucket}/${key}`);
    return o ? { size: o.length, contentType: null } : null;
  },
  async readHead(bucket, key, n) {
    take('readHead');
    const o = store.objects.get(`${bucket}/${key}`);
    if (!o) throw new StorageBackendError('not_found', 'read');
    return o.subarray(0, n);
  },
  async createDownloadUrl(bucket, key, seconds, { download } = {}) {
    store.calls.push(['createDownloadUrl', bucket, key, seconds, download]);
    take('createDownloadUrl');
    if (!store.objects.has(`${bucket}/${key}`)) throw new StorageBackendError('not_found', 'download link');
    return `https://storage.test/storage/v1/object/sign/${bucket}/${key}?token=down${download ? `&download=${encodeURIComponent(download)}` : ''}`;
  },
  async remove(bucket, keys) {
    store.calls.push(['remove', bucket, ...keys]);
    take('remove');
    for (const k of keys) store.objects.delete(`${bucket}/${k}`);
  },
  async upload(bucket, key, body) {
    store.objects.set(`${bucket}/${key}`, body);
  },
};
/** What the browser does with the signed upload URL. */
function browserPut(url, bytes) {
  const target = store.pendingUploads.get(url);
  assert.ok(target, 'a URL the server handed out');
  store.objects.set(`${target.bucket}/${target.key}`, bytes);
}

// ---- HTTP helpers --------------------------------------------------------------------------
async function call(path, { method = 'GET', body, cookie } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...(method !== 'GET' && { origin: ORIGIN }), ...(cookie && { cookie }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
const as = (who) => (path, options = {}) => call(path, { ...options, cookie: cookies[who] });
const owner = as('OWNER_A');
const ownerB = as('OWNER_B');
const manager1 = as('MANAGER_A1');
const manager2 = as('MANAGER_A2');
const staff = as('STAFF');
const O = '/api/owner/exams';
const M = '/api/manager/exams';
const filesOf = (root, paperId) => `${root}/papers/${paperId}/files`;
const row = (id) => prisma.examPaperFile.findUnique({ where: { id } });

/** Start → browser PUT → confirm. Returns the confirm response. */
async function upload(who, root, paperId, { bytes = PDF, fileName = 'paper.pdf', contentType = 'application/pdf', kind = 'question_paper', replaces } = {}) {
  const start = await who(filesOf(root, paperId), { method: 'POST', body: { fileName, contentType, size: bytes.length, ...(replaces ? { replaces } : { kind }) } });
  assert.equal(start.status, 201, JSON.stringify(start.body));
  browserPut(start.body.upload.url, bytes);
  const confirm = await who(`${filesOf(root, paperId)}/${start.body.file.id}/confirm`, { method: 'POST' });
  return { start, confirm, id: start.body.file.id };
}

before(async () => {
  saved.url = env.supabaseUrl;
  saved.key = env.supabaseSecretKey;
  saved.bucket = env.storageBucket;
  saved.max = env.storageMaxFileMb;
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  resetLimiter();
  const today = await calendarToday();
  for (const key of ['A', 'B']) {
    schools[key] = await prisma.school.create({ data: { code: `TEPF${tag}-${key}`, name: `Paper Files ${key} ${tag}`, location: 'Mogadishu', phone: '+252 61 1234567', address: 'Road 1', examinationsEnabled: true } });
  }
  const branch = (key, school, number) =>
    prisma.branch.create({ data: { schoolId: schools[school].id, number, code: `TEPF${tag}-${key}`, name: `Branch ${key}`, nameKey: `branch ${key.toLowerCase()} ${lower}`, address: 'Road', city: 'Mogadishu' } });
  branches.A1 = await branch('A1', 'A', 1);
  branches.A2 = await branch('A2', 'A', 2);
  branches.B = await branch('B1', 'B', 1);
  const school = schools.A;
  const yearStart = addDays(today, -30);
  ctx.year = await prisma.academicYear.create({ data: { schoolId: school.id, name: `Y ${tag}`, nameKey: `y ${lower}`, startDate: asDbDay(yearStart), endDate: asDbDay(addDays(today, 300)), status: 'CURRENT', startedAt: new Date() } });
  await prisma.academicWeekdays.create({ data: { schoolId: school.id, academicYearId: ctx.year.id, days: ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'], effectiveFrom: asDbDay(yearStart) } });
  const type = await prisma.examType.create({ data: { schoolId: school.id, name: 'Mid-Term', nameKey: 'mid-term', defaultMaxMarks: 50, stopsLessons: false } });
  const cls = await prisma.schoolClass.create({ data: { schoolId: school.id, name: 'Grade 7', nameKey: 'grade 7', sequence: 1 } });
  const math = await prisma.subject.create({ data: { schoolId: school.id, name: 'Math', nameKey: 'math' } });
  await prisma.classSubject.create({ data: { schoolId: school.id, classId: cls.id, subjectId: math.id } });
  for (const [key, role, where] of [['OWNER_A', 'OWNER', 'A'], ['OWNER_B', 'OWNER', 'B'], ['MANAGER_A1', 'MANAGER', 'A1'], ['MANAGER_A2', 'MANAGER', 'A2'], ['STAFF', 'STAFF']]) {
    const password = randomBytes(12).toString('base64url');
    const email = `test-epf-${key.toLowerCase().replace('_', '-')}-${lower}@test.edutrack.example`;
    const scope = role === 'MANAGER' ? { branchId: branches[where].id } : await branchFor(role);
    const user = await prisma.user.create({ data: { name: `Test ${key} ${tag}`, email, role, ...scope, passwordHash: await hashPassword(password) } });
    if (role === 'OWNER') await prisma.school.update({ where: { id: schools[where].id }, data: { ownerId: user.id } });
    const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ email, password }) });
    if (role !== 'STAFF') assert.equal(login.status, 200, `${key} sign-in`);
    cookies[key] = login.headers.get('set-cookie')?.split(';')[0];
  }
  // A school-wide examination (School Owner) and a branch examination of A1 (its Manager).
  const wide = await owner(`${O}/examinations`, { method: 'POST', body: { examType: type.id, startDate: addDays(today, 5), endDate: addDays(today, 8), classes: [cls.id] } });
  assert.equal(wide.status, 201, JSON.stringify(wide.body));
  const local = await manager1(`${M}/examinations`, { method: 'POST', body: { examType: type.id, startDate: addDays(today, 10), endDate: addDays(today, 12), classes: [cls.id] } });
  assert.equal(local.status, 201, JSON.stringify(local.body));
  const paperOf = async (examId) => (await owner(`${O}/examinations/${examId}`)).body.classes[0].papers[0];
  ctx.widePaper = await paperOf(wide.body.examination.id);
  ctx.localPaper = await paperOf(local.body.examination.id);
  ctx.localExam = local.body.examination;
});

beforeEach(() => {
  env.supabaseUrl = 'https://storage.test';
  env.supabaseSecretKey = KEY;
  env.storageBucket = 'edutrack-files';
  env.storageMaxFileMb = saved.max;
  store.bucket = { name: 'edutrack-files', public: false };
  store.fail = {};
  setStorageBackend(fake);
});

after(async () => {
  setStorageBackend(null);
  env.supabaseUrl = saved.url;
  env.supabaseSecretKey = saved.key;
  env.storageBucket = saved.bucket;
  env.storageMaxFileMb = saved.max;
  const schoolIds = Object.values(schools).map((s) => s.id);
  const where = { schoolId: { in: schoolIds } };
  const userIds = (await prisma.user.findMany({ where: { email: { endsWith: `-${lower}@test.edutrack.example` } }, select: { id: true } })).map((u) => u.id);
  await prisma.examPaperFile.deleteMany({ where });
  await prisma.examPaper.deleteMany({ where });
  await prisma.examinationClass.deleteMany({ where: { examination: where } });
  await prisma.examination.deleteMany({ where });
  await prisma.classSubject.deleteMany({ where });
  await prisma.subject.deleteMany({ where });
  await prisma.schoolClass.deleteMany({ where });
  await prisma.academicWeekdays.deleteMany({ where });
  await prisma.examType.deleteMany({ where });
  await prisma.examSettings.deleteMany({ where });
  await prisma.notification.deleteMany({ where: { recipientId: { in: userIds } } });
  await prisma.auditEvent.deleteMany({ where: { OR: [where, { actorId: { in: userIds } }] } });
  await prisma.academicYear.deleteMany({ where });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.school.updateMany({ where: { id: { in: schoolIds } }, data: { ownerId: null } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.branch.deleteMany({ where });
  await prisma.school.deleteMany({ where: { id: { in: schoolIds } } });
  await removeTestBranches();
  server.close();
  await prisma.$disconnect();
});

describe('configuration and bucket', () => {
  test('missing credentials: the list says so and uploads answer 503 without calling storage', async () => {
    env.supabaseUrl = undefined;
    env.supabaseSecretKey = undefined;
    store.calls.length = 0;
    const list = await owner(filesOf(O, ctx.widePaper.id));
    assert.equal(list.status, 200);
    assert.equal(list.body.configured, false);
    const start = await owner(filesOf(O, ctx.widePaper.id), { method: 'POST', body: { kind: 'question_paper', fileName: 'a.pdf', size: 100 } });
    assert.equal(start.status, 503);
    assert.equal(start.body.code, 'STORAGE_NOT_CONFIGURED');
    assert.equal(store.calls.length, 0);
  });

  test('a publishable key counts as not configured', async () => {
    env.supabaseSecretKey = 'sb_publishable_abc';
    const start = await owner(filesOf(O, ctx.widePaper.id), { method: 'POST', body: { kind: 'question_paper', fileName: 'a.pdf', size: 100 } });
    assert.equal(start.body.code, 'STORAGE_NOT_CONFIGURED');
  });

  test('the configured bucket is used, never created; a missing or public bucket is refused', async () => {
    env.storageBucket = 'missing-bucket';
    store.calls.length = 0;
    const missing = await owner(filesOf(O, ctx.widePaper.id), { method: 'POST', body: { kind: 'question_paper', fileName: 'a.pdf', size: 100 } });
    assert.equal(missing.status, 503);
    assert.equal(missing.body.code, 'STORAGE_BUCKET_MISSING');
    assert.ok(store.calls.every(([op]) => op === 'getBucket'), 'only a check — no bucket is created');
    env.storageBucket = 'edutrack-files';
    store.bucket = { name: 'edutrack-files', public: true };
    setStorageBackend(fake); // forget the cached privacy check
    const open = await owner(filesOf(O, ctx.widePaper.id), { method: 'POST', body: { kind: 'question_paper', fileName: 'a.pdf', size: 100 } });
    assert.equal(open.body.code, 'STORAGE_BUCKET_PUBLIC');
    assert.equal(await prisma.examPaperFile.count({ where: { paperId: ctx.widePaper.id } }), 0, 'no record without a usable bucket');
  });
});

describe('validation', () => {
  const start = (body) => owner(filesOf(O, ctx.widePaper.id), { method: 'POST', body: { kind: 'question_paper', ...body } });
  test('unsupported, oversized, empty, mismatched and malformed uploads are refused', async () => {
    assert.equal((await start({ fileName: 'run.exe', contentType: 'application/x-msdownload', size: 10 })).status, 400);
    assert.equal((await start({ fileName: 'page.html', size: 10 })).status, 400);
    assert.equal((await start({ fileName: 'noextension', size: 10 })).status, 400);
    assert.equal((await start({ fileName: 'big.pdf', contentType: 'application/pdf', size: 21 * 1024 * 1024 })).status, 400, 'above the 20 MB default');
    assert.equal((await start({ fileName: 'empty.pdf', size: 0 })).status, 400);
    const mismatch = await start({ fileName: 'paper.pdf', contentType: 'image/png', size: 10 });
    assert.equal(mismatch.status, 400);
    assert.ok(mismatch.body.details.contentType);
    assert.equal((await start({ fileName: 'paper.pdf', size: '10' })).status, 400);
    assert.equal((await start({ fileName: 'paper.pdf', size: 10, storageKey: 'schools/other/x.pdf' })).status, 400, 'paths are never accepted');
    assert.equal((await owner(filesOf(O, ctx.widePaper.id), { method: 'POST', body: { fileName: 'a.pdf', size: 10 } })).status, 400, 'a kind is needed');
  });

  test('the size limit is configurable', async () => {
    env.storageMaxFileMb = 1;
    assert.equal((await start({ fileName: 'paper.pdf', size: 2 * 1024 * 1024 })).body.details.size, 'At most 1 MB.');
    assert.equal((await owner(filesOf(O, ctx.widePaper.id))).body.maxBytes, 1024 * 1024);
  });

  test('the name is cleaned (no path); the key is generated; a vague browser type is fine', async () => {
    const r = await start({ fileName: '../../etc/Xisaab – Mid-Term.PDF', contentType: 'application/octet-stream', size: PDF.length });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.file.fileName, 'Xisaab – Mid-Term.PDF');
    assert.equal(r.body.file.contentType, 'application/pdf', 'the server decides the stored type');
    const rec = await row(r.body.file.id);
    assert.equal(rec.storageKey, `schools/${schools.A.id}/examinations/papers/${rec.id}.pdf`);
    assert.equal(rec.bucket, 'edutrack-files');
    assert.equal(rec.extension, 'pdf');
    assert.equal(rec.branchId, null, 'school-wide examination');
    assert.equal(r.body.upload.method, 'PUT');
    assert.equal(r.body.upload.headers['content-type'], 'application/pdf');
    assert.ok(!JSON.stringify(r.body).includes(KEY), 'the secret key never reaches the browser');
    assert.ok(!('storageKey' in r.body.file) && !('bucket' in r.body.file), 'no storage paths in responses');
  });
});

describe('upload, download, replace, remove', () => {
  test('a verified upload becomes ready; confirming twice is harmless; attachments have their own path', async () => {
    const { id, confirm } = await upload(owner, O, ctx.widePaper.id, { fileName: 'Math.pdf' });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
    assert.equal(confirm.body.file.status, 'ready');
    assert.equal(confirm.body.file.type, 'PDF');
    const again = await owner(`${filesOf(O, ctx.widePaper.id)}/${id}/confirm`, { method: 'POST' });
    assert.equal(again.status, 200);
    assert.equal(again.body.file.status, 'ready');
    const uploads = await prisma.auditEvent.count({ where: { schoolId: schools.A.id, action: 'EXAM_PAPER_FILE_UPLOADED', change: { path: ['fileId'], equals: id } } });
    assert.equal(uploads, 1, 'audited once');
    const scheme = await upload(owner, O, ctx.widePaper.id, { bytes: PNG, fileName: 'scheme.png', contentType: 'image/png', kind: 'marking_scheme' });
    assert.equal(scheme.confirm.status, 200);
    assert.match((await row(scheme.id)).storageKey, new RegExp(`^schools/${schools.A.id}/examinations/attachments/${scheme.id}\\.png$`));
    ctx.readyId = id;
  });

  test('nothing in storage yet: the upload stays open; wrong content is rejected, deleted and audited', async () => {
    const start = await owner(filesOf(O, ctx.widePaper.id), { method: 'POST', body: { kind: 'question_paper', fileName: 'fake.pdf', contentType: 'application/pdf', size: EXE.length } });
    const id = start.body.file.id;
    const early = await owner(`${filesOf(O, ctx.widePaper.id)}/${id}/confirm`, { method: 'POST' });
    assert.equal(early.body.code, 'UPLOAD_INCOMPLETE');
    browserPut(start.body.upload.url, EXE);
    const rejected = await owner(`${filesOf(O, ctx.widePaper.id)}/${id}/confirm`, { method: 'POST' });
    assert.equal(rejected.status, 422);
    assert.equal(rejected.body.code, 'UPLOAD_REJECTED');
    const rec = await row(id);
    assert.equal(rec.status, 'REJECTED');
    assert.equal(rec.statusReason, 'content');
    assert.ok(rec.objectDeletedAt, 'the bytes are deleted');
    assert.equal(store.objects.has(`edutrack-files/${rec.storageKey}`), false);
    const audit = await prisma.auditEvent.findFirst({ where: { schoolId: schools.A.id, action: 'EXAM_PAPER_FILE_REJECTED' } });
    assert.equal(audit.result, 'FAILURE');
    // A wrong size (truncated upload) is rejected too.
    const short = await owner(filesOf(O, ctx.widePaper.id), { method: 'POST', body: { kind: 'question_paper', fileName: 'short.pdf', size: PDF.length + 10 } });
    browserPut(short.body.upload.url, PDF);
    const r2 = await owner(`${filesOf(O, ctx.widePaper.id)}/${short.body.file.id}/confirm`, { method: 'POST' });
    assert.equal(r2.status, 422);
    assert.equal((await row(short.body.file.id)).statusReason, 'size');
    const listed = (await owner(filesOf(O, ctx.widePaper.id))).body.files.map((f) => f.id);
    assert.ok(!listed.includes(id) && !listed.includes(short.body.file.id), 'rejected uploads are not listed');
  });

  test('download and view links are short-lived, signed, audited — and never stored or logged in the audit', async () => {
    const dl = await owner(`${filesOf(O, ctx.widePaper.id)}/${ctx.readyId}/download`, { method: 'POST' });
    assert.equal(dl.status, 200);
    assert.match(dl.body.url, /token=down&download=Math\.pdf$/);
    assert.ok(Date.parse(dl.body.expiresAt) - Date.now() <= 120_000);
    const view = await owner(`${filesOf(O, ctx.widePaper.id)}/${ctx.readyId}/download`, { method: 'POST', body: { mode: 'view' } });
    assert.ok(!view.body.url.includes('download='), 'view opens in the browser');
    assert.equal(store.calls.filter(([op]) => op === 'createDownloadUrl').at(-1)[3], 120);
    const events = await prisma.auditEvent.findMany({ where: { schoolId: schools.A.id, action: 'EXAM_PAPER_FILE_DOWNLOADED' } });
    assert.equal(events.length, 2);
    assert.ok(events.every((e) => !JSON.stringify(e).includes('token=') && !JSON.stringify(e).includes('schools/')), 'no signed URL or key in the audit');
    assert.equal((await owner(`${filesOf(O, ctx.widePaper.id)}/${ctx.readyId}/download`, { method: 'POST', body: { mode: 'stream' } })).status, 400);
  });

  test('replace: the old file stays until the new one is confirmed, then is replaced and deleted', async () => {
    const old = await row(ctx.readyId);
    const start = await owner(filesOf(O, ctx.widePaper.id), { method: 'POST', body: { replaces: ctx.readyId, fileName: 'Math v2.pdf', size: PDF.length } });
    assert.equal(start.status, 201, JSON.stringify(start.body));
    assert.equal((await row(ctx.readyId)).status, 'READY', 'nothing changes before the new file is confirmed');
    browserPut(start.body.upload.url, PDF);
    const confirm = await owner(`${filesOf(O, ctx.widePaper.id)}/${start.body.file.id}/confirm`, { method: 'POST' });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
    assert.equal(confirm.body.file.kind, 'question_paper', 'keeps the kind of the file it replaces');
    const replaced = await row(ctx.readyId);
    assert.equal(replaced.status, 'REPLACED');
    assert.equal(replaced.replacedById, start.body.file.id);
    assert.ok(replaced.objectDeletedAt);
    assert.equal(store.objects.has(`edutrack-files/${old.storageKey}`), false);
    assert.equal(await prisma.auditEvent.count({ where: { schoolId: schools.A.id, action: 'EXAM_PAPER_FILE_REPLACED' } }), 1);
    const list = (await owner(filesOf(O, ctx.widePaper.id))).body.files;
    assert.equal(list.find((f) => f.id === ctx.readyId).status, 'replaced', 'history kept');
    assert.equal((await owner(`${filesOf(O, ctx.widePaper.id)}/${ctx.readyId}/download`, { method: 'POST' })).body.code, 'FILE_NOT_READY');
    // Replacing a file that is no longer available is refused.
    assert.equal((await owner(filesOf(O, ctx.widePaper.id), { method: 'POST', body: { replaces: ctx.readyId, fileName: 'x.pdf', size: 10 } })).body.code, 'FILE_NOT_READY');
    ctx.readyId = start.body.file.id;
  });

  test('two replacements of the same file: the second is discarded', async () => {
    const a = await owner(filesOf(O, ctx.widePaper.id), { method: 'POST', body: { replaces: ctx.readyId, fileName: 'a.pdf', size: PDF.length } });
    const b = await owner(filesOf(O, ctx.widePaper.id), { method: 'POST', body: { replaces: ctx.readyId, fileName: 'b.pdf', size: PDF.length } });
    browserPut(a.body.upload.url, PDF);
    browserPut(b.body.upload.url, PDF);
    assert.equal((await owner(`${filesOf(O, ctx.widePaper.id)}/${a.body.file.id}/confirm`, { method: 'POST' })).status, 200);
    const late = await owner(`${filesOf(O, ctx.widePaper.id)}/${b.body.file.id}/confirm`, { method: 'POST' });
    assert.equal(late.status, 409);
    assert.equal(late.body.code, 'REPLACE_TARGET_CHANGED');
    const rec = await row(b.body.file.id);
    assert.equal(rec.status, 'ABANDONED');
    assert.equal(store.objects.has(`edutrack-files/${rec.storageKey}`), false);
    ctx.readyId = a.body.file.id;
  });

  test('remove keeps the record (who, when) and deletes the bytes; twice is refused', async () => {
    const rec = await row(ctx.readyId);
    const removed = await owner(`${filesOf(O, ctx.widePaper.id)}/${ctx.readyId}/remove`, { method: 'POST' });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.file.status, 'removed');
    assert.ok(removed.body.file.removedBy);
    assert.equal(store.objects.has(`edutrack-files/${rec.storageKey}`), false);
    assert.ok((await row(ctx.readyId)).objectDeletedAt);
    assert.equal((await owner(`${filesOf(O, ctx.widePaper.id)}/${ctx.readyId}/remove`, { method: 'POST' })).body.code, 'FILE_REMOVED');
    assert.equal(await prisma.auditEvent.count({ where: { schoolId: schools.A.id, action: 'EXAM_PAPER_FILE_REMOVED' } }), 1);
  });
});

describe('consistency between Neon and storage', () => {
  test('storage fails before the upload starts: the record is closed, nothing is listed', async () => {
    const original = fake.createUploadUrl;
    let attempts = 0;
    fake.createUploadUrl = async () => {
      attempts += 1;
      throw new StorageBackendError('unavailable', 'upload link');
    };
    try {
      const r = await owner(filesOf(O, ctx.widePaper.id), { method: 'POST', body: { kind: 'other', fileName: 'x.pdf', size: 10 } });
      assert.equal(r.status, 502);
      assert.equal(r.body.code, 'STORAGE_ERROR');
      assert.equal(attempts, 2, 'one retry after a network failure');
    } finally {
      fake.createUploadUrl = original;
    }
    const last = await prisma.examPaperFile.findFirst({ where: { paperId: ctx.widePaper.id, fileName: 'x.pdf' } });
    assert.equal(last.status, 'ABANDONED');
    assert.ok(last.objectDeletedAt);
  });

  test('a delete that fails after the database change is retried by maintenance', async () => {
    const { id } = await upload(owner, O, ctx.widePaper.id, { fileName: 'retry.pdf' });
    const rec = await row(id);
    const original = fake.remove;
    fake.remove = async () => {
      throw new StorageBackendError('unavailable', 'remove');
    };
    try {
      const removed = await owner(`${filesOf(O, ctx.widePaper.id)}/${id}/remove`, { method: 'POST' });
      assert.equal(removed.status, 200, 'the removal itself succeeds');
    } finally {
      fake.remove = original;
    }
    assert.equal((await row(id)).objectDeletedAt, null);
    assert.ok(store.objects.has(`edutrack-files/${rec.storageKey}`), 'bytes still there');
    const swept = await sweepExamPaperFiles();
    assert.ok(swept.deleted >= 1);
    assert.ok((await row(id)).objectDeletedAt);
    assert.equal(store.objects.has(`edutrack-files/${rec.storageKey}`), false);
  });

  test('an upload never confirmed (bytes stored, record pending) is cleared after a day', async () => {
    const start = await owner(filesOf(O, ctx.widePaper.id), { method: 'POST', body: { kind: 'other', fileName: 'left.pdf', size: PDF.length } });
    browserPut(start.body.upload.url, PDF);
    const rec = await row(start.body.file.id);
    assert.equal((await sweepExamPaperFiles()).abandoned, 0, 'not before a day');
    await sweepExamPaperFiles({ now: new Date(Date.now() + 25 * 60 * 60 * 1000) });
    const after = await row(rec.id);
    assert.equal(after.status, 'ABANDONED');
    assert.ok(after.objectDeletedAt);
    assert.equal(store.objects.has(`edutrack-files/${rec.storageKey}`), false);
    const confirm = await owner(`${filesOf(O, ctx.widePaper.id)}/${rec.id}/confirm`, { method: 'POST' });
    assert.equal(confirm.body.code, 'NOT_PENDING');
  });

  test('a ready file whose bytes are missing: 404 FILE_MISSING, audited as a failure', async () => {
    const { id } = await upload(owner, O, ctx.widePaper.id, { fileName: 'lost.pdf' });
    store.objects.delete(`edutrack-files/${(await row(id)).storageKey}`);
    const r = await owner(`${filesOf(O, ctx.widePaper.id)}/${id}/download`, { method: 'POST' });
    assert.equal(r.status, 404);
    assert.equal(r.body.code, 'FILE_MISSING');
    const failed = await prisma.auditEvent.findFirst({ where: { schoolId: schools.A.id, action: 'EXAM_PAPER_FILE_DOWNLOADED', result: 'FAILURE' } });
    assert.ok(failed);
    ctx.lostId = id;
  });

  test('too many unfinished uploads of one paper are refused', async () => {
    const results = [];
    for (let i = 0; i < 11; i += 1) results.push((await owner(filesOf(O, ctx.localPaper.id), { method: 'POST', body: { kind: 'other', fileName: `n${i}.pdf`, size: 10 } })).status);
    assert.equal(results.at(-1), 429);
    await prisma.examPaperFile.updateMany({ where: { paperId: ctx.localPaper.id, status: 'PENDING' }, data: { status: 'ABANDONED', objectDeletedAt: new Date() } });
  });
});

describe('authorization', () => {
  test('another school sees nothing of this school’s files', async () => {
    const paths = [filesOf(O, ctx.widePaper.id), `${filesOf(O, ctx.widePaper.id)}/${ctx.lostId}/download`, `${filesOf(O, ctx.widePaper.id)}/${ctx.lostId}/remove`];
    assert.equal((await ownerB(paths[0])).status, 404);
    assert.equal((await ownerB(paths[1], { method: 'POST' })).status, 404);
    assert.equal((await ownerB(paths[2], { method: 'POST' })).status, 404);
    assert.equal((await ownerB(filesOf(O, ctx.widePaper.id), { method: 'POST', body: { kind: 'other', fileName: 'x.pdf', size: 10 } })).status, 404);
  });

  test('a Manager: own branch examination yes; school-wide view/download only; another branch nothing', async () => {
    const own = await upload(manager1, M, ctx.localPaper.id, { fileName: 'branch.pdf' });
    assert.equal(own.confirm.status, 200, JSON.stringify(own.confirm.body));
    const rec = await row(own.id);
    assert.equal(rec.branchId, branches.A1.id, 'branch recorded');
    assert.equal(rec.storageKey.startsWith(`schools/${schools.A.id}/`), true);
    const wide = await manager1(filesOf(M, ctx.widePaper.id));
    assert.equal(wide.status, 200);
    assert.equal(wide.body.canChange, false);
    const ready = await upload(owner, O, ctx.widePaper.id, { fileName: 'print me.pdf' });
    assert.equal((await manager1(`${filesOf(M, ctx.widePaper.id)}/${ready.id}/download`, { method: 'POST' })).status, 200, 'downloads to print');
    assert.equal((await manager1(filesOf(M, ctx.widePaper.id), { method: 'POST', body: { kind: 'other', fileName: 'x.pdf', size: 10 } })).status, 403);
    assert.equal((await manager1(`${filesOf(M, ctx.widePaper.id)}/${ready.id}/remove`, { method: 'POST' })).status, 403);
    assert.equal((await manager1(filesOf(M, ctx.widePaper.id), { method: 'POST', body: { replaces: ready.id, fileName: 'x.pdf', size: 10 } })).status, 403);
    // Manager of A2: A1's examination is invisible.
    assert.equal((await manager2(filesOf(M, ctx.localPaper.id))).status, 404);
    assert.equal((await manager2(`${filesOf(M, ctx.localPaper.id)}/${own.id}/download`, { method: 'POST' })).status, 404);
    assert.equal((await manager2(`${filesOf(M, ctx.localPaper.id)}/${own.id}/remove`, { method: 'POST' })).status, 404);
  });

  test('other roles and anonymous callers are refused', async () => {
    assert.ok([401, 403].includes((await staff(filesOf(O, ctx.widePaper.id))).status));
    assert.ok([401, 403].includes((await staff(filesOf(M, ctx.widePaper.id))).status));
    assert.equal((await call(filesOf(O, ctx.widePaper.id))).status, 401);
    assert.equal((await call(`${filesOf(O, ctx.widePaper.id)}/${ctx.lostId}/download`, { method: 'POST' })).status, 401);
  });
});

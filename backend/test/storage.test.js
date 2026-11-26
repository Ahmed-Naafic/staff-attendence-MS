/*
 * The shared storage layer (docs/storage/supabase-storage.md), without a database or a real
 * Supabase project: configuration checks, file validation, object keys and school isolation, the
 * storage service over a stand-in backend, and the Supabase SDK backend over a stand-in fetch.
 */
import assert from 'node:assert/strict';
import { after, beforeEach, describe, test } from 'node:test';
import { readFileDescriptor, safeFileName, sniffType } from '../src/common/storage/fileTypes.js';
import { checkStorageConfig, validateStorageConfigAtStartup } from '../src/common/storage/storageConfig.js';
import { assertKeyOfSchool, newObjectKey } from '../src/common/storage/storageKeys.js';
import * as storage from '../src/common/storage/storageService.js';
import { createSupabaseBackend, StorageBackendError } from '../src/common/storage/supabaseBackend.js';
import { env } from '../src/config/env.js';

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const FILE = '33333333-3333-4333-8333-333333333333';
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');
const jwt = (payload) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
const base = { supabaseUrl: 'https://abc.supabase.co', supabaseSecretKey: 'sb_secret_xyz', storageBucket: 'edutrack-files', storageMaxFileMb: 20 };

describe('configuration', () => {
  test('the default bucket is edutrack-files', () => {
    const saved = process.env.SUPABASE_STORAGE_BUCKET;
    assert.equal(env.storageBucket, process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'edutrack-files');
    if (saved === undefined) assert.equal(env.storageBucket, 'edutrack-files');
  });

  test('complete and correct: configured', () => {
    assert.deepEqual(checkStorageConfig(base), { configured: true, missing: false, problems: [] });
    assert.equal(checkStorageConfig({ ...base, supabaseSecretKey: jwt({ role: 'service_role' }) }).configured, true, 'legacy service_role key');
  });

  test('missing credentials: not configured, no problem reported (storage is optional)', () => {
    const r = checkStorageConfig({ ...base, supabaseUrl: undefined, supabaseSecretKey: undefined });
    assert.equal(r.configured, false);
    assert.equal(r.missing, true);
    assert.deepEqual(r.problems, []);
  });

  test('half-done or wrong configuration is reported without the key value', () => {
    const cases = [
      [{ supabaseSecretKey: undefined }, /SUPABASE_SECRET_KEY is missing/],
      [{ supabaseUrl: undefined }, /SUPABASE_URL is missing/],
      [{ supabaseSecretKey: 'sb_publishable_123' }, /publishable key/],
      [{ supabaseSecretKey: jwt({ role: 'anon' }) }, /anon key/],
      [{ supabaseSecretKey: 'not-a-key' }, /not a Supabase secret key/],
      [{ supabaseUrl: 'abc.supabase.co' }, /not a valid URL/],
      [{ supabaseUrl: 'http://abc.supabase.co' }, /https/],
      [{ supabaseUrl: 'https://abc.supabase.co/storage/v1' }, /without a path/],
      [{ storageBucket: 'Bad Bucket!' }, /bucket name/],
      [{ storageMaxFileMb: 0 }, /STORAGE_MAX_FILE_MB/],
    ];
    for (const [change, pattern] of cases) {
      const r = checkStorageConfig({ ...base, ...change });
      assert.equal(r.configured, false, JSON.stringify(change));
      assert.match(r.problems.join(' '), pattern);
      assert.ok(!r.problems.join(' ').includes('sb_publishable_123') && !r.problems.join(' ').includes('not-a-key'), 'never echoes the key');
    }
  });

  test('startup: STORAGE_REQUIRED stops the server when missing or wrong; otherwise only logs', () => {
    const logs = [];
    const log = { error: (m) => logs.push(m) };
    assert.throws(() => validateStorageConfigAtStartup({ ...base, supabaseUrl: undefined, supabaseSecretKey: undefined, storageRequired: true }, log), /STORAGE_REQUIRED/);
    assert.throws(() => validateStorageConfigAtStartup({ ...base, supabaseSecretKey: 'sb_publishable_1', storageRequired: true }, log), /publishable/);
    assert.equal(validateStorageConfigAtStartup({ ...base, supabaseUrl: undefined, supabaseSecretKey: undefined }, log).configured, false);
    assert.equal(validateStorageConfigAtStartup({ ...base, storageRequired: true }, log).configured, true);
  });
});

describe('file validation', () => {
  const opts = { allowed: ['pdf', 'doc', 'docx'], maxBytes: 1024 };
  test('allowed types by extension; the browser type must agree when it is specific', () => {
    assert.equal(readFileDescriptor({ fileName: 'a.PDF', contentType: 'application/pdf', size: 10 }, opts).type.ext, 'pdf');
    assert.equal(readFileDescriptor({ fileName: 'a.doc', contentType: '', size: 10 }, opts).type.mime, 'application/msword');
    assert.equal(readFileDescriptor({ fileName: 'a.docx', size: 10 }, opts).type.ext, 'docx');
    assert.equal(readFileDescriptor({ fileName: 'a.pdf', contentType: 'application/octet-stream', size: 10 }, opts).type.ext, 'pdf');
    assert.throws(() => readFileDescriptor({ fileName: 'a.pdf', contentType: 'text/html', size: 10 }, opts), (e) => Boolean(e.details.contentType));
    assert.throws(() => readFileDescriptor({ fileName: 'a.png', size: 10 }, opts), (e) => Boolean(e.details.fileName), 'not allowed for this use');
    assert.throws(() => readFileDescriptor({ fileName: 'a.pdf.exe', size: 10 }, opts), (e) => Boolean(e.details.fileName));
    assert.throws(() => readFileDescriptor({ fileName: 'a.pdf', size: 0 }, opts), (e) => e.details.size === 'The file is empty.');
    assert.throws(() => readFileDescriptor({ fileName: 'a.pdf', size: 1025 }, opts), (e) => /At most/.test(e.details.size));
    assert.throws(() => readFileDescriptor({ fileName: 'a.pdf', size: 1.5 }, opts), (e) => Boolean(e.details.size));
    assert.throws(() => readFileDescriptor({ fileName: '', size: 1 }, opts), (e) => Boolean(e.details.fileName));
    assert.throws(() => readFileDescriptor({ fileName: 42, size: 1 }, opts), (e) => Boolean(e.details.fileName));
  });

  test('file names: no path, no control characters, no leading dots, length kept with the extension', () => {
    assert.equal(safeFileName('../../etc/passwd.pdf'), 'passwd.pdf');
    assert.equal(safeFileName('C:\\Users\\x\\exam.docx'), 'exam.docx');
    assert.equal(safeFileName('..hidden.pdf'), 'hidden.pdf');
    assert.equal(safeFileName('a\u0000b<c>.pdf'), 'a_b_c_.pdf');
    const long = safeFileName(`${'x'.repeat(200)}.pdf`);
    assert.equal(long.length, 120);
    assert.ok(long.endsWith('.pdf'));
  });

  test('content signatures', () => {
    assert.ok(sniffType(PDF, 'pdf'));
    assert.ok(sniffType(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]), 'doc'));
    assert.ok(sniffType(Buffer.from('PK\x03\x04rest', 'latin1'), 'docx'));
    assert.ok(sniffType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'jpg'));
    assert.ok(!sniffType(Buffer.from('MZ\x90\x00'), 'pdf'), 'an executable is not a PDF');
    assert.ok(!sniffType(Buffer.from('<html>'), 'docx'));
    assert.ok(!sniffType(PDF, 'docx'));
    assert.ok(!sniffType(Buffer.alloc(0), 'pdf'));
    assert.ok(!sniffType(PDF, 'exe'));
  });
});

describe('object keys and school isolation', () => {
  test('the agreed layout, built only from server-side ids', () => {
    assert.equal(newObjectKey('examPapers', { schoolId: SCHOOL, ext: 'pdf', fileId: FILE }).key, `schools/${SCHOOL}/examinations/papers/${FILE}.pdf`);
    assert.equal(newObjectKey('examAttachments', { schoolId: SCHOOL, ext: 'docx', fileId: FILE }).key, `schools/${SCHOOL}/examinations/attachments/${FILE}.docx`);
    assert.equal(newObjectKey('studentDocuments', { schoolId: SCHOOL, ownerId: OTHER, ext: 'pdf', fileId: FILE }).key, `schools/${SCHOOL}/student-documents/${OTHER}/${FILE}.pdf`);
    assert.equal(newObjectKey('staffDocuments', { schoolId: SCHOOL, ownerId: OTHER, ext: 'pdf', fileId: FILE }).key, `schools/${SCHOOL}/staff-documents/${OTHER}/${FILE}.pdf`);
    assert.match(newObjectKey('examPapers', { schoolId: SCHOOL, ext: 'pdf' }).fileId, /^[0-9a-f-]{36}$/, 'a fresh UUID');
  });

  test('anything else is refused', () => {
    assert.throws(() => newObjectKey('examPapers', { schoolId: '../x', ext: 'pdf' }));
    assert.throws(() => newObjectKey('examPapers', { schoolId: SCHOOL, ext: 'p/df' }));
    assert.throws(() => newObjectKey('studentDocuments', { schoolId: SCHOOL, ext: 'pdf' }), 'needs the student');
    assert.throws(() => newObjectKey('nowhere', { schoolId: SCHOOL, ext: 'pdf' }));
  });

  test('a key must be inside the caller’s school', () => {
    const key = `schools/${SCHOOL}/examinations/papers/${FILE}.pdf`;
    assert.equal(assertKeyOfSchool(key, SCHOOL), key);
    assert.throws(() => assertKeyOfSchool(key, OTHER));
    assert.throws(() => assertKeyOfSchool(`schools/${SCHOOL}/../${OTHER}/x.pdf`, SCHOOL));
    assert.throws(() => assertKeyOfSchool(`schools/${SCHOOL}/`, SCHOOL));
    assert.throws(() => assertKeyOfSchool(`schools/${SCHOOL}/a b.pdf`, SCHOOL));
    assert.equal(assertKeyOfSchool(`${SCHOOL}/e/p/${FILE}.pdf`, SCHOOL), `${SCHOOL}/e/p/${FILE}.pdf`, 'first-release layout');
  });
});

describe('storage service (stand-in backend)', () => {
  const saved = { url: env.supabaseUrl, key: env.supabaseSecretKey, bucket: env.storageBucket };
  const key = `schools/${SCHOOL}/examinations/papers/${FILE}.pdf`;
  let calls;
  let objects;
  let bucket;
  const backend = {
    getBucket: async (b) => {
      calls.push(['getBucket', b]);
      if (!bucket) throw new StorageBackendError('not_found', 'bucket check');
      return { public: bucket.public };
    },
    createUploadUrl: async (b, k) => {
      calls.push(['createUploadUrl', b, k]);
      return { url: `https://x.supabase.co/storage/v1/object/upload/sign/${b}/${k}?token=t` };
    },
    stat: async (b, k) => (objects.has(k) ? { size: objects.get(k).length } : null),
    readHead: async (b, k, n) => objects.get(k).subarray(0, n),
    createDownloadUrl: async (b, k, s, { download } = {}) => {
      calls.push(['createDownloadUrl', b, k, s, download]);
      if (!objects.has(k)) throw new StorageBackendError('not_found', 'download link');
      return `https://x.supabase.co/storage/v1/object/sign/${b}/${k}?token=d`;
    },
    remove: async (b, keys) => {
      calls.push(['remove', b, ...keys]);
      keys.forEach((k) => objects.delete(k));
    },
    upload: async (b, k, body) => objects.set(k, body),
  };
  beforeEach(() => {
    env.supabaseUrl = 'https://x.supabase.co';
    env.supabaseSecretKey = 'sb_secret_test';
    env.storageBucket = 'edutrack-files';
    calls = [];
    objects = new Map();
    bucket = { public: false };
    storage.setStorageBackend(backend);
  });
  after(() => {
    storage.setStorageBackend(null);
    env.supabaseUrl = saved.url;
    env.supabaseSecretKey = saved.key;
    env.storageBucket = saved.bucket;
  });

  test('not configured: 503 before anything is sent', async () => {
    env.supabaseSecretKey = undefined;
    await assert.rejects(storage.createUploadUrl({ schoolId: SCHOOL, key, contentType: 'application/pdf' }), (e) => e.code === 'STORAGE_NOT_CONFIGURED');
    assert.equal(calls.length, 0);
  });

  test('the bucket is checked (private) once and cached; missing and public are refused', async () => {
    await storage.createUploadUrl({ schoolId: SCHOOL, key, contentType: 'application/pdf' });
    await storage.createUploadUrl({ schoolId: SCHOOL, key, contentType: 'application/pdf' });
    assert.equal(calls.filter(([op]) => op === 'getBucket').length, 1);
    assert.deepEqual(calls.find(([op]) => op === 'getBucket'), ['getBucket', 'edutrack-files']);
    storage.setStorageBackend(backend);
    bucket = null;
    await assert.rejects(storage.assertStorageReady(), (e) => e.code === 'STORAGE_BUCKET_MISSING' && e.status === 503);
    bucket = { public: true };
    await assert.rejects(storage.assertStorageReady(), (e) => e.code === 'STORAGE_BUCKET_PUBLIC');
  });

  test('another school’s key is refused before Supabase is called', async () => {
    await assert.rejects(storage.createDownloadUrl({ schoolId: OTHER, key, seconds: 60 }), (e) => e.code === 'STORAGE_KEY_INVALID');
    await assert.rejects(storage.deleteObject({ schoolId: OTHER, key }), (e) => e.code === 'STORAGE_KEY_INVALID');
    assert.equal(calls.length, 0);
  });

  test('signed URLs: short-lived, with an expiry; lifetimes outside 10 s – 1 h refused; missing → 404', async () => {
    objects.set(key, PDF);
    const link = await storage.createDownloadUrl({ schoolId: SCHOOL, key, seconds: 120, fileName: 'a.pdf' });
    assert.match(link.url, /token=d$/);
    assert.ok(Math.abs(Date.parse(link.expiresAt) - Date.now() - 120_000) < 2000);
    assert.deepEqual(calls.at(-1), ['createDownloadUrl', 'edutrack-files', key, 120, 'a.pdf']);
    await assert.rejects(storage.createDownloadUrl({ schoolId: SCHOOL, key, seconds: 7200 }));
    objects.delete(key);
    await assert.rejects(storage.createDownloadUrl({ schoolId: SCHOOL, key, seconds: 60 }), (e) => e.status === 404 && e.code === 'FILE_MISSING');
  });

  test('verification: missing, wrong size, wrong content, ok', async () => {
    const v = (size, ext = 'pdf') => storage.verifyUploadedObject({ schoolId: SCHOOL, key, size, ext });
    assert.deepEqual(await v(PDF.length), { ok: false, reason: 'missing' });
    objects.set(key, PDF);
    assert.deepEqual(await v(PDF.length + 1), { ok: false, reason: 'size' });
    assert.deepEqual(await v(PDF.length, 'docx'), { ok: false, reason: 'content' });
    assert.deepEqual(await v(PDF.length), { ok: true });
    assert.equal(await storage.objectExists({ schoolId: SCHOOL, key }), true);
  });

  test('one retry after a network failure; a refused key is reported as access denied', async () => {
    let n = 0;
    storage.setStorageBackend({ ...backend, getBucket: async () => ({ public: false }), remove: async () => { n += 1; if (n === 1) throw new StorageBackendError('unavailable', 'remove'); } });
    await storage.deleteObject({ schoolId: SCHOOL, key });
    assert.equal(n, 2);
    storage.setStorageBackend({ ...backend, remove: async () => { throw new StorageBackendError('unavailable', 'remove'); } });
    await assert.rejects(storage.deleteObject({ schoolId: SCHOOL, key }), (e) => e.status === 502 && e.code === 'STORAGE_ERROR');
    assert.equal(await storage.tryDeleteObject({ schoolId: SCHOOL, key }), false, 'reported, not thrown');
    storage.setStorageBackend({ ...backend, getBucket: async () => { throw new StorageBackendError('denied', 'bucket check', 403); } });
    await assert.rejects(storage.assertStorageReady(), (e) => e.code === 'STORAGE_ACCESS_DENIED');
  });

  test('server-side upload checks content and size', async () => {
    await storage.uploadBuffer({ schoolId: SCHOOL, key, buffer: PDF, ext: 'pdf', contentType: 'application/pdf' });
    assert.ok(objects.has(key));
    await assert.rejects(storage.uploadBuffer({ schoolId: SCHOOL, key, buffer: Buffer.from('MZ...'), ext: 'pdf', contentType: 'application/pdf' }), (e) => e.status === 400);
    await assert.rejects(storage.uploadBuffer({ schoolId: SCHOOL, key, buffer: Buffer.alloc(0), ext: 'pdf', contentType: 'application/pdf' }), (e) => e.status === 400);
  });
});

describe('Supabase SDK backend (stand-in fetch)', () => {
  const url = 'https://proj.supabase.co';
  const secretKey = 'sb_secret_unit_test_key';
  const key = `schools/${SCHOOL}/examinations/papers/${FILE}.pdf`;
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  test('requests go to the project with the secret key in the apikey header; URLs come back signed', async () => {
    const seen = [];
    const fetch = async (input, init = {}) => {
      const u = typeof input === 'string' ? input : input.url;
      const headers = new Headers(init.headers);
      seen.push({ url: u, method: init.method ?? 'GET', apikey: headers.get('apikey'), range: headers.get('range') });
      if (u.includes('token=down')) return new Response(PDF.subarray(0, 8), { status: 206 });
      if (u.endsWith('/storage/v1/bucket/edutrack-files')) return json(200, { id: 'edutrack-files', public: false });
      if (u.includes('/object/upload/sign/edutrack-files/')) return json(200, { url: `/object/upload/sign/edutrack-files/${key}?token=up` });
      if (u.includes('/object/sign/edutrack-files/')) return json(200, { signedURL: `/object/sign/edutrack-files/${key}?token=down` });
      if (u.includes('/object/info/edutrack-files/')) return json(200, { size: PDF.length, content_type: 'application/pdf' });
      if (u.endsWith('/object/edutrack-files') && init.method === 'DELETE') return json(200, []);
      return json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    };
    const b = createSupabaseBackend({ url, secretKey, fetch });
    assert.deepEqual((await b.getBucket('edutrack-files')).public, false);
    const up = await b.createUploadUrl('edutrack-files', key);
    assert.match(up.url, new RegExp(`^${url}/storage/v1/object/upload/sign/edutrack-files/schools/.+\\?token=up$`));
    assert.ok(!up.url.includes(secretKey));
    assert.deepEqual(await b.stat('edutrack-files', key), { size: PDF.length, contentType: 'application/pdf' });
    assert.deepEqual([...(await b.readHead('edutrack-files', key, 8))], [...PDF.subarray(0, 8)]);
    assert.equal(seen.find((s) => s.url.includes('token=down')).range, 'bytes=0-7');
    const down = await b.createDownloadUrl('edutrack-files', key, 120, { download: 'paper.pdf' });
    assert.match(down, /token=down&download=paper\.pdf$/);
    await b.remove('edutrack-files', [key]);
    const api = seen.filter((s) => !s.url.includes('token='));
    assert.ok(api.length >= 5 && api.every((s) => s.url.startsWith(`${url}/storage/v1/`) && s.apikey === secretKey), 'API calls carry the key');
    assert.ok(seen.filter((s) => s.url.includes('token=')).every((s) => s.apikey === null), 'reads through a signed URL carry no key');
  });

  test('errors are classified: missing objects and buckets, refused keys, network failures', async () => {
    const answer = (fn) => createSupabaseBackend({ url, secretKey, fetch: fn });
    assert.equal(await answer(async () => json(400, { statusCode: '404', error: 'not_found', message: 'Object not found' })).stat('edutrack-files', key), null);
    await assert.rejects(answer(async () => json(400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' })).getBucket('nope'), (e) => e.kind === 'not_found');
    await assert.rejects(answer(async () => json(403, { statusCode: '403', error: 'Unauthorized', message: 'Invalid Compact JWS' })).getBucket('edutrack-files'), (e) => e.kind === 'denied');
    await assert.rejects(answer(async () => json(409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' })).upload('edutrack-files', key, PDF, 'application/pdf'), (e) => e.kind === 'conflict');
    await assert.rejects(answer(async () => { throw new TypeError('fetch failed'); }).getBucket('edutrack-files'), (e) => e.kind === 'unavailable');
    await assert.rejects(answer(async () => json(500, { message: 'boom' })).remove('edutrack-files', [key]), (e) => e.kind === 'unavailable');
  });
});

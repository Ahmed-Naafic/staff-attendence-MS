import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { ApiError, apiDownload, filenameFrom } from '../../../lib/api.js';
import { exportQuery, exportRecords } from '../data/attendanceApi.js';
import { exportErrorMessage, runExport, saveFile } from './exportRules.js';
import { readView } from './reportRules.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const ID = '0b7a1c5e-6f1d-4c3b-9a2e-1f2d3c4b5a69';
const csvResponse = (body, headers = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="attendance_CIT-001_2026-10-01_to_2026-10-28.csv"', 'x-export-rows': '2', ...headers } });
const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('the export asks for the current filters and sort, never a page, and only an Owner sends a branch', async () => {
  const view = readView(new URLSearchParams(`branch=${ID}&shift=${ID}&status=late&checkOut=missing&q=amina&sort=staffName:asc&page=4`), 'OWNER');
  assert.deepEqual(exportQuery('OWNER', view, { from: '2026-10-01', to: '2026-10-28' }), {
    from: '2026-10-01', to: '2026-10-28', branch: ID, staff: '', shift: ID, status: 'late', checkOut: 'missing', q: 'amina', sort: 'staffName', order: 'asc',
  });
  assert.equal(exportQuery('MANAGER', readView(new URLSearchParams(`branch=${ID}`), 'MANAGER'), { from: 'a', to: 'b' }).branch, undefined);

  let requested;
  globalThis.fetch = async (url, init) => {
    requested = { url, init };
    return csvResponse('﻿work_date\r\n');
  };
  await exportRecords('MANAGER', readView(new URLSearchParams('page=3'), 'MANAGER'), { from: '2026-10-01', to: '2026-10-28' });
  assert.equal(requested.url, '/api/manager/attendance/export.csv?from=2026-10-01&to=2026-10-28&sort=date&order=desc');
  assert.equal(requested.init.credentials, 'same-origin');
  assert.ok(!requested.url.includes('page'));
});

test('Excel uses the same query on export.xlsx; only the two formats exist', async () => {
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return csvResponse('PK', { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': 'attachment; filename="attendance_CIT-001_2026-10-01_to_2026-10-28.xlsx"' });
  };
  const view = readView(new URLSearchParams(`status=late&branch=${ID}`), 'OWNER');
  const file = await exportRecords('OWNER', view, { from: '2026-10-01', to: '2026-10-28' }, 'xlsx');
  assert.equal(file.filename, 'attendance_CIT-001_2026-10-01_to_2026-10-28.xlsx');
  await exportRecords('OWNER', view, { from: '2026-10-01', to: '2026-10-28' }, 'csv');
  assert.deepEqual(urls.map((u) => u.split('?')[0]), ['/api/owner/attendance/export.xlsx', '/api/owner/attendance/export.csv']);
  assert.equal(urls[0].split('?')[1], urls[1].split('?')[1], 'the same filters for both formats');
  assert.throws(() => exportRecords('OWNER', view, { from: 'a', to: 'b' }, 'docx'), /Unknown export format/);
});

test('download: the file, its safe name and row count; errors become ApiError with the server’s message', async () => {
  globalThis.fetch = async () => csvResponse('﻿a,b\r\n1,2\r\n');
  const file = await apiDownload('/owner/attendance/export.csv');
  assert.equal(file.filename, 'attendance_CIT-001_2026-10-01_to_2026-10-28.csv');
  assert.equal(file.rows, 2);
  // The bytes are kept as sent, byte-order mark included (text() would decode it away).
  const bytes = new Uint8Array(await file.blob.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.equal(new TextDecoder().decode(bytes.slice(3)), 'a,b\r\n1,2\r\n');

  globalThis.fetch = async () => jsonResponse(400, { error: 'These filters match 12,001 records; an export can contain at most 10,000. Narrow the dates or filters and export again.', code: 'EXPORT_TOO_LARGE', details: { total: 12001, limit: 10000 } });
  await assert.rejects(apiDownload('/x'), (error) => error instanceof ApiError && error.code === 'EXPORT_TOO_LARGE' && error.details.total === 12001);
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(apiDownload('/x'), (error) => error.code === 'NETWORK_ERROR');
  // A body cut off mid-stream is an error, never a file.
  globalThis.fetch = async () => {
    const response = csvResponse('ignored');
    Object.defineProperty(response, 'blob', { value: () => Promise.reject(new TypeError('terminated')) });
    return response;
  };
  await assert.rejects(apiDownload('/x'), (error) => error.code === 'DOWNLOAD_INTERRUPTED');
});

test('file names from the server are used only when plainly safe', () => {
  assert.equal(filenameFrom('attachment; filename="attendance_X-1_2026-10-01_to_2026-10-02.csv"'), 'attendance_X-1_2026-10-01_to_2026-10-02.csv');
  assert.equal(filenameFrom('attachment; filename="../../evil.csv"'), 'download.csv');
  assert.equal(filenameFrom('attachment; filename="a b.csv"'), 'download.csv');
  assert.equal(filenameFrom(null), 'download.csv');
});

test('running an export: saved and reported on success; a clear message and nothing saved on failure', async () => {
  const saved = [];
  const save = (blob, filename) => saved.push(filename);
  const ok = await runExport({ request: async () => ({ blob: new Blob(['x']), filename: 'a.csv', rows: 1 }), save });
  assert.deepEqual(ok, { status: 'success', message: 'Downloaded 1 record as a.csv.' });
  assert.deepEqual(saved, ['a.csv']);

  const failures = [
    [new ApiError(400, 'EXPORT_TOO_LARGE', 'These filters match 12,001 records; …'), /12,001 records/],
    [new ApiError(400, 'VALIDATION_ERROR', 'Choose at most 62 days.', { from: 'Choose at most 62 days (from 2026-08-28 for this end date).' }), /62 days \(from/],
    [new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.'), /session has ended/],
    [new ApiError(403, 'FORBIDDEN', 'No'), /do not have access/],
    [new ApiError(404, 'NOT_FOUND', 'Branch not found.'), /not part of your reports/],
    [new ApiError(0, 'NETWORK_ERROR', 'The server could not be reached. Check your connection and try again.'), /could not be reached/],
    [new ApiError(0, 'DOWNLOAD_INTERRUPTED', 'The download was interrupted before the file was complete. Try again.'), /interrupted/],
    [new ApiError(500, 'INTERNAL_ERROR', 'Something went wrong.'), /could not be created/],
  ];
  for (const [error, message] of failures) {
    const result = await runExport({ request: async () => Promise.reject(error), save });
    assert.equal(result.status, 'error');
    assert.match(result.message, message);
    assert.equal(exportErrorMessage(error), result.message);
  }
  assert.deepEqual(saved, ['a.csv'], 'nothing saved after a failure');
});

test('saving: a temporary download link is clicked and removed; the object URL is released', () => {
  const events = [];
  const link = { style: {}, click: () => events.push('click'), remove: () => events.push('remove') };
  const doc = { createElement: (tag) => (events.push(`create ${tag}`), link), body: { appendChild: () => events.push('append') } };
  const url = { createObjectURL: () => 'blob:1', revokeObjectURL: (href) => events.push(`revoke ${href}`) };
  let release;
  saveFile(new Blob(['x']), 'a.csv', { doc, url, later: (fn) => (release = fn) });
  assert.deepEqual([link.href, link.download, link.rel], ['blob:1', 'a.csv', 'noopener']);
  assert.deepEqual(events, ['create a', 'append', 'click', 'remove']);
  release();
  assert.equal(events.at(-1), 'revoke blob:1');
});

import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { exportQuery, exportRecords, loadExportPreview } from '../data/attendanceApi.js';
import { cellTone, dialogReducer, downloadAvailability, FORMATS, formatById, initialDialog, previewNote } from './exportDialog.js';
import { readView } from './reportRules.js';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const ID = '0b7a1c5e-6f1d-4c3b-9a2e-1f2d3c4b5a69';
const range = { from: '2026-10-01', to: '2026-10-28' };

test('three formats, PDF first; each with a title, extension and description', () => {
  assert.deepEqual(FORMATS.map((f) => [f.id, f.label, f.extension]), [['pdf', 'PDF', '.pdf'], ['xlsx', 'Excel', '.xlsx'], ['csv', 'CSV', '.csv']]);
  assert.ok(FORMATS.every((f) => f.title && f.description));
  assert.equal(formatById('unknown').id, 'pdf');
});

test('the dialog: opens on the format choice, previews, switches format inside the preview, returns, closes; keeps the last format', () => {
  let state = dialogReducer(initialDialog, { type: 'open' });
  assert.deepEqual(state, { open: true, step: 'choose', format: 'pdf' });
  state = dialogReducer(state, { type: 'format', format: 'csv' });
  state = dialogReducer(state, { type: 'preview' });
  assert.deepEqual(state, { open: true, step: 'preview', format: 'csv' });
  state = dialogReducer(state, { type: 'format', format: 'xlsx' });
  assert.deepEqual(state, { open: true, step: 'preview', format: 'xlsx' }, 'switching formats stays in the preview');
  assert.equal(dialogReducer(state, { type: 'format', format: 'docx' }), state, 'unknown formats are ignored');
  state = dialogReducer(state, { type: 'back' });
  assert.equal(state.step, 'choose');
  state = dialogReducer(state, { type: 'close' });
  assert.deepEqual(state, { open: false, step: 'choose', format: 'xlsx' });
  assert.deepEqual(dialogReducer(state, { type: 'open' }), { open: true, step: 'choose', format: 'xlsx' });
});

test('preview and every download use the same query from the page filters (never a page number)', async () => {
  const view = readView(new URLSearchParams(`branch=${ID}&status=late&checkOut=missing&q=ali&sort=staffName:asc&page=4`), 'OWNER');
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return url.includes('/preview')
      ? new Response(JSON.stringify({ total: 3 }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('%PDF-1.7', { status: 200, headers: { 'content-disposition': 'attachment; filename="attendance_X_2026-10-01_to_2026-10-28.pdf"', 'x-export-rows': '3' } });
  };
  assert.deepEqual(await loadExportPreview('OWNER', view, range), { total: 3 });
  const pdf = await exportRecords('OWNER', view, range, 'pdf');
  await exportRecords('OWNER', view, range, 'xlsx');
  await exportRecords('OWNER', view, range, 'csv');
  assert.equal(pdf.filename, 'attendance_X_2026-10-01_to_2026-10-28.pdf');
  const [paths, queries] = [urls.map((u) => u.split('?')[0]), urls.map((u) => u.split('?')[1])];
  assert.deepEqual(paths, ['/api/owner/attendance/export/preview', '/api/owner/attendance/export.pdf', '/api/owner/attendance/export.xlsx', '/api/owner/attendance/export.csv']);
  assert.equal(new Set(queries).size, 1, 'one query for preview and downloads');
  assert.equal(queries[0], new URLSearchParams(Object.entries(exportQuery('OWNER', view, range)).filter(([, v]) => v)).toString());
  assert.ok(!queries[0].includes('page'));
  // A Manager never sends a branch.
  globalThis.fetch = async (url) => {
    urls.push(url);
    return new Response('{}', { status: 200 });
  };
  await loadExportPreview('MANAGER', readView(new URLSearchParams(`branch=${ID}`), 'MANAGER'), range);
  assert.ok(!urls.at(-1).includes('branch='));
});

test('download availability: allowed for 0–10,000 records (an empty report is a valid file); refused with the reason beyond', () => {
  assert.deepEqual(downloadAvailability(0), { disabled: false, reason: null });
  assert.deepEqual(downloadAvailability(10_000), { disabled: false, reason: null });
  assert.match(downloadAvailability(10_001).reason, /10,001 records; a report can contain at most 10,000\. Narrow/);
  assert.equal(downloadAvailability(null).disabled, true);
});

test('preview notes and cell styles', () => {
  assert.equal(previewNote({ total: 0, shown: 0 }), 'No attendance records match these filters. The download is a valid, empty report.');
  assert.equal(previewNote({ total: 3, shown: 3 }), 'Showing all 3 records.');
  assert.equal(previewNote({ total: 10_000, shown: 50 }), 'Showing the first 50 of 10,000 records. The download contains all 10,000.');
  assert.deepEqual(
    [['status', 'Present'], ['status', 'Late'], ['checkOut', 'Missing >24h'], ['checkOut', 'Pending'], ['checkOut', 'Not required'], ['checkOut', '16:02'], ['text', 'x']].map(([k, v]) => cellTone(k, v)),
    ['present', 'late', 'missing', 'pending', 'muted', 'plain', 'plain'],
  );
});

import { apiDownload, apiRequest } from '../../../lib/api.js';
import { PAGE_SIZE } from '../utils/reportRules.js';

/*
 * Attendance reports (read only): GET /api/owner/attendance/… for a School Owner (their school; one
 * branch with `branch`) and GET /api/manager/attendance/… for a Manager (their current branch). The
 * scope is always decided by the server from the signed-in account; these calls only send filters.
 * Failures throw ApiError: 400 VALIDATION_ERROR (details per field), 404 NOT_FOUND (a branch or
 * staff member outside the scope).
 */
const base = (role) => (role === 'OWNER' ? '/owner/attendance' : '/manager/attendance');
const scoped = (role, view) => ({ branch: role === 'OWNER' ? view.branch : undefined, staff: view.staff, shift: view.shift });

/** { today, branches (Owner) | null, shifts, staff } — called without dates it covers today. */
export const loadOptions = (role, { from, to, branch, staffQuery } = {}) =>
  apiRequest(`${base(role)}/options`, { query: { from, to, branch: role === 'OWNER' ? branch : undefined, staffQuery } });

/** { filters, today, timeZones, totals, absence, byDay, byBranch (Owner, all branches) } */
export const loadSummary = (role, view, { from, to }) => apiRequest(`${base(role)}/summary`, { query: { from, to, ...scoped(role, view) } });

/** { items, total, page, pageSize, pageCount, filters, today } */
export function loadRecords(role, view, { from, to }) {
  const [sort, order] = view.sort.split(':');
  return apiRequest(`${base(role)}/records`, {
    query: { from, to, ...scoped(role, view), status: view.status, checkOut: view.checkOut, q: view.q, sort, order, page: view.page, pageSize: PAGE_SIZE },
  });
}

/** The records query for a view without paging: the export covers every matching row (Phase 2). */
export function exportQuery(role, view, { from, to }) {
  const [sort, order] = view.sort.split(':');
  return { from, to, ...scoped(role, view), status: view.status, checkOut: view.checkOut, q: view.q, sort, order };
}

export const EXPORT_FORMATS = ['pdf', 'xlsx', 'csv'];

/**
 * Every record matching the view as a file: format 'pdf' (printable report), 'xlsx' (Excel workbook:
 * Overview and Attendance Records) or 'csv' (data only). → { blob, filename, rows }; at most 10,000 rows (400 EXPORT_TOO_LARGE beyond).
 */
export function exportRecords(role, view, range, format = 'csv') {
  if (!EXPORT_FORMATS.includes(format)) throw new Error(`Unknown export format: ${format}`);
  return apiDownload(`${base(role)}/export.${format}`, { query: exportQuery(role, view, range) });
}

/**
 * The export preview for the view (JSON, not a file): { head, notes, summary, total, shown, limit,
 * overLimit, columns, rows (the first 50, as the files write them), csv, files }. The same filters as a
 * download; the download still reads and checks everything itself.
 */
export const loadExportPreview = (role, view, range) => apiRequest(`${base(role)}/export/preview`, { query: exportQuery(role, view, range) });

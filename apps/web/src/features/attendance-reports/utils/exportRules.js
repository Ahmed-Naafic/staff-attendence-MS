/*
 * Report exports in the web app (PDF, Excel, CSV; docs/reports/). The server decides scope, filters
 * and the 10,000-row limit; these helpers decide what the messages say and how a received file is
 * saved (whether a download is offered: utils/exportDialog.js). Kept free of React so `node --test`
 * can check them.
 */

export const EXPORT_MAX_ROWS = 10_000;

/** The message shown for a failed export (ApiError from apiDownload). */
export function exportErrorMessage(error) {
  if (!error) return 'The export could not be created. Try again.';
  if (error.code === 'EXPORT_TOO_LARGE') return error.message;
  if (error.status === 400) return Object.values(error.details ?? {})[0] ?? error.message;
  if (error.status === 401) return 'Your session has ended. Sign in again to export.';
  if (error.status === 403) return 'You do not have access to this export.';
  if (error.status === 404) return 'The selected branch or staff member is not part of your reports. Clear that filter and try again.';
  if (error.code === 'NETWORK_ERROR' || error.code === 'DOWNLOAD_INTERRUPTED') return error.message;
  return 'The export could not be created. Try again.';
}

export const successMessage = ({ filename, rows }) =>
  `Downloaded ${rows === null || rows === undefined ? 'the' : `${rows.toLocaleString('en')} ${rows === 1 ? 'record' : 'records'} as`} ${filename}.`;

/**
 * Runs one export: request(), then save(blob, filename). → { status: 'success', message } or
 * { status: 'error', message }. Nothing is saved when the request fails or the file is incomplete.
 */
export async function runExport({ request, save }) {
  try {
    const file = await request();
    save(file.blob, file.filename);
    return { status: 'success', message: successMessage(file) };
  } catch (error) {
    if (error?.name === 'AbortError') return { status: 'idle', message: '' };
    return { status: 'error', message: exportErrorMessage(error) };
  }
}

/**
 * Saves a received file: an object URL on a temporary link with `download`, clicked, then removed;
 * the URL is released shortly after. `doc`, `url` and `later` are injectable for tests.
 */
export function saveFile(blob, filename, { doc = globalThis.document, url = globalThis.URL, later = (fn) => setTimeout(fn, 1000) } = {}) {
  const href = url.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = href;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  doc.body.appendChild(link);
  link.click();
  link.remove();
  later(() => url.revokeObjectURL(href));
}

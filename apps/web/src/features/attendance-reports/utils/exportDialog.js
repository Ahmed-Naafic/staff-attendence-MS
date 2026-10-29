/*
 * The Export Report dialog's state and wording (no React, so `node --test` can check it). The dialog
 * offers three formats, a preview (data from the server's preview endpoint, never a file) and a
 * download (the server's export endpoint, which checks scope, dates and the row limit again).
 */
import { EXPORT_MAX_ROWS } from './exportRules.js';

export const FORMATS = [
  { id: 'pdf', label: 'PDF', extension: '.pdf', title: 'PDF report', description: 'Formatted and printable: A4 landscape pages with the summary, the records table and page numbers.' },
  { id: 'xlsx', label: 'Excel', extension: '.xlsx', title: 'Excel workbook', description: 'An Overview sheet and an Attendance Records sheet with filters and a frozen header.' },
  { id: 'csv', label: 'CSV', extension: '.csv', title: 'CSV data', description: 'Data only, one row per record, for importing into other systems.' },
];
export const formatById = (id) => FORMATS.find((f) => f.id === id) ?? FORMATS[0];

export const initialDialog = { open: false, step: 'choose', format: 'pdf' };

/**
 * open (keeps the last chosen format) · close · format (choose another; the preview stays open) ·
 * preview (show the preview) · back (return to the format choice).
 */
export function dialogReducer(state, action) {
  switch (action.type) {
    case 'open':
      return { ...state, open: true, step: 'choose' };
    case 'close':
      return { ...state, open: false, step: 'choose' };
    case 'format':
      return FORMATS.some((f) => f.id === action.format) ? { ...state, format: action.format } : state;
    case 'preview':
      return { ...state, step: 'preview' };
    case 'back':
      return { ...state, step: 'choose' };
    default:
      return state;
  }
}

/** Under the preview: how much of the report it shows. */
export function previewNote({ total, shown }) {
  if (!total) return 'No attendance records match these filters. The download is a valid, empty report.';
  if (total > shown) return `Showing the first ${shown.toLocaleString('en')} of ${total.toLocaleString('en')} records. The download contains all ${total.toLocaleString('en')}.`;
  return `Showing all ${total.toLocaleString('en')} ${total === 1 ? 'record' : 'records'}.`;
}

/** Whether the report can be downloaded (from the records total or the preview): { disabled, reason }. */
export function downloadAvailability(total) {
  if (total === null || total === undefined) return { disabled: true, reason: 'Loading the records…' };
  if (total > EXPORT_MAX_ROWS) {
    return { disabled: true, reason: `These filters match ${total.toLocaleString('en')} records; a report can contain at most ${EXPORT_MAX_ROWS.toLocaleString('en')}. Narrow the dates or filters.` };
  }
  return { disabled: false, reason: null };
}

/** The style of a preview cell, by column kind and value (the same rules as the files). */
export function cellTone(kind, value) {
  if (kind === 'status') return value === 'Late' ? 'late' : 'present';
  if (kind === 'checkOut') {
    if (value === 'Missing >24h') return 'missing';
    if (value === 'Pending') return 'pending';
    if (value === 'Not required') return 'muted';
  }
  return 'plain';
}

import { once } from 'node:events';
import { csvLine, CSV_BOM } from '../../common/csv.js';
import { PdfDocument, toWinAnsi, wrapText } from '../../common/pdf.js';
import { colName, createStyles, rowXml, sheetXml, workbookBuffer } from '../../common/xlsx.js';
import { platformTimeZone } from '../platform-settings/settings.service.js';
import { EXPORT_MAX_ROWS, exportFilename, exportPreview, localParts, readExportBatches } from './attendanceReports.service.js';

/*
 * Attendance report exports (docs/reports/; design reference:
 * docs/design/references/staff-app/"EduTrack Attendance Report Mockup.png"). The same rows, filters,
 * scope and order as the records report, at most 10,000 rows:
 *  - CSV: data only — a header row and the standard columns.
 *  - Excel (.xlsx): "Overview" (title, school, period, scope, filters, generation time, summary of the
 *    exported rows, notes — absence is not calculated) and "Attendance Records" (the standard columns,
 *    frozen header, autofilter, restrained status colours).
 * Standard columns only: never coordinates, GPS distance or accuracy, received times, upload
 * diagnostics, internal ids or account data. Read only; not audited (D21 open).
 */

const STATUS_LABEL = { PRESENT: 'Present', LATE: 'Late' };
/** Check-out cell when no check-out was recorded (the D9 states, in the export's wording). */
export const CHECK_OUT_EXPORT_LABEL = { open: 'Pending', missing: 'Missing >24h', not_required: 'Not required' };
const FILTER_STATUS = { present: 'Present', late: 'Late' };
const FILTER_CHECK_OUT = { recorded: 'Checked out', ...CHECK_OUT_EXPORT_LABEL };
const ROLE_LABEL = { OWNER: 'School Owner', MANAGER: 'Manager' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '8h 07m' — worked time from the recorded check-in and check-out; null when it cannot be calculated. */
export const formatWorked = (minutes) => (Number.isInteger(minutes) && minutes >= 0 ? `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m` : null);
const hhmm = (time) => (time ? time.slice(0, 5) : null);
/** '01 Oct 2026' for 'YYYY-MM-DD'. */
const longDay = (date) => `${date.slice(8, 10)} ${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;

/**
 * The standard columns, in order (the Excel records sheet and the CSV). Branch is for Owners only: a
 * Manager's report is always their one current branch.
 */
export const EXPORT_COLUMNS = [
  { header: 'Date', width: 12, value: (r) => r.workDate, kind: 'date' },
  { header: 'Branch', width: 22, value: (r) => r.branch.name, ownerOnly: true },
  { header: 'Staff ID', width: 22, value: (r) => r.staff.staffId },
  { header: 'Staff Name', width: 26, value: (r) => r.staff.name },
  { header: 'Job Title', width: 20, value: (r) => r.staff.jobTitle },
  { header: 'Shift', width: 16, value: (r) => r.shift.name },
  { header: 'Scheduled Start', width: 11, value: (r) => r.shift.start, kind: 'time' },
  { header: 'Check-in', width: 10, value: (r) => hhmm(r.checkIn.time), kind: 'time' },
  { header: 'Status', width: 11, value: (r) => STATUS_LABEL[r.status], kind: 'status' },
  { header: 'Check-out', width: 14, value: (r) => (r.checkOut ? hhmm(r.checkOut.time) : CHECK_OUT_EXPORT_LABEL[r.checkOutState]), kind: 'checkOut' },
  { header: 'Worked Time', width: 12, value: (r) => formatWorked(r.workedMinutes), kind: 'time' },
];
export const columnsFor = (role) => EXPORT_COLUMNS.filter((c) => role === 'OWNER' || !c.ownerOnly);

const fileHeaders = (type, filename, total) => ({
  'Content-Type': type,
  'Content-Disposition': `attachment; filename="${filename}"`,
  'X-Content-Type-Options': 'nosniff',
  'X-Export-Rows': String(total),
});
const scopeCode = (context) => context.branch?.code ?? context.school?.code;

// ---- CSV -------------------------------------------------------------------------------------

/** Writes a chunk, waiting while the client's buffer is full (returns at once if the client has gone). */
async function write(res, chunk) {
  if (res.destroyed) return;
  if (!res.write(chunk)) await Promise.race([once(res, 'drain'), once(res, 'close')]);
}

/**
 * Streams the CSV: UTF-8 BOM, the header row, then one row per record (RFC 4180; formula-like text
 * neutralized, common/csv.js). Errors before the file starts are answered as JSON by the error
 * handler; a failure after it started aborts the connection, so a partial file is never complete.
 */
export async function sendCsvExport(res, role, base, filters) {
  const columns = columnsFor(role);
  try {
    await readExportBatches(base, filters, {}, {
      stop: () => res.destroyed,
      start: async ({ total, context }) => {
        res.status(200).set(fileHeaders('text/csv; charset=utf-8', exportFilename(scopeCode(context), filters, 'csv'), total));
        await write(res, CSV_BOM + csvLine(columns.map((c) => c.header)));
      },
      batch: (records) => write(res, records.map((r) => csvLine(columns.map((c) => c.value(r)))).join('')),
    });
    res.end();
  } catch (error) {
    if (!res.headersSent) {
      for (const header of ['Content-Type', 'Content-Disposition', 'X-Export-Rows']) res.removeHeader(header);
      throw error;
    }
    console.error(error);
    res.destroy(error);
  }
}

// ---- Excel -----------------------------------------------------------------------------------

const NAVY = '001D31';
const GOLD = 'D6982D';
const STYLE_DEFS = {
  title: { font: { bold: true, size: 18, color: 'FFFFFF' }, fill: NAVY, align: { v: 'center' } },
  subtitle: { font: { bold: true, size: 12, color: 'FFFFFF' }, fill: NAVY, align: { v: 'center' } },
  band: { font: { size: 10, color: 'D9E2EC' }, fill: NAVY, align: { v: 'center' } },
  gold: { fill: GOLD },
  label: { font: { bold: true, color: '4A566B' }, align: { v: 'top' } },
  value: { align: { v: 'top', wrap: true } },
  section: { font: { bold: true, size: 13, color: NAVY }, border: { bottom: { style: 'medium', color: GOLD } } },
  cardInfoLabel: { font: { bold: true, color: '0B4F82' }, fill: 'E0F0FE' },
  cardInfoValue: { font: { bold: true, size: 20, color: NAVY }, fill: 'E0F0FE', align: { h: 'left' } },
  cardPresentLabel: { font: { bold: true, color: '0F6B45' }, fill: 'D6F5E8' },
  cardPresentValue: { font: { bold: true, size: 20, color: '0F6B45' }, fill: 'D6F5E8', align: { h: 'left' } },
  cardLateLabel: { font: { bold: true, color: '7A4F00' }, fill: 'FDECC7' },
  cardLateValue: { font: { bold: true, size: 20, color: '7A4F00' }, fill: 'FDECC7', align: { h: 'left' } },
  cardOutLabel: { font: { bold: true, color: '4C3A8C' }, fill: 'EDE9FB' },
  cardOutValue: { font: { bold: true, size: 20, color: '4C3A8C' }, fill: 'EDE9FB', align: { h: 'left' } },
  cardMissingLabel: { font: { bold: true, color: 'B42318' }, fill: 'FEE4E2' },
  cardMissingValue: { font: { bold: true, size: 20, color: 'B42318' }, fill: 'FEE4E2', align: { h: 'left' } },
  note: { font: { color: '4A566B' }, align: { v: 'top', wrap: true } },
  noteStrong: { font: { bold: true, color: '7A4F00' }, fill: 'FDF6E7', align: { v: 'top', wrap: true } },
  sheetTitle: { font: { bold: true, size: 14, color: 'FFFFFF' }, fill: NAVY, align: { v: 'center' } },
  header: {
    font: { bold: true, color: 'FFFFFF' },
    fill: NAVY,
    align: { h: 'center', v: 'center', wrap: true },
    border: { color: '0A2F4A', bottom: { style: 'medium', color: GOLD } },
  },
  text: { border: 'thin', align: { v: 'center' } },
  date: { border: 'thin', align: { h: 'center', v: 'center' }, numFmt: 'yyyy-mm-dd' },
  time: { border: 'thin', align: { h: 'center', v: 'center' } },
  present: { font: { bold: true, color: '0F6B45' }, fill: 'D6F5E8', border: 'thin', align: { h: 'center', v: 'center' } },
  late: { font: { bold: true, color: '7A4F00' }, fill: 'FDECC7', border: 'thin', align: { h: 'center', v: 'center' } },
  missing: { font: { color: 'B42318' }, fill: 'FEF3F2', border: 'thin', align: { h: 'center', v: 'center' } },
  pending: { font: { italic: true, color: '4A566B' }, border: 'thin', align: { h: 'center', v: 'center' } },
  notRequired: { font: { color: '617087' }, border: 'thin', align: { h: 'center', v: 'center' } },
  empty: { font: { italic: true, color: '617087' } },
};
const styles = createStyles(STYLE_DEFS);
const S = styles.id;

/** The style of a records cell. */
function cellStyle(column, value) {
  if (column.kind === 'date') return S.date;
  if (column.kind === 'status') return value === 'Late' ? S.late : S.present;
  if (column.kind === 'checkOut') {
    if (value === CHECK_OUT_EXPORT_LABEL.missing) return S.missing;
    if (value === CHECK_OUT_EXPORT_LABEL.open) return S.pending;
    if (value === CHECK_OUT_EXPORT_LABEL.not_required) return S.notRequired;
    return S.time;
  }
  return column.kind === 'time' ? S.time : S.text;
}

/** One Attendance Records row (sheet row `number`): dates as real dates, each cell with its style. */
export const recordRowXml = (columns, record, number) =>
  rowXml(
    number,
    columns.map((c) => {
      const value = c.value(record);
      return [c.kind === 'date' ? { date: value } : value, cellStyle(c, value)];
    }),
  );

/**
 * The report's heading, shared by the Excel Overview, the PDF and the preview: title, school, period,
 * scope, filters, time zones and generation.
 */
export function reportHeader({ role, filters, context, timeZones, generated }) {
  const branch = context.branch ? `${context.branch.name} (${context.branch.code})` : null;
  return {
    title: 'EduTrack – Attendance Report',
    school: context.school?.name ?? '',
    period: filters.from === filters.to ? longDay(filters.from) : `${longDay(filters.from)} – ${longDay(filters.to)}`,
    scope: role === 'OWNER' ? (branch ?? 'All branches') : `Branch: ${branch}`,
    filters: filterText(filters, context),
    timeZones,
    generatedOn: `${longDay(generated.date)}, ${generated.time} (${generated.timeZone})`,
    generatedBy: ROLE_LABEL[role],
    reportType: 'Attendance records',
  };
}

/** The notes printed with every report (Excel Overview, PDF, preview). */
export const reportNotes = (timeZones, total) => [
  'Absence is not calculated yet. Days without a check-in are not listed and are not counted as absent.',
  'One row per accepted check-in, with its check-out when one was recorded. The status (Present or Late) is the one recorded at check-in.',
  `Times are branch times (${timeZones.join(', ')}), from the schedule in effect on each day. Dates are work dates; both ends of the period are included.`,
  'Check-out: a time when recorded; Pending = a check-out can still be recorded or uploaded (until 24 hours after the work day ends); Missing >24h = none was recorded in that time; Not required = check-out was not used that day.',
  'Worked time is calculated from the recorded check-in and check-out; it is blank when there is no check-out.',
  `${total.toLocaleString('en')} ${total === 1 ? 'row' : 'rows'} (an export contains at most ${EXPORT_MAX_ROWS.toLocaleString('en')}).`,
];

/** Generation time in the platform time zone: { date, time 'HH:MM', timeZone, at }. */
async function generatedAt(at = new Date()) {
  const timeZone = await platformTimeZone();
  const local = localParts(at, timeZone);
  return { date: local.date, time: local.time.slice(0, 5), timeZone, at };
}

/** The filters in words (none → 'None'). */
function filterText(filters, context) {
  const parts = [
    context.staff && `Staff: ${context.staff.name} (${context.staff.staffId})`,
    context.shift && `Shift: ${context.shift}`,
    filters.status && `Status: ${FILTER_STATUS[filters.status]}`,
    filters.checkOut && `Check-out: ${FILTER_CHECK_OUT[filters.checkOut]}`,
    filters.q && `Search: "${filters.q}"`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'None';
}

/**
 * The workbook for the collected rows. summary: counts of the exported rows (they match the
 * Attendance Records sheet exactly, including its filters).
 */
export function buildAttendanceWorkbook({ role, filters, context, recordRows, total, summary, timeZones, generated }) {
  const columns = columnsFor(role);
  const last = colName(columns.length - 1);
  const head = reportHeader({ role, filters, context, timeZones, generated });

  // Overview
  const o = [];
  const merges = [];
  const wide = (row) => merges.push(`A${row}:F${row}`);
  o.push(rowXml(1, [[head.title, S.title], ...Array(5).fill([null, S.title])], { height: 34 }));
  wide(1);
  o.push(rowXml(2, [[head.school, S.subtitle], ...Array(5).fill([null, S.subtitle])], { height: 22 }));
  wide(2);
  o.push(rowXml(3, [[`Period: ${head.period}   |   Time zone: ${head.timeZones.join(', ')}`, S.band], ...Array(5).fill([null, S.band])], { height: 20 }));
  wide(3);
  o.push(rowXml(4, Array(6).fill([null, S.gold]), { height: 4 }));
  wide(4);
  const details = [
    ['Scope', head.scope],
    ['Filters', head.filters],
    ['Generated on', head.generatedOn],
    ['Generated by', head.generatedBy],
    ['Report type', head.reportType],
  ];
  details.forEach(([label, value], i) => {
    const row = 6 + i;
    o.push(rowXml(row, [[label, S.label], [value, S.value], [null, S.value], [null, S.value], [null, S.value], [null, S.value]]));
    merges.push(`B${row}:F${row}`);
  });
  const sumRow = 6 + details.length + 1;
  o.push(rowXml(sumRow, [['Summary of the records in this report', S.section], ...Array(5).fill([null, S.section])], { height: 20 }));
  wide(sumRow);
  const cards = [
    ['Check-ins', summary.checkIns, 'Info'],
    ['Present', summary.present, 'Present'],
    ['Late', summary.late, 'Late'],
    ['Checked out', summary.checkedOut, 'Out'],
    ['No check-out (>24h)', summary.missing, 'Missing'],
  ];
  o.push(rowXml(sumRow + 1, cards.map(([label, , tone]) => [label, S[`card${tone}Label`]]), { height: 20 }));
  o.push(rowXml(sumRow + 2, cards.map(([, value, tone]) => [value, S[`card${tone}Value`]]), { height: 32 }));
  o.push(rowXml(sumRow + 3, [[`Also: pending check-out ${summary.pending} · check-out not required ${summary.notRequired} · staff with records ${summary.staff}`, S.note]]));
  merges.push(`A${sumRow + 3}:F${sumRow + 3}`);
  const notesRow = sumRow + 5;
  o.push(rowXml(notesRow, [['Notes', S.section], ...Array(5).fill([null, S.section])], { height: 20 }));
  wide(notesRow);
  const notes = reportNotes(head.timeZones, total).map((text, i) => [text, i === 0 ? S.noteStrong : S.note]);
  notes.forEach(([text, style], i) => {
    const row = notesRow + 1 + i;
    o.push(rowXml(row, [[text, style], ...Array(5).fill([null, style])], { height: 30 }));
    merges.push(`A${row}:F${row}`);
  });
  const overview = sheetXml({ widths: [20, 20, 20, 20, 22, 20], rows: o, merges, tabColor: NAVY, selected: true, lastRef: `F${notesRow + notes.length}` });

  // Attendance Records
  const titleCells = [[`Attendance Records — ${head.school} · ${head.scope} · ${head.period}`, S.sheetTitle], ...Array(columns.length - 1).fill([null, S.sheetTitle])];
  const rows = [rowXml(1, titleCells, { height: 26 }), rowXml(2, columns.map((c) => [c.header, S.header]), { height: 30 }), ...recordRows];
  const recordMerges = [`A1:${last}1`];
  const lastRow = total ? total + 2 : 3;
  if (!total) {
    rows.push(rowXml(3, [['No attendance records match these filters.', S.empty]]));
    recordMerges.push(`A3:${last}3`);
  }
  const filterRef = `A2:${last}${total ? total + 2 : 2}`;
  const records = sheetXml({ widths: columns.map((c) => c.width), rows, merges: recordMerges, freezeRows: 2, autoFilter: filterRef, tabColor: GOLD, landscape: true, lastRef: `${last}${lastRow}` });

  return workbookBuffer({
    sheets: [
      { name: 'Overview', xml: overview },
      { name: 'Attendance Records', xml: records },
    ],
    stylesXml: styles.xml,
    title: head.title,
    filterRefs: { 1: `'Attendance Records'!$A$2:$${last}$${total ? total + 2 : 2}` },
    created: generated.at,
  });
}

/**
 * Builds and sends the Excel workbook. The rows are read in batches into the sheet's XML (at most
 * 10,000 rows); nothing is sent until the workbook is complete, so any failure is answered as JSON.
 * The Overview summary is counted by the database in the same snapshot as the rows.
 */
export async function sendXlsxExport(res, role, base, filters) {
  const columns = columnsFor(role);
  const recordRows = [];
  let info;
  const at = new Date();
  await readExportBatches(base, filters, { now: at, withSummary: true }, {
    start: (value) => {
      info = value;
    },
    batch: (records) => {
      for (const r of records) recordRows.push(recordRowXml(columns, r, recordRows.length + 3));
    },
  });
  const { total, context, summary, timeZones } = info;
  const buffer = buildAttendanceWorkbook({ role, filters, context, recordRows, total, summary, timeZones, generated: await generatedAt(at) });
  res
    .status(200)
    .set(fileHeaders('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', exportFilename(scopeCode(context), filters, 'xlsx'), total))
    .send(buffer);
}

// ---- PDF -------------------------------------------------------------------------------------

/*
 * The PDF report: A4 landscape (the 10–11 columns need the width). Page 1 starts with the navy title
 * band (school, period, time zones; generation on the right), the scope and filters, the five summary
 * cards and the absence note; then the Attendance Records table. The table header is repeated on
 * every page; text wraps inside its column (long words are split), so nothing overlaps or is cut off;
 * rows never split across pages. Every page has a footer with the report name and "Page X of Y".
 * The notes follow the table.
 */
const PAGE = { width: 842, height: 595, margin: 32, bottom: 34 };
const TABLE_FONT = 8;
const LINE = 10;
const CELL_PAD = 4;
// Relative column widths (Owner); the Manager's report gives Branch's share to Staff Name and Job Title.
// Every header word fits its column at 8 pt bold ("Scheduled" needs about 50 pt with padding).
const PDF_WIDTHS = { Date: 56, Branch: 80, 'Staff ID': 104, 'Staff Name': 114, 'Job Title': 80, Shift: 62, 'Scheduled Start': 58, 'Check-in': 46, Status: 48, 'Check-out': 70, 'Worked Time': 60 };
const PDF_COLOURS = {
  present: { fill: 'D6F5E8', text: '0F6B45', font: 'bold' },
  late: { fill: 'FDECC7', text: '7A4F00', font: 'bold' },
  missing: { fill: 'FEF3F2', text: 'B42318', font: 'regular' },
  pending: { text: '4A566B', font: 'italic' },
  notRequired: { text: '617087', font: 'regular' },
};

/** The role's columns with their x position and width on the page. */
export function pdfColumns(role) {
  const columns = columnsFor(role);
  const usable = PAGE.width - 2 * PAGE.margin;
  const widths = columns.map((c) => PDF_WIDTHS[c.header]);
  if (role !== 'OWNER') {
    widths[columns.findIndex((c) => c.header === 'Staff Name')] += 44;
    widths[columns.findIndex((c) => c.header === 'Job Title')] += 40;
  }
  const scale = usable / widths.reduce((a, b) => a + b, 0);
  let x = PAGE.margin;
  return columns.map((c, i) => {
    const width = widths[i] * scale;
    const column = { ...c, x, width };
    x += width;
    return column;
  });
}
export const PDF_TABLE = { font: TABLE_FONT, padding: CELL_PAD, page: PAGE };

const pdfCellLook = (column, value) => {
  if (column.kind === 'status') return value === 'Late' ? PDF_COLOURS.late : PDF_COLOURS.present;
  if (column.kind === 'checkOut') {
    if (value === CHECK_OUT_EXPORT_LABEL.missing) return PDF_COLOURS.missing;
    if (value === CHECK_OUT_EXPORT_LABEL.open) return PDF_COLOURS.pending;
    if (value === CHECK_OUT_EXPORT_LABEL.not_required) return PDF_COLOURS.notRequired;
  }
  return { text: '0D1932', font: 'regular' };
};

/** Builds the PDF report page by page: the constructor draws page 1's heading, `add` appends rows, `finish` returns the file. */
export class AttendancePdf {
  constructor({ role, head, summary, total }) {
    Object.assign(this, { role, head, summary, total, columns: pdfColumns(role), rows: 0 });
    this.doc = new PdfDocument({ width: PAGE.width, height: PAGE.height, title: `${head.title} — ${head.school}`, created: new Date() });
    this.#firstPage();
  }

  /** wrapText, noting on the document when a character had to be replaced (the page then says so). */
  #wrap(text, font, size, width) {
    if (toWinAnsi(text).replaced) this.doc.replacedCharacters = true;
    return wrapText(text, font, size, width);
  }

  #firstPage() {
    const { doc, head, summary } = this;
    const m = PAGE.margin;
    doc.addPage();
    doc.rect(0, 0, PAGE.width, 82, NAVY);
    doc.rect(0, 82, PAGE.width, 3, GOLD);
    doc.text(head.title, m, 34, { font: 'bold', size: 20, color: 'FFFFFF' });
    // The school name on one line beside the generation details; a longer name continues in the details below.
    const school = this.#wrap(head.school, 'bold', 11, 430);
    doc.text(school[0], m, 53, { font: 'bold', size: 11, color: 'FFFFFF' });
    doc.text(`Period: ${head.period}   |   Time zone: ${head.timeZones.join(', ')}`, m, 70, { size: 9, color: 'D9E2EC' });
    const right = PAGE.width - m - 300;
    [`Generated on: ${head.generatedOn}`, `Generated by: ${head.generatedBy}`, `Report type: ${head.reportType}`].forEach((line, i) =>
      doc.text(line, right, 32 + i * 14, { size: 8.5, color: 'D9E2EC', align: 'right', width: 300 }),
    );
    let y = 104;
    const details = [...(school.length > 1 ? [['School', head.school]] : []), ['Scope', head.scope], ['Filters', head.filters]];
    for (const [label, value] of details) {
      doc.text(label, m, y, { font: 'bold', size: 9, color: '4A566B' });
      const lines = this.#wrap(value, 'regular', 9, PAGE.width - 2 * m - 70);
      lines.forEach((line, i) => doc.text(line, m + 70, y + i * 12, { size: 9 }));
      y += lines.length * 12 + 2;
    }
    y += 6;
    const cards = [
      ['Check-ins', summary.checkIns, 'E0F0FE', '0B4F82'],
      ['Present', summary.present, 'D6F5E8', '0F6B45'],
      ['Late', summary.late, 'FDECC7', '7A4F00'],
      ['Checked out', summary.checkedOut, 'EDE9FB', '4C3A8C'],
      ['No check-out (>24h)', summary.missing, 'FEE4E2', 'B42318'],
    ];
    const gap = 10;
    const cardWidth = (PAGE.width - 2 * m - gap * (cards.length - 1)) / cards.length;
    cards.forEach(([label, value, fill, color], i) => {
      const x = m + i * (cardWidth + gap);
      doc.rect(x, y, cardWidth, 46, fill);
      doc.text(label, x + 10, y + 16, { font: 'bold', size: 9, color });
      doc.text(value.toLocaleString('en'), x + 10, y + 38, { font: 'bold', size: 18, color });
    });
    y += 46 + 14;
    doc.text(`Also: pending check-out ${summary.pending} · check-out not required ${summary.notRequired} · staff with records ${summary.staff}`, m, y, { size: 8.5, color: '4A566B' });
    y += 10;
    doc.rect(m, y, PAGE.width - 2 * m, 20, 'FDF6E7');
    doc.text(reportNotes(head.timeZones, this.total)[0], m + 8, y + 13, { font: 'bold', size: 8.5, color: '7A4F00' });
    y += 34;
    doc.text('Attendance Records', m, y, { font: 'bold', size: 12, color: NAVY });
    doc.rect(m, y + 5, PAGE.width - 2 * m, 1.5, GOLD);
    this.y = y + 12;
    this.#tableHeader();
  }

  #continuationPage() {
    this.doc.addPage();
    const title = this.#wrap(`Attendance Records — ${this.head.school} · ${this.head.period} (continued)`, 'bold', 9, PAGE.width - 2 * PAGE.margin)[0];
    this.doc.text(title, PAGE.margin, 26, { font: 'bold', size: 9, color: NAVY });
    this.y = 34;
    this.#tableHeader();
  }

  #tableHeader() {
    const { doc, columns } = this;
    const labels = columns.map((c) => this.#wrap(c.header, 'bold', TABLE_FONT, c.width - 2 * CELL_PAD));
    const height = Math.max(...labels.map((l) => l.length)) * LINE + 8;
    doc.rect(PAGE.margin, this.y, PAGE.width - 2 * PAGE.margin, height, NAVY);
    doc.rect(PAGE.margin, this.y + height - 1.5, PAGE.width - 2 * PAGE.margin, 1.5, GOLD);
    columns.forEach((c, i) => labels[i].forEach((line, j) => doc.text(line, c.x + CELL_PAD, this.y + 11 + j * LINE, { font: 'bold', size: TABLE_FONT, color: 'FFFFFF' })));
    this.y += height;
  }

  /** Appends report rows (a new page, with the table header, before any row that does not fit). */
  add(records) {
    const { doc, columns } = this;
    for (const r of records) {
      const cells = columns.map((c) => {
        const value = c.value(r) ?? '';
        const look = pdfCellLook(c, value);
        return { column: c, look, lines: this.#wrap(String(value), look.font, TABLE_FONT, c.width - 2 * CELL_PAD) };
      });
      const height = Math.max(...cells.map((cell) => cell.lines.length)) * LINE + 6;
      if (this.y + height > PAGE.height - PAGE.bottom) this.#continuationPage();
      if (this.rows % 2 === 1) doc.rect(PAGE.margin, this.y, PAGE.width - 2 * PAGE.margin, height, 'F7F9FC');
      for (const { column, look, lines } of cells) {
        if (look.fill) doc.rect(column.x + 1, this.y + 1, column.width - 2, height - 2, look.fill);
        lines.forEach((line, j) => doc.text(line, column.x + CELL_PAD, this.y + 10 + j * LINE, { font: look.font, size: TABLE_FONT, color: look.text }));
      }
      doc.line(PAGE.margin, this.y + height, PAGE.width - PAGE.margin, this.y + height, 'E3E9F0', 0.5);
      this.y += height;
      this.rows += 1;
    }
  }

  /** The notes after the table, the footers, and the file. */
  finish() {
    const { doc, head } = this;
    if (!this.rows) {
      doc.text('No attendance records match these filters.', PAGE.margin + CELL_PAD, this.y + 14, { font: 'italic', size: 9, color: '617087' });
      this.y += 22;
    }
    const notes = reportNotes(head.timeZones, this.total)
      .slice(1)
      .map((note) => this.#wrap(note, 'regular', 8, PAGE.width - 2 * PAGE.margin));
    const needed = 26 + notes.reduce((n, lines) => n + lines.length * 10 + 3, 0);
    if (this.y + needed > PAGE.height - PAGE.bottom) {
      doc.addPage();
      this.y = 20;
    }
    this.y += 20;
    doc.text('Notes', PAGE.margin, this.y, { font: 'bold', size: 10, color: NAVY });
    this.y += 6;
    for (const lines of notes) {
      for (const line of lines) {
        this.y += 10;
        doc.text(line, PAGE.margin, this.y, { size: 8, color: '4A566B' });
      }
      this.y += 3;
    }
    const footer = this.#wrap(`${head.title} · ${head.school} · ${head.period}`, 'regular', 7.5, 560)[0];
    return doc.toBuffer((page, pages) => {
      doc.line(PAGE.margin, PAGE.height - 22, PAGE.width - PAGE.margin, PAGE.height - 22, 'D3DCE6', 0.5);
      doc.text(footer, PAGE.margin, PAGE.height - 12, { size: 7.5, color: '73819A' });
      doc.text(`Page ${page} of ${pages}`, PAGE.width - PAGE.margin - 120, PAGE.height - 12, { size: 7.5, color: '73819A', align: 'right', width: 120 });
      if (doc.replacedCharacters && page === 1) {
        doc.text('Some characters cannot be shown in this PDF (shown as ?); the Excel and CSV exports contain the exact text.', PAGE.margin, PAGE.height - 26, { size: 7, color: 'B42318' });
      }
    });
  }
}

/**
 * Builds and sends the PDF. Rows are read in batches and drawn page by page (each finished page is
 * compressed at once); nothing is sent until the file is complete, so any failure is answered as JSON.
 */
export async function sendPdfExport(res, role, base, filters) {
  let pdf;
  let info;
  const at = new Date();
  const generated = await generatedAt(at);
  await readExportBatches(base, filters, { now: at, withSummary: true }, {
    start: (value) => {
      info = value;
      const head = reportHeader({ role, filters, context: value.context, timeZones: value.timeZones, generated });
      pdf = new AttendancePdf({ role, head, summary: value.summary, total: value.total });
    },
    batch: (records) => pdf.add(records),
  });
  const buffer = pdf.finish();
  res.status(200).set(fileHeaders('application/pdf', exportFilename(scopeCode(info.context), filters, 'pdf'), info.total)).send(buffer);
}

// ---- preview ---------------------------------------------------------------------------------

/**
 * The export preview (JSON, not a file): the heading, notes, summary and total of every matching row,
 * the role's columns, and the first rows formatted exactly as the exports write them (values, the
 * kind of each cell for styling, and the same rows as CSV lines). A download reads everything again.
 */
export async function previewExport(role, base, filters) {
  const at = new Date();
  const { context, total, summary, timeZones, records, limit, overLimit } = await exportPreview(base, filters, { now: at });
  const columns = columnsFor(role);
  const head = reportHeader({ role, filters, context, timeZones, generated: await generatedAt(at) });
  const rows = records.map((r) => columns.map((c) => c.value(r) ?? ''));
  return {
    head,
    notes: reportNotes(timeZones, total),
    summary,
    total,
    limit,
    overLimit,
    columns: columns.map((c) => ({ header: c.header, kind: c.kind ?? 'text' })),
    rows,
    shown: rows.length,
    csv: [csvLine(columns.map((c) => c.header)), ...rows.map((row) => csvLine(row))].join(''),
    files: Object.fromEntries(['pdf', 'xlsx', 'csv'].map((ext) => [ext, exportFilename(scopeCode(context), filters, ext)])),
  };
}

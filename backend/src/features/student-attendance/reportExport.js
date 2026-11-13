import { csvLine, CSV_BOM } from '../../common/csv.js';
import { colName, createStyles, rowXml, sheetXml, workbookBuffer } from '../../common/xlsx.js';

/*
 * Student attendance report exports (docs/business-rules.md → Student attendance → Reports): the
 * same report as the screen, every student (not one page).
 *  - CSV: the students, one row each (formula-safe, UTF-8 with a byte-order mark).
 *  - Excel (.xlsx): "Overview" (school, period, source, filters, totals, how the rate is counted),
 *    "Sections" (completion and marks per section) and "Students" (lowest rate first; frozen header,
 *    autofilter).
 * Student numbers and names only: no contact details, guardians or internal ids. Read only.
 */

const SOURCE_LABEL = { manager: 'Daily attendance (Managers)', lessons: 'Lesson attendance (teachers)' };
const rateText = (rate) => (rate === null ? '' : rate);

const STUDENT_COLUMNS = [
  { header: 'Student ID', width: 22, value: (r) => r.student.number },
  { header: 'Student Name', width: 28, value: (r) => r.student.name },
  { header: 'Branch', width: 20, value: (r) => r.branch ?? '', ownerOnly: true },
  { header: 'Section', width: 18, value: (r) => r.sections.join(', ') },
  { header: 'Present', width: 10, value: (r) => r.counts.present, number: true },
  { header: 'Late', width: 8, value: (r) => r.counts.late, number: true },
  { header: 'Absent', width: 9, value: (r) => r.counts.absent, number: true },
  { header: 'Excused', width: 9, value: (r) => r.counts.excused, number: true },
  { header: 'Not Marked', width: 11, value: (r) => r.counts.notMarked, number: true },
  { header: 'Attendance %', width: 13, value: (r) => rateText(r.rate), number: true },
];
const SECTION_COLUMNS = [
  { header: 'Section', width: 18, value: (s) => s.section.displayName },
  { header: 'Branch', width: 20, value: (s) => s.section.branch.name, ownerOnly: true },
  { header: 'Expected', width: 10, value: (s) => s.completion.expected, number: true },
  { header: 'Taken', width: 8, value: (s) => s.completion.taken, number: true },
  { header: 'Complete', width: 10, value: (s) => s.completion.complete, number: true },
  { header: 'Missing', width: 9, value: (s) => s.completion.missing, number: true },
  { header: 'Present', width: 10, value: (s) => s.counts.present, number: true },
  { header: 'Late', width: 8, value: (s) => s.counts.late, number: true },
  { header: 'Absent', width: 9, value: (s) => s.counts.absent, number: true },
  { header: 'Excused', width: 9, value: (s) => s.counts.excused, number: true },
  { header: 'Not Marked', width: 11, value: (s) => s.counts.notMarked, number: true },
  { header: 'Attendance %', width: 13, value: (s) => rateText(s.rate), number: true },
];
const forRole = (columns, role) => columns.filter((c) => role === 'OWNER' || !c.ownerOnly);

export const reportFilename = (code, report, ext) => `student-attendance-${code}-${report.filters.source}-${report.filters.from}-to-${report.filters.to}.${ext}`;

const fileHeaders = (type, filename, rows) => ({
  'Content-Type': type,
  'Content-Disposition': `attachment; filename="${filename}"`,
  'X-Content-Type-Options': 'nosniff',
  'X-Export-Rows': String(rows),
});

/** CSV of the report's students. */
export function sendReportCsv(res, { role, report, code }) {
  const columns = forRole(STUDENT_COLUMNS, role);
  const body = CSV_BOM + csvLine(columns.map((c) => c.header)) + report.students.map((r) => csvLine(columns.map((c) => c.value(r)))).join('');
  res.status(200).set(fileHeaders('text/csv; charset=utf-8', reportFilename(code, report, 'csv'), report.students.length)).send(body);
}

const NAVY = '001D31';
const GOLD = 'D6982D';
const styles = createStyles({
  title: { font: { bold: true, size: 16, color: 'FFFFFF' }, fill: NAVY, align: { v: 'center' } },
  label: { font: { bold: true, color: '4A566B' }, align: { v: 'top' } },
  value: { align: { v: 'top', wrap: true } },
  note: { font: { color: '4A566B' }, align: { v: 'top', wrap: true } },
  header: { font: { bold: true, color: 'FFFFFF' }, fill: NAVY, align: { h: 'center', v: 'center', wrap: true }, border: { color: '0A2F4A', bottom: { style: 'medium', color: GOLD } } },
  text: { border: 'thin', align: { v: 'center' } },
  number: { border: 'thin', align: { h: 'center', v: 'center' } },
  low: { font: { bold: true, color: 'B42318' }, fill: 'FEF3F2', border: 'thin', align: { h: 'center', v: 'center' } },
});
const S = styles.id;

function tableSheet(columns, items, { lowAt } = {}) {
  const last = colName(columns.length - 1);
  const rows = [rowXml(1, columns.map((c) => [c.header, S.header]), { height: 30 })];
  items.forEach((item, i) => {
    rows.push(
      rowXml(
        i + 2,
        columns.map((c) => {
          const v = c.value(item);
          const low = c.header === 'Attendance %' && typeof v === 'number' && lowAt !== undefined && v < lowAt;
          return [v === '' ? null : v, low ? S.low : c.number ? S.number : S.text];
        }),
      ),
    );
  });
  const lastRow = items.length + 1;
  return { xml: sheetXml({ widths: columns.map((c) => c.width), rows, freezeRows: 1, autoFilter: `A1:${last}${lastRow}`, lastRef: `${last}${lastRow}` }), filter: `$A$1:$${last}$${lastRow}` };
}

/** Excel workbook of the report. `context`: { schoolName, scopeName, generatedBy }. */
export function sendReportXlsx(res, { role, report, code, context, generated = new Date() }) {
  const f = report.filters;
  const t = report.totals;
  const facts = [
    ['School', context.schoolName],
    ['Branch', context.scopeName],
    ['Period', `${f.from} to ${f.to}`],
    ['Source', SOURCE_LABEL[f.source]],
    ...(f.below ? [['Students below', `${f.below}%`]] : []),
    ['Generated', `${generated.toISOString().slice(0, 16).replace('T', ' ')} UTC by ${context.generatedBy}`],
    ['', ''],
    ['Students', t.students],
    ['Attendance rate', t.rate === null ? '—' : `${t.rate}%`],
    ['Present / Late / Absent', `${t.present} / ${t.late} / ${t.absent}`],
    ['Excused / Not marked', `${t.excused} / ${t.notMarked}`],
    [f.source === 'manager' ? 'Sessions taken / expected' : 'Lessons taken / expected', `${t.completion.taken} / ${t.completion.expected} (missing ${t.completion.missing})`],
  ];
  const overviewRows = [rowXml(1, [['Student Attendance Report', S.title], [null, S.title]], { height: 28 })];
  facts.forEach(([label, value], i) => overviewRows.push(rowXml(i + 2, [[label, S.label], [value === '' ? null : value, S.value]])));
  const n = facts.length + 3;
  overviewRows.push(rowXml(n, [['How it is counted', S.label], ['Attendance rate = (present + late) ÷ (present + late + absent). Excused and unmarked students are not counted as absent. Excuses are applied as recorded when the report was made. Sessions never taken have no marks: see the Sections sheet (Missing).', S.note]], { height: 60 }));
  const overview = sheetXml({ widths: [26, 70], rows: overviewRows, merges: ['A1:B1'], lastRef: `B${n}` });
  const sections = tableSheet(forRole(SECTION_COLUMNS, role), report.sections, { lowAt: f.below ?? undefined });
  const students = tableSheet(forRole(STUDENT_COLUMNS, role), report.students, { lowAt: f.below ?? 80 });
  const buffer = workbookBuffer({
    sheets: [
      { name: 'Overview', xml: overview },
      { name: 'Sections', xml: sections.xml },
      { name: 'Students', xml: students.xml },
    ],
    stylesXml: styles.xml,
    title: 'Student Attendance Report',
    filterRefs: { 1: `'Sections'!${sections.filter}`, 2: `'Students'!${students.filter}` },
    created: generated,
  });
  res.status(200).set(fileHeaders('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', reportFilename(code, report, 'xlsx'), report.students.length)).send(buffer);
}

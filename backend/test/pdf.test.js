/*
 * The PDF writer (common/pdf.js) and the attendance PDF layout (attendanceExport.js → AttendancePdf):
 * valid structure, text encoding, wrapping that never exceeds its width or drops text, repeated table
 * headers and page numbers. Pure functions; no database. (The generated files were also opened with
 * pypdf in strict mode and rendered with PDFium while developing; see docs/design/implementation-log.md.)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PdfDocument, textWidth, toWinAnsi, wrapText } from '../src/common/pdf.js';
import { AttendancePdf, PDF_TABLE, pdfColumns, reportHeader } from '../src/features/attendance/attendanceExport.js';
import { readPdf } from './support/pdfReader.js';

test('a valid PDF: header, objects at their xref offsets, pages in order, text, UTF-16 title', () => {
  const doc = new PdfDocument({ title: 'Report – 😀' });
  doc.addPage();
  doc.rect(10, 10, 100, 20, '001D31');
  doc.text('First (page) \\ é — ok', 20, 40, { font: 'bold' });
  doc.addPage();
  doc.line(0, 0, 100, 100);
  doc.text('Second', 20, 40);
  const pdf = readPdf(doc.toBuffer((page, pages) => doc.text(`Page ${page} of ${pages}`, 700, 580)));
  assert.equal(pdf.pageCount, 2);
  assert.deepEqual(pdf.pages[0].lines, ['First (page) \\ é — ok', 'Page 1 of 2']);
  assert.deepEqual(pdf.pages[1].lines, ['Second', 'Page 2 of 2']);
  assert.match(pdf.info, /\/Title <FEFF[0-9A-F]+>/);
});

test('encoding: Latin text kept; marks dropped to the base letter; other scripts become "?" and are flagged; idempotent', () => {
  assert.deepEqual(toWinAnsi('Café – “x”'), { text: 'Café \u0096 \u0093x\u0094', replaced: false });
  assert.deepEqual(toWinAnsi('Cāmil'), { text: 'Camil', replaced: false });
  assert.deepEqual(toWinAnsi('محمد'), { text: '????', replaced: true });
  assert.deepEqual(toWinAnsi(toWinAnsi('a – b').text), toWinAnsi('a – b'));
  assert.equal(toWinAnsi('a\tb\nc').text, 'a b c');
});

test('wrapping: every line fits; no word or character is lost; very long words are split', () => {
  const text = 'Maryam Abdirahman Mohamed Abdullahi Hassan Supercalifragilisticexpialidocious Warsame';
  for (const width of [40, 60, 120, 300]) {
    const lines = wrapText(text, 'regular', 8, width);
    for (const line of lines) assert.ok(textWidth(line, 'regular', 8) <= width, `${JSON.stringify(line)} ≤ ${width}`);
    assert.equal(lines.join('').replace(/ /g, ''), text.replace(/ /g, ''));
  }
  assert.deepEqual(wrapText('', 'regular', 8, 50), ['']);
  // Codes break after a hyphen, not inside a number.
  assert.deepEqual(wrapText('X6DFAB4-A-B001-ST0007', 'regular', 8, 88), ['X6DFAB4-A-B001-', 'ST0007']);
  // Measured widths never under-estimate the real Helvetica widths (W is the widest capital).
  assert.ok(textWidth('W', 'regular', 10) >= 9.44);
  assert.ok(textWidth('Scheduled', 'bold', 8) <= pdfColumns('OWNER').find((c) => c.header === 'Scheduled Start').width - 2 * PDF_TABLE.padding);
});

test('columns: Owner 11 and Manager 10 (no Branch), filling the landscape page width exactly', () => {
  for (const [role, count] of [['OWNER', 11], ['MANAGER', 10]]) {
    const columns = pdfColumns(role);
    assert.equal(columns.length, count);
    assert.equal(columns.some((c) => c.header === 'Branch'), role === 'OWNER');
    const last = columns.at(-1);
    assert.ok(Math.abs(last.x + last.width - (PDF_TABLE.page.width - PDF_TABLE.page.margin)) < 0.01);
  }
});

test('the report: header repeated on every page, page numbers, long text kept, notes, and the replacement note only when needed', () => {
  const head = reportHeader({
    role: 'OWNER',
    filters: { from: '2026-10-01', to: '2026-10-28' },
    context: { school: { name: 'A School', code: 'S' }, branch: null, staff: null, shift: null },
    timeZones: ['Africa/Mogadishu'],
    generated: { date: '2026-10-29', time: '14:30', timeZone: 'Africa/Mogadishu' },
  });
  const long = 'Maryam Abdirahman Mohamed Abdullahi Hassan Abdi Warsame Ali Farah Yusuf Osman Ahmed Nur Ibrahim Jama Abdikarim';
  const record = (i, name = `Staff ${i}`) => ({
    workDate: '2026-10-28',
    timeZone: 'Africa/Mogadishu',
    branch: { name: 'Main', code: 'B' },
    staff: { id: `s${i}`, staffId: `S-${i}`, name, jobTitle: 'Teacher' },
    shift: { name: 'Morning', start: '08:00' },
    status: 'PRESENT',
    checkIn: { time: '07:55:00' },
    checkOut: null,
    checkOutState: 'missing',
    workedMinutes: null,
  });
  const summary = { checkIns: 120, present: 120, late: 0, checkedOut: 0, missing: 120, pending: 0, notRequired: 0, staff: 120 };
  const pdf = new AttendancePdf({ role: 'OWNER', head, summary, total: 120 });
  pdf.add([record(0, long), ...Array.from({ length: 119 }, (_, i) => record(i + 1))]);
  const read = readPdf(pdf.finish());
  assert.ok(read.pageCount >= 4);
  read.pages.forEach((page, i) => {
    assert.ok(page.lines.includes('Staff ID') && page.lines.includes('Check-out'), `table header on page ${i + 1}`);
    assert.ok(page.lines.includes(`Page ${i + 1} of ${read.pageCount}`), `page number on page ${i + 1}`);
  });
  const all = read.pages.map((p) => p.text).join('\n');
  for (const word of long.split(' ')) assert.ok(all.includes(word), word);
  for (let i = 1; i <= 119; i += 1) assert.ok(all.includes(`S-${i}\n`), `row ${i}`);
  assert.ok(all.includes('Absence is not calculated yet.'));
  assert.ok(all.includes('120 rows (an export contains at most 10,000).'));
  assert.ok(!all.includes('cannot be shown'));

  const other = new AttendancePdf({ role: 'OWNER', head, summary, total: 1 });
  other.add([record(1, 'محمد علي')]);
  const withNote = readPdf(other.finish()).pages[0].text;
  assert.ok(withNote.includes('Some characters cannot be shown in this PDF'));
});

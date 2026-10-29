/*
 * The .xlsx writer (common/xlsx.js): ZIP container, XML escaping, cells, styles and workbook parts.
 * Pure functions; no database. (The generated files were also opened with openpyxl and Microsoft
 * Excel while developing; see docs/design/implementation-log.md.)
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cellXml, colName, createStyles, dateSerial, rowXml, sheetXml, workbookBuffer, xmlText, zip } from '../src/common/xlsx.js';
import { readXlsx, rowValues, styleColours, unzip } from './support/xlsxReader.js';

test('ZIP: entries round-trip with correct CRCs; equal input gives an equal file', () => {
  const entries = [
    { name: 'a.txt', data: Buffer.from('hello hello hello') },
    { name: 'dir/ü.xml', data: Buffer.from('<x>é</x>') },
  ];
  const file = zip(entries);
  assert.deepEqual(unzip(file), { 'a.txt': 'hello hello hello', 'dir/ü.xml': '<x>é</x>' });
  assert.ok(zip(entries).equals(file));
});

test('XML text: markup escaped; characters XML cannot hold are removed', () => {
  assert.equal(xmlText('a < b & "c" > d'), 'a &lt; b &amp; &quot;c&quot; &gt; d');
  assert.equal(xmlText('bell\u0007 null\u0000 tab\tok'), 'bell null tab\tok');
  assert.equal(xmlText('emoji 😀 kept'), 'emoji 😀 kept');
  assert.equal(xmlText('lone \uD800 surrogate'), 'lone  surrogate');
});

test('cells: text is always an inline string (never a formula); numbers; dates as serials; empty cells', () => {
  assert.equal(cellXml('A1', '=SUM(A1:A9)', 3), '<c r="A1" s="3" t="inlineStr"><is><t xml:space="preserve">=SUM(A1:A9)</t></is></c>');
  assert.ok(!cellXml('A1', '=1+1').includes('<f>'));
  assert.equal(cellXml('B2', 42), '<c r="B2"><v>42</v></c>');
  assert.equal(cellXml('C3', { date: '2026-10-28' }, 2), `<c r="C3" s="2"><v>${dateSerial('2026-10-28')}</v></c>`);
  assert.equal(dateSerial('1900-03-01'), 61);
  assert.equal(cellXml('D4', null), '');
  assert.equal(cellXml('D4', '', 5), '<c r="D4" s="5"/>');
  assert.deepEqual([colName(0), colName(10), colName(25), colName(26), colName(27)], ['A', 'K', 'Z', 'AA', 'AB']);
  assert.equal(rowXml(3, [['x', 0], [1, 0]], { height: 20 }), '<row r="3" ht="20" customHeight="1"><c r="A3" t="inlineStr"><is><t xml:space="preserve">x</t></is></c><c r="B3"><v>1</v></c></row>');
});

test('styles: named styles map to distinct indexes; shared parts are reused', () => {
  const { xml, id } = createStyles({
    a: { font: { bold: true, color: 'FFFFFF' }, fill: '001D31' },
    b: { font: { bold: true, color: 'FFFFFF' }, fill: '001D31', align: { h: 'center' } },
    c: { numFmt: 'yyyy-mm-dd', border: 'thin' },
  });
  assert.deepEqual([id.a, id.b, id.c], [1, 2, 3]);
  assert.equal((xml.match(/<fill>/g) ?? []).length, 3, 'none, gray125, navy (shared by a and b)');
  assert.match(xml, /<numFmt numFmtId="164" formatCode="yyyy-mm-dd"\/>/);
});

test('workbook: all parts present and named; sheet names checked; frozen header and autofilter written', () => {
  const styles = createStyles({ header: { font: { bold: true }, fill: '001D31' } });
  const sheet = sheetXml({ widths: [10, 20], rows: [rowXml(1, [['Title', 0]]), rowXml(2, [['A', styles.id.header], ['B', styles.id.header]])], freezeRows: 2, autoFilter: 'A2:B2', merges: ['A1:B1'], lastRef: 'B2' });
  const book = readXlsx(workbookBuffer({ sheets: [{ name: 'First', xml: sheet }, { name: 'Second & More', xml: sheet }], stylesXml: styles.xml, title: 'T', filterRefs: { 0: "'First'!$A$2:$B$2" } }));
  assert.deepEqual(book.sheetNames, ['First', 'Second & More']);
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'docProps/core.xml', 'docProps/app.xml']) {
    assert.ok(book.files[part], part);
  }
  const first = book.sheets.First;
  assert.match(first.xml, /<pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(first.xml, /<autoFilter ref="A2:B2"\/>/);
  assert.match(first.xml, /<mergeCell ref="A1:B1"\/>/);
  assert.deepEqual(rowValues(first, 2, 'B'), ['A', 'B']);
  assert.equal(styleColours(book.files, first.cells.get('A2').style).fill, '001D31');
  assert.match(book.files['xl/workbook.xml'], /_xlnm\._FilterDatabase/);
  assert.throws(() => workbookBuffer({ sheets: [{ name: 'a/b', xml: sheet }], stylesXml: styles.xml }), /Invalid sheet name/);
  assert.throws(() => workbookBuffer({ sheets: [{ name: 'x'.repeat(32), xml: sheet }], stylesXml: styles.xml }), /Invalid sheet name/);
});

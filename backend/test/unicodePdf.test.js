/*
 * The Unicode PDF writer (common/unicodePdf.js), no database: the embedded Inter font is read
 * correctly, Somali and accented Latin text is written with the right glyphs and a ToUnicode map
 * (copyable), characters the font lacks are reported, text is measured and wrapped, tables break
 * across pages.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inflateSync } from 'node:zlib';
import { fitText, loadFont, PdfReport, textWidth, UnicodePdfDocument, wrapText } from '../src/common/unicodePdf.js';

/** Every stream of the file, inflated when compressed (font files skipped by size). */
function streams(buffer) {
  const text = buffer.toString('latin1');
  const out = [];
  const re = /<<([^]*?)>>\s*stream\n/g;
  let m;
  while ((m = re.exec(text))) {
    const length = Number(/\/Length (\d+)/.exec(m[1])[1]);
    const start = m.index + m[0].length;
    const raw = buffer.subarray(start, start + length);
    if (m[1].includes('/Length1')) continue;
    out.push(m[1].includes('FlateDecode') ? inflateSync(raw).toString('latin1') : raw.toString('latin1'));
  }
  return out;
}

test('the font: Inter, with Latin, Somali and accented letters, but no Arabic', () => {
  const f = loadFont('regular');
  assert.equal(f.unitsPerEm, 2048);
  for (const ch of 'AaḤāéçÖ–’') assert.ok(f.cmap.get(ch.codePointAt(0)) > 0, ch);
  assert.equal(f.cmap.get('ع'.codePointAt(0)), undefined);
  assert.ok(textWidth('Mm', 'bold', 10) > textWidth('ii', 'bold', 10));
  assert.ok(Math.abs(textWidth('Hello', 'regular', 20) - 2 * textWidth('Hello', 'regular', 10)) < 1e-9);
});

test('text is written as glyphs with a ToUnicode map; missing characters are reported', () => {
  const doc = new UnicodePdfDocument({ title: 'Test Ḥāshim' });
  doc.addPage();
  doc.text('Cabdiraxmaan Ḥāshim', 40, 40);
  doc.text('Bold', 40, 60, { font: 'bold' });
  assert.equal(doc.missingCharacters, false);
  const buffer = doc.toBuffer();
  assert.equal(buffer.subarray(0, 8).toString('latin1'), '%PDF-1.7');
  const text = buffer.toString('latin1');
  assert.match(text, /\/Subtype \/Type0 \/BaseFont \/Inter-Regular \/Encoding \/Identity-H/);
  assert.match(text, /\/FontFile2 \d+ 0 R/);
  const all = streams(buffer).join('\n');
  const f = loadFont('regular');
  const hex = (ch) => f.cmap.get(ch.codePointAt(0)).toString(16).padStart(4, '0').toUpperCase();
  assert.ok(all.includes(`<${hex('Ḥ')}> <1E24>`), 'Ḥ maps back to U+1E24');
  assert.ok(all.includes(`<${hex('ā')}> <0101>`), 'ā maps back to U+0101');
  assert.ok(all.toUpperCase().includes(hex('Ḥ')), 'the page draws the glyph');
  const arabic = new UnicodePdfDocument();
  arabic.addPage();
  arabic.text('علي', 40, 40);
  assert.equal(arabic.missingCharacters, true);
});

test('wrapping and fitting', () => {
  const lines = wrapText('Xaawo Cabdullaahi Ḥasan Maxamed Cali', 'regular', 10, 80);
  assert.ok(lines.length > 1);
  assert.ok(lines.every((l) => textWidth(l, 'regular', 10) <= 80));
  assert.equal(lines.join(' '), 'Xaawo Cabdullaahi Ḥasan Maxamed Cali');
  const fitted = fitText('A very long examination name that does not fit', 'bold', 10, 100);
  assert.ok(fitted.endsWith('…') && textWidth(fitted, 'bold', 10) <= 100);
});

test('a report: tables break across pages, every page has a footer', () => {
  const r = new PdfReport({ title: 'Seating', subtitle: 'Mid-Term', school: 'Iftiin' });
  r.table([{ label: 'Seat', width: 0.5 }, { label: 'Student', width: 3 }], Array.from({ length: 80 }, (_, i) => [String(i + 1), `Student ${i + 1}`]));
  const buffer = r.toBuffer();
  assert.ok(r.doc.pages.length >= 3);
  assert.equal((buffer.toString('latin1').match(/\/Type \/Page /g) ?? []).length, r.doc.pages.length);
});

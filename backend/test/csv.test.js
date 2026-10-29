/*
 * CSV writing (common/csv.js): RFC 4180 quoting and spreadsheet formula-injection protection. Pure
 * functions; no database.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { csvCell, csvLine, neutralize } from '../src/common/csv.js';

test('formula-triggering text gets a leading apostrophe, also after leading whitespace and in full-width form', () => {
  for (const value of ['=1+1', '+1', '-2', '@SUM(A1)', '=HYPERLINK("http://x")', ' =cmd', '  +x', ' -y', '\t=x', '＝X', '＋1', '－1', '＠x']) {
    assert.equal(neutralize(value), `'${value}`, JSON.stringify(value));
  }
  for (const value of ['\tTab first', '\rCR first', '\nLF first']) assert.equal(neutralize(value), `'${value}`);
  for (const value of ['plain', 'Amina Yusuf', '2026-10-28', '08:05:00', 'a=b', 'x-1', 'e@mail', '']) assert.equal(neutralize(value), value);
});

test('quoting: commas, double quotes, line breaks and edge whitespace; quotes are doubled', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(csvCell('cr\rhere'), '"cr\rhere"');
  assert.equal(csvCell(' lead'), '" lead"');
  assert.equal(csvCell('trail '), '"trail "');
  assert.equal(csvCell('plain'), 'plain');
  // Neutralized first, then quoted when needed.
  assert.equal(csvCell('=A1,B1'), `"'=A1,B1"`);
  assert.equal(csvCell('\rCR first'), `"'\rCR first"`);
  assert.equal(csvCell('-x "y"'), `"'-x ""y"""`);
});

test('numbers stay numbers; empty values are empty cells; lines end with CRLF', () => {
  assert.equal(csvCell(12.5), '12.5');
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell(Number.NaN), '');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvLine(['a', 1, null, 'b,c']), 'a,1,,"b,c"\r\n');
});

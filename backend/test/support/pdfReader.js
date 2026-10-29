/*
 * Test helper: checks and reads a PDF produced by common/pdf.js — the header and end marker, the
 * cross-reference table (every offset points at its object), the page tree in order, and each page's
 * text (the Tj strings of its content streams, decoded from WinAnsi), in drawing order. Enough to check
 * structure and content; not a general PDF reader.
 */
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';

const FROM_WIN_ANSI = { 0x80: '€', 0x85: '…', 0x91: '‘', 0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—' };

function unescape(literal) {
  let text = '';
  for (let i = 0; i < literal.length; i += 1) {
    const ch = literal[i];
    if (ch !== '\\') {
      text += ch;
      continue;
    }
    const next = literal[i + 1];
    if (/[0-7]/.test(next)) {
      const code = parseInt(literal.slice(i + 1, i + 4), 8);
      text += FROM_WIN_ANSI[code] ?? String.fromCharCode(code);
      i += 3;
    } else {
      text += next;
      i += 1;
    }
  }
  return text;
}

/** { pageCount, pages: [{ lines: [text…], text }], info } — throws (assert) when the structure is wrong. */
export function readPdf(buffer) {
  const raw = buffer.toString('latin1');
  assert.ok(raw.startsWith('%PDF-1.7\n'), 'PDF header');
  assert.ok(raw.trimEnd().endsWith('%%EOF'), 'end marker');
  const startxref = Number(/startxref\n(\d+)\n%%EOF\s*$/.exec(raw)[1]);
  assert.ok(raw.startsWith('xref\n', startxref), 'startxref points at the xref table');
  const [, first, count] = /^xref\n(\d+) (\d+)\n/.exec(raw.slice(startxref));
  assert.equal(Number(first), 0);
  const entries = raw.slice(startxref).split('\n').slice(2, 2 + Number(count));
  const objects = new Map();
  entries.slice(1).forEach((entry, i) => {
    const offset = Number(entry.slice(0, 10));
    const number = i + 1;
    assert.ok(raw.startsWith(`${number} 0 obj\n`, offset), `object ${number} at its xref offset`);
    const end = raw.indexOf('\nendobj\n', offset);
    objects.set(number, { start: offset, body: raw.slice(offset + `${number} 0 obj\n`.length, end) });
  });
  const trailer = raw.slice(raw.indexOf('trailer', startxref));
  const root = Number(/\/Root (\d+) 0 R/.exec(trailer)[1]);
  const pagesRef = Number(/\/Pages (\d+) 0 R/.exec(objects.get(root).body)[1]);
  const kidList = /\/Kids \[([^\]]*)\]/.exec(objects.get(pagesRef).body)[1];
  const kids = [...kidList.matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  const declared = Number(/\/Count (\d+)/.exec(objects.get(pagesRef).body)[1]);
  assert.equal(kids.length, declared, 'page count');
  const streamOf = (number) => {
    const { body } = objects.get(number);
    const length = Number(/\/Length (\d+)/.exec(body)[1]);
    const at = buffer.indexOf('stream\n', objects.get(number).start) + 'stream\n'.length;
    return inflateSync(buffer.subarray(at, at + length)).toString('latin1');
  };
  const pages = kids.map((kid) => {
    const body = objects.get(kid).body;
    assert.match(body, /\/Type \/Page /);
    const contents = [...(/\/Contents \[([^\]]*)\]/.exec(body)[1]).matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
    const lines = contents.flatMap((n) => [...streamOf(n).matchAll(/\((.*?)(?<!\\)\) Tj/g)].map((m) => unescape(m[1])));
    return { lines, text: lines.join('\n') };
  });
  const infoRef = Number(/\/Info (\d+) 0 R/.exec(trailer)[1]);
  return { pageCount: pages.length, pages, info: objects.get(infoRef).body };
}

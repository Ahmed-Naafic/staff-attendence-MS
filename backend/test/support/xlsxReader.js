/*
 * Test helper: reads an .xlsx produced by common/xlsx.js — the ZIP entries (central directory,
 * raw inflate, CRC check) and each worksheet's cells ({ value, style, type }) by reference, plus the
 * sheet names in workbook order. Enough to check structure and content; not a general reader.
 */
import assert from 'node:assert/strict';
import { crc32, inflateRawSync } from 'node:zlib';

export function unzip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, 'end of central directory');
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const files = {};
  for (let i = 0; i < count; i += 1) {
    assert.equal(buffer.readUInt32LE(at), 0x02014b50, 'central directory entry');
    const method = buffer.readUInt16LE(at + 10);
    const crc = buffer.readUInt32LE(at + 16);
    const size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const extra = buffer.readUInt16LE(at + 30);
    const comment = buffer.readUInt16LE(at + 32);
    const offset = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    assert.equal(buffer.readUInt32LE(offset), 0x04034b50, `local header of ${name}`);
    const start = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
    const data = method === 8 ? inflateRawSync(buffer.subarray(start, start + size)) : buffer.subarray(start, start + size);
    assert.equal(crc32(data), crc, `CRC of ${name}`);
    files[name] = data.toString('utf8');
    at += 46 + nameLength + extra + comment;
  }
  return files;
}

const unescape = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** { files, sheetNames, sheets: { [name]: { xml, cells: Map(ref → { value, style, type }) } } } */
export function readXlsx(buffer) {
  const files = unzip(buffer);
  const sheetNames = [...files['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)" sheetId="(\d+)"/g)].map((m) => unescape(m[1]));
  const sheets = {};
  sheetNames.forEach((name, i) => {
    const xml = files[`xl/worksheets/sheet${i + 1}.xml`];
    const cells = new Map();
    for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"(?: s="(\d+)")?(?: t="(\w+)")?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const [, ref, style, type, inner] = m;
      let value = null;
      if (inner && type === 'inlineStr') value = unescape(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)[1]);
      else if (inner) value = Number(/<v>([^<]*)<\/v>/.exec(inner)[1]);
      cells.set(ref, { value, style: Number(style ?? 0), type: type ?? (inner ? 'n' : 'empty') });
    }
    sheets[name] = { xml, cells };
  });
  return { files, sheetNames, sheets };
}

/** The values of one sheet row (1-based) from column A to `lastColumn` (a letter), null for empty cells. */
export const rowValues = (sheet, row, lastColumn) => {
  const values = [];
  for (let c = 65; c <= lastColumn.charCodeAt(0); c += 1) values.push(sheet.cells.get(`${String.fromCharCode(c)}${row}`)?.value ?? null);
  return values;
};

/** The fill colour (RRGGBB) and font colour of a cell style index, read from styles.xml. */
export function styleColours(files, index) {
  const styles = files['xl/styles.xml'];
  const list = (tag) => [...styles.matchAll(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'g'))].map((m) => m[0]);
  const xfs = [.../<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)[1].matchAll(/<xf [^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map((m) => m[0]);
  const xf = xfs[index];
  const fill = list('fill')[Number(/fillId="(\d+)"/.exec(xf)[1])];
  const font = list('font')[Number(/fontId="(\d+)"/.exec(xf)[1])];
  return {
    fill: /fgColor rgb="FF([0-9A-F]{6})"/.exec(fill)?.[1] ?? null,
    font: /color rgb="FF([0-9A-F]{6})"/.exec(font)?.[1] ?? null,
    numFmt: Number(/numFmtId="(\d+)"/.exec(xf)[1]),
  };
}

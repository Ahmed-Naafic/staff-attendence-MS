import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

/*
 * A Unicode PDF writer with no dependencies (PDF 1.7), for documents that print people's names as
 * they are written (examination timetables, seating lists, registers, report cards). Same drawing API
 * as common/pdf.js (pages, text, rectangles, lines; coordinates in points from the top-left), but text
 * uses an embedded TrueType font (Inter, SIL Open Font License: backend/assets/fonts/OFL.txt) as a
 * Type0 / CIDFontType2 font with Identity-H encoding and a ToUnicode map, so every character the font
 * has prints exactly and can be copied and searched.
 *
 * The whole font file is embedded (compressed) once per document and font used. Inter covers Latin
 * (all Somali letters, accented Latin), Greek and Cyrillic; characters it lacks (e.g. Arabic script,
 * which would also need shaping) print as the font's empty glyph and are recorded in
 * `missingCharacters` so the caller can say so. Text runs left to right without kerning.
 */

// ---- TrueType -----------------------------------------------------------------------------------

/** Reads what the writer needs from a TrueType file: units, metrics, advance widths, the character map. */
export function parseTrueType(buffer) {
  const u16 = (o) => buffer.readUInt16BE(o);
  const i16 = (o) => buffer.readInt16BE(o);
  const u32 = (o) => buffer.readUInt32BE(o);
  if (u32(0) !== 0x00010000) throw new Error('Not a TrueType font (glyf outlines expected).');
  const tables = {};
  for (let i = 0, n = u16(4); i < n; i += 1) {
    const at = 12 + i * 16;
    tables[buffer.toString('latin1', at, at + 4)] = { offset: u32(at + 8), length: u32(at + 12) };
  }
  for (const t of ['head', 'hhea', 'hmtx', 'maxp', 'cmap']) if (!tables[t]) throw new Error(`The font has no ${t} table.`);
  const head = tables.head.offset;
  const unitsPerEm = u16(head + 18);
  const bbox = [i16(head + 36), i16(head + 38), i16(head + 40), i16(head + 42)];
  const hhea = tables.hhea.offset;
  const ascent = i16(hhea + 4);
  const descent = i16(hhea + 6);
  const metrics = u16(hhea + 34);
  const glyphCount = u16(tables.maxp.offset + 4);
  const widths = new Uint16Array(glyphCount);
  for (let g = 0; g < glyphCount; g += 1) widths[g] = u16(tables.hmtx.offset + 4 * Math.min(g, metrics - 1));
  let capHeight = ascent;
  if (tables['OS/2'] && u16(tables['OS/2'].offset) >= 2) capHeight = i16(tables['OS/2'].offset + 88);
  const italicAngle = tables.post ? buffer.readInt32BE(tables.post.offset + 4) / 65536 : 0;

  // The best Unicode subtable: format 12 (full range) else format 4 (BMP), platform 3 (or 0).
  const cmap = new Map();
  const base = tables.cmap.offset;
  const subtables = [];
  for (let i = 0, n = u16(base + 2); i < n; i += 1) subtables.push({ platform: u16(base + 4 + i * 8), encoding: u16(base + 6 + i * 8), offset: base + u32(base + 8 + i * 8) });
  const pick = (format) => subtables.find((s) => (s.platform === 3 || s.platform === 0) && u16(s.offset) === format);
  const f12 = pick(12);
  const f4 = pick(4);
  if (f12) {
    for (let i = 0, groups = u32(f12.offset + 12); i < groups; i += 1) {
      const at = f12.offset + 16 + i * 12;
      const start = u32(at);
      const end = u32(at + 4);
      const glyph = u32(at + 8);
      for (let c = start; c <= end && c - start < 0x20000; c += 1) cmap.set(c, glyph + (c - start));
    }
  } else if (f4) {
    const at = f4.offset;
    const segs = u16(at + 6) / 2;
    const ends = at + 14;
    const starts = ends + segs * 2 + 2;
    const deltas = starts + segs * 2;
    const ranges = deltas + segs * 2;
    for (let s = 0; s < segs; s += 1) {
      const end = u16(ends + s * 2);
      const start = u16(starts + s * 2);
      const delta = i16(deltas + s * 2);
      const rangeOffset = u16(ranges + s * 2);
      for (let c = start; c <= end && c !== 0xffff; c += 1) {
        let glyph;
        if (!rangeOffset) glyph = (c + delta) & 0xffff;
        else {
          const g = u16(ranges + s * 2 + rangeOffset + (c - start) * 2);
          glyph = g ? (g + delta) & 0xffff : 0;
        }
        if (glyph) cmap.set(c, glyph);
      }
    }
  } else throw new Error('The font has no Unicode character map.');
  return { unitsPerEm, bbox, ascent, descent, capHeight, italicAngle, widths, cmap, glyphCount };
}

const FONT_FILES = {
  regular: new URL('../../assets/fonts/Inter-Regular.ttf', import.meta.url),
  bold: new URL('../../assets/fonts/Inter-Bold.ttf', import.meta.url),
};
const cache = new Map();
/** The parsed font (and its file) for 'regular' | 'bold' | 'italic' (italic: regular, slanted). */
export function loadFont(kind) {
  const file = kind === 'bold' ? 'bold' : 'regular';
  if (!cache.has(file)) {
    const buffer = readFileSync(FONT_FILES[file]);
    cache.set(file, { buffer, ...parseTrueType(buffer), name: file === 'bold' ? 'Inter-Bold' : 'Inter-Regular' });
  }
  return cache.get(file);
}

// ---- measuring ------------------------------------------------------------------------------------

const clean = (value) => String(value ?? '').replace(/[\t\r\n]+/g, ' ');

/** Width of text in points at a font size. */
export function textWidth(value, font = 'regular', size = 10) {
  const f = loadFont(font);
  let units = 0;
  for (const ch of clean(value)) units += f.widths[f.cmap.get(ch.codePointAt(0)) ?? 0];
  return (units / f.unitsPerEm) * size;
}

/** Splits text into lines no wider than maxWidth (words kept whole unless a word alone is too wide). */
export function wrapText(value, font, size, maxWidth) {
  const words = clean(value).split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  const push = (word) => {
    // A word wider than the line is cut by characters.
    let part = '';
    for (const ch of word) {
      if (textWidth(part + ch, font, size) > maxWidth && part) {
        lines.push(part);
        part = '';
      }
      part += ch;
    }
    return part;
  };
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (textWidth(next, font, size) <= maxWidth) line = next;
    else {
      if (line) lines.push(line);
      line = textWidth(word, font, size) <= maxWidth ? word : push(word);
    }
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

/** Shortens text to fit maxWidth, ending with "…". */
export function fitText(value, font, size, maxWidth) {
  let text = clean(value);
  if (textWidth(text, font, size) <= maxWidth) return text;
  while (text && textWidth(`${text}…`, font, size) > maxWidth) text = [...text].slice(0, -1).join('');
  return `${text}…`;
}

// ---- the document ---------------------------------------------------------------------------------

const num = (n) => (Math.round(n * 100) / 100).toString();
const rgb = (hex) => [0, 2, 4].map((i) => num(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ');
const FONT_KEYS = { regular: 'F1', bold: 'F2', italic: 'F1' };

/** A Unicode PDF document built page by page; `toBuffer()` returns the file. */
export class UnicodePdfDocument {
  constructor({ width = 595, height = 842, title = '', author = 'EduTrack', created = new Date() } = {}) {
    Object.assign(this, { width, height, title, author, created });
    this.pages = [];
    this.missingCharacters = false;
    this.used = { F1: new Map(), F2: new Map() }; // glyph → character
    this.images = []; // embedded JPEG images: { data, width, height, components }
  }

  /**
   * Draws a JPEG image (a Buffer) in the box x, y, w, h (top-left origin), keeping its proportions
   * inside the box. Unreadable data draws nothing. Each distinct buffer is embedded once.
   */
  image(data, x, y, w, h) {
    const info = jpegInfo(data);
    if (!info) return;
    let index = this.images.findIndex((im) => im.data === data);
    if (index < 0) index = this.images.push({ data, ...info }) - 1;
    const scale = Math.min(w / info.width, h / info.height);
    const dw = info.width * scale;
    const dh = info.height * scale;
    const dx = x + (w - dw) / 2;
    const dy = y + (h - dh) / 2;
    this.page.push(`q ${num(dw)} 0 0 ${num(dh)} ${num(dx)} ${num(this.height - dy - dh)} cm /Im${index + 1} Do Q`);
  }

  #current = -1;

  addPage() {
    this.#flush();
    this.page = [];
    this.pages.push({ streams: [] });
    this.#current = this.pages.length - 1;
    return this.pages.length;
  }

  #flush() {
    if (this.page?.length) this.pages[this.#current].streams.push(deflateSync(Buffer.from(this.page.join('\n'), 'latin1')));
    this.page = [];
  }

  rect(x, y, w, h, fill) {
    this.page.push(`${rgb(fill)} rg ${num(x)} ${num(this.height - y - h)} ${num(w)} ${num(h)} re f`);
  }

  /** An outlined rectangle. */
  box(x, y, w, h, color = 'D3DCE6', width = 0.5) {
    this.page.push(`${rgb(color)} RG ${num(width)} w ${num(x)} ${num(this.height - y - h)} ${num(w)} ${num(h)} re S`);
  }

  line(x1, y1, x2, y2, color = 'D3DCE6', width = 0.5) {
    this.page.push(`${rgb(color)} RG ${num(width)} w ${num(x1)} ${num(this.height - y1)} m ${num(x2)} ${num(this.height - y2)} l S`);
  }

  /** Text with its baseline at y. options: { font: 'regular' | 'bold' | 'italic', size, color, align, width }. */
  text(value, x, y, { font = 'regular', size = 10, color = '0D1932', align = 'left', width = 0 } = {}) {
    const text = clean(value);
    if (!text) return;
    const f = loadFont(font);
    const key = FONT_KEYS[font];
    let hex = '';
    for (const ch of text) {
      const glyph = f.cmap.get(ch.codePointAt(0)) ?? 0;
      if (!glyph && ch !== ' ') this.missingCharacters = true;
      if (glyph) this.used[key].set(glyph, ch);
      hex += glyph.toString(16).padStart(4, '0');
    }
    let left = x;
    if (align !== 'left') {
      const w = textWidth(text, font, size);
      left = align === 'right' ? x + width - w : x + (width - w) / 2;
    }
    // Italic: the regular font slanted (Inter has no italic file here).
    const matrix = font === 'italic' ? `1 0 0.2 1 ${num(left)} ${num(this.height - y)}` : `1 0 0 1 ${num(left)} ${num(this.height - y)}`;
    this.page.push(`BT /${key} ${num(size)} Tf ${rgb(color)} rg ${matrix} Tm <${hex}> Tj ET`);
  }

  /** The PDF file. `decorate(pageNumber, pageCount)` may draw on each page last (footers). */
  toBuffer(decorate) {
    this.#flush();
    if (decorate) {
      this.pages.forEach((_, i) => {
        this.#current = i;
        decorate(i + 1, this.pages.length);
        this.#flush();
      });
    }
    const objects = [];
    const add = (body) => objects.push(body) && objects.length;
    const catalog = add(null);
    const pagesId = add(null);
    const fontIds = {};
    // Only the fonts the document uses are embedded (a page without text uses none).
    for (const [key, kind] of [['F1', 'regular'], ['F2', 'bold']]) {
      if (!this.used[key].size) continue;
      const f = loadFont(kind);
      const used = [...this.used[key].entries()].sort((a, b) => a[0] - b[0]);
      const scale = (v) => Math.round((v * 1000) / f.unitsPerEm);
      const file = deflateSync(f.buffer);
      const fileId = add({ dict: `<< /Length ${file.length} /Length1 ${f.buffer.length} /Filter /FlateDecode >>`, stream: file });
      const descriptor = add(
        `<< /Type /FontDescriptor /FontName /${f.name} /Flags 32 /FontBBox [${f.bbox.map(scale).join(' ')}] /ItalicAngle ${num(f.italicAngle)} /Ascent ${scale(f.ascent)} /Descent ${scale(f.descent)} /CapHeight ${scale(f.capHeight)} /StemV 80 /FontFile2 ${fileId} 0 R >>`,
      );
      const widths = used.map(([g]) => `${g} [${scale(f.widths[g])}]`).join(' ');
      const cid = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${f.name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /DW ${scale(f.widths[0])} /W [${widths}] /CIDToGIDMap /Identity >>`);
      const utf16 = (ch) => Buffer.from(ch, 'utf16le').swap16().toString('hex').toUpperCase();
      const lines = [];
      for (let i = 0; i < used.length; i += 100) {
        const chunk = used.slice(i, i + 100);
        lines.push(`${chunk.length} beginbfchar`, ...chunk.map(([g, ch]) => `<${g.toString(16).padStart(4, '0').toUpperCase()}> <${utf16(ch)}>`), 'endbfchar');
      }
      const cmap = Buffer.from(
        ['/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap', '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def', '/CMapName /Adobe-Identity-UCS def', '/CMapType 2 def', '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange', ...lines, 'endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end'].join('\n'),
        'latin1',
      );
      const cmapId = add({ dict: `<< /Length ${cmap.length} >>`, stream: cmap });
      fontIds[key] = add(`<< /Type /Font /Subtype /Type0 /BaseFont /${f.name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${cmapId} 0 R >>`);
    }
    const imageIds = this.images.map((im) => {
      const space = im.components === 1 ? '/DeviceGray' : im.components === 4 ? '/DeviceCMYK /Decode [1 0 1 0 1 0 1 0]' : '/DeviceRGB';
      return add({ dict: `<< /Type /XObject /Subtype /Image /Width ${im.width} /Height ${im.height} /ColorSpace ${space} /BitsPerComponent 8 /Filter /DCTDecode /Length ${im.data.length} >>`, stream: im.data });
    });
    const xobjects = imageIds.length ? ` /XObject << ${imageIds.map((id, i) => `/Im${i + 1} ${id} 0 R`).join(' ')} >>` : '';
    const resources = `<< /Font << ${Object.entries(fontIds).map(([key, id]) => `/${key} ${id} 0 R`).join(' ')} >>${xobjects} /ProcSet [/PDF /Text${imageIds.length ? ' /ImageC' : ''}] >>`;
    const pageIds = this.pages.map(({ streams }) => {
      const contents = streams.map((stream) => add({ dict: `<< /Length ${stream.length} /Filter /FlateDecode >>`, stream }));
      return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources ${resources} /Contents [${contents.map((c) => `${c} 0 R`).join(' ')}] >>`);
    });
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    const date = `D:${this.created.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;
    const utf16 = (value) => `<FEFF${[...String(value)].map((ch) => Buffer.from(ch, 'utf16le').swap16().toString('hex')).join('').toUpperCase()}>`;
    const info = add(`<< /Title ${utf16(this.title)} /Author ${utf16(this.author)} /Producer (EduTrack) /CreationDate (${date}) >>`);

    const chunks = [Buffer.from('%PDF-1.7\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    let offset = chunks[0].length;
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(offset);
      const parts =
        typeof body === 'string'
          ? [Buffer.from(`${i + 1} 0 obj\n${body}\nendobj\n`, 'latin1')]
          : [Buffer.from(`${i + 1} 0 obj\n${body.dict}\nstream\n`, 'latin1'), body.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')];
      for (const part of parts) {
        chunks.push(part);
        offset += part.length;
      }
    });
    const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
    chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(chunks);
  }
}

/** Width, height and components of a baseline or progressive JPEG (from its SOF marker), or null. */
export function jpegInfo(data) {
  if (!Buffer.isBuffer(data) || data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) return null;
    const marker = data[i + 1];
    const length = data.readUInt16BE(i + 2);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return { height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7), components: data[i + 9] };
    i += 2 + length;
  }
  return null;
}

// ---- tables -----------------------------------------------------------------------------------------

/**
 * A simple document layout: A4 pages with a header (title, subtitle) on each page, tables that break
 * across pages with their header repeated, and a footer (generated date, page x of y).
 * columns: [{ label, width (share), align }]; rows: [[cell text]].
 */
export class PdfReport {
  constructor({ title, subtitle = '', school = '', landscape = false, generatedAt = new Date() }) {
    this.doc = new UnicodePdfDocument({ title, width: landscape ? 842 : 595, height: landscape ? 595 : 842, created: generatedAt });
    Object.assign(this, { title, subtitle, school, generatedAt, margin: 36 });
    this.newPage();
  }

  get inner() {
    return this.doc.width - this.margin * 2;
  }

  newPage() {
    this.doc.addPage();
    const d = this.doc;
    d.rect(0, 0, d.width, 6, '0D1932');
    if (this.school) d.text(this.school, this.margin, 30, { font: 'bold', size: 9, color: '5B6B80' });
    d.text(this.title, this.margin, 50, { font: 'bold', size: 15 });
    if (this.subtitle) d.text(fitText(this.subtitle, 'regular', 9.5, this.inner), this.margin, 66, { size: 9.5, color: '45556C' });
    this.y = this.subtitle ? 84 : 70;
  }

  /** Room for `h` points, else a new page. */
  ensure(h) {
    if (this.y + h > this.doc.height - this.margin - 18) {
      this.newPage();
      return true;
    }
    return false;
  }

  heading(text) {
    this.ensure(40);
    this.y += 10;
    this.doc.text(text, this.margin, this.y + 10, { font: 'bold', size: 11.5 });
    this.y += 18;
  }

  paragraph(text, { size = 9.5, color = '45556C', font = 'regular' } = {}) {
    for (const line of wrapText(text, font, size, this.inner)) {
      this.ensure(size + 4);
      this.doc.text(line, this.margin, this.y + size, { size, color, font });
      this.y += size + 4;
    }
    this.y += 4;
  }

  /** Key–value pairs in rows of `perRow`. */
  facts(pairs, perRow = 3) {
    const w = this.inner / perRow;
    for (let i = 0; i < pairs.length; i += perRow) {
      this.ensure(30);
      pairs.slice(i, i + perRow).forEach(([k, v], j) => {
        this.doc.text(k, this.margin + j * w, this.y + 9, { size: 8, color: '6B7A90' });
        this.doc.text(fitText(v, 'bold', 10, w - 8), this.margin + j * w, this.y + 22, { font: 'bold', size: 10 });
      });
      this.y += 30;
    }
  }

  table(columns, rows, { size = 9, zebra = true, minRowHeight = 18 } = {}) {
    const total = columns.reduce((n, c) => n + (c.width ?? 1), 0);
    const widths = columns.map((c) => ((c.width ?? 1) / total) * this.inner);
    const pad = 4;
    const header = () => {
      this.doc.rect(this.margin, this.y, this.inner, 18, 'EEF2F7');
      let x = this.margin;
      columns.forEach((c, i) => {
        this.doc.text(fitText(c.label, 'bold', size, widths[i] - pad * 2), x + pad, this.y + 12.5, { font: 'bold', size, color: '45556C', align: c.align ?? 'left', width: widths[i] - pad * 2 });
        x += widths[i];
      });
      this.y += 18;
    };
    this.ensure(36);
    header();
    rows.forEach((row, r) => {
      const cells = row.map((cell, i) => wrapText(cell ?? '', columns[i].bold ? 'bold' : 'regular', size, widths[i] - pad * 2));
      const h = Math.max(minRowHeight, Math.max(...cells.map((l) => l.length)) * (size + 3) + 7);
      if (this.ensure(h)) header();
      if (zebra && r % 2) this.doc.rect(this.margin, this.y, this.inner, h, 'F7F9FC');
      let x = this.margin;
      cells.forEach((lines, i) => {
        lines.forEach((line, l) => this.doc.text(line, x + pad, this.y + size + 4 + l * (size + 3), { size, font: columns[i].bold ? 'bold' : 'regular', align: columns[i].align ?? 'left', width: widths[i] - pad * 2 }));
        x += widths[i];
      });
      this.doc.line(this.margin, this.y + h, this.margin + this.inner, this.y + h, 'E3E8EF');
      this.y += h;
    });
    this.y += 8;
  }

  toBuffer() {
    const stamp = this.generatedAt.toISOString().slice(0, 16).replace('T', ' ');
    return this.doc.toBuffer((page, count) => {
      this.doc.text(`EduTrack · generated ${stamp} UTC`, this.margin, this.doc.height - 20, { size: 7.5, color: '8794A8' });
      this.doc.text(`Page ${page} of ${count}`, this.margin, this.doc.height - 20, { size: 7.5, color: '8794A8', align: 'right', width: this.inner });
    });
  }
}

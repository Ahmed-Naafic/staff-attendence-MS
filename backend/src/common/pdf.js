import { deflateSync } from 'node:zlib';

/*
 * A small PDF writer with no dependencies (PDF 1.7): pages of text, filled rectangles and lines,
 * drawn with the standard Helvetica fonts (regular, bold, oblique; WinAnsi encoding, so no font
 * files are embedded), content streams compressed with Flate, a cross-reference table, document
 * information. Coordinates are in points from the top-left corner of the page.
 *
 * Text measurement uses the published Helvetica widths with a small safety margin, so wrapped text
 * never runs past its box. Characters the WinAnsi encoding cannot show (e.g. Arabic script) are
 * written as "?"; the document records that it happened (`replacedCharacters`) so the caller can say
 * so on the page.
 */

// Helvetica and Helvetica-Bold advance widths (1/1000 em) for the ASCII characters 32–126.
const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
const FONTS = { regular: { name: 'Helvetica', widths: REGULAR }, bold: { name: 'Helvetica-Bold', widths: BOLD }, italic: { name: 'Helvetica-Oblique', widths: REGULAR } };
const FONT_KEYS = { regular: 'F1', bold: 'F2', italic: 'F3' };
/** Measured widths are enlarged by this factor, so text always fits the space measured for it. */
const SAFETY = 1.04;

// WinAnsi bytes 0x80–0x9F that differ from Latin-1 (0xA0–0xFF are the same as Unicode).
const WIN_ANSI = new Map(
  Object.entries({
    '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
    '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
  }),
);
const WIN_ANSI_BYTES = new Set(WIN_ANSI.values());
// Widths of those characters and of wide Latin-1 letters (regular / bold); anything else outside ASCII
// is measured by its base letter (é → e) or, failing that, as a full em (never too narrow).
const SPECIAL_WIDTHS = { '€': 556, '…': 1000, '‘': 222, '’': 222, '“': 333, '”': 333, '•': 350, '–': 556, '—': 1000, 'Æ': 1000, 'æ': 889, 'Œ': 1000, 'œ': 944, 'ß': 611, ' ': 278 };

/** The text as WinAnsi characters: { text (one char per byte), replaced }. Line breaks and tabs become spaces. */
export function toWinAnsi(value) {
  let text = '';
  let replaced = false;
  for (const ch of String(value ?? '').replace(/[\t\r\n]+/g, ' ')) {
    const code = ch.codePointAt(0);
    if ((code >= 32 && code <= 126) || (code >= 0xa0 && code <= 0xff)) text += ch;
    else if (WIN_ANSI.has(ch)) text += String.fromCharCode(WIN_ANSI.get(ch));
    // Already WinAnsi (e.g. a line from wrapText): keep it, so converting twice changes nothing.
    else if (WIN_ANSI_BYTES.has(code)) text += ch;
    else {
      // A letter with a mark the encoding lacks (e.g. ā): its base letter; otherwise "?".
      const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      if (base && [...base].every((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126)) text += base;
      else if (code >= 32) {
        text += '?';
        replaced = true;
      }
    }
  }
  return { text, replaced };
}

function charWidth(ch, font) {
  const code = ch.charCodeAt(0);
  if (code >= 32 && code <= 126) return FONTS[font].widths[code - 32];
  const unicode = [...WIN_ANSI].find(([, byte]) => byte === code)?.[0] ?? ch;
  if (SPECIAL_WIDTHS[unicode] !== undefined) return SPECIAL_WIDTHS[unicode];
  const base = unicode.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return base.length === 1 && base.charCodeAt(0) >= 32 && base.charCodeAt(0) <= 126 ? FONTS[font].widths[base.charCodeAt(0) - 32] : 1000;
}

/** Width in points of text (already WinAnsi or plain) in a font ('regular' | 'bold' | 'italic') and size, with the safety margin. */
export function textWidth(value, font = 'regular', size = 10) {
  const { text } = toWinAnsi(value);
  let units = 0;
  for (const ch of text) units += charWidth(ch, font);
  return (units * size * SAFETY) / 1000;
}

/**
 * Lines of text that each fit `maxWidth`: words are kept together where they fit; a word longer than
 * the line is split between characters. Never drops text. Empty text → [''].
 */
export function wrapText(value, font, size, maxWidth) {
  const words = toWinAnsi(value).text.split(' ').filter((w) => w !== '');
  if (!words.length) return [''];
  const lines = [];
  let line = '';
  const push = (word) => {
    const candidate = line ? `${line} ${word}` : word;
    if (textWidth(candidate, font, size) <= maxWidth) {
      line = candidate;
      return;
    }
    if (line) lines.push(line);
    line = '';
    if (textWidth(word, font, size) <= maxWidth) {
      line = word;
      return;
    }
    // Split a word wider than the line: after the last hyphen or slash that fits (codes such as
    // CIT-001-B001-ST001 break between their parts), otherwise between characters.
    let part = '';
    for (const ch of word) {
      if (part && textWidth(part + ch, font, size) > maxWidth) {
        const cut = Math.max(part.lastIndexOf('-'), part.lastIndexOf('/'));
        if (cut > 0 && cut < part.length - 1) {
          lines.push(part.slice(0, cut + 1));
          part = part.slice(cut + 1);
        } else {
          lines.push(part);
          part = '';
        }
      }
      part += ch;
    }
    line = part;
  };
  for (const word of words) push(word);
  if (line) lines.push(line);
  return lines;
}

const rgb = (hex) => [0, 2, 4].map((i) => (parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
const num = (n) => (Math.round(n * 100) / 100).toString();
/** A PDF literal string of WinAnsi text: \, ( and ) escaped; bytes above 126 as octal. */
const literal = (text) =>
  `(${[...text].map((ch) => {
    const code = ch.charCodeAt(0);
    if (ch === '\\' || ch === '(' || ch === ')') return `\\${ch}`;
    return code > 126 ? `\\${code.toString(8).padStart(3, '0')}` : ch;
  }).join('')})`;

/** A PDF document built page by page; `toBuffer()` returns the file. */
export class PdfDocument {
  constructor({ width = 842, height = 595, title = '', author = 'EduTrack', created = new Date() } = {}) {
    Object.assign(this, { width, height, title, author, created });
    this.pages = [];
    this.replacedCharacters = false;
  }

  #current = -1;

  /** Starts a new page; drawing goes to it. The previous page's drawing is compressed now, to keep memory low. */
  addPage() {
    this.#flush();
    this.page = [];
    this.pages.push({ streams: [] });
    this.#current = this.pages.length - 1;
    return this.pages.length;
  }

  /** Compresses the drawing collected for the current page into one of its content streams. */
  #flush() {
    if (this.page?.length) this.pages[this.#current].streams.push(deflateSync(Buffer.from(this.page.join('\n'), 'latin1')));
    this.page = [];
  }

  /** A filled rectangle (top-left x, y; colour 'RRGGBB'). */
  rect(x, y, w, h, fill) {
    this.page.push(`${rgb(fill)} rg ${num(x)} ${num(this.height - y - h)} ${num(w)} ${num(h)} re f`);
  }

  /** A straight line. */
  line(x1, y1, x2, y2, color = 'D3DCE6', width = 0.5) {
    this.page.push(`${rgb(color)} RG ${num(width)} w ${num(x1)} ${num(this.height - y1)} m ${num(x2)} ${num(this.height - y2)} l S`);
  }

  /** Text with its baseline at y. options: { font, size, color, align: 'left' | 'right' | 'center', width }. */
  text(value, x, y, { font = 'regular', size = 10, color = '0D1932', align = 'left', width = 0 } = {}) {
    const { text, replaced } = toWinAnsi(value);
    if (replaced) this.replacedCharacters = true;
    if (!text) return;
    let left = x;
    if (align !== 'left') {
      const w = textWidth(text, font, size) / SAFETY;
      left = align === 'right' ? x + width - w : x + (width - w) / 2;
    }
    this.page.push(`BT /${FONT_KEYS[font]} ${num(size)} Tf ${rgb(color)} rg 1 0 0 1 ${num(left)} ${num(this.height - y)} Tm ${literal(text)} Tj ET`);
  }

  /** The PDF file. `decorate(pageNumber, pageCount)` may draw on each page last (e.g. footers). */
  toBuffer(decorate) {
    this.#flush();
    if (decorate) {
      // Drawn last, as a second content stream of each page (page numbers need the page count).
      this.pages.forEach((_, i) => {
        this.#current = i;
        decorate(i + 1, this.pages.length);
        this.#flush();
      });
    }
    const objects = [];
    const add = (body) => objects.push(body) && objects.length; // returns the object number
    const catalog = add(null);
    const pagesId = add(null);
    const fontIds = Object.fromEntries(Object.entries(FONT_KEYS).map(([key, ref]) => [ref, add(`<< /Type /Font /Subtype /Type1 /BaseFont /${FONTS[key].name} /Encoding /WinAnsiEncoding >>`)]));
    const resources = `<< /Font << ${Object.entries(fontIds).map(([ref, id]) => `/${ref} ${id} 0 R`).join(' ')} >> /ProcSet [/PDF /Text] >>`;
    const pageIds = this.pages.map(({ streams }) => {
      const contents = streams.map((stream) => add({ dict: `<< /Length ${stream.length} /Filter /FlateDecode >>`, stream }));
      return add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources ${resources} /Contents [${contents.map((c) => `${c} 0 R`).join(' ')}] >>`);
    });
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
    const date = `D:${this.created.toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`;
    // Document information strings are text strings (not page text): UTF-16BE with a byte-order mark, exact for any character.
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

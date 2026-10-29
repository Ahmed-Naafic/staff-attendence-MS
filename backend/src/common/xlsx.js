import { crc32, deflateRawSync } from 'node:zlib';

/*
 * A small Excel (.xlsx, Office Open XML SpreadsheetML) writer with no dependencies: the workbook is
 * a ZIP of XML parts, built with Node's zlib (raw deflate, CRC-32). It writes only what the
 * attendance report needs: text, numbers and dates; cell styles (fonts, fills, borders, alignment,
 * number formats); column widths, row heights, merged cells, a frozen header, an autofilter, tab
 * colours and page setup. No formulas are ever written: every text value is an inline string, so a
 * value such as "=SUM(A1)" is shown as text and never evaluated (formula injection cannot occur).
 */

// ---- XML -------------------------------------------------------------------------------------

// Characters XML 1.0 cannot contain (control characters other than tab, LF and CR; lone surrogates).
const INVALID_XML = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/gu;

/** Text safe inside an XML element or attribute: invalid characters removed, markup escaped. */
export const xmlText = (value) =>
  String(value).replace(INVALID_XML, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Column letters for a 0-based index: 0 → A, 25 → Z, 26 → AA. */
export function colName(index) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
/** Excel's serial day number for a calendar date 'YYYY-MM-DD' (shown with a date number format). */
export const dateSerial = (date) => (Date.parse(`${date}T00:00:00Z`) - EXCEL_EPOCH) / 86_400_000;

/**
 * One cell. value: string (inline text), number, { date: 'YYYY-MM-DD' } or null/'' (styled empty
 * cell when a style is given, otherwise nothing).
 */
export function cellXml(ref, value, style = 0) {
  const s = style ? ` s="${style}"` : '';
  if (value === null || value === undefined || value === '') return style ? `<c r="${ref}"${s}/>` : '';
  if (typeof value === 'number') return Number.isFinite(value) ? `<c r="${ref}"${s}><v>${value}</v></c>` : `<c r="${ref}"${s}/>`;
  if (typeof value === 'object' && value.date) return `<c r="${ref}"${s}><v>${dateSerial(value.date)}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
}

/** One row (1-based number) of [value, style] pairs starting in column A; `height` in points. */
export function rowXml(number, cells, { height } = {}) {
  const attrs = height ? ` ht="${height}" customHeight="1"` : '';
  return `<row r="${number}"${attrs}>${cells.map(([value, style], i) => cellXml(`${colName(i)}${number}`, value, style)).join('')}</row>`;
}

/**
 * A worksheet: widths (per column, in characters), rows (row XML strings), merges ('A1:F1'),
 * freezeRows (rows kept visible at the top), autoFilter ('A2:K40'), tabColor ('RRGGBB'), selected.
 */
export function sheetXml({ widths = [], rows = [], merges = [], freezeRows = 0, autoFilter, tabColor, selected = false, landscape = false, lastRef = 'A1' }) {
  const pane = freezeRows
    ? `<pane ySplit="${freezeRows}" topLeftCell="A${freezeRows + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${freezeRows + 1}" sqref="A${freezeRows + 1}"/>`
    : '';
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    `<sheetPr>${tabColor ? `<tabColor rgb="FF${tabColor}"/>` : ''}<pageSetUpPr fitToPage="1"/></sheetPr>`,
    `<dimension ref="A1:${lastRef}"/>`,
    `<sheetViews><sheetView workbookViewId="0" showGridLines="0"${selected ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews>`,
    '<sheetFormatPr defaultRowHeight="15"/>',
    widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '',
    `<sheetData>${rows.join('')}</sheetData>`,
    autoFilter ? `<autoFilter ref="${autoFilter}"/>` : '',
    merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : '',
    '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>',
    `<pageSetup orientation="${landscape ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>`,
    '</worksheet>',
  ].join('');
}

// ---- styles ----------------------------------------------------------------------------------

/**
 * Builds styles.xml from named definitions and returns { xml, id: name → cell style index }.
 * def: { font: { bold, italic, size, color }, fill: 'RRGGBB', border: { color, bottom: { style, color } } | 'thin',
 *        align: { h, v, wrap }, numFmt: 'yyyy-mm-dd' }. Index 0 is the default style.
 */
export function createStyles(defs) {
  const fonts = ['<font><sz val="11"/><color rgb="FF0D1932"/><name val="Calibri"/><family val="2"/></font>'];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  const numFmts = [];
  const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  const index = (list, xml) => {
    const found = list.indexOf(xml);
    return found >= 0 ? found : list.push(xml) - 1;
  };
  const id = {};
  for (const [name, def] of Object.entries(defs)) {
    const f = def.font ?? {};
    const fontId = index(
      fonts,
      `<font>${f.bold ? '<b/>' : ''}${f.italic ? '<i/>' : ''}<sz val="${f.size ?? 11}"/><color rgb="FF${f.color ?? '0D1932'}"/><name val="Calibri"/><family val="2"/></font>`,
    );
    const fillId = def.fill ? index(fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${def.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    let borderId = 0;
    if (def.border) {
      const b = def.border === 'thin' ? { color: 'D3DCE6' } : def.border;
      const side = (tag, spec) => (spec ? `<${tag} style="${spec.style}"><color rgb="FF${spec.color}"/></${tag}>` : `<${tag}/>`);
      const thin = b.color ? { style: 'thin', color: b.color } : null;
      borderId = index(borders, `<border>${side('left', b.left ?? thin)}${side('right', b.right ?? thin)}${side('top', b.top ?? thin)}${side('bottom', b.bottom ?? thin)}<diagonal/></border>`);
    }
    let numFmtId = 0;
    if (def.numFmt) {
      const existing = numFmts.find((n) => n.code === def.numFmt);
      numFmtId = existing ? existing.id : numFmts[numFmts.push({ id: 164 + numFmts.length, code: def.numFmt }) - 1].id;
    }
    const a = def.align;
    const alignment = a ? `<alignment${a.h ? ` horizontal="${a.h}"` : ''}${a.v ? ` vertical="${a.v}"` : ''}${a.wrap ? ' wrapText="1"' : ''}/>` : '';
    id[name] = index(
      xfs,
      `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${numFmtId ? ' applyNumberFormat="1"' : ''}${fontId ? ' applyFont="1"' : ''}${fillId ? ' applyFill="1"' : ''}${borderId ? ' applyBorder="1"' : ''}${alignment ? ` applyAlignment="1">${alignment}</xf>` : '/>'}`,
    );
  }
  const xml = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n',
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map((n) => `<numFmt numFmtId="${n.id}" formatCode="${xmlText(n.code)}"/>`).join('')}</numFmts>` : '',
    `<fonts count="${fonts.length}">${fonts.join('')}</fonts>`,
    `<fills count="${fills.length}">${fills.join('')}</fills>`,
    `<borders count="${borders.length}">${borders.join('')}</borders>`,
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
    `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`,
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>',
    '</styleSheet>',
  ].join('');
  return { xml, id };
}

// ---- workbook and ZIP ------------------------------------------------------------------------

/**
 * The .xlsx file: sheets [{ name (≤ 31 characters, no []:*?/\), xml }], stylesXml, title, filterRefs
 * ({ [sheet index]: "'Sheet'!$A$2:$K$40" } for autofilters), created (Date). Returns a Buffer.
 */
export function workbookBuffer({ sheets, stylesXml, title = '', filterRefs = {}, created = new Date() }) {
  const ct = 'application/vnd.openxmlformats-officedocument';
  const names = sheets.map((s) => {
    if (!s.name || s.name.length > 31 || /[[\]:*?/\\]/.test(s.name)) throw new Error(`Invalid sheet name: ${s.name}`);
    return s.name;
  });
  const definedNames = Object.entries(filterRefs)
    .map(([i, ref]) => `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${xmlText(ref)}</definedName>`)
    .join('');
  const parts = [
    [
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="${ct}.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${ct}.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="${ct}.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="${ct}.extended-properties+xml"/></Types>`,
    ],
    [
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>',
    ],
    [
      'docProps/core.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlText(title)}</dc:title><dc:creator>EduTrack</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created.toISOString().replace(/\.\d{3}Z$/, 'Z')}</dcterms:created></cp:coreProperties>`,
    ],
    ['docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>EduTrack</Application></Properties>'],
    [
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${names.map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${definedNames ? `<definedNames>${definedNames}</definedNames>` : ''}</workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ],
    ['xl/styles.xml', stylesXml],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, s.xml]),
  ];
  return zip(parts.map(([name, text]) => ({ name, data: Buffer.from(text, 'utf8') })));
}

/** A ZIP archive (deflate, UTF-8 names, fixed 1980-01-01 timestamps so equal input gives an equal file). */
export function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8');
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(0, 10); // time 00:00
    local.writeUInt16LE(0x21, 12); // date 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBytes, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // made by
    central.writeUInt16LE(20, 6); // needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

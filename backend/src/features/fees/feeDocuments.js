import { fitText, PdfReport, UnicodePdfDocument, wrapText } from '../../common/unicodePdf.js';
import { colName, createStyles, rowXml, sheetXml, workbookBuffer } from '../../common/xlsx.js';
import { invoiceView } from './feeInvoices.service.js';
import { formatMoney } from './feeRules.js';

/*
 * Fee documents: receipts (A5, A4 or an 80 mm receipt printer), invoices (one or a batch, A4) and
 * report exports (PDF and Excel). Receipts print what was stored when they were issued; a receipt of
 * a reversed payment prints VOID across it. EduTrack's own colours; the school's logo when it has one.
 */

const NAVY = '0D1932';
const MUTED = '5B6B80';
const LINE = 'D3DCE6';
const SOFT = 'F1F4F8';

const logoOf = (branding) => {
  const m = /^data:image\/jpeg;base64,(.+)$/.exec(branding?.logo ?? '');
  return m ? Buffer.from(m[1], 'base64') : null;
};
const dateText = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dateTimeText = (iso) => `${dateText(iso)} ${iso.slice(11, 16)}`;
const slug = (s) => String(s ?? '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 50) || 'document';

// ---- receipts ---------------------------------------------------------------------------------------

const SIZES = { a5: { width: 420, height: 595, margin: 30 }, a4: { width: 595, height: 842, margin: 44 }, thermal: { width: 227, height: 0, margin: 10 } };

/** The receipt PDF from its stored content. */
export function receiptPdf(receipt, { format = 'a5' } = {}) {
  const c = receipt.content;
  const voided = Boolean(receipt.voidedAt);
  const size = SIZES[format] ?? SIZES.a5;
  const thermal = format === 'thermal';
  const lineHeight = thermal ? 11 : 14;
  const height = thermal ? 260 + c.lines.length * 26 + (c.school.footer ? 30 : 0) + (c.payment.note ? 20 : 0) : size.height;
  const doc = new UnicodePdfDocument({ title: `Receipt ${c.number}`, width: size.width, height, created: new Date(receipt.issuedAt) });
  doc.addPage();
  const m = size.margin;
  const inner = size.width - m * 2;
  const s = thermal ? 0.8 : format === 'a4' ? 1.15 : 1;
  const money = (v) => formatMoney(v, c.currency);
  let y = m;
  const logo = logoOf(receipt.branding);
  if (!thermal) doc.rect(0, 0, size.width, 5, NAVY);
  if (logo) {
    const box = thermal ? 34 : 44 * s;
    doc.image(logo, thermal ? (size.width - box) / 2 : m, y, box, box);
    if (thermal) y += box + 4;
  }
  const textX = logo && !thermal ? m + 52 * s : m;
  const align = thermal ? 'center' : 'left';
  const headWidth = thermal ? inner : inner - (textX - m) - 120 * s;
  doc.text(fitText(c.school.name, 'bold', 13 * s, headWidth), textX, y + 13 * s, { font: 'bold', size: 13 * s, align, width: headWidth });
  y += 17 * s;
  for (const line of [c.branch?.name, c.school.address, [c.school.phone, c.school.email].filter(Boolean).join(' · ')].filter(Boolean)) {
    doc.text(fitText(line, 'regular', 8 * s, headWidth), textX, y + 9 * s, { size: 8 * s, color: MUTED, align, width: headWidth });
    y += 10 * s;
  }
  if (!thermal) {
    doc.text('PAYMENT RECEIPT', m, m + 13 * s, { font: 'bold', size: 11 * s, color: NAVY, align: 'right', width: inner });
    doc.text(c.number, m, m + 27 * s, { font: 'bold', size: 10 * s, align: 'right', width: inner });
    doc.text(dateTimeText(c.payment.receivedAt), m, m + 39 * s, { size: 8.5 * s, color: MUTED, align: 'right', width: inner });
    y = Math.max(y, m + 50 * s) + 8;
  } else {
    y += 6;
    doc.text('PAYMENT RECEIPT', m, y + 10, { font: 'bold', size: 10, align: 'center', width: inner });
    doc.text(`${c.number} · ${dateTimeText(c.payment.receivedAt)}`, m, y + 22, { size: 7.5, align: 'center', width: inner });
    y += 30;
  }
  doc.line(m, y, m + inner, y, LINE, 0.8);
  y += 8;
  const facts = [
    ['Student', c.student.name],
    ['Student ID', c.student.studentNumber],
    ['Class', c.student.class ?? '—'],
    ['Payment method', c.payment.method],
  ];
  const cols = thermal ? 1 : 2;
  const fw = inner / cols;
  facts.forEach(([k, v], i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const fy = y + row * (thermal ? 12 : 26 * s);
    if (thermal) {
      doc.text(`${k}:`, m, fy + 9, { size: 7.5, color: MUTED });
      doc.text(fitText(v, 'bold', 7.5, inner - 70), m + 70, fy + 9, { font: 'bold', size: 7.5 });
    } else {
      doc.text(k, m + col * fw, fy + 8 * s, { size: 7.5 * s, color: MUTED });
      doc.text(fitText(v, 'bold', 9.5 * s, fw - 8), m + col * fw, fy + 20 * s, { font: 'bold', size: 9.5 * s });
    }
  });
  y += Math.ceil(facts.length / cols) * (thermal ? 12 : 26 * s) + 8;
  // Lines: what the payment covers.
  const header = thermal ? ['Covers', 'Paid'] : ['Covers', 'Fee', 'Paid', 'Balance'];
  const widths = thermal ? [inner * 0.65, inner * 0.35] : [inner * 0.46, inner * 0.18, inner * 0.18, inner * 0.18];
  doc.rect(m, y, inner, lineHeight + 4, SOFT);
  let x = m;
  header.forEach((h, i) => {
    doc.text(h, x + 4, y + lineHeight - 1, { font: 'bold', size: 8 * s, color: MUTED, align: i ? 'right' : 'left', width: widths[i] - 8 });
    x += widths[i];
  });
  y += lineHeight + 4;
  for (const l of c.lines) {
    const label = l.kind === 'monthly' ? `Monthly fee · ${l.period}` : l.title;
    const cells = thermal ? [label, money(l.paid)] : [label, money(l.due), money(l.paid), money(l.balance)];
    const wrapped = wrapText(cells[0], 'regular', 8.5 * s, widths[0] - 8);
    const h = Math.max(lineHeight + 4, wrapped.length * (9 * s + 2) + 6);
    x = m;
    cells.forEach((cell, i) => {
      if (i === 0) wrapped.forEach((w, j) => doc.text(w, x + 4, y + 11 * s + j * (9 * s + 2), { size: 8.5 * s }));
      else doc.text(cell, x + 4, y + 11 * s, { size: 8.5 * s, align: 'right', width: widths[i] - 8 });
      x += widths[i];
    });
    y += h;
    doc.line(m, y, m + inner, y, 'E3E8EF');
  }
  y += 10;
  doc.text('Amount received', m, y + 11 * s, { font: 'bold', size: 10 * s });
  doc.text(money(c.payment.amount), m, y + 11 * s, { font: 'bold', size: 12 * s, align: 'right', width: inner });
  y += 18 * s;
  doc.text('Balance still owed', m, y + 10 * s, { size: 8.5 * s, color: MUTED });
  doc.text(money(c.balanceAfter ?? 0), m, y + 10 * s, { size: 8.5 * s, color: MUTED, align: 'right', width: inner });
  y += 16 * s;
  if (c.payment.note) {
    doc.text(fitText(`Note: ${c.payment.note}`, 'regular', 8 * s, inner), m, y + 9 * s, { size: 8 * s, color: MUTED });
    y += 14 * s;
  }
  y += 10;
  doc.text(`Received by: ${c.receivedBy.name}`, m, y + 9 * s, { size: 8.5 * s });
  if (c.school.showSignature && !thermal) {
    doc.line(m + inner - 150 * s, y + 30 * s, m + inner, y + 30 * s, '8794A8', 0.6);
    doc.text(c.school.signatureLabel ?? 'Signature', m + inner - 150 * s, y + 40 * s, { size: 7.5 * s, color: MUTED, align: 'center', width: 150 * s });
    y += 46 * s;
  } else y += 16;
  if (c.school.footer) {
    for (const line of wrapText(c.school.footer, 'regular', 8 * s, inner)) {
      doc.text(line, m, y + 9 * s, { size: 8 * s, color: MUTED, align: 'center', width: inner });
      y += 10 * s;
    }
  }
  if (voided) {
    const big = thermal ? 40 : 90 * s;
    doc.text('VOID', 0, height / 2 + big / 3, { font: 'bold', size: big, color: 'D92D20', align: 'center', width: size.width });
    doc.text(fitText(`Payment reversed: ${receipt.voidReason ?? ''}`, 'regular', 8 * s, inner), m, height / 2 + big / 3 + 18 * s, { size: 8 * s, color: 'D92D20', align: 'center', width: inner });
  }
  if (!thermal) doc.text(`Copy printed ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, m, height - 14, { size: 6.5, color: '8794A8' });
  return { buffer: doc.toBuffer(), filename: `receipt-${slug(c.number)}.pdf` };
}

// ---- invoices ---------------------------------------------------------------------------------------

function drawInvoice(doc, inv, currency) {
  const v = invoiceView(inv);
  const c = v.content ?? {};
  const school = c.school ?? {};
  const money = (n) => formatMoney(n, currency);
  const m = 40;
  const inner = doc.width - m * 2;
  doc.rect(0, 0, doc.width, 6, NAVY);
  let y = 30;
  const logo = logoOf(inv.branding);
  if (logo) doc.image(logo, m, y, 54, 54);
  const tx = logo ? m + 64 : m;
  doc.text(fitText(school.schoolName ?? '', 'bold', 17, inner - 220), tx, y + 18, { font: 'bold', size: 17 });
  doc.text(fitText(c.branch?.name ?? '', 'regular', 9.5, 240), tx, y + 33, { size: 9.5, color: MUTED });
  doc.text(fitText(school.address ?? '', 'regular', 8.5, 260), tx, y + 46, { size: 8.5, color: MUTED });
  const contact = [school.phone, school.email, school.website].filter(Boolean);
  contact.forEach((t, i) => doc.text(t, m, y + 14 + i * 12, { size: 8.5, color: MUTED, align: 'right', width: inner }));
  y += 70;
  doc.rect(m, y, inner, 24, NAVY);
  doc.text('STUDENT INVOICE', m, y + 16, { font: 'bold', size: 12, color: 'FFFFFF', align: 'center', width: inner });
  y += 34;
  const left = [['Invoice No.', v.number ?? 'Draft'], ['Date', v.issuedAt ? dateText(v.issuedAt) : dateText(v.createdAt)], ['Academic year', c.academicYear ?? '—'], ['Period', c.periodLabel ?? '—']];
  const right = [['Student', c.student?.name ?? v.student.name], ['Student ID', v.student.studentNumber], ['Class', c.student?.class ?? '—'], ['Guardian', c.student?.guardianName ?? '—']];
  doc.box(m, y, inner, 70, LINE, 0.8);
  doc.line(m + inner / 2, y, m + inner / 2, y + 70, LINE, 0.8);
  [left, right].forEach((rows, col) =>
    rows.forEach(([k, val], i) => {
      const x = m + 10 + col * (inner / 2);
      doc.text(k, x, y + 15 + i * 15, { size: 8.5, color: MUTED });
      doc.text(fitText(val, 'bold', 9, inner / 2 - 100), x + 84, y + 15 + i * 15, { font: 'bold', size: 9 });
    }),
  );
  y += 82;
  const cols = [
    { label: '#', w: 0.05 },
    { label: 'Description', w: 0.3 },
    { label: 'Period', w: 0.25 },
    { label: 'Fee', w: 0.13, right: true },
    { label: 'Discount', w: 0.13, right: true },
    { label: 'Amount', w: 0.14, right: true },
  ];
  const header = () => {
    doc.rect(m, y, inner, 20, SOFT);
    let x = m;
    for (const col of cols) {
      doc.text(col.label, x + 5, y + 13.5, { font: 'bold', size: 8.5, color: MUTED, align: col.right ? 'right' : 'left', width: col.w * inner - 10 });
      x += col.w * inner;
    }
    y += 20;
  };
  header();
  v.lines.forEach((l, i) => {
    if (y > doc.height - 200) {
      doc.addPage();
      y = 40;
      header();
    }
    const cells = [String(i + 1), l.description, l.period, money(l.standardAmount), l.discountAmount ? `-${money(l.discountAmount)}` : '—', l.cancelled ? 'Cancelled' : money(l.amount)];
    let x = m;
    cells.forEach((cell, j) => {
      doc.text(fitText(cell, 'regular', 9, cols[j].w * inner - 10), x + 5, y + 13, { size: 9, color: l.cancelled ? '8794A8' : NAVY, align: cols[j].right ? 'right' : 'left', width: cols[j].w * inner - 10 });
      x += cols[j].w * inner;
    });
    y += 19;
    doc.line(m, y, m + inner, y, 'E3E8EF');
  });
  y += 10;
  const totals = [
    ['Fees', money(v.totals.subtotal), false],
    ['Discounts', v.totals.discounts ? `-${money(v.totals.discounts)}` : money(0), false],
    ['Total invoice', money(v.totals.total), true],
    ['Previous payments', v.totals.paid ? `-${money(v.totals.paid)}` : money(0), false],
  ];
  const tw = 240;
  for (const [k, val, bold] of totals) {
    doc.text(k, m + inner - tw, y + 12, { size: 9.5, font: bold ? 'bold' : 'regular' });
    doc.text(val, m + inner - tw, y + 12, { size: 9.5, font: bold ? 'bold' : 'regular', align: 'right', width: tw });
    y += 17;
  }
  doc.rect(m + inner - tw - 8, y, tw + 8, 26, 'EEF2F7');
  doc.text('Remaining balance', m + inner - tw, y + 17, { font: 'bold', size: 11 });
  doc.text(money(v.totals.balance), m + inner - tw, y + 17, { font: 'bold', size: 12, align: 'right', width: tw });
  y += 40;
  doc.text(`Status: ${v.status.replace('_', ' ').replace(/^\w/, (ch) => ch.toUpperCase())}`, m, y, { font: 'bold', size: 9 });
  y += 14;
  const notes = [c.note, 'This invoice has no payment deadline. An invoice is not a receipt: payments are confirmed by receipts.'].filter(Boolean);
  doc.text('Note', m, y + 4, { font: 'bold', size: 9 });
  y += 8;
  for (const n of notes) {
    for (const line of wrapText(`• ${n}`, 'regular', 8.5, inner)) {
      y += 12;
      doc.text(line, m, y, { size: 8.5, color: MUTED });
    }
  }
  if (v.status === 'cancelled') doc.text('CANCELLED', 0, doc.height / 2, { font: 'bold', size: 70, color: 'D92D20', align: 'center', width: doc.width });
  if (school.footer) doc.text(fitText(school.footer, 'regular', 8, inner), m, doc.height - 34, { size: 8, color: MUTED, align: 'center', width: inner });
}

/** One PDF with every invoice given (one or more pages each). */
export function invoicesPdf(invoices, currency) {
  const doc = new UnicodePdfDocument({ title: invoices.length === 1 ? `Invoice ${invoices[0].number ?? 'draft'}` : `Invoices (${invoices.length})` });
  for (const inv of invoices) {
    doc.addPage();
    drawInvoice(doc, inv, currency);
  }
  const first = invoices[0];
  const filename = invoices.length === 1 ? `invoice-${slug(first.number ?? `draft-${first.id.slice(0, 8)}`)}.pdf` : `invoices-${invoices.length}.pdf`;
  return { buffer: doc.toBuffer(), filename, missingCharacters: doc.missingCharacters };
}

// ---- reports ----------------------------------------------------------------------------------------

const cellText = (col, value, currency) => {
  if (value === null || value === undefined || value === '') return '';
  if (col.kind === 'money') return formatMoney(value, currency);
  if (col.kind === 'percent') return `${(value / 100).toFixed(1)}%`;
  if (col.kind === 'int') return String(value);
  return String(value);
};
const filterLine = (r, filters) => [r.academicYear?.name, filters?.branchName, filters?.className, r.from && r.to ? `${r.from} to ${r.to}` : null].filter(Boolean).join(' · ');

export function reportPdf(r, { schoolName, filters } = {}) {
  const landscape = r.columns.length > 6;
  const many = r.columns.length > 12;
  const pdf = new PdfReport({ title: r.title, subtitle: filterLine(r, filters) || r.description, school: schoolName, landscape });
  if (r.summary) pdf.facts(Object.entries(r.summary).map(([k, v]) => [k[0].toUpperCase() + k.slice(1), k === 'rate' ? `${(v / 100).toFixed(1)}%` : formatMoney(v, r.currency)]), 5);
  if (!r.rows.length) pdf.paragraph('No records match these filters.');
  else {
    const rows = r.rows.map((row) => r.columns.map((c) => cellText(c, row[c.key], r.currency)));
    if (r.totals) rows.push(r.columns.map((c) => cellText(c, r.totals[c.key], r.currency)));
    pdf.table(r.columns.map((c) => ({ label: c.label, width: c.kind === 'text' && !c.narrow ? 1.6 : 1, align: c.align, bold: c.bold })), rows, { size: many ? 7 : landscape ? 8 : 8.5 });
  }
  return { buffer: pdf.toBuffer(), filename: `fees-${r.report}-${r.today ?? 'report'}.pdf` };
}

const styles = createStyles({
  title: { font: { bold: true, size: 14, color: 'FFFFFF' }, fill: '001D31', align: { v: 'center' } },
  sub: { font: { color: '4A566B' } },
  header: { font: { bold: true, color: 'FFFFFF' }, fill: '001D31', align: { h: 'center', v: 'center', wrap: true }, border: { color: '0A2F4A', bottom: { style: 'medium', color: 'D6982D' } } },
  cell: { border: 'thin', align: { v: 'center', wrap: true } },
  number: { border: 'thin', align: { h: 'right', v: 'center' } },
  total: { font: { bold: true }, fill: 'F1F4F8', border: 'thin', align: { v: 'center' } },
  totalNumber: { font: { bold: true }, fill: 'F1F4F8', border: 'thin', align: { h: 'right', v: 'center' } },
});

/** An Excel workbook of a report: money as numbers (in the currency's units), totals last. */
export function reportXlsx(r, { filters } = {}) {
  const S = styles.id;
  const width = Math.max(1, r.columns.length);
  const last = colName(width - 1);
  const value = (c, v) => {
    if (v === null || v === undefined || v === '') return '';
    if (c.kind === 'money') return v / 100;
    if (c.kind === 'percent') return v / 100;
    return v;
  };
  const rows = [
    rowXml(1, [[r.title, S.title], ...Array.from({ length: width - 1 }, () => [null, S.title])], { height: 24 }),
    rowXml(2, [[`${filterLine(r, filters) || r.description} · ${r.currency}${r.columns.some((c) => c.kind === 'percent') ? ' · rates in %' : ''}`, S.sub]]),
    rowXml(4, r.columns.map((c) => [c.label, S.header]), { height: 28 }),
  ];
  r.rows.forEach((row, i) => rows.push(rowXml(i + 5, r.columns.map((c) => [value(c, row[c.key]), c.kind === 'text' || c.kind === 'date' ? S.cell : S.number]))));
  if (r.totals) rows.push(rowXml(r.rows.length + 5, r.columns.map((c) => [value(c, r.totals[c.key]), c.kind === 'text' || c.kind === 'date' ? S.total : S.totalNumber])));
  const xml = sheetXml({ widths: r.columns.map((c) => (c.kind === 'text' && !c.narrow ? 26 : 15)), rows, merges: [`A1:${last}1`], freezeRows: 4, landscape: r.columns.length > 6, lastRef: `${last}${r.rows.length + 5}` });
  return { buffer: workbookBuffer({ sheets: [{ name: r.title.slice(0, 30), xml }], stylesXml: styles.xml, title: r.title }), filename: `fees-${r.report}-${r.today ?? 'report'}.xlsx` };
}

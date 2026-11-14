import { PdfDocument, wrapText } from '../../common/pdf.js';
import { colName, createStyles, rowXml, sheetXml, workbookBuffer } from '../../common/xlsx.js';

/*
 * Timetable exports (docs/business-rules.md → Timetable builder → Views): the class, teacher and
 * master timetables as Excel (.xlsx) or PDF (A4 landscape), exactly as the screen shows them. The
 * master timetable has one table per school day (classes × periods). Names only: no contact details.
 */

const DAY_NAMES = { MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday', SUN: 'Sunday' };
const NAVY = '001D31';
const GOLD = 'D6982D';

const subjectText = (s) => s?.name ?? '';
const teacherText = (t) => t?.name ?? '';

/** Section → { header, rows: [{ label, cells: [text] }] } (periods × days). */
function sectionTable(view) {
  const numbers = new Map();
  for (const day of view.days) for (const p of view.periods[day] ?? []) if (p.kind === 'lesson' && !numbers.has(p.number)) numbers.set(p.number, p);
  const ordered = [...numbers.values()].sort((a, b) => a.number - b.number);
  return {
    header: ['Period', ...view.days.map((d) => DAY_NAMES[d])],
    rows: ordered.map((p) => ({
      label: `Period ${p.number}\n${p.start}–${p.end}`,
      cells: view.days.map((d) => {
        const l = view.lessons.find((x) => x.weekday === d && x.period === p.number);
        return l ? `${subjectText(l.subject)}${l.teacher ? `\n${teacherText(l.teacher)}` : ''}` : '';
      }),
    })),
  };
}

/** Teacher → clock-time rows × days. */
function teacherTable(view) {
  return {
    header: ['Time', ...view.days.map((d) => `${DAY_NAMES[d]} (${view.perDay[d] ?? 0})`)],
    rows: view.rows.map((r) => ({
      label: `${r.start}–${r.end}`,
      cells: view.days.map((d) => {
        const list = view.lessons.filter((l) => l.weekday === d && l.start === r.start);
        return list.map((l) => `${l.section.displayName} · ${subjectText(l.subject)}${l.elsewhere ? ' (elsewhere)' : ''}${l.room ? `\nRoom ${l.room}` : ''}`).join('\n');
      }),
    })),
  };
}

/** Master → one table per day: classes × the day's periods. */
function masterTables(view) {
  return view.days.map((day) => {
    const numbers = [...new Set(view.sections.flatMap((s) => (s.periods[day] ?? []).filter((p) => p.kind === 'lesson').map((p) => p.number)))].sort((a, b) => a - b);
    return {
      day,
      header: ['Class', ...numbers.map((n) => `P${n}`)],
      rows: view.sections.map((s) => ({
        label: s.displayName,
        cells: numbers.map((n) => {
          const l = s.lessons.find((x) => x.weekday === day && x.period === n);
          return l ? `${l.subject?.code || subjectText(l.subject)}${l.teacher ? `\n${teacherText(l.teacher)}` : ''}` : '';
        }),
      })),
    };
  });
}

function titleOf(view) {
  if (view.kind === 'section') return { title: `Class timetable: ${view.section.displayName}`, sub: `${view.branch.name} · ${view.academicYear.name}` };
  if (view.kind === 'teacher') return { title: `Teacher timetable: ${view.teacher.name} (${view.teacher.staffId})`, sub: `${view.academicYear?.name ?? ''} · ${view.total} lessons a week` };
  return { title: `Master timetable: ${view.branch.name}`, sub: view.academicYear.name };
}
const sourceText = (view) => (view.source === 'draft' ? `Draft planned for ${view.date} (not published)` : `In effect on ${view.date}`);

export function timetableFilename(view, ext) {
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'timetable';
  const who = view.kind === 'section' ? view.section.displayName : view.kind === 'teacher' ? view.teacher.staffId : view.branch.code ?? view.branch.name;
  return `timetable-${view.kind}-${slug(who)}-${view.source}-${view.date}.${ext}`;
}

const headers = (type, filename) => ({ 'Content-Type': type, 'Content-Disposition': `attachment; filename="${filename}"`, 'X-Content-Type-Options': 'nosniff' });

// ---- Excel ---------------------------------------------------------------------------------------

const styles = createStyles({
  title: { font: { bold: true, size: 14, color: 'FFFFFF' }, fill: NAVY, align: { v: 'center' } },
  sub: { font: { color: '4A566B' } },
  header: { font: { bold: true, color: 'FFFFFF' }, fill: NAVY, align: { h: 'center', v: 'center', wrap: true }, border: { color: '0A2F4A', bottom: { style: 'medium', color: GOLD } } },
  label: { font: { bold: true }, fill: 'F1F4F8', border: 'thin', align: { v: 'center', wrap: true } },
  cell: { border: 'thin', align: { h: 'center', v: 'center', wrap: true } },
  empty: { border: 'thin', fill: 'FAFBFC' },
});
const S = styles.id;

function tableSheet(table, { title, sub, note }) {
  const width = table.header.length;
  const last = colName(width - 1);
  const rows = [
    rowXml(1, [[title, S.title], ...Array.from({ length: width - 1 }, () => [null, S.title])], { height: 24 }),
    rowXml(2, [[`${sub} · ${note}`, S.sub]]),
    rowXml(4, table.header.map((h) => [h, S.header]), { height: 28 }),
  ];
  table.rows.forEach((r, i) => {
    const lines = Math.max(2, ...r.cells.map((c) => c.split('\n').length));
    rows.push(rowXml(i + 5, [[r.label, S.label], ...r.cells.map((c) => [c || null, c ? S.cell : S.empty])], { height: 15 * lines + 4 }));
  });
  const lastRow = table.rows.length + 4;
  return sheetXml({ widths: [16, ...Array.from({ length: width - 1 }, () => (width > 9 ? 14 : 20))], rows, merges: [`A1:${last}1`], freezeRows: 4, landscape: true, lastRef: `${last}${lastRow}` });
}

export function sendTimetableXlsx(res, view, generated = new Date()) {
  const { title, sub } = titleOf(view);
  const note = sourceText(view);
  const sheets =
    view.kind === 'master'
      ? masterTables(view).map((t) => ({ name: DAY_NAMES[t.day], xml: tableSheet(t, { title: `${title} — ${DAY_NAMES[t.day]}`, sub, note }) }))
      : [{ name: 'Timetable', xml: tableSheet(view.kind === 'section' ? sectionTable(view) : teacherTable(view), { title, sub, note }) }];
  if (!sheets.length) sheets.push({ name: 'Timetable', xml: tableSheet({ header: ['Timetable'], rows: [] }, { title, sub, note: `${note} · no lessons` }) });
  const buffer = workbookBuffer({ sheets, stylesXml: styles.xml, title, created: generated });
  res.status(200).set(headers('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', timetableFilename(view, 'xlsx'))).send(buffer);
}

// ---- PDF -----------------------------------------------------------------------------------------

const M = 28;
function drawTable(doc, table, { title, sub, note }) {
  doc.addPage();
  doc.rect(0, 0, doc.width, 46, NAVY);
  doc.text(title, M, 28, { font: 'bold', size: 14, color: 'FFFFFF' });
  doc.text(`${sub} · ${note}`, M, 62, { size: 9, color: '4A566B' });
  const cols = table.header.length;
  const labelW = cols > 10 ? 70 : 90;
  const cellW = (doc.width - 2 * M - labelW) / Math.max(1, cols - 1);
  const size = cols > 10 ? 6.5 : 8;
  let y = 74;
  const headerH = 20;
  doc.rect(M, y, doc.width - 2 * M, headerH, NAVY);
  table.header.forEach((h, i) => {
    const x = i === 0 ? M : M + labelW + (i - 1) * cellW;
    doc.text(h, x + 3, y + 13, { font: 'bold', size, color: 'FFFFFF', width: (i === 0 ? labelW : cellW) - 6, align: i === 0 ? 'left' : 'center' });
  });
  y += headerH;
  for (const r of table.rows) {
    const wrapped = r.cells.map((c) => (c ? c.split('\n').flatMap((line) => wrapText(line, 'regular', size, cellW - 6)) : []));
    const labelLines = r.label.split('\n').flatMap((line) => wrapText(line, 'bold', size, labelW - 6));
    const lines = Math.max(2, labelLines.length, ...wrapped.map((w) => w.length));
    const h = lines * (size + 2.5) + 6;
    if (y + h > doc.height - M) {
      doc.addPage();
      y = M;
    }
    doc.rect(M, y, labelW, h, 'F1F4F8');
    labelLines.forEach((line, i) => doc.text(line, M + 3, y + 4 + (i + 1) * (size + 2.5) - 2, { font: 'bold', size }));
    wrapped.forEach((w, i) => {
      const x = M + labelW + i * cellW;
      w.forEach((line, j) => doc.text(line, x + 3, y + 4 + (j + 1) * (size + 2.5) - 2, { size: j === 0 ? size : size - 0.5, font: j === 0 ? 'bold' : 'regular', color: j === 0 ? '0D1932' : '4A566B', width: cellW - 6, align: 'center' }));
    });
    doc.line(M, y + h, doc.width - M, y + h);
    for (let i = 0; i < cols; i += 1) {
      const x = i === 0 ? M : M + labelW + (i - 1) * cellW;
      doc.line(x, y, x, y + h);
    }
    doc.line(doc.width - M, y, doc.width - M, y + h);
    y += h;
  }
  if (!table.rows.length) doc.text('No lessons.', M, y + 18, { size: 10, color: '4A566B' });
}

export function sendTimetablePdf(res, view, generated = new Date()) {
  const { title, sub } = titleOf(view);
  const note = sourceText(view);
  const doc = new PdfDocument({ title, created: generated });
  if (view.kind === 'master') {
    const tables = masterTables(view);
    for (const t of tables) drawTable(doc, t, { title: `${title} — ${DAY_NAMES[t.day]}`, sub, note });
    if (!tables.length) drawTable(doc, { header: ['Class'], rows: [] }, { title, sub, note });
  } else {
    drawTable(doc, view.kind === 'section' ? sectionTable(view) : teacherTable(view), { title, sub, note });
  }
  const buffer = doc.toBuffer((page, count) => {
    doc.text(`EduTrack · ${generated.toISOString().slice(0, 16).replace('T', ' ')} UTC · Page ${page} of ${count}`, M, doc.height - 12, { size: 7, color: '8A94A6' });
  });
  res.status(200).set(headers('application/pdf', timetableFilename(view, 'pdf'))).send(buffer);
}

export const _forTests = { sectionTable, teacherTable, masterTables };

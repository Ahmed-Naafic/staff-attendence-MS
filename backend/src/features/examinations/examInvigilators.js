import { PdfReport } from '../../common/unicodePdf.js';
import { colName, createStyles, rowXml, sheetXml, workbookBuffer } from '../../common/xlsx.js';
import { getTimetable } from './examTimetable.service.js';

/*
 * The invigilator matrix of a branch's examination timetable (docs/business-rules.md → Examinations →
 * Timetable → Invigilators): staff × examination days, each cell the rooms that person invigilates that
 * day (one entry per room and session, never merged; each keeps its session for the filters). The page
 * and the exports show staff names and room numbers only (R01 | R05). Built from getTimetable, so the page and its PDF / Excel exports
 * always show the same, current invigilations. Filters: shift, session of the day (1, 2, …), dates.
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const weekdayOf = (date) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];

/** Pure: { filters, options, days, rows, summary } from a timetable (getTimetable's shape). */
export function invigilatorMatrix(t, { shift = null, session = null, from = null, to = null } = {}) {
  const all = t.sessions;
  const options = {
    shifts: [...new Set(all.map((s) => s.shiftName))].sort((a, b) => a.localeCompare(b)),
    sessions: [...new Set(all.map((s) => s.sequence))].sort((a, b) => a - b),
    dates: [...new Set(all.map((s) => s.date))].sort(),
  };
  const picked = all.filter(
    (s) => (!shift || s.shiftName === shift) && (!session || s.sequence === session) && (!from || s.date >= from) && (!to || s.date <= to),
  );
  const days = [...new Set(picked.map((s) => s.date))].sort().map((date) => ({ date, weekday: weekdayOf(date) }));
  const byStaff = new Map();
  for (const s of picked) {
    for (const r of s.rooms) {
      for (const person of r.invigilators) {
        const row = byStaff.get(person.id) ?? { staff: { id: person.id, name: person.name, staffId: person.staffId ?? null }, cells: {}, duties: 0 };
        (row.cells[s.date] ??= []).push({ sessionId: s.id, room: { id: r.room.id, name: r.room.name }, start: s.start, end: s.end, shiftName: s.shiftName, sequence: s.sequence });
        row.duties += 1;
        byStaff.set(person.id, row);
      }
    }
  }
  const rows = [...byStaff.values()].sort((a, b) => a.staff.name.localeCompare(b.staff.name));
  for (const row of rows) for (const list of Object.values(row.cells)) list.sort((a, b) => a.start.localeCompare(b.start) || a.room.name.localeCompare(b.room.name, undefined, { numeric: true }));
  const unstaffed = picked.reduce((n, s) => n + s.rooms.filter((r) => r.invigilators.length < r.need).length, 0);
  return {
    examination: t.examination,
    branch: t.branch,
    published: Boolean(t.timetable?.publishedAt),
    changedSincePublish: Boolean(t.timetable?.changedSincePublish),
    filters: { shift, session, from, to },
    options,
    days,
    rows,
    summary: { staff: rows.length, duties: rows.reduce((n, r) => n + r.duties, 0), days: days.length, sessions: picked.length, roomsShort: unstaffed },
  };
}

/** The matrix of a branch (scope rules of getTimetable: a Manager's branch; the Owner names one). */
export async function getInvigilatorMatrix(scope, examId, { branch }, filters) {
  return invigilatorMatrix(await getTimetable(scope, examId, { branch }), filters);
}

// ---- exports ----------------------------------------------------------------------------------

/** Room numbers of a day in session order: "R01 | R05" (staff names and rooms only in the exports). */
const cellText = (list) => (list ?? []).map((a) => a.room.name).join(' | ');
/** The export rows: [staff name, rooms of day 1, …] ('' for no duty), shared by the PDF and Excel. */
export const exportRows = (m, days = m.days) => m.rows.map((row) => [row.staff.name, ...days.map((d) => cellText(row.cells[d.date]))]);
const filterText = (m) =>
  [
    m.filters.shift ? `Shift: ${m.filters.shift}` : 'All shifts',
    m.filters.session ? `Session ${m.filters.session}` : 'All sessions',
    m.days.length ? `${m.days[0].date} to ${m.days.at(-1).date}` : 'No days',
    m.published ? (m.changedSincePublish ? 'changed since published' : 'published') : 'not published',
  ].join(' · ');
const slug = (s) => String(s).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 50) || 'examination';
export const matrixFilename = (m, ext) => `invigilators-${slug(m.examination.name)}-${slug(m.branch.name)}.${ext}`;

/** A landscape PDF: the matrix, days split over several tables when there are many. */
export function invigilatorMatrixPdf(scope, m) {
  const r = new PdfReport({ title: `Invigilators · ${m.examination.name}`, subtitle: `${m.branch.name} · ${filterText(m)}`, school: scope.school.name ?? '', landscape: true });
  if (!m.rows.length) r.paragraph('No invigilation duties for these filters.');
  const PER_TABLE = 6;
  for (let i = 0; i < Math.max(1, m.days.length); i += PER_TABLE) {
    const days = m.days.slice(i, i + PER_TABLE);
    if (!m.rows.length) break;
    if (m.days.length > PER_TABLE) r.heading(`${days[0].date} to ${days.at(-1).date}`);
    r.table(
      [{ label: 'Staff name', width: 1.6, bold: true }, ...days.map((d) => ({ label: `${d.weekday} ${d.date.slice(5)}`, width: 1.2 }))],
      exportRows(m, days).map((row) => row.map((c) => c || '—')),
      { size: 8.5, minRowHeight: 22 },
    );
  }
  const buffer = r.toBuffer();
  return { buffer, filename: matrixFilename(m, 'pdf'), missingCharacters: r.doc.missingCharacters };
}

const NAVY = '001D31';
const GOLD = 'D6982D';
const styles = createStyles({
  title: { font: { bold: true, size: 14, color: 'FFFFFF' }, fill: NAVY, align: { v: 'center' } },
  sub: { font: { color: '4A566B' } },
  header: { font: { bold: true, color: 'FFFFFF' }, fill: NAVY, align: { h: 'center', v: 'center', wrap: true }, border: { color: '0A2F4A', bottom: { style: 'medium', color: GOLD } } },
  label: { font: { bold: true }, fill: 'F1F4F8', border: 'thin', align: { v: 'center', wrap: true } },
  cell: { border: 'thin', align: { h: 'center', v: 'center', wrap: true } },
  empty: { border: 'thin', fill: 'FAFBFC', font: { color: '8794A8' }, align: { h: 'center', v: 'center' } },
});

/** An Excel workbook: one sheet, staff × days, each cell its rooms with times (one per line). */
export function invigilatorMatrixXlsx(m, created = new Date()) {
  const S = styles.id;
  const width = m.days.length + 1;
  const last = colName(width - 1);
  const rows = [
    rowXml(1, [[`Invigilators · ${m.examination.name}`, S.title], ...Array.from({ length: width - 1 }, () => [null, S.title])], { height: 24 }),
    rowXml(2, [[`${m.branch.name} · ${filterText(m)}`, S.sub]]),
    rowXml(4, [['Staff name', S.header], ...m.days.map((d) => [`${d.weekday}\n${d.date}`, S.header])], { height: 32 }),
  ];
  exportRows(m).forEach(([name, ...cells], i) => {
    rows.push(rowXml(i + 5, [[name, S.label], ...cells.map((c) => (c ? [c, S.cell] : ['—', S.empty]))], { height: 20 }));
  });
  const xml = sheetXml({ widths: [28, ...m.days.map(() => 18)], rows, merges: [`A1:${last}1`], freezeRows: 4, landscape: true, lastRef: `${last}${Math.max(4, m.rows.length + 4)}` });
  return { buffer: workbookBuffer({ sheets: [{ name: 'Invigilators', xml }], stylesXml: styles.xml, title: `Invigilators · ${m.examination.name}`, created }), filename: matrixFilename(m, 'xlsx') };
}

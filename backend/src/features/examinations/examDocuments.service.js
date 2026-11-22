import { badRequest, notFound } from '../../common/httpError.js';
import { PdfReport } from '../../common/unicodePdf.js';
import { getPrisma } from '../../config/prisma.js';
import { getSessionAttendance } from './examAttendance.service.js';
import { getMarkSheet } from './examMarks.service.js';
import { getTimetable } from './examTimetable.service.js';

/*
 * Examination documents (docs/business-rules.md → Examinations → Documents): Unicode PDFs
 * (common/unicodePdf.js) built from the same data the screens show, so a printout never differs from
 * the page: the timetable of a branch, invigilators' duties, a session's seating lists (one page per
 * room, for the door) and attendance registers (with a signature column), and a mark sheet (filled in,
 * or blank to write on). Report cards: examResults.service.js. Whoever can see the data can print it.
 */

const ATTENDANCE = { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused' };
export const DOCUMENT_KINDS = ['timetable', 'duties', 'seating', 'register'];

const report = (scope, title, subtitle, options = {}) => new PdfReport({ title, subtitle, school: scope.school.name ?? '', ...options });
const finish = (r, filename) => {
  const buffer = r.toBuffer();
  return { buffer, filename, missingCharacters: r.doc.missingCharacters };
};
const safe = (text) => String(text).replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'document';

function timetableDoc(scope, t) {
  const r = report(scope, `Examination timetable · ${t.examination.name}`, `${t.branch.name} · ${t.examination.startDate} to ${t.examination.endDate}${t.timetable?.publishedAt ? '' : ' · not published'}`, { landscape: true });
  if (!t.sessions.length) r.paragraph('No timetable yet.');
  r.table(
    [{ label: 'Date', width: 1.1 }, { label: 'Time', width: 1 }, { label: 'Shift', width: 0.9 }, { label: 'Papers', width: 3.2 }, { label: 'Students', width: 0.8, align: 'right' }, { label: 'Rooms and invigilators', width: 3.4 }],
    t.sessions.map((s) => [
      s.date,
      `${s.start}–${s.end}`,
      s.shiftName,
      s.papers.map((p) => `${p.subject.name} (${p.class.name})`).join(', '),
      String(s.students),
      s.rooms.map((x) => `${x.room.name}: ${x.invigilators.map((i) => i.name).join(', ') || '—'}`).join('; '),
    ]),
  );
  if (t.unscheduled.length) {
    r.heading('Papers not in the timetable');
    r.paragraph(t.unscheduled.map((u) => `${u.class.name} ${u.subject.name}`).join(', '));
  }
  return finish(r, `timetable-${safe(t.examination.name)}-${safe(t.branch.name)}.pdf`);
}

function dutiesDoc(scope, t) {
  const r = report(scope, `Invigilation duties · ${t.examination.name}`, `${t.branch.name}`);
  const byStaff = new Map();
  for (const s of t.sessions) for (const room of s.rooms) for (const i of room.invigilators) byStaff.set(i.id, { staff: i, duties: [...(byStaff.get(i.id)?.duties ?? []), { s, room }] });
  if (!byStaff.size) r.paragraph('No invigilators yet.');
  for (const { staff, duties } of [...byStaff.values()].sort((a, b) => a.staff.name.localeCompare(b.staff.name))) {
    r.heading(`${staff.name}${staff.staffId ? ` · ${staff.staffId}` : ''} · ${duties.length} dut${duties.length === 1 ? 'y' : 'ies'}`);
    r.table(
      [{ label: 'Date', width: 1 }, { label: 'Time', width: 1 }, { label: 'Room', width: 0.8 }, { label: 'Papers', width: 3 }, { label: 'Students', width: 0.8, align: 'right' }],
      duties.map(({ s, room }) => [s.date, `${s.start}–${s.end}`, room.room.name, s.papers.map((p) => `${p.subject.name} (${p.class.name})`).join(', '), String(room.students)]),
    );
  }
  return finish(r, `duties-${safe(t.examination.name)}-${safe(t.branch.name)}.pdf`);
}

function roomsDoc(scope, exam, att, kind) {
  const register = kind === 'register';
  const when = `${att.session.date} ${att.session.start}–${att.session.end}`;
  const r = report(scope, `${register ? 'Attendance register' : 'Seating list'} · ${exam.name}`, when);
  att.rooms.forEach((room, i) => {
    if (i) r.newPage();
    r.heading(`Room ${room.room.name} · ${room.seats.length} students`);
    r.paragraph(`Invigilators: ${room.invigilators.map((x) => x.name).join(', ') || '—'}`);
    r.table(
      register
        ? [{ label: 'Seat', width: 0.5 }, { label: 'Student', width: 2.6, bold: true }, { label: 'Adm. No.', width: 1.1 }, { label: 'Class · Paper', width: 2 }, { label: 'Attendance', width: 1 }, { label: 'Signature', width: 1.4 }]
        : [{ label: 'Seat', width: 0.5 }, { label: 'Student', width: 2.8, bold: true }, { label: 'Adm. No.', width: 1.2 }, { label: 'Class', width: 1.3 }, { label: 'Paper', width: 1.5 }],
      room.seats.map((s) =>
        register
          ? [String(s.seatNumber), s.student.name, s.student.number, `${s.section.name} · ${s.subject}`, ATTENDANCE[s.attendance] ?? '', '']
          : [String(s.seatNumber), s.student.name, s.student.number, s.section.name, s.subject],
      ),
      { minRowHeight: register ? 24 : 18 },
    );
    if (register) {
      r.ensure(40);
      r.y += 16;
      r.doc.line(r.margin, r.y, r.margin + 200, r.y, '8794A8');
      r.doc.text('Invigilator’s signature', r.margin, r.y + 12, { size: 8, color: '6B7A90' });
      r.y += 20;
    }
  });
  if (!att.rooms.length) r.paragraph('Nobody is seated in this session.');
  return finish(r, `${register ? 'register' : 'seating'}-${safe(exam.name)}-${att.session.date}-${att.session.start.replace(':', '')}.pdf`);
}

/** A timetable document of a branch (`kind` timetable | duties) or of a session (seating | register). */
export async function examDocument(scope, examId, kind, { branch, session }) {
  if (!DOCUMENT_KINDS.includes(kind)) throw notFound('Document not found.');
  if (kind === 'timetable' || kind === 'duties') {
    const t = await getTimetable(scope, examId, { branch });
    return kind === 'timetable' ? timetableDoc(scope, t) : dutiesDoc(scope, t);
  }
  if (!session) throw badRequest('Choose the session.', { session: 'Choose the session.' });
  const att = await getSessionAttendance(scope, examId, session);
  const exam = await getPrisma().examination.findUnique({ where: { id: examId }, select: { name: true } });
  return roomsDoc(scope, exam, att, kind);
}

/** A mark sheet: filled in (as entered) or blank (to write marks on). */
export async function markSheetDocument(scope, paperId, sectionId, { blank }) {
  const s = await getMarkSheet(scope, paperId, sectionId);
  const r = report(scope, `Mark sheet · ${s.paper.subject.name} · ${s.section.name}`, `${s.examination.name} · out of ${s.paper.maxMarks}${blank ? '' : ` · ${s.status}`}${s.satOn ? ` · sat on ${s.satOn}` : ''}`);
  r.table(
    [{ label: '#', width: 0.4 }, { label: 'Student', width: 2.8, bold: true }, { label: 'Adm. No.', width: 1.2 }, { label: 'Attendance', width: 1 }, { label: `Marks (${s.paper.maxMarks})`, width: 1, align: 'right' }],
    s.students.map((row, i) => [String(i + 1), row.student.name, row.student.number, row.excused ? 'Excused' : row.absent ? 'Absent' : (row.attendance ? ATTENDANCE[row.attendance] : ''), blank ? '' : row.excused ? '—' : row.absent ? 'AB' : (row.marks ?? '').toString()]),
    { minRowHeight: blank ? 24 : 18 },
  );
  if (!blank) r.paragraph(`Entered ${s.stats.entered}/${s.stats.students} · average ${s.stats.average ?? '—'} (${s.stats.averagePercent ?? '—'}%) · highest ${s.stats.highest ?? '—'} · lowest ${s.stats.lowest ?? '—'}${s.approvedBy ? ` · approved by ${s.approvedBy}` : ''}`);
  r.ensure(40);
  r.y += 16;
  r.doc.line(r.margin, r.y, r.margin + 200, r.y, '8794A8');
  r.doc.text('Teacher’s signature', r.margin, r.y + 12, { size: 8, color: '6B7A90' });
  return finish(r, `marks-${safe(s.paper.subject.name)}-${safe(s.section.name)}${blank ? '-blank' : ''}.pdf`);
}

/** Sends a document: PDF headers, the file name, and a header saying when characters were missing from the font. */
export function sendPdf(res, { buffer, filename, missingCharacters }) {
  res.status(200).set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'no-store',
    ...(missingCharacters && { 'X-Missing-Characters': 'true' }),
  });
  res.send(buffer);
}

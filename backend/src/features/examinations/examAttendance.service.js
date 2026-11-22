import { badRequest, conflict, forbidden, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { asDbDay, addDays, toDay } from '../academic-calendar/schoolDays.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockActiveSchool, lockOperatingBranch } from '../branches/branches.service.js';
import { sectionDisplayName } from '../classes/classInput.js';
import { findExam } from './examinations.service.js';
import { toClock } from './timetableEngine.js';

/*
 * Examination attendance (docs/business-rules.md → Examinations → Attendance): each student's seat at
 * a paper is marked present, absent, late (sat the paper) or excused. Invigilators mark the rooms they
 * invigilate, on the day of the session (Staff app, /api/teacher/exams). The School Owner and the
 * branch's Manager mark or correct any room from the day of the session on (web). Never before the
 * day; never in a cancelled examination, nor once the paper's results are published (phase 7). Marks
 * entry reads it: absent and excused students get no marks (absent counts as zero when the setting
 * says so). Each save is one audit event.
 */

const TX = { timeout: 30000, maxWait: 10000 };
export const ATTENDANCE = ['present', 'absent', 'late', 'excused'];
const toDb = (s) => s.toUpperCase();
const studentName = (s) => [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' ');

const seatSelect = {
  id: true,
  seatNumber: true,
  roomId: true,
  attendance: true,
  attendanceNote: true,
  attendanceAt: true,
  attendanceByName: true,
  student: { select: { id: true, firstName: true, middleName: true, lastName: true, studentNumber: true } },
  section: { select: { id: true, name: true, class: { select: { name: true } } } },
  sitting: { select: { paperId: true, paper: { select: { subject: { select: { name: true } } } } } },
};
const toSeat = (s) => ({
  seatNumber: s.seatNumber,
  student: { id: s.student.id, name: studentName(s.student), number: s.student.studentNumber },
  section: { id: s.section.id, name: sectionDisplayName(s.section.class.name, s.section.name) },
  subject: s.sitting.paper.subject.name,
  paperId: s.sitting.paperId,
  attendance: s.attendance?.toLowerCase() ?? null,
  note: s.attendanceNote ?? '',
  markedBy: s.attendanceByName ?? null,
  markedAt: s.attendanceAt?.toISOString() ?? null,
});
const counts = (seats) => ({
  students: seats.length,
  present: seats.filter((s) => s.attendance === 'present').length,
  absent: seats.filter((s) => s.attendance === 'absent').length,
  late: seats.filter((s) => s.attendance === 'late').length,
  excused: seats.filter((s) => s.attendance === 'excused').length,
  notTaken: seats.filter((s) => !s.attendance).length,
});

/** Rooms of a session with their seats: [{ room, seats, summary, invigilators }]. */
async function roomsOf(client, sessionId, roomId = null) {
  const [seats, invigilations] = await Promise.all([
    client.examSeat.findMany({ where: { sessionId, ...(roomId && { roomId }) }, select: { ...seatSelect, room: { select: { id: true, name: true } } }, orderBy: { seatNumber: 'asc' } }),
    client.examInvigilation.findMany({ where: { sessionId, ...(roomId && { roomId }) }, select: { roomId: true, staff: { select: { id: true, name: true } } } }),
  ]);
  const rooms = new Map();
  for (const s of seats) {
    const r = rooms.get(s.room.id) ?? { room: s.room, seats: [] };
    r.seats.push(toSeat(s));
    rooms.set(s.room.id, r);
  }
  return [...rooms.values()]
    .map((r) => ({ ...r, summary: counts(r.seats), invigilators: invigilations.filter((i) => i.roomId === r.room.id).map((i) => i.staff) }))
    .sort((a, b) => a.room.name.localeCompare(b.room.name, undefined, { numeric: true }));
}

/** Papers whose results are published in the session's branch: their attendance stays. */
/** Sections whose results in the examination are approved or published: their attendance stays. */
async function lockedSections(client, examinationId, sectionIds) {
  if (!sectionIds.length) return new Set();
  const rows = await client.examResultSet.findMany({ where: { examinationId, sectionId: { in: sectionIds }, status: { in: ['APPROVED', 'PUBLISHED'] } }, select: { sectionId: true } });
  return new Set(rows.map((r) => r.sectionId));
}

/**
 * Applies marks to seats of a session (one room or any): [{ studentId, status, note }]. Checks every
 * student has a seat there; records who and when. → number of seats changed.
 */
async function applyMarks(tx, session, roomId, marks, user) {
  const seats = await tx.examSeat.findMany({ where: { sessionId: session.id, ...(roomId && { roomId }), studentId: { in: marks.map((m) => m.studentId) } }, select: { id: true, studentId: true, sectionId: true, attendance: true, attendanceNote: true } });
  if (seats.length !== marks.length) throw badRequest('Check the highlighted fields.', { marks: roomId ? 'Every student must be seated in this room.' : 'Every student must be seated in this session.' });
  const locked = await lockedSections(tx, session.examinationId, [...new Set(seats.map((s) => s.sectionId))]);
  if (seats.some((s) => locked.has(s.sectionId))) throw conflict('RESULTS_PUBLISHED', 'The results of this class are approved or published: its attendance stays as it is.');
  const now = new Date();
  let changed = 0;
  for (const m of marks) {
    const seat = seats.find((s) => s.studentId === m.studentId);
    const status = toDb(m.status);
    const note = m.note ?? null;
    if (seat.attendance === status && (seat.attendanceNote ?? null) === note) continue;
    await tx.examSeat.update({ where: { id: seat.id }, data: { attendance: status, attendanceNote: note, attendanceAt: now, attendanceById: user.id, attendanceByName: user.name } });
    changed += 1;
  }
  return changed;
}

const auditSave = (tx, schoolId, user, req, exam, session, roomName, changed, total) =>
  recordAuditEvent({
    client: tx,
    action: AUDIT_ACTIONS.EXAM_ATTENDANCE_RECORDED,
    actor: { id: user.id, name: user.name, role: user.role },
    target: { type: 'examination', id: exam.id, name: exam.name },
    schoolId,
    description: `Recorded examination attendance${roomName ? ` in ${roomName}` : ''} on ${toDay(session.date)} ${toClock(session.startMinute)}: ${changed} of ${total} students changed.`,
    change: { fields: ['attendance'], session: session.id, room: roomName ?? null, changed, total },
    req,
  });

// ---- School Owner and Manager (web) -----------------------------------------------------------

async function webSession(client, scope, examId, sessionId) {
  const exam = await findExam(client, scope, examId);
  const session = isUuid(sessionId) ? await client.examSession.findFirst({ where: { id: sessionId, examinationId: exam.id, ...(scope.branch && { branchId: scope.branch.id }) } }) : null;
  if (!session) throw notFound('Session not found.');
  return { exam, session };
}

/** A session's attendance, room by room: { session, canEdit, rooms: [{ room, seats, summary, invigilators }], summary }. */
export async function getSessionAttendance(scope, examId, sessionId) {
  const prisma = getPrisma();
  const [{ exam, session }, today] = await Promise.all([webSession(prisma, scope, examId, sessionId), calendarToday()]);
  const rooms = await roomsOf(prisma, session.id);
  return {
    session: { id: session.id, date: toDay(session.date), start: toClock(session.startMinute), end: toClock(session.endMinute), shiftName: session.shiftName },
    canEdit: exam.status === 'SCHEDULED' && toDay(session.date) <= today,
    rooms,
    summary: counts(rooms.flatMap((r) => r.seats)),
  };
}

/** Records attendance in a session (School Owner, or the branch's Manager): { room?, marks }. */
export async function saveSessionAttendance(scope, examId, sessionId, { room, marks }, user, req) {
  const today = await calendarToday();
  await getPrisma().$transaction(async (tx) => {
    const { exam, session } = await webSession(tx, scope, examId, sessionId);
    if (scope.branch) await lockOperatingBranch(tx, scope, 'examination attendance');
    else await lockActiveSchool(tx, scope.school);
    if (exam.status !== 'SCHEDULED') throw conflict('NOT_SCHEDULED', `${exam.name} is not scheduled.`);
    if (toDay(session.date) > today) throw conflict('TOO_EARLY', `Attendance of this session can be taken from ${toDay(session.date)}.`);
    const roomRow = room ? await tx.examRoom.findFirst({ where: { id: room, branchId: session.branchId }, select: { name: true } }) : null;
    if (room && !roomRow) throw badRequest('Check the highlighted fields.', { room: 'Choose a room of this session.' });
    const changed = await applyMarks(tx, session, room, marks, user);
    if (changed) await auditSave(tx, scope.school.id, user, req, exam, session, roomRow?.name, changed, marks.length);
  }, TX);
  return getSessionAttendance(scope, examId, sessionId);
}

// ---- invigilators (Staff app) ----------------------------------------------------------------

/**
 * The teacher's invigilation duties: today's and the next 14 days' (scheduled examinations):
 * { date, duties: [{ session, room, examination, papers, summary, canMark }] }.
 */
export async function teacherDuties(teacher) {
  const prisma = getPrisma();
  const today = await calendarToday();
  const rows = await prisma.examInvigilation.findMany({
    where: { staffId: teacher.id, session: { date: { gte: asDbDay(today), lte: asDbDay(addDays(today, 14)) }, examination: { status: 'SCHEDULED', schoolId: teacher.school.id } } },
    select: {
      roomId: true,
      room: { select: { id: true, name: true } },
      session: { select: { id: true, date: true, startMinute: true, endMinute: true, shiftName: true, examination: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } } } },
    },
  });
  const duties = [];
  for (const r of rows) {
    const seats = await prisma.examSeat.findMany({ where: { sessionId: r.session.id, roomId: r.roomId }, select: { attendance: true, sitting: { select: { paper: { select: { subject: { select: { name: true } }, class: { select: { name: true } } } } } } } });
    const date = toDay(r.session.date);
    duties.push({
      session: { id: r.session.id, date, start: toClock(r.session.startMinute), end: toClock(r.session.endMinute), shiftName: r.session.shiftName },
      room: r.room,
      branch: r.session.branch,
      examination: r.session.examination,
      papers: [...new Set(seats.map((s) => `${s.sitting.paper.subject.name} · ${s.sitting.paper.class.name}`))].sort(),
      summary: counts(seats.map((s) => ({ attendance: s.attendance?.toLowerCase() ?? null }))),
      canMark: date === today,
    });
  }
  duties.sort((a, b) => (a.session.date + a.session.start).localeCompare(b.session.date + b.session.start));
  return { date: today, duties };
}

async function teacherRoomCheck(client, teacher, sessionId, roomId) {
  if (!isUuid(sessionId) || !isUuid(roomId)) throw notFound('This room is not one of your duties.');
  const duty = await client.examInvigilation.findFirst({
    where: { staffId: teacher.id, sessionId, roomId, session: { examination: { schoolId: teacher.school.id } } },
    select: { room: { select: { id: true, name: true } }, session: { include: { examination: { select: { id: true, name: true, status: true } } } } },
  });
  if (!duty) throw notFound('This room is not one of your duties.');
  return duty;
}

/** One room of a duty with its students: { session, room, examination, canMark, seats, summary }. */
export async function teacherRoom(teacher, sessionId, roomId) {
  const prisma = getPrisma();
  const [duty, today] = await Promise.all([teacherRoomCheck(prisma, teacher, sessionId, roomId), calendarToday()]);
  const [room] = await roomsOf(prisma, sessionId, roomId);
  const s = duty.session;
  return {
    session: { id: s.id, date: toDay(s.date), start: toClock(s.startMinute), end: toClock(s.endMinute), shiftName: s.shiftName },
    room: duty.room,
    examination: { id: s.examination.id, name: s.examination.name },
    canMark: s.examination.status === 'SCHEDULED' && toDay(s.date) === today,
    seats: room?.seats ?? [],
    summary: room?.summary ?? counts([]),
  };
}

/** An invigilator records their room's attendance, on the day: { session, room, marks }. */
export async function saveTeacherAttendance(teacher, { session: sessionId, room: roomId, marks }, req) {
  const today = await calendarToday();
  await getPrisma().$transaction(async (tx) => {
    const duty = await teacherRoomCheck(tx, teacher, sessionId, roomId);
    const s = duty.session;
    if (s.examination.status !== 'SCHEDULED') throw conflict('NOT_SCHEDULED', `${s.examination.name} is not scheduled.`);
    if (toDay(s.date) !== today) throw forbidden(toDay(s.date) > today ? `You can take this room’s attendance on ${toDay(s.date)}.` : 'Only the day of the paper. Ask your Manager to correct it.');
    const changed = await applyMarks(tx, s, roomId, marks, teacher);
    if (changed) await auditSave(tx, teacher.school.id, { ...teacher, role: 'STAFF' }, req, s.examination, s, duty.room.name, changed, marks.length);
  }, TX);
  return teacherRoom(teacher, sessionId, roomId);
}

// ---- for the timetable (sessions with attendance keep their seats) ------------------------------

/** Refuses (409 ATTENDANCE_TAKEN) to reseat sessions where attendance was taken. */
export async function refuseIfAttendance(tx, where) {
  const taken = await tx.examSeat.findFirst({ where: { ...where, attendance: { not: null } }, select: { id: true } });
  if (taken) throw conflict('ATTENDANCE_TAKEN', 'Attendance was already taken in that session: its seats stay as they are.');
}

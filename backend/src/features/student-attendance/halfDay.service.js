import { Prisma } from '@prisma/client';
import { badRequest, conflict, forbidden, notFound } from '../../common/httpError.js';
import { fromDbStatus } from '../../common/listQuery.js';
import { isUuid } from '../../common/validate.js';
import { localDateTime, zonedMidnight } from '../../common/zonedTime.js';
import { getPrisma } from '../../config/prisma.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { addDays, asDbDay, toDay } from '../academic-calendar/schoolDays.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockOperatingBranch, operatingState } from '../branches/branches.service.js';
import { sectionDisplayName } from '../classes/classInput.js';
import { platformTimeZone } from '../platform-settings/settings.service.js';
import { loadSectionDays } from '../timetable/lessons.js';
import {
  countStatuses,
  dayShape,
  editableUntil,
  effectiveStatus,
  excuseCoversHalf,
  excuseCoversLesson,
  HALF_FROM_DB,
  HALF_LABELS,
  HALF_TO_DB,
  plannedHalves,
  sessionTimes,
  STATUS_FROM_DB,
  STATUS_LABELS,
  STATUS_TO_DB,
  windowState,
} from './attendanceRules.js';
import { activeExcuses, toExcuseBrief } from './excuses.service.js';
import { effectiveSettings } from './settings.js';
import { coveredThroughout, loadAttendanceDays, SECTION_INCLUDE, suspensionsOf } from './attendanceDays.js';

/*
 * The Manager's student attendance (docs/business-rules.md → Student attendance → Manager
 * attendance): once or twice a school day for each section of their branch, before and after the
 * main break. The School Owner reads every branch's; only Managers take it (403 otherwise).
 *
 * A session is opened for a section, date and half: it keeps the class list of that moment (the
 * section's enrollments that had not ended before the date), its times and its deadline. Marks are
 * PRESENT, ABSENT, LATE or EXCUSED (with a reason). Each change of a mark is kept in the change
 * history and the session's audit event; nothing is deleted. Unmarked students are never absent:
 * they are pending until the deadline and not marked after it. Excuses are applied when read.
 *
 * Windows (settings.js): from `halfDayOpensBeforeMinutes` before the half starts to its deadline
 * (`halfDayDeadlineAfterMinutes` after it ends) marks are on time; after it, until the end of the
 * day `managerEditDays` after the date, they are late entries and corrections (a reason may be
 * required). Days before then are read only (409 EDIT_PERIOD_OVER). Writes need the branch operating,
 * the year not closed, and run in one transaction with their audit event.
 */

const TX = { timeout: 30000, maxWait: 10000 };
const MANAGERS_ONLY = () => forbidden('Managers take student attendance for their branch. You can view it here.');
const SESSION_NOT_FOUND = () => notFound('Attendance session not found.');

/** "Before the break" for a Manager's session; "Period 3 · Mathematics" for a lesson. */
export const sessionLabel = (s) => (s.kind === 'LESSON' ? `Period ${s.periodNumber} · ${s.subject?.name ?? 'Lesson'}` : HALF_LABELS[HALF_FROM_DB[s.half]]);
/** Whether a plain excuse covers a session (half-day: its half; lesson: its period or its half). */
export const excuseCoversSession = (excuse, date, s) =>
  s.kind === 'LESSON' ? excuseCoversLesson(excuse, date, { half: s.half ? HALF_FROM_DB[s.half] : null, period: s.periodNumber }) : excuseCoversHalf(excuse, date, HALF_FROM_DB[s.half]);

export const sectionInclude = SECTION_INCLUDE;

export const toSection = (s) => ({
  id: s.id,
  name: s.name,
  displayName: sectionDisplayName(s.class.name, s.name),
  status: fromDbStatus(s.status),
  class: { id: s.class.id, name: s.class.name },
  branch: { id: s.branch.id, name: s.branch.name, code: s.branch.code },
  academicYear: { id: s.academicYear.id, name: s.academicYear.name, status: s.academicYear.status.toLowerCase() },
});

export const studentName = (s) => [s.firstName, s.middleName, s.lastName].filter(Boolean).join(' ');
export const byName = (a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName) || a.studentNumber.localeCompare(b.studentNumber);

const NO_SCHOOL = {
  no_academic_year: () => 'it is outside the academic year',
  closure: (d) => `the branch is closed (${d.closure?.name ?? 'closure'})`,
  holiday: (d) => `it is a school holiday (${d.holiday?.name ?? 'holiday'})`,
  not_a_school_day: () => 'it is not a school day',
  no_school_days: () => 'no school days are set up for the year',
};
export const noSchoolText = (day) => (NO_SCHOOL[day.reason] ?? (() => 'there is no school'))(day);

// Suspensions: attendanceDays.js (suspensionsOf, coveredThroughout).
export { coveredThroughout, suspensionsOf };

// ---- the day ---------------------------------------------------------------------------------------

async function branchesOf(client, scope, branchId) {
  if (scope.branch) return [{ id: scope.branch.id, name: scope.branch.name, code: scope.branch.code }];
  const rows = await client.branch.findMany({ where: { schoolId: scope.school.id, ...(branchId && { id: branchId }) }, select: { id: true, name: true, code: true }, orderBy: { number: 'asc' } });
  if (branchId && !rows.length) throw notFound('Branch not found.');
  return rows;
}

export const clock = (instant, timeZone) => (instant ? localDateTime(instant, timeZone).time : null);

/**
 * The attendance of a day: for each section of the branch (Owner: every branch, or the one chosen)
 * whose academic year covers the date, whether there is school and its sessions, each with its
 * times, state, and the counts of the session when it has been opened. Fixed number of queries.
 */
export async function dayOverview(scope, { date, branch: branchId }) {
  const prisma = getPrisma();
  const [branches, today] = await Promise.all([branchesOf(prisma, scope, branchId), calendarToday()]);
  const { rows } = await loadAttendanceDays(scope.school.id, branches.map((b) => b.id), date, date, { client: prisma });
  const operating = scope.branch ? operatingState(scope.branch, scope.school).operating : false;
  const canTake = (row, item) => Boolean(scope.branch) && operating && row.section.academicYear.status !== 'CLOSED' && (item.state === 'open' || item.state === 'overdue');

  const totals = { sessions: 0, taken: 0, complete: 0, due: 0, missing: 0 };
  const items = rows.map((row) => {
    const { day, section } = row;
    for (const h of row.halves) {
      totals.sessions += 1;
      if (h.session) totals.taken += 1;
      if (h.status === 'complete') totals.complete += 1;
      if (h.due) {
        totals.due += 1;
        if (h.status !== 'complete') totals.missing += 1;
      }
    }
    return {
      section: toSection(section),
      schoolDay: day.schoolDay,
      reason: day.schoolDay ? null : day.reason,
      reasonText: day.schoolDay ? null : noSchoolText(day),
      timetableDay: day.timetableDay,
      extraDay: day.extraDay,
      bellSchedule: day.bellSchedule,
      students: row.students,
      halves: row.halves.map((h) => ({ ...h, canTake: canTake(row, h) })),
      // The day's lessons (teachers take their attendance) and whether each was taken.
      lessons: row.lessons.map((l) => ({ ...l, canTake: canTake(row, l) })),
    };
  });
  return { date, today, branches, totals, items };
}

// ---- one session -----------------------------------------------------------------------------------

export async function findSection(client, scope, id) {
  const section = isUuid(id) ? await client.section.findFirst({ where: { id, schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) }, include: sectionInclude }) : null;
  if (!section) throw notFound('Section not found.');
  return section;
}

export const lockSectionDay = (tx, sectionId, date) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`student-attendance:${sectionId}:${date}`}))`;

/** The section's enrollments that had not ended before `date` (the class list of a session). */
export const rosterOf = (client, sectionId, dayStart) =>
  client.enrollment.findMany({ where: { sectionId, OR: [{ endedAt: null }, { endedAt: { gte: dayStart } }] }, select: { id: true, studentId: true } });

/**
 * Opens a section's session for a date and half (Manager), with the class list of this moment.
 * Opening one that is already open returns it (200; 201 when created). Refused when there is no
 * school that day (409 NOT_A_SCHOOL_DAY), the day has no such half (409 HALF_NOT_AVAILABLE), it
 * cannot be taken yet (409 SESSION_NOT_OPEN_YET), the correction period is over (409
 * EDIT_PERIOD_OVER), or the branch was suspended throughout it (409 SUSPENDED_THEN).
 */
export async function openSession(scope, { sectionId, date, half }, user, req) {
  if (!scope.branch) throw MANAGERS_ONLY();
  const prisma = getPrisma();
  const section = await findSection(prisma, scope, sectionId);
  const year = section.academicYear;
  if (section.status !== 'ACTIVE' || section.class.status !== 'ACTIVE') throw conflict('SECTION_INACTIVE', `${sectionDisplayName(section.class.name, section.name)} is inactive.`);
  if (year.status === 'CLOSED') throw conflict('YEAR_CLOSED', `${year.name} is closed. Its attendance is kept as it is.`);
  if (date < toDay(year.startDate) || date > toDay(year.endDate)) throw conflict('NOT_A_SCHOOL_DAY', `${date} is outside ${year.name}.`);
  const timeZone = await platformTimeZone();
  const displayName = sectionDisplayName(section.class.name, section.name);

  const { id, created } = await prisma.$transaction(async (tx) => {
    await lockOperatingBranch(tx, scope, 'student attendance');
    await lockSectionDay(tx, section.id, date);
    const now = new Date();
    const existing = (await tx.studentAttendanceSession.findMany({ where: { sectionId: section.id, date: asDbDay(date), kind: 'HALF_DAY' }, select: { id: true, half: true } })).map((s) => ({
      ...s,
      half: HALF_FROM_DB[s.half],
    }));
    const same = existing.find((s) => s.half === half);
    if (same) return { id: same.id, created: false };

    const [settings, days] = await Promise.all([effectiveSettings({ id: section.branchId, schoolId: scope.school.id }, tx), loadSectionDays(scope.school.id, [{ id: section.id, branchId: section.branchId }], date, date, tx)]);
    const [day] = days.get(section.id);
    if (!day.schoolDay && !existing.length) throw conflict('NOT_A_SCHOOL_DAY', `There is no attendance for ${displayName} on ${date}: ${noSchoolText(day)}.`);
    const item = dayShape(plannedHalves(day, settings), day.halves, existing).find((i) => i.half === half && !i.session);
    if (!item) {
      throw conflict('HALF_NOT_AVAILABLE', `${displayName} has no “${HALF_LABELS[half].toLowerCase()}” attendance on ${date}${existing.length ? ': this day’s attendance is already taken in other parts' : ''}.`);
    }
    const times = sessionTimes(date, item, settings, timeZone);
    const state = windowState(times, editableUntil(date, settings, timeZone), now);
    if (state === 'upcoming') throw conflict('SESSION_NOT_OPEN_YET', `This attendance can be taken from ${clock(times.opensAt, timeZone)} on ${localDateTime(times.opensAt, timeZone).date}.`, { opensAt: times.opensAt });
    if (state === 'locked') throw conflict('EDIT_PERIOD_OVER', `Attendance for ${date} can no longer be taken or corrected (${settings.managerEditDays} days after the date).`);
    const dayStart = zonedMidnight(date, timeZone);
    const dayEnd = zonedMidnight(addDays(date, 1), timeZone);
    const suspensions = await suspensionsOf(tx, scope.school.id, [section.branchId], dayStart, dayEnd, now);
    if (coveredThroughout(suspensions.get(section.branchId), times.startsAt ?? dayStart, times.endsAt ?? dayEnd)) {
      throw conflict('SUSPENDED_THEN', 'The branch was suspended at that time, so there is no attendance to take.');
    }

    const roster = await rosterOf(tx, section.id, dayStart);
    const session = await tx.studentAttendanceSession.create({
      data: {
        schoolId: scope.school.id,
        branchId: section.branchId,
        academicYearId: year.id,
        sectionId: section.id,
        kind: 'HALF_DAY',
        date: asDbDay(date),
        half: HALF_TO_DB[half],
        timetableDay: day.timetableDay,
        ...times,
        openedById: user.id,
        openedByName: user.name,
      },
    });
    if (roster.length) {
      await tx.studentAttendanceEntry.createMany({
        data: roster.map((r) => ({ sessionId: session.id, schoolId: scope.school.id, branchId: section.branchId, studentId: r.studentId, enrollmentId: r.id })),
      });
    }
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.STUDENT_ATTENDANCE_SESSION_OPENED,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { type: 'Section', id: section.id, name: displayName },
      schoolId: scope.school.id,
      description: `Opened ${displayName}’s attendance for ${date} (${HALF_LABELS[half].toLowerCase()}) with ${roster.length} students.`,
      change: { date, half, students: roster.length, deadlineAt: times.deadlineAt.toISOString() },
      req,
    });
    return { id: session.id, created: true };
  }, TX);
  return { created, ...(await getSession(scope, id)) };
}

export const studentSelect = { id: true, studentNumber: true, firstName: true, middleName: true, lastName: true, gender: true, status: true };

async function findSession(client, scope, id) {
  const session = isUuid(id)
    ? await client.studentAttendanceSession.findFirst({
        where: { id, schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) },
        include: { subject: { select: { id: true, name: true, code: true } }, section: { include: sectionInclude }, entries: { include: { student: { select: studentSelect }, enrollment: { select: { status: true, sectionId: true } } } } },
      })
    : null;
  if (!session) throw SESSION_NOT_FOUND();
  return session;
}

/** A session with its class list, each student's mark, excuse and what it counts as, the counts, and whether it can be marked now. */
export async function getSession(scope, id) {
  const prisma = getPrisma();
  const session = await findSession(prisma, scope, id);
  const date = toDay(session.date);
  const half = session.half ? HALF_FROM_DB[session.half] : null;
  const [settings, timeZone, excuses] = await Promise.all([
    effectiveSettings({ id: session.branchId, schoolId: scope.school.id }, prisma),
    platformTimeZone(),
    activeExcuses(prisma, scope.school.id, session.entries.map((e) => e.studentId), date, date),
  ]);
  const now = new Date();
  const until = editableUntil(date, settings, timeZone);
  const state = windowState(session, until, now);
  const overdue = now > session.deadlineAt;
  const operating = scope.branch ? operatingState(scope.branch, scope.school).operating : false;
  const yearOpen = session.section.academicYear.status !== 'CLOSED';

  const students = [...session.entries]
    .sort((a, b) => byName(a.student, b.student))
    .map((e) => {
      const status = STATUS_FROM_DB[e.status] ?? null;
      const excuse = (excuses.get(e.studentId) ?? []).find((x) => excuseCoversSession(x, date, session)) ?? null;
      return {
        student: { id: e.student.id, number: e.student.studentNumber, name: studentName(e.student), gender: e.student.gender.toLowerCase() },
        status,
        effective: effectiveStatus(status, { excused: Boolean(excuse), overdue }),
        reason: e.reason,
        note: e.note,
        markedAt: e.markedAt,
        markedBy: e.markedByName,
        markedByRole: e.markedByRole ? e.markedByRole.toLowerCase() : null,
        afterDeadline: Boolean(e.markedAt && e.markedAt > session.deadlineAt),
        version: e.version,
        addedLate: e.addedLate,
        // The student has since left the section (moved or left the school): kept on this list.
        leftSection: e.enrollment.sectionId !== session.sectionId || e.enrollment.status === 'TRANSFERRED_OUT',
        excuse: excuse ? toExcuseBrief(excuse) : null,
      };
    });
  const counts = countStatuses(students.map((s) => s.effective));
  return {
    session: {
      id: session.id,
      kind: session.kind === 'LESSON' ? 'lesson' : 'half_day',
      date,
      half,
      period: session.periodNumber,
      subject: session.subject ?? null,
      label: sessionLabel(session),
      timetableDay: session.timetableDay,
      start: clock(session.startsAt, timeZone),
      end: clock(session.endsAt, timeZone),
      opensAt: session.opensAt,
      deadlineAt: session.deadlineAt,
      editableUntil: until > session.deadlineAt ? until : session.deadlineAt,
      openedAt: session.openedAt,
      openedBy: session.openedByName,
      state,
      complete: counts.notMarked === 0,
    },
    section: toSection(session.section),
    students,
    counts,
    canMark: Boolean(scope.branch) && operating && yearOpen && (state === 'open' || state === 'overdue'),
    reasonRequiredForChanges: overdue && settings.correctionReasonRequired,
    statusLabels: STATUS_LABELS,
  };
}

/** Locks a Manager's session row for a change and checks that it can still be changed. */
async function lockSessionForChange(tx, scope, id, timeZone) {
  if (!isUuid(id)) throw SESSION_NOT_FOUND();
  await lockOperatingBranch(tx, scope, 'student attendance');
  const [row] = await tx.$queryRaw`SELECT "id" FROM "StudentAttendanceSession" WHERE "id" = ${id} AND "schoolId" = ${scope.school.id} AND "branchId" = ${scope.branch.id} FOR UPDATE`;
  if (!row) throw SESSION_NOT_FOUND();
  const session = await tx.studentAttendanceSession.findUnique({
    where: { id },
    include: { subject: { select: { id: true, name: true } }, section: { include: sectionInclude }, entries: { include: { student: { select: studentSelect } } } },
  });
  if (session.section.academicYear.status === 'CLOSED') throw conflict('YEAR_CLOSED', `${session.section.academicYear.name} is closed. Its attendance is kept as it is.`);
  const date = toDay(session.date);
  const settings = await effectiveSettings({ id: session.branchId, schoolId: scope.school.id }, tx);
  const now = new Date();
  const state = windowState(session, editableUntil(date, settings, timeZone), now);
  if (state === 'upcoming') throw conflict('SESSION_NOT_OPEN_YET', `This attendance can be taken from ${clock(session.opensAt, timeZone)}.`, { opensAt: session.opensAt });
  if (state === 'locked') throw conflict('EDIT_PERIOD_OVER', `Attendance for ${date} can no longer be taken or corrected (${settings.managerEditDays} days after the date).`);
  return { session, settings, date, now };
}

/**
 * Saves marks (Manager): only students on the session's class list; only actual changes are
 * written. After the deadline, changing a mark needs a reason when the school requires it. A mark
 * sent with an outdated `version` is refused (409 STALE_MARKS: someone else changed it).
 */
export async function saveMarks(scope, id, { marks }, user, req) {
  if (!scope.branch) throw MANAGERS_ONLY();
  const timeZone = await platformTimeZone();
  await getPrisma().$transaction(async (tx) => {
    const { session, settings, date, now } = await lockSessionForChange(tx, scope, id, timeZone);
    const label = sessionLabel(session);
    const afterDeadline = now > session.deadlineAt;
    const byStudent = new Map(session.entries.map((e) => [e.studentId, e]));
    const errors = {};
    const stale = [];
    const changes = [];
    for (const mark of marks) {
      const entry = byStudent.get(mark.studentId);
      if (!entry) {
        errors[`marks.${mark.index}.student`] = 'This student is not on the class list of this session.';
        continue;
      }
      if (mark.version !== undefined && mark.version !== entry.version) stale.push(entry.studentId);
      const status = STATUS_TO_DB[mark.status];
      const statusChanged = entry.status !== status;
      const reason = mark.reason ?? (statusChanged ? null : entry.reason);
      const note = mark.note ?? (statusChanged ? null : entry.note);
      if (!statusChanged && reason === entry.reason && note === entry.note) continue;
      if (entry.status && statusChanged && afterDeadline && settings.correctionReasonRequired && !mark.reason) {
        errors[`marks.${mark.index}.reason`] = 'Give the reason for changing this mark after it was due.';
      }
      changes.push({ entry, status, reason, note });
    }
    if (Object.keys(errors).length) throw badRequest('Check the highlighted marks.', errors);
    if (stale.length) throw conflict('STALE_MARKS', 'Someone else changed some of these marks meanwhile. Reload to see them, then try again.', { students: stale });
    if (!changes.length) return;

    const rows = changes.map((c) => Prisma.sql`(${c.entry.id}::text, ${c.status}::text, ${c.reason}::text, ${c.note}::text)`);
    await tx.$executeRaw`
      UPDATE "StudentAttendanceEntry" AS e
      SET "status" = v.status::"StudentAttendanceStatus", "reason" = v.reason, "note" = v.note,
          "markedAt" = ${now}, "markedById" = ${user.id}, "markedByName" = ${user.name}, "markedByRole" = ${user.role}::"Role",
          "occurredAt" = ${now}, "syncedAt" = NULL, "source" = 'WEB', "version" = e."version" + 1
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, status, reason, note)
      WHERE e."id" = v.id`;
    await tx.studentAttendanceChange.createMany({
      data: changes.map((c) => ({
        entryId: c.entry.id,
        sessionId: session.id,
        studentId: c.entry.studentId,
        fromStatus: c.entry.status,
        toStatus: c.status,
        reason: c.reason,
        note: c.note,
        actorId: user.id,
        actorName: user.name,
        actorRole: user.role,
        source: 'WEB',
        occurredAt: now,
        afterDeadline,
      })),
    });
    const displayName = sectionDisplayName(session.section.class.name, session.section.name);
    const marked = changes.filter((c) => !c.entry.status).length;
    const corrected = changes.length - marked;
    const statusText = (s) => (s ? STATUS_LABELS[STATUS_FROM_DB[s]] : 'Not marked');
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.STUDENT_ATTENDANCE_MARKED,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { type: 'Section', id: session.section.id, name: displayName },
      schoolId: scope.school.id,
      description: `Took ${displayName}’s attendance for ${date} (${label}): ${marked} marked, ${corrected} changed${afterDeadline ? ', after the deadline' : ''}.`,
      change: {
        sessionId: session.id,
        date,
        session: label,
        marked,
        changed: corrected,
        afterDeadline,
        students: changes.slice(0, 100).map((c) => ({
          student: `${studentName(c.entry.student)} (${c.entry.student.studentNumber})`,
          from: statusText(c.entry.status),
          to: statusText(c.status),
          ...(c.reason && { reason: c.reason }),
        })),
        ...(changes.length > 100 && { more: changes.length - 100 }),
      },
      req,
    });
  }, TX);
  return getSession(scope, id);
}

/**
 * Adds to the session's class list the students enrolled in the section since it opened (Manager).
 * Nobody is removed: students who left stay, marked as such.
 */
export async function refreshRoster(scope, id, user, req) {
  if (!scope.branch) throw MANAGERS_ONLY();
  const timeZone = await platformTimeZone();
  const added = await getPrisma().$transaction(async (tx) => {
    const { session, date } = await lockSessionForChange(tx, scope, id, timeZone);
    const listed = new Set(session.entries.map((e) => e.studentId));
    const missing = (await rosterOf(tx, session.sectionId, zonedMidnight(date, timeZone))).filter((r) => !listed.has(r.studentId));
    if (!missing.length) return 0;
    await tx.studentAttendanceEntry.createMany({
      data: missing.map((r) => ({ sessionId: session.id, schoolId: scope.school.id, branchId: session.branchId, studentId: r.studentId, enrollmentId: r.id, addedLate: true })),
    });
    const displayName = sectionDisplayName(session.section.class.name, session.section.name);
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.STUDENT_ATTENDANCE_CLASS_LIST_UPDATED,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { type: 'Section', id: session.section.id, name: displayName },
      schoolId: scope.school.id,
      description: `Added ${missing.length} newly enrolled students to ${displayName}’s attendance for ${date} (${sessionLabel(session)}).`,
      change: { sessionId: session.id, date, added: missing.length },
      req,
    });
    return missing.length;
  }, TX);
  return { added, ...(await getSession(scope, id)) };
}

/** Every mark and change of a session, newest first (at most 500). */
export async function sessionHistory(scope, id) {
  const prisma = getPrisma();
  const session = isUuid(id) ? await prisma.studentAttendanceSession.findFirst({ where: { id, schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }) }, select: { id: true } }) : null;
  if (!session) throw SESSION_NOT_FOUND();
  const rows = await prisma.studentAttendanceChange.findMany({
    where: { sessionId: session.id },
    orderBy: [{ recordedAt: 'desc' }, { id: 'asc' }],
    take: 500,
    include: { entry: { select: { student: { select: studentSelect } } } },
  });
  return {
    items: rows.map((r) => ({
      id: r.id,
      student: { id: r.entry.student.id, number: r.entry.student.studentNumber, name: studentName(r.entry.student) },
      from: STATUS_FROM_DB[r.fromStatus] ?? null,
      to: STATUS_FROM_DB[r.toStatus],
      reason: r.reason,
      note: r.note,
      by: r.actorName,
      byRole: r.actorRole,
      source: r.source.toLowerCase(),
      occurredAt: r.occurredAt,
      recordedAt: r.recordedAt,
      afterDeadline: r.afterDeadline,
    })),
  };
}

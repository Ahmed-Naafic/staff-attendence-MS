import { Prisma } from '@prisma/client';
import { conflict, HttpError, notFound } from '../../common/httpError.js';
import { zonedMidnight } from '../../common/zonedTime.js';
import { getPrisma } from '../../config/prisma.js';
import { asDbDay } from '../academic-calendar/schoolDays.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockOperatingBranch } from '../branches/branches.service.js';
import { sectionDisplayName } from '../classes/classInput.js';
import { platformTimeZone } from '../platform-settings/settings.service.js';
import { loadSectionDays } from '../timetable/lessons.js';
import { teacherLessons } from '../timetable/timetable.service.js';
import {
  countStatuses,
  editableUntil,
  effectiveStatus,
  excuseCoversLesson,
  HALF_TO_DB,
  lessonTimes,
  STATUS_FROM_DB,
  STATUS_TO_DB,
  teacherMarkRefusal,
  uploadUntil,
  windowState,
} from './attendanceRules.js';
import { activeExcuses } from './excuses.service.js';
import { byName, clock, findSection, getSession, lockSectionDay, rosterOf, studentName } from './halfDay.service.js';
import { effectiveSettings, effectiveSettingsFor } from './settings.js';

/*
 * Teacher lesson attendance (docs/business-rules.md → Student attendance → Teacher lesson
 * attendance), from the Staff mobile app, online or offline. A teacher's lessons are the timetable's
 * lessons naming them, and lessons without a named teacher in subjects they teach in that section
 * (timetable.service.js teacherLessons — the one definition). Teachers mark PRESENT or ABSENT;
 * LATE and EXCUSED are the Manager's.
 *
 * Times: each mark carries `occurredAt` (device clock) and the request `sentAt` (device clock when
 * sending); the server measures the device clock against its own (|sentAt − received| ≤ 5 minutes,
 * else 422 CLOCK_SKEW: kept on the device and sent again) and corrects each mark's time by the same
 * difference (when it is more than 30 seconds off). A mark counts when it was taken between the lesson's opening and its deadline (or, for
 * a correction of the teacher's own mark, within `teacherCorrectionMinutes` of their first mark), and
 * it arrives by the deadline plus `offlineGraceMinutes`. Marks are applied in the order they were
 * taken; an older mark never replaces a newer one, and a teacher never replaces a Manager's mark.
 * Each mark gets its own answer (recorded or refused with a code); nothing is deleted.
 */

const TX = { timeout: 30000, maxWait: 10000 };
const CLOCK_TOLERANCE_MS = 5 * 60_000;
const REFUSALS = {
  NOT_ON_LIST: 'This student is not on the class list of this lesson.',
  OUTSIDE_WINDOW: 'Taken outside the lesson’s attendance time.',
  SET_BY_MANAGER: 'A Manager has set this student’s attendance; ask them to change it.',
  NEWER_MARK: 'A later mark for this student was already recorded.',
  EVENT_IN_FUTURE: 'The mark time is later than the time it was sent.',
};

/** A teacher's lesson on a date: the item from teacherLessons, or null. */
async function findLesson(teacher, sectionId, date, period) {
  const { lessons } = await teacherLessons({ school: teacher.school, branch: null }, teacher.id, { from: date, to: date });
  return lessons.find((l) => l.section.id === sectionId && l.period === period) ?? null;
}

const lessonHalf = (half) => (half === 'before_break' || half === 'after_break' ? half : null);

/** Creates a lesson session with the class list of this moment (inside a transaction with the section day locked). */
async function createLessonSession(tx, { schoolId, section, date, lesson, times, user, req, timeZone, timetableDay }) {
  const roster = await rosterOf(tx, section.id, zonedMidnight(date, timeZone));
  const half = lessonHalf(lesson.half);
  const session = await tx.studentAttendanceSession.create({
    data: {
      schoolId,
      branchId: section.branchId,
      academicYearId: section.academicYearId,
      sectionId: section.id,
      kind: 'LESSON',
      date: asDbDay(date),
      half: half ? HALF_TO_DB[half] : null,
      periodNumber: lesson.period,
      subjectId: lesson.subject.id,
      timetableDay: timetableDay ?? null,
      ...times,
      openedById: user.id,
      openedByName: user.name,
    },
  });
  if (roster.length) {
    await tx.studentAttendanceEntry.createMany({ data: roster.map((r) => ({ sessionId: session.id, schoolId, branchId: section.branchId, studentId: r.studentId, enrollmentId: r.id })) });
  }
  const displayName = section.displayName ?? sectionDisplayName(section.class.name, section.name);
  await recordAuditEvent({
    client: tx,
    action: AUDIT_ACTIONS.STUDENT_ATTENDANCE_SESSION_OPENED,
    actor: { id: user.id, name: user.name, role: user.role },
    target: { type: 'Section', id: section.id, name: displayName },
    schoolId,
    description: `Opened ${displayName}’s attendance for ${date} (period ${lesson.period}, ${lesson.subject.name}) with ${roster.length} students.`,
    change: { date, kind: 'lesson', period: lesson.period, subject: lesson.subject.name, students: roster.length, deadlineAt: times.deadlineAt.toISOString() },
    req,
  });
  return session.id;
}

const lockLesson = (tx, sectionId, date, period) => lockSectionDay(tx, sectionId, `${date}:p${period}`);

// ---- the teacher's day -------------------------------------------------------------------------

/**
 * A teacher's lessons on a date, each with its window, its session (when opened) and the class list
 * with marks: the session's list when opened, else the section's current class list (so the app
 * can mark offline). Fixed number of queries.
 */
export async function teacherDay(teacher, { date }) {
  const prisma = getPrisma();
  const [{ lessons }, timeZone] = await Promise.all([teacherLessons({ school: teacher.school, branch: null }, teacher.id, { from: date, to: date }), platformTimeZone()]);
  const sectionIds = [...new Set(lessons.map((l) => l.section.id))];
  const branchIds = [...new Set(lessons.map((l) => l.section.branch.id))];
  const dayStart = zonedMidnight(date, timeZone);
  const [settingsMap, sessions, enrollments] = await Promise.all([
    effectiveSettingsFor(teacher.school.id, branchIds, prisma),
    sectionIds.length
      ? prisma.studentAttendanceSession.findMany({
          where: { sectionId: { in: sectionIds }, date: asDbDay(date), kind: 'LESSON' },
          include: { entries: { include: { student: { select: { id: true, studentNumber: true, firstName: true, middleName: true, lastName: true } } } } },
        })
      : [],
    sectionIds.length
      ? prisma.enrollment.findMany({
          where: { sectionId: { in: sectionIds }, OR: [{ endedAt: null }, { endedAt: { gte: dayStart } }] },
          select: { sectionId: true, student: { select: { id: true, studentNumber: true, firstName: true, middleName: true, lastName: true } } },
        })
      : [],
  ]);
  const studentIds = [...new Set([...enrollments.map((e) => e.student.id), ...sessions.flatMap((s) => s.entries.map((e) => e.studentId))])];
  const excuses = await activeExcuses(prisma, teacher.school.id, studentIds, date, date);
  const now = new Date();

  const items = lessons.map((lesson) => {
    const settings = settingsMap.get(lesson.section.branch.id);
    const session = sessions.find((s) => s.sectionId === lesson.section.id && s.periodNumber === lesson.period) ?? null;
    const times = session ?? lessonTimes(date, lesson, settings, timeZone);
    const until = uploadUntil(times.deadlineAt, settings);
    const state = now < times.opensAt ? 'upcoming' : now <= times.deadlineAt ? 'open' : 'closed';
    const overdue = now > times.deadlineAt;
    const target = { half: lessonHalf(lesson.half), period: lesson.period };
    const excuseOf = (studentId) => (excuses.get(studentId) ?? []).find((x) => excuseCoversLesson(x, date, target)) ?? null;
    const rows = session
      ? session.entries.map((e) => ({ student: e.student, status: STATUS_FROM_DB[e.status] ?? null, markedBy: e.markedByName, byManager: e.markedByRole === 'MANAGER' || e.markedByRole === 'OWNER', mine: e.markedById === teacher.id, occurredAt: e.occurredAt }))
      : enrollments.filter((e) => e.sectionId === lesson.section.id).map((e) => ({ student: e.student, status: null, markedBy: null, byManager: false, mine: false, occurredAt: null }));
    const students = rows
      .sort((a, b) => byName(a.student, b.student))
      .map((r) => {
        const excuse = excuseOf(r.student.id);
        return {
          id: r.student.id,
          number: r.student.studentNumber,
          name: studentName(r.student),
          status: r.status,
          effective: effectiveStatus(r.status, { excused: Boolean(excuse), overdue }),
          markedBy: r.markedBy,
          setByManager: r.byManager,
          occurredAt: r.occurredAt,
          excuse: excuse ? { reason: excuse.reason } : null,
        };
      });
    return {
      key: `${lesson.section.id}|${date}|${lesson.period}`,
      date,
      period: lesson.period,
      start: lesson.start,
      end: lesson.end,
      half: lesson.half,
      section: lesson.section,
      subject: lesson.subject,
      room: lesson.room,
      opensAt: times.opensAt,
      deadlineAt: times.deadlineAt,
      uploadUntil: until,
      state,
      session: session ? { id: session.id, counts: countStatuses(students.map((s) => s.effective)), openedAt: session.openedAt } : null,
      students,
    };
  });
  return { date, serverTime: now, teacher: { id: teacher.id, name: teacher.name }, lessons: items };
}

// ---- the teacher's marks -----------------------------------------------------------------------

/**
 * Applies a teacher's marks for one lesson: { sectionId, date, period, sentAt, marks: [{ studentId,
 * status, occurredAt }] }. Opens the lesson's session if needed. → { results: [{ student, occurredAt,
 * result: 'recorded' | 'refused', code?, message? }], lesson } (lesson: as in teacherDay).
 */
export async function saveLessonMarks(teacher, { sectionId, date, period, sentAt, marks }, receivedAt, req) {
  const skew = sentAt.getTime() - receivedAt.getTime();
  if (Math.abs(skew) > CLOCK_TOLERANCE_MS) {
    throw new HttpError(422, 'CLOCK_SKEW', 'Your device clock differs from the server by more than 5 minutes. Set the date and time automatically; the marks are kept and sent again.', { skewSeconds: Math.round(skew / 1000) });
  }
  const prisma = getPrisma();
  const lesson = await findLesson(teacher, sectionId, date, period);
  if (!lesson) throw notFound('This is not one of your lessons on that day.');
  const timeZone = await platformTimeZone();
  const settings = await effectiveSettings({ id: lesson.section.branch.id, schoolId: teacher.school.id }, prisma);

  const results = await prisma.$transaction(async (tx) => {
    await lockOperatingBranch(tx, { school: teacher.school, branch: { id: lesson.section.branch.id } }, 'student attendance');
    await lockLesson(tx, sectionId, date, period);
    const section = await findSection(tx, { school: teacher.school, branch: null }, sectionId);
    if (section.academicYear.status === 'CLOSED') throw conflict('YEAR_CLOSED', `${section.academicYear.name} is closed. Its attendance is kept as it is.`);
    let session = await tx.studentAttendanceSession.findFirst({ where: { sectionId, date: asDbDay(date), kind: 'LESSON', periodNumber: period } });
    const times = session ?? lessonTimes(date, lesson, settings, timeZone);
    if (receivedAt < times.opensAt) throw conflict('SESSION_NOT_OPEN_YET', `This lesson’s attendance can be taken from ${clock(times.opensAt, timeZone)}.`, { opensAt: times.opensAt });
    if (receivedAt > uploadUntil(times.deadlineAt, settings)) {
      throw conflict('UPLOAD_PERIOD_OVER', 'These marks arrived too late to count. Ask your Manager to record this lesson’s attendance.');
    }
    if (!session) {
      const [day] = (await loadSectionDays(teacher.school.id, [{ id: section.id, branchId: section.branchId }], date, date, tx)).get(section.id);
      const { startsAt, endsAt, opensAt, deadlineAt } = times;
      const id = await createLessonSession(tx, { schoolId: teacher.school.id, section, date, lesson, times: { startsAt, endsAt, opensAt, deadlineAt }, user: teacher, req, timeZone, timetableDay: day.timetableDay });
      session = await tx.studentAttendanceSession.findUnique({ where: { id } });
    }

    const entries = await tx.studentAttendanceEntry.findMany({ where: { sessionId: session.id }, include: { student: { select: { studentNumber: true, firstName: true, middleName: true, lastName: true } } } });
    const firstOwn = await tx.studentAttendanceChange.groupBy({ by: ['entryId'], where: { sessionId: session.id, actorId: teacher.id }, _min: { occurredAt: true } });
    const state = new Map(
      entries.map((e) => [e.studentId, { ...e, firstMarkedAt: firstOwn.find((f) => f.entryId === e.id)?._min.occurredAt ?? null, dirty: false }]),
    );
    // The device clock is corrected only when it is noticeably off (not by the request's travel time).
    const correction = Math.abs(skew) > 30_000 ? skew : 0;
    const ordered = marks.map((m, index) => ({ ...m, index, at: new Date(m.occurredAt.getTime() - correction) })).sort((a, b) => a.at - b.at || a.index - b.index);
    const answers = new Array(marks.length);
    const changes = [];
    for (const m of ordered) {
      const answer = (code) => {
        answers[m.index] = { student: m.studentId, occurredAt: m.occurredAt, result: code ? 'refused' : 'recorded', ...(code && { code, message: REFUSALS[code] }) };
      };
      const entry = state.get(m.studentId);
      if (!entry) {
        answer('NOT_ON_LIST');
        continue;
      }
      if (m.at.getTime() > receivedAt.getTime() + 60_000) {
        answer('EVENT_IN_FUTURE');
        continue;
      }
      const status = STATUS_TO_DB[m.status];
      if (entry.status === status && entry.markedById === teacher.id) {
        answer(null); // already recorded (e.g. sent again after a lost answer)
        continue;
      }
      const refusal = teacherMarkRefusal({ at: m.at, session, entry: { ...entry, firstMarkedAt: entry.firstMarkedAt ?? m.at }, teacherId: teacher.id, settings });
      if (refusal) {
        answer(refusal);
        continue;
      }
      changes.push({ entry: { ...entry }, status, at: m.at });
      Object.assign(entry, { status, occurredAt: m.at, markedById: teacher.id, markedByName: teacher.name, markedByRole: 'STAFF', markedAt: receivedAt, firstMarkedAt: entry.firstMarkedAt ?? m.at, dirty: true });
      answer(null);
    }

    const dirty = [...state.values()].filter((e) => e.dirty);
    if (dirty.length) {
      const rows = dirty.map((e) => Prisma.sql`(${e.id}::text, ${e.status}::text, ${e.occurredAt}::timestamp)`);
      await tx.$executeRaw`
        UPDATE "StudentAttendanceEntry" AS e
        SET "status" = v.status::"StudentAttendanceStatus", "reason" = NULL, "note" = NULL,
            "markedAt" = ${receivedAt}, "markedById" = ${teacher.id}, "markedByName" = ${teacher.name}, "markedByRole" = 'STAFF',
            "occurredAt" = v.at, "syncedAt" = ${receivedAt}, "source" = 'MOBILE', "version" = e."version" + 1
        FROM (VALUES ${Prisma.join(rows)}) AS v(id, status, at)
        WHERE e."id" = v.id`;
      await tx.studentAttendanceChange.createMany({
        data: changes.map((c) => ({
          entryId: c.entry.id,
          sessionId: session.id,
          studentId: c.entry.studentId,
          fromStatus: c.entry.status,
          toStatus: c.status,
          actorId: teacher.id,
          actorName: teacher.name,
          actorRole: 'STAFF',
          source: 'MOBILE',
          occurredAt: c.at,
          afterDeadline: c.at > session.deadlineAt,
        })),
      });
      const displayName = sectionDisplayName(section.class.name, section.name);
      const offline = changes.filter((c) => receivedAt.getTime() - c.at.getTime() > 2 * 60_000).length;
      await recordAuditEvent({
        client: tx,
        action: AUDIT_ACTIONS.STUDENT_LESSON_ATTENDANCE_MARKED,
        actor: { id: teacher.id, name: teacher.name, role: 'STAFF' },
        target: { type: 'Section', id: section.id, name: displayName },
        schoolId: teacher.school.id,
        description: `Took ${displayName}’s attendance for ${date} (period ${period}, ${lesson.subject.name}): ${changes.length} marks${offline ? `, ${offline} taken offline` : ''}.`,
        change: {
          sessionId: session.id,
          date,
          period,
          subject: lesson.subject.name,
          marks: changes.length,
          offline,
          refused: answers.filter((a) => a.result === 'refused').length,
          students: changes.slice(0, 100).map((c) => ({ student: `${studentName(c.entry.student)} (${c.entry.student.studentNumber})`, from: STATUS_FROM_DB[c.entry.status] ?? 'not marked', to: STATUS_FROM_DB[c.status], at: c.at.toISOString() })),
        },
        req,
      });
    }
    return answers;
  }, TX);
  const day = await teacherDay(teacher, { date });
  return { results, lesson: day.lessons.find((l) => l.section.id === sectionId && l.period === period) ?? null };
}

// ---- Managers: a lesson's attendance ---------------------------------------------------------------

/**
 * A Manager opens a lesson's session (e.g. the teacher was absent, or to correct it afterwards): the
 * lesson must be on the section's timetable that day; from its opening until the correction period
 * ends (managerEditDays). Opening it again returns it.
 */
export async function openLessonSession(scope, { sectionId, date, period }, user, req) {
  const prisma = getPrisma();
  const section = await findSection(prisma, scope, sectionId);
  if (section.academicYear.status === 'CLOSED') throw conflict('YEAR_CLOSED', `${section.academicYear.name} is closed. Its attendance is kept as it is.`);
  const timeZone = await platformTimeZone();
  const { id, created } = await prisma.$transaction(async (tx) => {
    await lockOperatingBranch(tx, scope, 'student attendance');
    await lockLesson(tx, section.id, date, period);
    const existing = await tx.studentAttendanceSession.findFirst({ where: { sectionId: section.id, date: asDbDay(date), kind: 'LESSON', periodNumber: period }, select: { id: true } });
    if (existing) return { id: existing.id, created: false };
    const [settings, days] = await Promise.all([
      effectiveSettings({ id: section.branchId, schoolId: scope.school.id }, tx),
      loadSectionDays(scope.school.id, [{ id: section.id, branchId: section.branchId }], date, date, tx),
    ]);
    const [day] = days.get(section.id);
    const p = day.schoolDay ? day.periods.find((x) => x.kind === 'LESSON' && x.number === period && x.lesson) : null;
    if (!p) throw conflict('LESSON_NOT_FOUND', `${sectionDisplayName(section.class.name, section.name)} has no lesson in period ${period} on ${date}.`);
    const lesson = { period, start: p.start, end: p.end, half: p.half, subject: p.lesson.subject };
    const times = lessonTimes(date, lesson, settings, timeZone);
    const state = windowState(times, editableUntil(date, settings, timeZone), new Date());
    if (state === 'upcoming') throw conflict('SESSION_NOT_OPEN_YET', `This lesson’s attendance can be taken from ${clock(times.opensAt, timeZone)}.`, { opensAt: times.opensAt });
    if (state === 'locked') throw conflict('EDIT_PERIOD_OVER', `Attendance for ${date} can no longer be taken or corrected (${settings.managerEditDays} days after the date).`);
    const sessionId = await createLessonSession(tx, { schoolId: scope.school.id, section, date, lesson, times, user, req, timeZone, timetableDay: day.timetableDay });
    return { id: sessionId, created: true };
  }, TX);
  return { created, ...(await getSession(scope, id)) };
}


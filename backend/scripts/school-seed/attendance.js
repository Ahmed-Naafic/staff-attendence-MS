/*
 * School seed, part 2 — student attendance of the current year, from its start to yesterday:
 *
 *   Manager attendance  every section, every school day, in the shape the branch's settings give
 *                       (once a day, or before and after the break), marked by the branch's seeded
 *                       assistant Manager, with now and then an absence corrected to late;
 *   lesson attendance   the last five school days, every timetabled lesson with a teacher, marked by
 *                       that teacher on the mobile app (present / absent);
 *   excuses             a few: past, upcoming, by half, by periods and a cancelled one.
 *
 * Days, halves and lessons come from the application's own rules (loadSectionDays, plannedHalves),
 * so the data matches what the pages expect. Resumable: section-days that already have a Manager
 * session are skipped; lessons with a session are skipped.
 */
import { zonedInstant } from '../../src/common/zonedTime.js';
import { HALF_TO_DB, lessonTimes, plannedHalves, sessionTimes } from '../../src/features/student-attendance/attendanceRules.js';
import { effectiveSettingsFor } from '../../src/features/student-attendance/settings.js';
import { loadSectionDays } from '../../src/features/timetable/lessons.js';
import { addDays, dbDate, insertMany, iso, minutes, newId, rngFrom } from './util.js';

export async function seedStudentAttendance(prisma, ctx, log) {
  const { school, tz, today } = ctx;
  const rng = rngFrom(20261124);
  const year = await prisma.academicYear.findFirst({ where: { schoolId: school.id, status: 'CURRENT' } });
  const from = iso(year.startDate);
  const to = addDays(today, -1);
  if (to < from) return log('Student attendance: the year has not started.');
  const sections = await prisma.section.findMany({ where: { academicYearId: year.id }, select: { id: true, branchId: true, classId: true, name: true } });
  const branchIds = [...new Set(sections.map((s) => s.branchId))];
  const settings = await effectiveSettingsFor(school.id, branchIds);
  const managers = await prisma.user.findMany({ where: { role: 'MANAGER', status: 'ACTIVE', email: { endsWith: '.seed.example' }, branchId: { in: branchIds } } });
  const enrollments = await prisma.enrollment.findMany({ where: { academicYearId: year.id }, select: { id: true, studentId: true, sectionId: true, branchId: true, enrolledAt: true, endedAt: true } });
  const teachers = new Map((await prisma.user.findMany({ where: { role: 'STAFF', branch: { schoolId: school.id } }, select: { id: true, name: true } })).map((t) => [t.id, t]));
  const existing = await prisma.studentAttendanceSession.findMany({ where: { academicYearId: year.id }, select: { sectionId: true, date: true, kind: true, periodNumber: true } });
  const has = new Set(existing.map((s) => `${s.sectionId}|${iso(s.date)}|${s.kind}|${s.periodNumber ?? ''}`));
  const days = await loadSectionDays(school.id, sections, from, to);

  const rosterOn = (sectionId, date) => {
    const dayStart = zonedInstant(date, 0, tz);
    return enrollments.filter((e) => e.sectionId === sectionId && (!e.endedAt || e.endedAt > dayStart));
  };
  // Some students are absent more often than others.
  const absentee = new Map(enrollments.map((e) => [e.studentId, rng() < 0.08 ? 0.18 : 0.04]));

  const sessions = [];
  const entries = [];
  const changes = [];
  const mark = (session, enrollment, actor, actorRole, source, occurredAt, status) => {
    const reason = status === 'EXCUSED' ? 'Sick (guardian called).' : null;
    const entry = { id: newId(), sessionId: session.id, schoolId: school.id, branchId: session.branchId, studentId: enrollment.studentId, enrollmentId: enrollment.id, addedAt: session.openedAt, status, reason, markedAt: occurredAt, markedById: actor.id, markedByName: actor.name, markedByRole: actorRole, occurredAt, syncedAt: source === 'MOBILE' ? new Date(occurredAt.getTime() + 30_000) : occurredAt, source, version: 1 };
    changes.push({ id: newId(), entryId: entry.id, sessionId: session.id, studentId: enrollment.studentId, fromStatus: null, toStatus: status, reason, actorId: actor.id, actorName: actor.name, actorRole, source, occurredAt, recordedAt: entry.syncedAt });
    if (status === 'ABSENT' && actorRole === 'MANAGER' && rng() < 0.25) {
      const later = new Date(occurredAt.getTime() + minutes(35));
      Object.assign(entry, { status: 'LATE', markedAt: later, occurredAt: later, syncedAt: later, version: 2, note: 'Arrived after the roll call.' });
      changes.push({ id: newId(), entryId: entry.id, sessionId: session.id, studentId: enrollment.studentId, fromStatus: 'ABSENT', toStatus: 'LATE', note: entry.note, reason: 'Arrived late.', actorId: actor.id, actorName: actor.name, actorRole, source, occurredAt: later, recordedAt: later });
    }
    entries.push(entry);
  };
  // One section at a time, all or nothing (a failed run leaves no half-written section).
  const flush = async () => {
    const [ss, ee, cc] = [sessions.splice(0), entries.splice(0), changes.splice(0)];
    if (!ss.length) return;
    await prisma.$transaction(
      async (tx) => {
        await insertMany(tx, 'studentAttendanceSession', ss, 500);
        await insertMany(tx, 'studentAttendanceEntry', ee, 1000);
        await insertMany(tx, 'studentAttendanceChange', cc, 1000);
      },
      { timeout: 300_000, maxWait: 30_000 },
    );
  };

  let managerSessions = 0;
  let lessonSessions = 0;
  const lessonDays = new Map(); // branchId → the last five school days
  for (const section of sections) {
    const manager = managers.find((m) => m.branchId === section.branchId);
    const s = settings.get(section.branchId);
    if (!manager) continue;
    const sectionDays = (days.get(section.id) ?? []).filter((d) => d.schoolDay);
    for (const day of sectionDays) {
      if (has.has(`${section.id}|${day.date}|HALF_DAY|`)) continue;
      // Yesterday one section's attendance was not taken (the completion page shows it).
      if (day.date === to && section === sections.at(-1)) continue;
      const roster = rosterOn(section.id, day.date);
      for (const half of plannedHalves(day, s)) {
        const t = sessionTimes(day.date, half, s, tz);
        const openedAt = new Date((t.startsAt ?? t.opensAt).getTime() + minutes(rng.between(2, 12)));
        const session = { id: newId(), schoolId: school.id, branchId: section.branchId, academicYearId: year.id, sectionId: section.id, kind: 'HALF_DAY', date: dbDate(day.date), half: HALF_TO_DB[half.half], timetableDay: day.timetableDay, startsAt: t.startsAt, endsAt: t.endsAt, opensAt: t.opensAt, deadlineAt: t.deadlineAt, openedAt, openedById: manager.id, openedByName: manager.name };
        sessions.push(session);
        managerSessions += 1;
        for (const e of roster) {
          const r = rng();
          const p = absentee.get(e.studentId);
          const status = r < p ? 'ABSENT' : r < p + 0.04 ? 'LATE' : r < p + 0.05 ? 'EXCUSED' : 'PRESENT';
          mark(session, e, manager, 'MANAGER', 'WEB', new Date(openedAt.getTime() + minutes(3)), status);
        }
      }
    }
    // Teachers' lessons of the last five school days.
    const recent = sectionDays.slice(-5);
    if (recent.length) lessonDays.set(section.branchId, recent.map((d) => d.date));
    for (const day of recent) {
      const roster = rosterOn(section.id, day.date);
      for (const p of day.periods.filter((x) => x.kind === 'LESSON' && x.lesson?.teacher)) {
        if (has.has(`${section.id}|${day.date}|LESSON|${p.number}`)) continue;
        const teacher = teachers.get(p.lesson.teacher.id);
        if (!teacher || rng() < 0.05) continue; // now and then a lesson's attendance was missed
        const t = lessonTimes(day.date, p, s, tz);
        const openedAt = new Date(t.startsAt.getTime() + minutes(rng.between(1, 6)));
        const session = { id: newId(), schoolId: school.id, branchId: section.branchId, academicYearId: year.id, sectionId: section.id, kind: 'LESSON', date: dbDate(day.date), half: HALF_TO_DB[p.half], periodNumber: p.number, subjectId: p.lesson.subject.id, timetableDay: day.timetableDay, startsAt: t.startsAt, endsAt: t.endsAt, opensAt: t.opensAt, deadlineAt: t.deadlineAt, openedAt, openedById: teacher.id, openedByName: teacher.name };
        sessions.push(session);
        lessonSessions += 1;
        for (const e of roster) mark(session, e, teacher, 'STAFF', 'MOBILE', new Date(openedAt.getTime() + minutes(2)), rng() < absentee.get(e.studentId) ? 'ABSENT' : 'PRESENT');
      }
    }
    await flush();
  }
  await flush();
  log(`Student attendance: ${managerSessions} Manager sessions and ${lessonSessions} lesson sessions (${from} to ${to}).`);

  // Excuses (once).
  if (await prisma.studentExcuse.count({ where: { schoolId: school.id } })) return;
  const active = enrollments.filter((e) => !e.endedAt);
  const excuse = (i, data) => {
    const e = active[(i * 131) % active.length];
    const manager = managers.find((m) => m.branchId === e.branchId);
    return { id: newId(), schoolId: school.id, branchId: e.branchId, studentId: e.studentId, createdById: manager.id, createdByName: manager.name, ...data };
  };
  await prisma.studentExcuse.createMany({
    data: [
      excuse(1, { startDate: dbDate(addDays(today, -12)), endDate: dbDate(addDays(today, -10)), reason: 'Malaria (doctor’s note).' }),
      excuse(2, { startDate: dbDate(addDays(today, -4)), endDate: dbDate(addDays(today, -4)), reason: 'Family wedding' }),
      excuse(3, { startDate: dbDate(addDays(today, 1)), endDate: dbDate(addDays(today, 3)), half: 'BEFORE_BREAK', reason: 'Hospital visits', note: 'Mornings only.' }),
      excuse(4, { startDate: dbDate(addDays(today, 2)), endDate: dbDate(addDays(today, 2)), periods: [5, 6], reason: 'Inter-school football match' }),
      excuse(5, { startDate: dbDate(addDays(today, 5)), endDate: dbDate(addDays(today, 9)), reason: 'Travel to Baydhabo for a funeral' }),
      excuse(6, { startDate: dbDate(addDays(today, 4)), endDate: dbDate(addDays(today, 5)), reason: 'Travel', cancelledAt: new Date(), cancelledById: managers[0].id, cancelledByName: managers[0].name }),
    ],
  });
  log('Student attendance: 6 excuses.');
}

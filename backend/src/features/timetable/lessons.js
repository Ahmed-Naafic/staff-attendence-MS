import { getPrisma } from '../../config/prisma.js';
import { asDbDay, loadSchoolDaysForBranches, toDay, versionOn } from '../academic-calendar/schoolDays.js';
import { examCovers, loadScheduledExams } from '../examinations/examDays.js';
import { dayPlan, halvesOf, minutesToTime } from './bellTimes.js';

/*
 * The lessons of sections on dates (docs/business-rules.md → Timetables → Lessons of a day): the
 * one place that combines the academic calendar (is there school, which weekday's timetable the day
 * follows), the section's timetable version in effect that day, and its bell schedule's times in
 * effect that day. Student attendance (Manager half-shifts, teacher lessons, NOT_MARKED, reports)
 * reads days from here.
 *
 * Examinations: on the days of a scheduled examination that stops lessons, the normal lessons of the
 * classes sitting it stop in the branches holding it (examinations/examDays.js). The day stays a school
 * day (halves unchanged); its lessons become `lesson: null` with `stoppedLesson` kept for display, and
 * the day names the `examination`. So no lesson attendance is expected or taken on those days.
 *
 * Fixed number of queries whatever the number of sections and days: three for the school days of
 * every branch involved, one for the timetable versions, one for the sections' classes, one for the
 * examinations, one for the bell times.
 */

const subjectSelect = { id: true, name: true, code: true };
const teacherSelect = { id: true, name: true, staffId: true };

/**
 * `sections`: [{ id, branchId }] of one school. → Map sectionId → [day], each day:
 * { date, weekday, timetableDay, schoolDay, reason, holiday, closure, extraDay, examination: { id, name }
 *   | null, timetable: { id, effectiveFrom } | null, bellSchedule: { id, name } | null, periods: [plan
 *   item + lesson (+ stoppedLesson)], halves }.
 */
export async function loadSectionDays(schoolId, sections, from, to, client = getPrisma()) {
  const result = new Map();
  if (!sections.length) return result;
  const sectionIds = sections.map((s) => s.id);
  const branchIds = [...new Set(sections.map((s) => s.branchId))];
  const [calendar, versions, sectionClasses] = await Promise.all([
    loadSchoolDaysForBranches(schoolId, branchIds, from, to, client),
    client.timetableVersion.findMany({
      where: { sectionId: { in: sectionIds }, cancelledAt: null, effectiveFrom: { lte: asDbDay(to) } },
      select: {
        id: true,
        sectionId: true,
        bellScheduleId: true,
        effectiveFrom: true,
        bellSchedule: { select: { id: true, name: true } },
        slots: { select: { weekday: true, periodNumber: true, room: true, subject: { select: subjectSelect }, teacher: { select: teacherSelect } } },
      },
    }),
    client.section.findMany({ where: { id: { in: sectionIds } }, select: { id: true, classId: true } }),
  ]);
  const classOf = new Map(sectionClasses.map((s) => [s.id, s.classId]));
  const exams = await loadScheduledExams(schoolId, { branchIds, classIds: [...new Set(classOf.values())], stopsLessons: true }, from, to, client);
  const bellIds = [...new Set(versions.map((v) => v.bellScheduleId))];
  const bellRows = bellIds.length
    ? await client.bellScheduleVersion.findMany({
        where: { bellScheduleId: { in: bellIds }, cancelledAt: null, effectiveFrom: { lte: asDbDay(to) } },
        select: { bellScheduleId: true, effectiveFrom: true, periods: { select: { kind: true, number: true, name: true, days: true, startMinute: true, endMinute: true, mainBreak: true } } },
      })
    : [];
  const bells = new Map();
  for (const b of bellRows) bells.set(b.bellScheduleId, [...(bells.get(b.bellScheduleId) ?? []), { ...b, effectiveFrom: toDay(b.effectiveFrom) }]);
  const bySection = new Map();
  for (const v of versions) bySection.set(v.sectionId, [...(bySection.get(v.sectionId) ?? []), { ...v, effectiveFrom: toDay(v.effectiveFrom) }]);

  for (const section of sections) {
    const own = bySection.get(section.id) ?? [];
    const days = (calendar.get(section.branchId) ?? []).map((d) => {
      const base = {
        date: d.date,
        weekday: d.weekday,
        timetableDay: d.timetableDay,
        schoolDay: d.schoolDay,
        reason: d.reason,
        holiday: d.holiday,
        closure: d.closure,
        extraDay: d.extraDay,
        academicYear: d.academicYear,
        examination: null,
        timetable: null,
        bellSchedule: null,
        periods: [],
        halves: [],
      };
      const exam = d.schoolDay ? exams.find((e) => examCovers(e, { day: d.date, branchId: section.branchId, classId: classOf.get(section.id) })) : null;
      if (exam) base.examination = { id: exam.id, name: exam.name };
      const tv = versionOn(own, d.date);
      if (!tv) return base;
      const shaped = { ...base, timetable: { id: tv.id, effectiveFrom: tv.effectiveFrom }, bellSchedule: tv.bellSchedule };
      if (!d.schoolDay) return shaped;
      const bv = versionOn(bells.get(tv.bellScheduleId) ?? [], d.date);
      if (!bv) return shaped;
      const plan = dayPlan(bv.periods, d.timetableDay);
      const periods = plan.map((p) => {
        const slot = p.kind === 'LESSON' ? tv.slots.find((s) => s.weekday === d.timetableDay && s.periodNumber === p.number) : null;
        const lesson = slot ? { subject: slot.subject, teacher: slot.teacher ?? null, room: slot.room ?? null } : null;
        return {
          ...p,
          start: minutesToTime(p.startMinute),
          end: minutesToTime(p.endMinute),
          lesson: exam ? null : lesson,
          ...(exam && lesson && { stoppedLesson: lesson }),
        };
      });
      return { ...shaped, periods, halves: halvesOf(plan).map((h) => ({ ...h, start: minutesToTime(h.startMinute), end: minutesToTime(h.endMinute) })) };
    });
    result.set(section.id, days);
  }
  return result;
}

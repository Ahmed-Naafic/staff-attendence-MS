import { getPrisma } from '../../config/prisma.js';
import { asDbDay, toDay } from '../academic-calendar/schoolDays.js';

/*
 * Examination days (docs/business-rules.md → Examinations → Examinations and lessons): the one place
 * that says which scheduled examinations cover which branches, classes and dates. Lessons of a day
 * (timetable/lessons.js) ask which examinations stop a section's lessons; the academic calendar asks
 * which examinations to show. Only SCHEDULED examinations count: a draft has no effect and a
 * cancelled one never had. An examination with branchId null covers every branch of the school.
 * Exam days stay school days (students come to sit their papers): only the normal lessons stop.
 */

const plain = (e) => ({
  id: e.id,
  name: e.name,
  branchId: e.branchId,
  startDate: toDay(e.startDate),
  endDate: toDay(e.endDate),
  stopsLessons: e.stopsLessons,
  classIds: e.classes.map((c) => c.classId),
});

/**
 * Scheduled examinations of a school overlapping from..to in any of `branchIds` (school-wide ones
 * included), optionally only those that stop lessons and only those sat by one of `classIds`.
 * → [{ id, name, branchId, startDate, endDate, stopsLessons, classIds }] ('YYYY-MM-DD' dates).
 */
export async function loadScheduledExams(schoolId, { branchIds, classIds = null, stopsLessons = false }, from, to, client = getPrisma()) {
  if (!branchIds.length || (classIds && !classIds.length)) return [];
  const rows = await client.examination.findMany({
    where: {
      schoolId,
      status: 'SCHEDULED',
      ...(stopsLessons && { stopsLessons: true }),
      startDate: { lte: asDbDay(to) },
      endDate: { gte: asDbDay(from) },
      OR: [{ branchId: null }, { branchId: { in: branchIds } }],
      ...(classIds && { classes: { some: { classId: { in: classIds } } } }),
    },
    select: { id: true, name: true, branchId: true, startDate: true, endDate: true, stopsLessons: true, classes: { select: { classId: true } } },
    orderBy: [{ startDate: 'asc' }, { nameKey: 'asc' }],
  });
  return rows.map(plain);
}

/** Whether exam `e` (from loadScheduledExams) covers `day` in `branchId`, for `classId` when given. */
export const examCovers = (e, { day, branchId, classId = null }) =>
  e.startDate <= day && day <= e.endDate && (!e.branchId || e.branchId === branchId) && (!classId || e.classIds.includes(classId));

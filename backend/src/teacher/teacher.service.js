import { getPrisma } from '../config/prisma.js';
import { liveTeachingOf } from '../features/teaching/teaching.service.js';
import { myTimetable } from '../features/timetable-builder/views.service.js';

/**
 * The teacher's own teaching (Staff app → My classes & subjects): their live assignments (running or
 * scheduled, planned or current year, every branch), each with the class's lessons per week for the
 * subject and how many of them are in the published timetable in effect on `date` (default today).
 * Class-teacher assignments have no lessons of their own (both null). Read only; the assignments
 * themselves are made on the web (Teaching page).
 */
export async function myTeaching(teacher, { date }) {
  const prisma = getPrisma();
  const [assignments, week] = await Promise.all([liveTeachingOf(teacher.id), myTimetable(teacher, { date })]);
  const subjectItems = assignments.filter((a) => a.subject);
  const planned = subjectItems.length
    ? await prisma.classSubject.findMany({
        where: { schoolId: teacher.school.id, classId: { in: [...new Set(subjectItems.map((a) => a.section.class.id))] }, subjectId: { in: [...new Set(subjectItems.map((a) => a.subject.id))] } },
        select: { classId: true, subjectId: true, weeklyLessons: true },
      })
    : [];
  const inTimetable = new Map();
  for (const l of week.lessons) {
    const key = `${l.section.id}|${l.subject?.id}`;
    inTimetable.set(key, (inTimetable.get(key) ?? 0) + 1);
  }
  const currentYear = week.academicYear?.id ?? null;
  return {
    date: week.date,
    academicYear: week.academicYear,
    items: assignments.map((a) => ({
      id: a.id,
      role: a.role,
      subject: a.subject && { id: a.subject.id, name: a.subject.name, code: a.subject.code },
      section: { id: a.section.id, displayName: a.section.displayName, className: a.section.class.name },
      branch: a.branch,
      academicYear: a.academicYear,
      startDate: a.startDate,
      endDate: a.endDate,
      state: a.state,
      weeklyLessons: a.subject ? planned.find((p) => p.classId === a.section.class.id && p.subjectId === a.subject.id)?.weeklyLessons ?? null : null,
      // Lessons of this subject and class in the published timetable shown in My week (current year only).
      inTimetable: a.subject && a.academicYear.id === currentYear ? inTimetable.get(`${a.section.id}|${a.subject.id}`) ?? 0 : null,
    })),
  };
}

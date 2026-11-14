import { Router } from 'express';
import { forbidden } from '../common/httpError.js';
import { jsonBody } from '../common/validate.js';
import { getPrisma } from '../config/prisma.js';
import { calendarToday } from '../features/academic-calendar/calendar.service.js';
import { saveLessonMarks, teacherDay } from '../features/student-attendance/lessonAttendance.service.js';
import { readLessonMarks, readTeacherDayQuery } from '../features/student-attendance/studentAttendanceInput.js';
import { settleIfDue } from '../features/staff/transfers.service.js';
import { requireAuth, requireRole } from '../middleware/requireAuth.js';
import { requireStudentAttendance } from '../middleware/requireStudentAttendance.js';
import { myTimetable } from '../features/timetable-builder/views.service.js';

/**
 * Teacher API (/api/teacher), used by the Staff mobile app (bearer token): a teacher's lessons and
 * their students' lesson attendance (docs/business-rules.md → Student attendance → Teacher lesson
 * attendance). Every route requires a signed-in STAFF account (requireAuth: the temporary password
 * replaced) whose school has Student Attendance switched on (403 FEATURE_DISABLED). Which lessons
 * are theirs comes from timetables and teaching assignments, never from the job title or the request;
 * a staff member without lessons simply has none. The school is read from the database each time.
 */
export const teacherRouter = Router();
teacherRouter.use(requireAuth, requireRole('STAFF'), async (req, res, next) => {
  try {
    await settleIfDue();
    const staff = await getPrisma().user.findFirst({
      where: { id: req.user.id, role: 'STAFF' },
      select: { id: true, name: true, role: true, branch: { select: { id: true, school: { select: { id: true, name: true, status: true } } } } },
    });
    if (!staff?.branch) return next(forbidden('No branch is assigned to your account.'));
    req.teacher = { id: staff.id, name: staff.name, role: staff.role, branchId: staff.branch.id, school: staff.branch.school };
    next();
  } catch (error) {
    next(error);
  }
});
// The teacher's own week (published timetables, every branch). Academic setup: not gated by the
// Student Attendance switch, so it sits before it.
teacherRouter.get('/timetable', async (req, res) => {
  const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : undefined;
  res.json(await myTimetable(req.teacher, { date }));
});
teacherRouter.use(requireStudentAttendance((req) => req.teacher.school.id));

// The teacher's lessons of a day (default today), with class lists and marks.
teacherRouter.get('/lessons', async (req, res) => {
  res.json(await teacherDay(req.teacher, readTeacherDayQuery(req.query, { today: await calendarToday() })));
});

// Marks for one lesson, online or uploaded later from the device. Each mark gets its own answer.
teacherRouter.put('/lessons/marks', async (req, res) => {
  const receivedAt = new Date();
  res.json(await saveLessonMarks(req.teacher, readLessonMarks(jsonBody(req)), receivedAt, req));
});

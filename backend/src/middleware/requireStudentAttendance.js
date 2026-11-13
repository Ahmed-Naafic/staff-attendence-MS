import { HttpError } from '../common/httpError.js';
import { getPrisma } from '../config/prisma.js';

/**
 * The per-school Student Attendance switch (docs/business-rules.md → Student attendance; Super
 * Admin: PUT /api/platform/schools/:id/features). The one check for every attendance-taking,
 * excuse and attendance-report route: when the school's switch is off they answer 403
 * FEATURE_DISABLED. Academic setup (calendar, subjects, teaching, timetables) and the attendance
 * settings stay available, so a school can prepare before it is switched on.
 *
 * `schoolIdOf(req)` → the signed-in account's school id (set by requireOwnerSchool /
 * requireManagerBranch). Read from the database on every request, so switching off applies at once.
 */
export const FEATURE_DISABLED = () => new HttpError(403, 'FEATURE_DISABLED', 'Student Attendance is not switched on for your school. Contact EduTrack support to switch it on.');

export const requireStudentAttendance = (schoolIdOf) => async (req, res, next) => {
  try {
    const school = await getPrisma().school.findUnique({ where: { id: schoolIdOf(req) }, select: { studentAttendanceEnabled: true } });
    if (!school?.studentAttendanceEnabled) return next(FEATURE_DISABLED());
    next();
  } catch (error) {
    next(error);
  }
};

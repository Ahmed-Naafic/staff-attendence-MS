import { HttpError } from '../common/httpError.js';
import { getPrisma } from '../config/prisma.js';

export const EXAMINATIONS_DISABLED = () =>
  new HttpError(403, 'FEATURE_DISABLED', 'Examinations are not switched on for your school. Contact EduTrack support to switch them on.');

/**
 * Examinations must be switched on for the school (Super Admin; School.examinationsEnabled), read
 * from the database on every request. `schoolIdOf(req)` gives the school. Off → 403 FEATURE_DISABLED.
 */
export const requireExaminations = (schoolIdOf) => async (req, res, next) => {
  try {
    const school = await getPrisma().school.findUnique({ where: { id: schoolIdOf(req) }, select: { examinationsEnabled: true } });
    if (!school?.examinationsEnabled) return next(EXAMINATIONS_DISABLED());
    return next();
  } catch (error) {
    return next(error);
  }
};

import { forbidden } from '../common/httpError.js';
import { getPrisma } from '../config/prisma.js';

/**
 * For OWNER routes (use after requireAuth and requireRole('OWNER')): sets req.school to the school
 * linked to the signed-in owner ({ id, code, name, status }). The school always comes from the
 * account, never from the request. An owner without a school → 403.
 */
export async function requireOwnerSchool(req, res, next) {
  const school = await getPrisma().school.findUnique({
    where: { ownerId: req.user.id },
    select: { id: true, code: true, name: true, status: true },
  });
  if (!school) return next(forbidden('No school is linked to your account.'));
  req.school = school;
  next();
}

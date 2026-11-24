import { forbidden } from '../common/httpError.js';
import { getPrisma } from '../config/prisma.js';

/**
 * For ACCOUNTANT routes (use after requireAuth and requireRole('ACCOUNTANT')): sets req.branch to the
 * signed-in Accountant's branch ({ id, code, name, number, status, school: { id, code, name, status } }),
 * read from the database on every request, so a move to another branch applies at once. No branch → 403.
 */
export async function requireAccountantBranch(req, res, next) {
  try {
    const user = await getPrisma().user.findFirst({
      where: { id: req.user.id, role: 'ACCOUNTANT' },
      select: { branch: { select: { id: true, code: true, name: true, number: true, status: true, school: { select: { id: true, code: true, name: true, status: true } } } } },
    });
    if (!user?.branch) return next(forbidden('No branch is assigned to your account.'));
    req.branch = user.branch;
    return next();
  } catch (error) {
    return next(error);
  }
}

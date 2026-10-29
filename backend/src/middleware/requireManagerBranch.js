import { forbidden } from '../common/httpError.js';
import { getPrisma } from '../config/prisma.js';

/**
 * For MANAGER routes (use after requireAuth and requireRole('MANAGER')): sets req.branch to the
 * signed-in Manager's branch ({ id, code, name, address, city, phone, status, school: { id, code,
 * name, status } }). Read from the database on every request, never from the session or the request,
 * so a transfer applies to the next request. No branch → 403.
 */
export async function requireManagerBranch(req, res, next) {
  const manager = await getPrisma().user.findFirst({
    where: { id: req.user.id, role: 'MANAGER' },
    select: {
      branch: {
        select: {
          id: true,
          code: true,
          name: true,
          address: true,
          city: true,
          phone: true,
          status: true,
          school: { select: { id: true, code: true, name: true, status: true } },
        },
      },
    },
  });
  if (!manager?.branch) return next(forbidden('No branch is assigned to your account.'));
  req.branch = manager.branch;
  next();
}

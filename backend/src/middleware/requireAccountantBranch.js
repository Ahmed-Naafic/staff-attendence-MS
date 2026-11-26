import { forbidden } from '../common/httpError.js';
import { getPrisma } from '../config/prisma.js';

/**
 * For the Accountant workspace (/api/accountant, after requireAuth): an ACCOUNTANT account, or a STAFF
 * member the School Owner gave Fee Management access (User.feeAccess). Both are read from the database on
 * every request, so revoking access or moving branch applies at once. Sets req.branch to their branch
 * ({ id, code, name, number, status, school: { id, code, name, status } }). Inside this workspace a staff
 * member acts as an Accountant: req.user.role is 'ACCOUNTANT' (payments, closings and audit events show
 * that role) and req.user.accountRole keeps 'STAFF'. Anyone else, or no branch → 403.
 */
export async function requireAccountantBranch(req, res, next) {
  try {
    if (req.user.role !== 'ACCOUNTANT' && req.user.role !== 'STAFF') return next(forbidden());
    const user = await getPrisma().user.findFirst({
      where: { id: req.user.id, status: 'ACTIVE', OR: [{ role: 'ACCOUNTANT' }, { role: 'STAFF', feeAccess: true }] },
      select: { branch: { select: { id: true, code: true, name: true, number: true, status: true, school: { select: { id: true, code: true, name: true, status: true } } } } },
    });
    if (!user) return next(forbidden(req.user.role === 'STAFF' ? 'You do not have Fee Management access. Ask your School Owner.' : undefined));
    if (!user.branch) return next(forbidden('No branch is assigned to your account.'));
    req.branch = user.branch;
    if (req.user.role === 'STAFF') req.user = { ...req.user, role: 'ACCOUNTANT', accountRole: 'STAFF' };
    return next();
  } catch (error) {
    return next(error);
  }
}

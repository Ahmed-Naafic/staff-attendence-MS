import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAccountantBranch } from '../middleware/requireAccountantBranch.js';
import { mountFeeRoutes } from '../features/fees/fees.routes.js';

/**
 * Accountant API (/api/accountant): Fee Management of the Accountant's branch only (docs/business-rules.md
 * → Fee Management → Permissions). The branch and school come from the account, never the request.
 * Also open to STAFF members with Fee Management access (requireAccountantBranch), acting as Accountants.
 */
export const accountantRouter = Router();
accountantRouter.use(requireAuth, requireAccountantBranch);

const scopeOf = (req) => {
  const { school, ...branch } = req.branch;
  return { school, branch };
};

accountantRouter.get('/branch', (req, res) => {
  const { school, ...branch } = req.branch;
  res.json({ branch: { id: branch.id, code: branch.code, name: branch.name, status: branch.status.toLowerCase() }, school: { id: school.id, name: school.name, status: school.status.toLowerCase() } });
});

mountFeeRoutes(accountantRouter, scopeOf, 'ACCOUNTANT');

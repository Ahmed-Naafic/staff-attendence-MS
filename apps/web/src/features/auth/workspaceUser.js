/**
 * The signed-in user as the web app works with them. A STAFF member the School Owner gave Fee Management
 * access (feeAccess) uses the Accountant workspace: role 'ACCOUNTANT' here, accountRole keeps 'STAFF'.
 * Display and routing only; the API checks the access on every request (requireAccountantBranch).
 */
export function workspaceUser(user) {
  if (user?.role === 'STAFF' && user.feeAccess === true) return { ...user, role: 'ACCOUNTANT', accountRole: 'STAFF' };
  return user;
}

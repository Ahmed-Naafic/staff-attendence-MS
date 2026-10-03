// Audit actions the platform records today. Only real, implemented actions are listed:
// disabled or unavailable actions in the web app never produce audit events.
export const AUDIT_ACTIONS = {
  SIGN_IN: 'SIGN_IN', // success, or failure (wrong email/password, inactive account)
  SIGN_OUT: 'SIGN_OUT',
};

/** Actions the audit filter accepts (the web app also lists types that have no events yet). */
export const FILTERABLE_ACTIONS = [
  'SCHOOL_REGISTERED',
  'SCHOOL_APPROVED',
  'SCHOOL_UPDATED',
  'SCHOOL_SUSPENDED',
  'OWNER_CREATED',
  'OWNER_UPDATED',
  'SIGN_IN',
  'SIGN_OUT',
  'PASSWORD_RESET',
  'SETTINGS_UPDATED',
];

/** Sign-ins, sign-outs and password changes count as security events. */
export const SECURITY_ACTIONS = ['SIGN_IN', 'SIGN_OUT', 'PASSWORD_RESET'];

/** Display names (as in the web app), so search can match an action by its name. */
export const ACTION_LABELS = {
  SCHOOL_REGISTERED: 'Register School',
  SCHOOL_APPROVED: 'Approve School',
  SCHOOL_UPDATED: 'Update School',
  SCHOOL_SUSPENDED: 'Suspend School',
  OWNER_CREATED: 'Create Owner Account',
  OWNER_UPDATED: 'Update Owner',
  SIGN_IN: 'Sign In',
  SIGN_OUT: 'Sign Out',
  PASSWORD_RESET: 'Reset Password',
  SETTINGS_UPDATED: 'Update Platform Settings',
};

export const ROLE_LABELS = { SUPER_ADMIN: 'Super Admin', OWNER: 'School Owner', MANAGER: 'Manager', STAFF: 'Staff' };

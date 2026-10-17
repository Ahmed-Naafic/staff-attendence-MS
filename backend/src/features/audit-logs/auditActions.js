// Audit actions the platform records today. Only real, implemented actions are listed:
// disabled or unavailable actions in the web app never produce audit events.
export const AUDIT_ACTIONS = {
  SIGN_IN: 'SIGN_IN', // success, or failure (wrong email/password, inactive account)
  SIGN_OUT: 'SIGN_OUT',
  // School Management (Super Admin)
  SCHOOL_CREATED: 'SCHOOL_CREATED',
  SCHOOL_UPDATED: 'SCHOOL_UPDATED',
  SCHOOL_SUSPENDED: 'SCHOOL_SUSPENDED',
  SCHOOL_REACTIVATED: 'SCHOOL_REACTIVATED',
  // School Owner Management (Super Admin)
  OWNER_CREATED: 'OWNER_CREATED',
  OWNER_UPDATED: 'OWNER_UPDATED',
  OWNER_SUSPENDED: 'OWNER_SUSPENDED',
  OWNER_REACTIVATED: 'OWNER_REACTIVATED',
};

/** Actions the audit filter accepts (the web app also lists types that have no events yet). */
export const FILTERABLE_ACTIONS = [
  'SCHOOL_CREATED',
  'SCHOOL_UPDATED',
  'SCHOOL_SUSPENDED',
  'SCHOOL_REACTIVATED',
  'OWNER_CREATED',
  'OWNER_UPDATED',
  'OWNER_SUSPENDED',
  'OWNER_REACTIVATED',
  'SIGN_IN',
  'SIGN_OUT',
  'PASSWORD_RESET',
  'SETTINGS_UPDATED',
];

/** Sign-ins, sign-outs and password changes count as security events. */
export const SECURITY_ACTIONS = ['SIGN_IN', 'SIGN_OUT', 'PASSWORD_RESET'];

/** Display names (as in the web app), so search can match an action by its name. */
export const ACTION_LABELS = {
  SCHOOL_CREATED: 'Register School',
  SCHOOL_UPDATED: 'Update School',
  SCHOOL_SUSPENDED: 'Suspend School',
  SCHOOL_REACTIVATED: 'Reactivate School',
  OWNER_CREATED: 'Create Owner Account',
  OWNER_UPDATED: 'Update Owner',
  OWNER_SUSPENDED: 'Suspend Owner',
  OWNER_REACTIVATED: 'Reactivate Owner',
  SIGN_IN: 'Sign In',
  SIGN_OUT: 'Sign Out',
  PASSWORD_RESET: 'Reset Password',
  SETTINGS_UPDATED: 'Update Platform Settings',
};

export const ROLE_LABELS = { SUPER_ADMIN: 'Super Admin', OWNER: 'School Owner', MANAGER: 'Manager', STAFF: 'Staff' };

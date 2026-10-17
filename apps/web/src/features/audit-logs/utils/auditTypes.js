// Display mapping for audit events: action names, roles, results and target types.
// Display only: the events describe history and do not imply the workflows behind them exist yet.

/**
 * tone: color of the action name (the name itself carries the meaning).
 * security: counted as a security event (sign-ins and password changes).
 * done: summary shown in the details panel for a successful event.
 */
export const auditActions = {
  SCHOOL_CREATED: { label: 'Register School', tone: 'success', done: 'School registered successfully.' },
  SCHOOL_UPDATED: { label: 'Update School', tone: 'info', done: 'School details updated successfully.' },
  SCHOOL_SUSPENDED: { label: 'Suspend School', tone: 'error', done: 'School suspended successfully.' },
  SCHOOL_REACTIVATED: { label: 'Reactivate School', tone: 'success', done: 'School reactivated successfully.' },
  OWNER_CREATED: { label: 'Create Owner Account', tone: 'success', done: 'Owner account created successfully.' },
  OWNER_UPDATED: { label: 'Update Owner', tone: 'info', done: 'Owner details updated successfully.' },
  OWNER_SUSPENDED: { label: 'Suspend Owner', tone: 'error', done: 'Owner account suspended successfully.' },
  OWNER_REACTIVATED: { label: 'Reactivate Owner', tone: 'success', done: 'Owner account reactivated successfully.' },
  SIGN_IN: { label: 'Sign In', tone: 'success', security: true, done: 'Signed in successfully.', failed: 'Sign-in attempt failed.' },
  SIGN_OUT: { label: 'Sign Out', tone: 'info', security: true, done: 'Signed out successfully.' },
  PASSWORD_RESET: { label: 'Reset Password', tone: 'info', security: true, done: 'Password reset completed successfully.' },
  SETTINGS_UPDATED: { label: 'Update Platform Settings', tone: 'info', done: 'Platform settings updated successfully.' },
};

export const actionOf = (code) => auditActions[code] ?? { label: code, tone: 'info', done: 'Action completed.' };

/** Summary sentence for the details panel. */
export const outcomeOf = (event) => {
  const action = actionOf(event.action);
  return event.result === 'failure' ? (action.failed ?? `${action.label} failed.`) : action.done;
};

export const auditRoles = {
  SUPER_ADMIN: { label: 'Super Admin', variant: 'accent' },
  OWNER: { label: 'School Owner', variant: 'info' },
  MANAGER: { label: 'Manager', variant: 'neutral' },
  STAFF: { label: 'Staff', variant: 'neutral' },
};

export const auditResults = {
  success: { label: 'Success', variant: 'success' },
  failure: { label: 'Failed', variant: 'error' },
};

export const targetTypes = {
  school: 'School',
  owner: 'School Owner',
  system: 'System',
  user: 'User',
};

export const isSecurityEvent = (event) => Boolean(actionOf(event.action).security);

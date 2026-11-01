// Display mapping for audit events: action names, roles, results and target types.
// Only actions the platform records are listed (they are also the action filter's choices).

/**
 * tone: color of the action name (the name itself carries the meaning).
 * security: counted as a security event (sign-ins, sign-outs, Authentication Settings changes, Super
 *   Admin password resets, Manager and staff password resets and temporary password changes), as
 *   SECURITY_ACTIONS in backend/src/features/audit-logs/auditActions.js.
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
  BRANCH_CREATED: { label: 'Create Branch', tone: 'success', done: 'Branch created successfully.' },
  BRANCH_UPDATED: { label: 'Update Branch', tone: 'info', done: 'Branch details updated successfully.' },
  BRANCH_SUSPENDED: { label: 'Suspend Branch', tone: 'error', done: 'Branch suspended successfully.' },
  BRANCH_REACTIVATED: { label: 'Reactivate Branch', tone: 'success', done: 'Branch reactivated successfully.' },
  BRANCH_LOCATION_CHANGED: { label: 'Change Branch Location', tone: 'info', done: 'Branch location changed successfully.' },
  BRANCH_LOCATION_CHANGE_CANCELLED: { label: 'Cancel Branch Location Change', tone: 'info', done: 'Scheduled branch location change cancelled.' },
  BRANCH_SCHEDULE_CHANGED: { label: 'Change Branch Schedule', tone: 'info', done: 'Branch schedule changed successfully.' },
  BRANCH_SCHEDULE_CHANGE_CANCELLED: { label: 'Cancel Branch Schedule Change', tone: 'info', done: 'Scheduled branch schedule change cancelled.' },
  MANAGER_CREATED: { label: 'Create Manager', tone: 'success', done: 'Manager account created successfully.' },
  MANAGER_UPDATED: { label: 'Update Manager', tone: 'info', done: 'Manager details updated successfully.' },
  MANAGER_TRANSFERRED: { label: 'Transfer Manager', tone: 'info', done: 'Manager transferred to another branch.' },
  MANAGER_SUSPENDED: { label: 'Suspend Manager', tone: 'error', done: 'Manager account suspended successfully.' },
  MANAGER_REACTIVATED: { label: 'Reactivate Manager', tone: 'success', done: 'Manager account reactivated successfully.' },
  MANAGER_PASSWORD_RESET: { label: 'Reset Manager Password', tone: 'error', security: true, done: 'New temporary password set for the Manager.' },
  STAFF_CREATED: { label: 'Create Staff', tone: 'success', done: 'Staff account created and activated.' },
  STAFF_UPDATED: { label: 'Update Staff', tone: 'info', done: 'Staff details updated successfully.' },
  STAFF_SUSPENDED: { label: 'Suspend Staff', tone: 'error', done: 'Staff account suspended successfully.' },
  STAFF_REACTIVATED: { label: 'Reactivate Staff', tone: 'success', done: 'Staff account reactivated successfully.' },
  STAFF_PASSWORD_RESET: { label: 'Reset Staff Password', tone: 'error', security: true, done: 'New temporary password set for the staff member.' },
  STAFF_ASSIGNMENT_CHANGED: { label: 'Change Shift Assignments', tone: 'info', done: 'Shift assignments changed successfully.' },
  STAFF_ASSIGNMENT_CHANGE_CANCELLED: { label: 'Cancel Shift Assignment Change', tone: 'info', done: 'Scheduled shift assignment change cancelled.' },
  PASSWORD_CHANGED: { label: 'Change Temporary Password', tone: 'info', security: true, done: 'Temporary password replaced by the account holder.' },
  BRANDING_UPDATED: { label: 'Update Branding', tone: 'info', done: 'Platform name updated successfully.' },
  GENERAL_SETTINGS_UPDATED: { label: 'Update General Settings', tone: 'info', done: 'General settings updated successfully.' },
  AUTH_SETTINGS_UPDATED: { label: 'Update Authentication Settings', tone: 'info', security: true, done: 'Authentication settings updated successfully.' },
  SCHEDULING_SETTINGS_UPDATED: { label: 'Update Scheduling Settings', tone: 'info', done: 'Scheduling settings updated successfully.' },
  STAFF_TRANSFER_SCHEDULED: { label: 'Schedule Staff Transfer', tone: 'info', done: 'Staff transfer scheduled.' },
  STAFF_TRANSFER_CANCELLED: { label: 'Cancel Staff Transfer', tone: 'info', done: 'Scheduled staff transfer cancelled.' },
  STAFF_TRANSFERRED: { label: 'Staff Transfer Took Effect', tone: 'success', done: 'The staff member now works at the new branch.' },
  NOTIFICATION_SETTINGS_UPDATED: { label: 'Update Notification Settings', tone: 'info', done: 'Notification settings updated successfully.' },
  BRANCH_REMINDER_SETTINGS_UPDATED: { label: 'Update Branch Reminder Settings', tone: 'info', done: 'Branch reminder settings updated successfully.' },
  NOTIFICATION_PREFERENCES_UPDATED: { label: 'Update Notification Preferences', tone: 'info', done: 'Notification preferences updated.' },
  ANNOUNCEMENT_CREATED: { label: 'Create Announcement', tone: 'success', done: 'Announcement created.' },
  ANNOUNCEMENT_UPDATED: { label: 'Edit Announcement', tone: 'info', done: 'Announcement edited.' },
  ANNOUNCEMENT_PUBLISHED: { label: 'Publish Announcement', tone: 'success', done: 'Announcement published.' },
  ANNOUNCEMENT_SCHEDULED: { label: 'Schedule Announcement', tone: 'info', done: 'Announcement scheduled.' },
  ANNOUNCEMENT_WITHDRAWN: { label: 'Withdraw Announcement', tone: 'error', done: 'Announcement withdrawn.' },
  SUPER_ADMIN_PASSWORD_RESET: { label: 'Reset Super Admin Password', tone: 'error', security: true, done: 'Super Admin password reset from the command line.' },
  SIGN_IN: { label: 'Sign In', tone: 'success', security: true, done: 'Signed in successfully.', failed: 'Sign-in attempt failed.' },
  SIGN_OUT: { label: 'Sign Out', tone: 'info', security: true, done: 'Signed out successfully.' },
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
  branch: 'Branch',
  manager: 'Manager',
  staff: 'Staff',
  system: 'System',
  user: 'User',
  announcement: 'Announcement',
};

export const isSecurityEvent = (event) => Boolean(actionOf(event.action).security);

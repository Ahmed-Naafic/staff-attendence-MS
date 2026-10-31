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
  // Branch Management (School Owner)
  BRANCH_CREATED: 'BRANCH_CREATED',
  BRANCH_UPDATED: 'BRANCH_UPDATED',
  BRANCH_SUSPENDED: 'BRANCH_SUSPENDED',
  BRANCH_REACTIVATED: 'BRANCH_REACTIVATED',
  BRANCH_LOCATION_CHANGED: 'BRANCH_LOCATION_CHANGED',
  BRANCH_LOCATION_CHANGE_CANCELLED: 'BRANCH_LOCATION_CHANGE_CANCELLED',
  // Branch schedules (Manager)
  BRANCH_SCHEDULE_CHANGED: 'BRANCH_SCHEDULE_CHANGED',
  BRANCH_SCHEDULE_CHANGE_CANCELLED: 'BRANCH_SCHEDULE_CHANGE_CANCELLED',
  // Manager accounts (School Owner)
  MANAGER_CREATED: 'MANAGER_CREATED',
  MANAGER_UPDATED: 'MANAGER_UPDATED',
  MANAGER_TRANSFERRED: 'MANAGER_TRANSFERRED',
  MANAGER_SUSPENDED: 'MANAGER_SUSPENDED',
  MANAGER_REACTIVATED: 'MANAGER_REACTIVATED',
  MANAGER_PASSWORD_RESET: 'MANAGER_PASSWORD_RESET', // a new temporary password (security event)
  // Staff accounts and shift assignments (Manager)
  STAFF_CREATED: 'STAFF_CREATED',
  STAFF_UPDATED: 'STAFF_UPDATED',
  STAFF_SUSPENDED: 'STAFF_SUSPENDED',
  STAFF_REACTIVATED: 'STAFF_REACTIVATED',
  STAFF_PASSWORD_RESET: 'STAFF_PASSWORD_RESET', // a new temporary password (security event)
  STAFF_ASSIGNMENT_CHANGED: 'STAFF_ASSIGNMENT_CHANGED',
  STAFF_ASSIGNMENT_CHANGE_CANCELLED: 'STAFF_ASSIGNMENT_CHANGE_CANCELLED',
  // Staff transfers between branches (School Owner; completion by the system)
  STAFF_TRANSFER_SCHEDULED: 'STAFF_TRANSFER_SCHEDULED',
  STAFF_TRANSFER_CANCELLED: 'STAFF_TRANSFER_CANCELLED',
  STAFF_TRANSFERRED: 'STAFF_TRANSFERRED',
  // The account holder replaces a temporary password (security event)
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  // Platform Settings: Branding (Super Admin)
  BRANDING_UPDATED: 'BRANDING_UPDATED',
  // Platform Settings: General (Super Admin)
  GENERAL_SETTINGS_UPDATED: 'GENERAL_SETTINGS_UPDATED',
  // Platform Settings: Authentication (Super Admin)
  AUTH_SETTINGS_UPDATED: 'AUTH_SETTINGS_UPDATED',
  // Super Admin recovery (command line only: scripts/reset-super-admin-password.js)
  SUPER_ADMIN_PASSWORD_RESET: 'SUPER_ADMIN_PASSWORD_RESET',
  // Notifications (docs/notifications/): settings and preferences changes and announcements (N22).
  // Deliveries, openings and read actions are never audited.
  NOTIFICATION_SETTINGS_UPDATED: 'NOTIFICATION_SETTINGS_UPDATED', // platform settings (Super Admin)
  BRANCH_REMINDER_SETTINGS_UPDATED: 'BRANCH_REMINDER_SETTINGS_UPDATED', // branch reminder timing (Manager)
  NOTIFICATION_PREFERENCES_UPDATED: 'NOTIFICATION_PREFERENCES_UPDATED', // a user's own preferences
  ANNOUNCEMENT_CREATED: 'ANNOUNCEMENT_CREATED',
  ANNOUNCEMENT_UPDATED: 'ANNOUNCEMENT_UPDATED',
  ANNOUNCEMENT_PUBLISHED: 'ANNOUNCEMENT_PUBLISHED',
  ANNOUNCEMENT_SCHEDULED: 'ANNOUNCEMENT_SCHEDULED',
  ANNOUNCEMENT_WITHDRAWN: 'ANNOUNCEMENT_WITHDRAWN',
};

/** Actions the audit filter accepts: the recorded actions only. */
export const FILTERABLE_ACTIONS = [
  'SCHOOL_CREATED',
  'SCHOOL_UPDATED',
  'SCHOOL_SUSPENDED',
  'SCHOOL_REACTIVATED',
  'OWNER_CREATED',
  'OWNER_UPDATED',
  'OWNER_SUSPENDED',
  'OWNER_REACTIVATED',
  'BRANCH_CREATED',
  'BRANCH_UPDATED',
  'BRANCH_SUSPENDED',
  'BRANCH_REACTIVATED',
  'BRANCH_LOCATION_CHANGED',
  'BRANCH_LOCATION_CHANGE_CANCELLED',
  'BRANCH_SCHEDULE_CHANGED',
  'BRANCH_SCHEDULE_CHANGE_CANCELLED',
  'MANAGER_CREATED',
  'MANAGER_UPDATED',
  'MANAGER_TRANSFERRED',
  'MANAGER_SUSPENDED',
  'MANAGER_REACTIVATED',
  'MANAGER_PASSWORD_RESET',
  'PASSWORD_CHANGED',
  'STAFF_CREATED',
  'STAFF_UPDATED',
  'STAFF_SUSPENDED',
  'STAFF_REACTIVATED',
  'STAFF_PASSWORD_RESET',
  'STAFF_ASSIGNMENT_CHANGED',
  'STAFF_ASSIGNMENT_CHANGE_CANCELLED',
  'STAFF_TRANSFER_SCHEDULED',
  'STAFF_TRANSFER_CANCELLED',
  'STAFF_TRANSFERRED',
  'BRANDING_UPDATED',
  'GENERAL_SETTINGS_UPDATED',
  'AUTH_SETTINGS_UPDATED',
  'SUPER_ADMIN_PASSWORD_RESET',
  'NOTIFICATION_SETTINGS_UPDATED',
  'BRANCH_REMINDER_SETTINGS_UPDATED',
  'NOTIFICATION_PREFERENCES_UPDATED',
  'ANNOUNCEMENT_CREATED',
  'ANNOUNCEMENT_UPDATED',
  'ANNOUNCEMENT_PUBLISHED',
  'ANNOUNCEMENT_SCHEDULED',
  'ANNOUNCEMENT_WITHDRAWN',
  'SIGN_IN',
  'SIGN_OUT',
];

/**
 * Security events: sign-ins, sign-outs, changes to Authentication Settings, Super Admin password
 * resets, new temporary passwords for Managers and staff, and temporary password changes. They count as Security Events in the audit summary (not as admin actions) and
 * are left out of the dashboard's recent platform activity.
 */
export const SECURITY_ACTIONS = [
  'SIGN_IN',
  'SIGN_OUT',
  'AUTH_SETTINGS_UPDATED',
  'SUPER_ADMIN_PASSWORD_RESET',
  'MANAGER_PASSWORD_RESET',
  'STAFF_PASSWORD_RESET',
  'PASSWORD_CHANGED',
];

/**
 * Branch events (School Owner actions, and schedule changes by the branch's Manager). School
 * Owners read their own school's; Super Admins read
 * them in the audit log. They are school activity, so the dashboard's recent platform activity
 * leaves them out.
 */
export const BRANCH_ACTIONS = [
  'BRANCH_CREATED',
  'BRANCH_UPDATED',
  'BRANCH_SUSPENDED',
  'BRANCH_REACTIVATED',
  'BRANCH_LOCATION_CHANGED',
  'BRANCH_LOCATION_CHANGE_CANCELLED',
  'BRANCH_SCHEDULE_CHANGED',
  'BRANCH_SCHEDULE_CHANGE_CANCELLED',
  'BRANCH_REMINDER_SETTINGS_UPDATED',
];

/**
 * Manager account events (School Owner actions, and the Manager's own password change). School
 * Owners read their own school's; Super Admins read them in the audit log. School activity: left
 * out of the dashboard's recent platform activity.
 */
export const MANAGER_ACTIONS = [
  'MANAGER_CREATED',
  'MANAGER_UPDATED',
  'MANAGER_TRANSFERRED',
  'MANAGER_SUSPENDED',
  'MANAGER_REACTIVATED',
  'MANAGER_PASSWORD_RESET',
  'PASSWORD_CHANGED',
];

/**
 * Staff account and assignment events (Manager actions). Super Admins read them in the audit log;
 * School Owners do not (not decided). School activity: left out of the dashboard's recent activity.
 */
export const STAFF_ACTIONS = [
  'STAFF_CREATED',
  'STAFF_UPDATED',
  'STAFF_SUSPENDED',
  'STAFF_REACTIVATED',
  'STAFF_PASSWORD_RESET',
  'STAFF_ASSIGNMENT_CHANGED',
  'STAFF_ASSIGNMENT_CHANGE_CANCELLED',
  'STAFF_TRANSFER_SCHEDULED',
  'STAFF_TRANSFER_CANCELLED',
  'STAFF_TRANSFERRED',
];

/**
 * A user's own notification preference changes (any role). Super Admins read them in the audit log;
 * personal settings, so they are left out of the dashboard's recent platform activity.
 */
export const PREFERENCE_ACTIONS = ['NOTIFICATION_PREFERENCES_UPDATED'];

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
  BRANCH_CREATED: 'Create Branch',
  BRANCH_UPDATED: 'Update Branch',
  BRANCH_SUSPENDED: 'Suspend Branch',
  BRANCH_REACTIVATED: 'Reactivate Branch',
  BRANCH_LOCATION_CHANGED: 'Change Branch Location',
  BRANCH_LOCATION_CHANGE_CANCELLED: 'Cancel Branch Location Change',
  BRANCH_SCHEDULE_CHANGED: 'Change Branch Schedule',
  BRANCH_SCHEDULE_CHANGE_CANCELLED: 'Cancel Branch Schedule Change',
  MANAGER_CREATED: 'Create Manager',
  MANAGER_UPDATED: 'Update Manager',
  MANAGER_TRANSFERRED: 'Transfer Manager',
  MANAGER_SUSPENDED: 'Suspend Manager',
  MANAGER_REACTIVATED: 'Reactivate Manager',
  MANAGER_PASSWORD_RESET: 'Reset Manager Password',
  PASSWORD_CHANGED: 'Change Temporary Password',
  STAFF_CREATED: 'Create Staff',
  STAFF_UPDATED: 'Update Staff',
  STAFF_SUSPENDED: 'Suspend Staff',
  STAFF_REACTIVATED: 'Reactivate Staff',
  STAFF_PASSWORD_RESET: 'Reset Staff Password',
  STAFF_ASSIGNMENT_CHANGED: 'Change Shift Assignments',
  STAFF_ASSIGNMENT_CHANGE_CANCELLED: 'Cancel Shift Assignment Change',
  STAFF_TRANSFER_SCHEDULED: 'Schedule Staff Transfer',
  STAFF_TRANSFER_CANCELLED: 'Cancel Staff Transfer',
  STAFF_TRANSFERRED: 'Staff Transfer Took Effect',
  BRANDING_UPDATED: 'Update Branding',
  GENERAL_SETTINGS_UPDATED: 'Update General Settings',
  AUTH_SETTINGS_UPDATED: 'Update Authentication Settings',
  SUPER_ADMIN_PASSWORD_RESET: 'Reset Super Admin Password',
  NOTIFICATION_SETTINGS_UPDATED: 'Update Notification Settings',
  BRANCH_REMINDER_SETTINGS_UPDATED: 'Update Branch Reminder Settings',
  NOTIFICATION_PREFERENCES_UPDATED: 'Update Notification Preferences',
  ANNOUNCEMENT_CREATED: 'Create Announcement',
  ANNOUNCEMENT_UPDATED: 'Edit Announcement',
  ANNOUNCEMENT_PUBLISHED: 'Publish Announcement',
  ANNOUNCEMENT_SCHEDULED: 'Schedule Announcement',
  ANNOUNCEMENT_WITHDRAWN: 'Withdraw Announcement',
  SIGN_IN: 'Sign In',
  SIGN_OUT: 'Sign Out',
};

export const ROLE_LABELS = { SUPER_ADMIN: 'Super Admin', OWNER: 'School Owner', MANAGER: 'Manager', STAFF: 'Staff' };

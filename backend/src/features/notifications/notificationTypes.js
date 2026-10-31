/*
 * Notification types, categories and the rules that do not depend on the database (approved
 * decisions N1–N24, docs/notifications/notification-specification.md).
 *
 * A notification's category decides whether a user may turn it off (N12): STATUS (school and branch
 * suspension and reactivation), MANAGER_ASSIGNMENT (the Manager's own transfer) and ANNOUNCEMENT are
 * mandatory; the others are optional. Each role sees only the categories it can receive.
 */

/** Notifications are kept for 90 days, then removed (N18). */
export const RETENTION_DAYS = 90;
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** The only approved notification language (N24). Templates exist per language; nothing falls back to English. */
export const LANGUAGES = ['so'];
export const DEFAULT_LANGUAGE = 'so';

export const CATEGORIES = [
  'ATTENDANCE',
  'MISSING_CHECK_OUT',
  'DIGEST',
  'ASSIGNMENT',
  'SCHEDULE',
  'BRANCH_SETUP',
  'MANAGER_ASSIGNMENT',
  'STATUS',
  'ANNOUNCEMENT',
  'TRANSFER',
];
export const MANDATORY_CATEGORIES = ['STATUS', 'MANAGER_ASSIGNMENT', 'ANNOUNCEMENT', 'TRANSFER'];
export const isMandatory = (category) => MANDATORY_CATEGORIES.includes(category);

/** The categories each role can receive (and so can see in its preferences). */
export const ROLE_CATEGORIES = {
  STAFF: ['MISSING_CHECK_OUT', 'ASSIGNMENT', 'SCHEDULE', 'TRANSFER', 'STATUS', 'ANNOUNCEMENT'],
  MANAGER: ['ATTENDANCE', 'DIGEST', 'BRANCH_SETUP', 'MANAGER_ASSIGNMENT', 'TRANSFER', 'STATUS', 'ANNOUNCEMENT'],
  OWNER: ['DIGEST', 'BRANCH_SETUP', 'STATUS', 'ANNOUNCEMENT'],
};

/** Notification type → category. The 11 approved Phase 1 events (N3) plus the digests (N6–N8). */
export const NOTIFICATION_TYPES = {
  LATE_CHECK_IN: 'ATTENDANCE', // 1 (Managers, during the work day)
  MISSING_CHECK_OUT: 'MISSING_CHECK_OUT', // 2 (the staff member)
  ASSIGNMENT_CHANGED: 'ASSIGNMENT', // 3
  ASSIGNMENT_CANCELLED: 'ASSIGNMENT', // 4
  SCHEDULE_CHANGED: 'SCHEDULE', // 5 (affected staff only)
  SCHEDULE_CHANGE_CANCELLED: 'SCHEDULE', // 5 (a cancelled scheduled change, affected staff only)
  BRANCH_NO_SCHEDULE: 'BRANCH_SETUP', // 6 (the branch's Managers)
  MANAGER_TRANSFERRED: 'MANAGER_ASSIGNMENT', // 7 (the Manager)
  BRANCH_SUSPENDED: 'STATUS', // 8
  BRANCH_REACTIVATED: 'STATUS', // 9
  SCHOOL_SUSPENDED: 'STATUS', // 10
  SCHOOL_REACTIVATED: 'STATUS', // 11
  BRANCH_NO_MANAGER: 'BRANCH_SETUP', // N7 (the Owner)
  BRANCH_DIGEST: 'DIGEST', // N6, N8 (the branch's Managers)
  SCHOOL_DIGEST: 'DIGEST', // N7 (the Owner, all branches)
  STAFF_TRANSFERRED: 'TRANSFER', // T9 (the staff member: their transfer is scheduled)
  STAFF_TRANSFER_IN: 'TRANSFER', // T9 (the destination branch's Managers)
  STAFF_TRANSFER_CANCELLED: 'TRANSFER', // T9 (the staff member and the destination Managers)
};
export const categoryOf = (type) => NOTIFICATION_TYPES[type];

/** Announcement kinds the Super Admin can choose (N17 examples). */
export const ANNOUNCEMENT_KINDS = ['FEATURE', 'SEASONAL', 'GUIDE', 'UPDATE', 'MAINTENANCE'];
/** Roles an announcement can target (never Super Admins). */
export const ANNOUNCEMENT_ROLES = ['OWNER', 'MANAGER', 'STAFF'];

/** Hard limits for reminder minutes (database checks repeat them). Check-in opens 30 minutes before a shift, so a check-in reminder cannot be earlier. */
export const HARD_LIMITS = { checkInLead: { min: 0, max: 30 }, checkOutLead: { min: 0, max: 120 }, digestHour: { min: 0, max: 23 } };

/** The platform settings used when none are saved (the database defaults). */
export const DEFAULT_PLATFORM_SETTINGS = {
  pushEnabled: true,
  checkInReminderEnabled: true,
  checkOutReminderEnabled: true,
  uploadReminderEnabled: true,
  checkInLeadDefault: 15,
  checkInLeadMin: 0,
  checkInLeadMax: 30,
  checkOutLeadDefault: 10,
  checkOutLeadMin: 0,
  checkOutLeadMax: 60,
  staffCanAdjustTiming: true,
  digestHour: 6,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * The reminders a staff member gets (N5): each one needs the platform, the branch and the staff
 * member to allow it. Minutes: the staff member's choice (when the platform lets staff adjust
 * timing), else the branch's, else the platform default — always clamped to the platform limits, so
 * nobody can go outside them. Preferences never change an attendance rule; a reminder never records
 * attendance.
 */
export function effectiveReminders(platform, branch, preference) {
  const p = { ...DEFAULT_PLATFORM_SETTINGS, ...(platform ?? {}) };
  const b = branch ?? {};
  const own = preference ?? {};
  const minutes = (staffValue, branchValue, fallback, min, max) =>
    clamp((p.staffCanAdjustTiming ? staffValue : null) ?? branchValue ?? fallback, min, max);
  const reminder = (platformOn, branchOn, staffOn) => ({
    available: Boolean(platformOn && branchOn !== false),
    enabled: Boolean(platformOn && branchOn !== false && staffOn !== false),
  });
  return {
    checkIn: {
      ...reminder(p.checkInReminderEnabled, b.checkInReminderEnabled, own.checkInReminder),
      leadMinutes: minutes(own.checkInLeadMinutes, b.checkInLeadMinutes, p.checkInLeadDefault, p.checkInLeadMin, p.checkInLeadMax),
      min: p.checkInLeadMin,
      max: p.checkInLeadMax,
      adjustable: p.staffCanAdjustTiming,
      // Geofence reminders also need the staff member's consent to background location (N1).
      consented: Boolean(own.locationConsentAt),
    },
    checkOut: {
      ...reminder(p.checkOutReminderEnabled, b.checkOutReminderEnabled, own.checkOutReminder),
      leadMinutes: minutes(own.checkOutLeadMinutes, b.checkOutLeadMinutes, p.checkOutLeadDefault, p.checkOutLeadMin, p.checkOutLeadMax),
      min: p.checkOutLeadMin,
      max: p.checkOutLeadMax,
      adjustable: p.staffCanAdjustTiming,
    },
    upload: reminder(p.uploadReminderEnabled, true, own.uploadReminder),
  };
}

/** Whether a user receives a notification of `category` given their disabled categories (mandatory ones always). */
export const wantsCategory = (category, disabled = []) => isMandatory(category) || !disabled.includes(category);

// Choices for the settings controls and the reasons shown on unavailable actions.
import {
  Bell,
  Blocks,
  CalendarClock,
  DatabaseBackup,
  KeyRound,
  Palette,
  Server,
  Settings,
  UserPlus,
} from 'lucide-react';

export const UNAVAILABLE = {
  rules: 'Not available yet: waiting for approved business rules.',
  persistence: 'Not available yet: platform settings persistence is not implemented.',
  operations: 'Not available yet: platform operations are not implemented.',
};

/** Settings sections from the reference. General, Branding, Authentication and Registration (read only) have approved content so far. */
export const settingsTabs = [
  { value: 'general', label: 'General', icon: Settings },
  { value: 'branding', label: 'Branding', icon: Palette },
  { value: 'authentication', label: 'Authentication', icon: KeyRound },
  { value: 'registration', label: 'Registration', icon: UserPlus },
  { value: 'scheduling', label: 'Scheduling & Assignments', icon: CalendarClock },
  { value: 'notifications', label: 'Notifications', icon: Bell },
  { value: 'system', label: 'System', icon: Server },
  { value: 'integrations', label: 'Integrations', icon: Blocks },
  { value: 'data-backup', label: 'Data & Backup', icon: DatabaseBackup },
];

const offsetName = (timeZone, now) => {
  try {
    return new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
};

/**
 * Time zone choices: IANA identifiers known to this browser (the server checks against its own
 * list), UTC first, each labelled with its current offset. The identifier is stored, never the offset.
 */
export function timezoneOptions(now = new Date()) {
  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = ['Africa/Mogadishu'];
  }
  return ['UTC', ...zones.filter((z) => z !== 'UTC')].map((value) => {
    const offset = offsetName(value, now);
    return { value, label: offset && offset !== 'GMT' ? `${value} (${offset})` : `${value} (GMT+00:00)` };
  });
}

export const languageOptions = [{ value: 'en', label: 'English' }];

const pad = (n) => String(n).padStart(2, '0');

/** The approved date formats, each labelled with today's date in that format. */
export function dateFormatOptions(now = new Date()) {
  const d = pad(now.getDate());
  const m = pad(now.getMonth() + 1);
  const y = now.getFullYear();
  return [
    { value: 'YYYY-MM-DD', label: `${y}-${m}-${d} (YYYY-MM-DD)` },
    { value: 'DD/MM/YYYY', label: `${d}/${m}/${y} (DD/MM/YYYY)` },
    { value: 'MM/DD/YYYY', label: `${m}/${d}/${y} (MM/DD/YYYY)` },
  ];
}

export const timeFormatOptions = [
  { value: '24h', label: '24-hour (14:30)' },
  { value: '12h', label: '12-hour (2:30 PM)' },
];

export const firstDayOptions = [
  { value: 'monday', label: 'Monday' },
  { value: 'sunday', label: 'Sunday' },
];

/** Platform Configuration switches, in reference order. */
export const configurationItems = [
  { key: 'allowSchoolRegistration', label: 'Allow new school registrations', description: 'Allow new schools to register on the platform.' },
  { key: 'allowOwnerCreation', label: 'Enable school owner creation', description: 'Allow creation of school owner accounts.' },
  { key: 'auditLogging', label: 'Enable audit logging', description: 'Log important platform actions.' },
  { key: 'emailNotifications', label: 'Enable email notifications', description: 'Send email notifications for important events.' },
  { key: 'smsNotifications', label: 'Enable SMS notifications', description: 'Send SMS notifications (requires configuration).' },
  { key: 'maintenanceMode', label: 'Enable maintenance mode', description: 'Put the platform in maintenance mode.' },
];

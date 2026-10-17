// Choices for the settings controls and the reasons shown on unavailable actions.
import {
  Bell,
  Blocks,
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

/** Settings sections from the reference. Only General has approved content so far. */
export const settingsTabs = [
  { value: 'general', label: 'General', icon: Settings },
  { value: 'branding', label: 'Branding', icon: Palette },
  { value: 'authentication', label: 'Authentication', icon: KeyRound },
  { value: 'registration', label: 'Registration', icon: UserPlus },
  { value: 'notifications', label: 'Notifications', icon: Bell },
  { value: 'system', label: 'System', icon: Server },
  { value: 'integrations', label: 'Integrations', icon: Blocks },
  { value: 'data-backup', label: 'Data & Backup', icon: DatabaseBackup },
];

export const timezoneOptions = [
  { value: 'Africa/Mogadishu', label: '(GMT+03:00) Mogadishu, Nairobi, Addis Ababa' },
  { value: 'UTC', label: '(GMT+00:00) Coordinated Universal Time (UTC)' },
];

export const languageOptions = [{ value: 'en', label: 'English' }];

const pad = (n) => String(n).padStart(2, '0');
const monthShort = new Intl.DateTimeFormat('en', { month: 'short' });

/** Date formats, each labelled with today's date in that format. */
export function dateFormatOptions(now = new Date()) {
  const d = pad(now.getDate());
  const m = pad(now.getMonth() + 1);
  const y = now.getFullYear();
  return [
    { value: 'MMM DD, YYYY', label: `${monthShort.format(now)} ${d}, ${y} (MMM DD, YYYY)` },
    { value: 'DD/MM/YYYY', label: `${d}/${m}/${y} (DD/MM/YYYY)` },
    { value: 'YYYY-MM-DD', label: `${y}-${m}-${d} (YYYY-MM-DD)` },
  ];
}

export const timeFormatOptions = [
  { value: '24h', label: '24-hour (14:30)' },
  { value: '12h', label: '12-hour (2:30 PM)' },
];

export const firstDayOptions = [
  { value: 'saturday', label: 'Saturday' },
  { value: 'sunday', label: 'Sunday' },
  { value: 'monday', label: 'Monday' },
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

/*
 * Display rules for the notification centre (pure; tested in notificationRules.test.js).
 * Notification texts arrive already written in Somali (the only approved notification language,
 * N24); the web app's own labels stay in English like the rest of the app.
 */

/** How often the unread count is refreshed while the app is open (and whenever the window regains focus). */
export const POLL_MS = 60_000;

export const CATEGORY_LABELS = {
  ATTENDANCE: 'Late arrivals',
  MISSING_CHECK_OUT: 'Missing check-outs',
  DIGEST: 'Daily attendance digests',
  ASSIGNMENT: 'Shift assignments',
  SCHEDULE: 'Schedule changes',
  BRANCH_SETUP: 'Branch setup warnings',
  MANAGER_ASSIGNMENT: 'Transfers',
  STATUS: 'Suspensions and reactivations',
  ANNOUNCEMENT: 'Platform announcements',
  TRANSFER: 'Staff transfers',
};

export const CATEGORY_DESCRIPTIONS = {
  ATTENDANCE: 'A staff member of your branch checked in late during the work day.',
  MISSING_CHECK_OUT: 'A check-out was not recorded within 24 hours of the end of the work day.',
  DIGEST: 'Each morning: check-ins, late arrivals and check-outs of the previous day (counts only).',
  ASSIGNMENT: 'Your shift assignments were changed or a scheduled change was cancelled.',
  SCHEDULE: 'A branch schedule change affects your shifts.',
  BRANCH_SETUP: 'A branch has no schedule in effect or no active Manager.',
  MANAGER_ASSIGNMENT: 'You were transferred to another branch.',
  STATUS: 'Your school or branch was suspended or reactivated.',
  ANNOUNCEMENT: 'Messages from the EduTrack platform team.',
  TRANSFER: 'A staff member is joining your branch, or a transfer was cancelled.',
};

/** Owner and Manager pages show absolute times in UTC, labelled (docs/business-rules.md → Owner date display). */
export const utcLabel = (text) => `${text} UTC`;

/** Unread badge text: nothing for 0, the number up to 9, then "9+". */
export function badgeText(count) {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 9 ? '9+' : String(count);
}

/** Accessible name of the bell button. */
export const bellLabel = (count) => (count > 0 ? `Notifications, ${count} unread` : 'Notifications');

/** The category filter choices for a role (from its preferences' categories). */
export const categoryOptions = (categories = []) => [{ value: '', label: 'All categories' }, ...categories.map((c) => ({ value: c.key, label: CATEGORY_LABELS[c.key] ?? c.key }))];

/**
 * Where "Open" leads for an item, or null (the item is shown in its details dialog only).
 * The target page checks its own access; a link never grants anything.
 */
export function linkTarget(item, role) {
  const link = item?.link;
  if (!link) return null;
  if (link.kind === 'attendanceRecords' && link.date && (role === 'MANAGER' || role === 'OWNER')) {
    return `/attendance?tab=records&range=custom&from=${link.date}&to=${link.date}`;
  }
  if (link.kind === 'schedule' && role === 'MANAGER') return '/schedule';
  if (link.kind === 'managers' && role === 'OWNER') return '/managers';
  return null;
}

/** An item with its read time set (after marking it read), leaving the others untouched. */
export const withRead = (items, read) => items.map((i) => (i.source === read.source && i.id === read.id ? { ...i, readAt: i.readAt ?? read.readAt } : i));

/** Every item marked read (after "Mark all as read"). */
export const allRead = (items, at = new Date().toISOString()) => items.map((i) => (i.readAt ? i : { ...i, readAt: at }));

const COUNT_FIELDS = [
  ['checkIns', 'Check-ins'],
  ['present', 'Present'],
  ['late', 'Late'],
  ['staff', 'Staff checked in'],
  ['checkedOut', 'Checked out'],
  ['open', 'Not checked out yet'],
  ['notRequired', 'Check-out not required'],
];

/** The digest view: the day's counts and the final counts of the day before, as labelled rows. */
export function digestSummary(data) {
  if (!data?.day) return null;
  return {
    date: data.date,
    day: COUNT_FIELDS.map(([key, label]) => ({ key, label, value: data.day[key] ?? 0 })),
    previous: data.previous
      ? { date: data.previous.date, rows: [['checkIns', 'Check-ins'], ['late', 'Late'], ['missing', 'No check-out']].map(([key, label]) => ({ key, label, value: data.previous[key] ?? 0 })) }
      : null,
    branches: (data.branches ?? []).map((b) => ({ name: b.name, code: b.code, ...b.day, missing: b.previous?.missing ?? 0 })),
  };
}

/** Preference rows: mandatory categories are shown on and locked (N12). */
export const preferenceRows = (categories = []) =>
  categories.map((c) => ({ ...c, label: CATEGORY_LABELS[c.key] ?? c.key, description: CATEGORY_DESCRIPTIONS[c.key] ?? '', locked: c.mandatory }));

/** The disabledCategories list after switching one optional category. */
export function toggledCategories(categories, key, enabled) {
  const off = categories.filter((c) => !c.mandatory && !c.enabled).map((c) => c.key);
  const next = enabled ? off.filter((k) => k !== key) : [...new Set([...off, key])];
  return next.sort();
}

/** Branch reminder minutes check (Manager): empty = platform default; otherwise a whole number within the platform limits. */
export function minutesProblem(value, { min, max }) {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return `Enter a whole number from ${min} to ${max}, or leave it empty for the platform default.`;
  return '';
}

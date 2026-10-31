/*
 * Announcement form rules (pure; tested in announcementRules.test.js). The server applies the same
 * rules and decides; these give immediate feedback. Times are entered in the browser's time zone
 * (datetime-local) and sent as ISO instants.
 */

export const TITLE_MAX = 120;
export const BODY_MAX = 2000;
export const MAX_DAYS = 90;
const DAY = 24 * 60 * 60 * 1000;

export const KINDS = [
  { value: 'FEATURE', label: 'New feature' },
  { value: 'SEASONAL', label: 'Greeting or seasonal message' },
  { value: 'GUIDE', label: 'Guide or tutorial' },
  { value: 'UPDATE', label: 'Platform update' },
  { value: 'MAINTENANCE', label: 'Maintenance' },
];
export const kindLabel = (kind) => KINDS.find((k) => k.value === kind)?.label ?? kind;

export const ROLES = [
  { value: 'OWNER', label: 'School Owners', description: 'In the web notification centre.' },
  { value: 'MANAGER', label: 'Managers', description: 'In the web notification centre.' },
  { value: 'STAFF', label: 'Staff', description: 'In the Staff app, with a push notification when enabled.' },
];

export const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'published', label: 'Published' },
  { value: 'expired', label: 'Expired' },
  { value: 'withdrawn', label: 'Withdrawn' },
];

const STATUS_BADGES = {
  draft: { label: 'Draft', variant: 'neutral' },
  scheduled: { label: 'Scheduled', variant: 'info' },
  published: { label: 'Published', variant: 'success' },
  expired: { label: 'Expired', variant: 'warning' },
  withdrawn: { label: 'Withdrawn', variant: 'error' },
};
export const statusBadge = (status) => STATUS_BADGES[status] ?? { label: status, variant: 'neutral' };

/** 'YYYY-MM-DDTHH:MM' in the browser's time zone for a Date (for datetime-local inputs). */
export function toLocalInput(date) {
  if (!date) return '';
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const fromLocalInput = (value) => (value ? new Date(value) : null);

/** A new form: published now for 7 days to all schools; the audience roles are chosen by the admin. */
export const emptyForm = (now = new Date()) => ({
  kind: 'UPDATE',
  title: '',
  body: '',
  imageUrl: '',
  linkUrl: '',
  roles: [],
  allSchools: true,
  schools: [],
  action: 'publish',
  publishAt: toLocalInput(new Date(now.getTime() + 60 * 60 * 1000)),
  expiresAt: toLocalInput(new Date(now.getTime() + 7 * DAY)),
});

/** The edit form of a saved announcement (its publish choice cannot change in the form). */
export const formFrom = (a) => ({
  kind: a.kind,
  title: a.title,
  body: a.body,
  imageUrl: a.imageUrl ?? '',
  linkUrl: a.linkUrl ?? '',
  roles: a.roles,
  allSchools: a.allSchools,
  schools: a.schools,
  action: null,
  publishAt: toLocalInput(a.publishAt),
  expiresAt: toLocalInput(a.expiresAt),
});

function urlProblem(value) {
  if (!value) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || !url.hostname.includes('.')) throw new Error();
    return '';
  } catch {
    return 'Enter a full https:// address, such as https://example.com/guide.';
  }
}

/**
 * Field errors ({} when valid). `saved` is the announcement being edited (null when creating): the
 * expiry counts from its publish time, or from the chosen publish time / now for a new one.
 */
export function validateAnnouncement(form, { now = new Date(), saved = null } = {}) {
  const errors = {};
  const title = form.title.trim();
  const body = form.body.trim();
  if (!title) errors.title = 'Enter a title.';
  else if ([...title].length > TITLE_MAX) errors.title = `At most ${TITLE_MAX} characters.`;
  if (!body) errors.body = 'Enter the message.';
  else if ([...body].length > BODY_MAX) errors.body = `At most ${BODY_MAX} characters.`;
  if (!form.roles.length) errors.roles = 'Choose at least one audience.';
  if (!form.allSchools && !form.schools.length) errors.schoolIds = 'Choose at least one school.';
  const image = urlProblem(form.imageUrl);
  if (image) errors.imageUrl = image;
  const link = urlProblem(form.linkUrl);
  if (link) errors.linkUrl = link;

  const publishAt = form.action === 'schedule' ? fromLocalInput(form.publishAt) : null;
  if (form.action === 'schedule') {
    if (!publishAt || Number.isNaN(publishAt.getTime())) errors.publishAt = 'Choose when to publish.';
    else if (publishAt < now) errors.publishAt = 'The publish time cannot be in the past.';
  }
  const expiresAt = fromLocalInput(form.expiresAt);
  const start = saved ? (saved.publishAt && saved.status !== 'draft' ? new Date(saved.publishAt) : now) : (publishAt ?? now);
  if (!expiresAt || Number.isNaN(expiresAt.getTime())) errors.expiresAt = 'Choose when the announcement expires.';
  else if (expiresAt <= start) errors.expiresAt = 'The expiry must be after the publish time.';
  else if (expiresAt.getTime() - start.getTime() > MAX_DAYS * DAY) errors.expiresAt = `An announcement can be shown for at most ${MAX_DAYS} days.`;
  return errors;
}

/** The request body (create: with action and publishAt; edit: the editable fields only). */
export function toBody(form, { create }) {
  const body = {
    kind: form.kind,
    title: form.title.trim(),
    body: form.body.trim(),
    imageUrl: form.imageUrl.trim() || null,
    linkUrl: form.linkUrl.trim() || null,
    roles: form.roles,
    allSchools: form.allSchools,
    schoolIds: form.allSchools ? [] : form.schools.map((s) => s.id),
    expiresAt: fromLocalInput(form.expiresAt).toISOString(),
  };
  if (create) {
    body.action = form.action;
    if (form.action === 'schedule') body.publishAt = fromLocalInput(form.publishAt).toISOString();
  }
  return body;
}

/** "Managers, Staff · all schools" / "School Owners · 3 schools". */
export function audienceText(a) {
  const roles = ROLES.filter((r) => a.roles.includes(r.value)).map((r) => r.label).join(', ');
  return `${roles} · ${a.allSchools ? 'all schools' : `${a.schools.length} school${a.schools.length === 1 ? '' : 's'}`}`;
}

/** Actions available for an announcement in a given state. */
export const actionsFor = (status) => ({
  edit: status !== 'withdrawn',
  publish: status === 'draft',
  withdraw: status !== 'withdrawn',
});

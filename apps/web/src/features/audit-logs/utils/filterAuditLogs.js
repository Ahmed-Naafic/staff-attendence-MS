// Client-side search, filters and pagination for the demo audit log.
// When the API arrives these become query parameters; the page keeps the same filter shape.
import { actionOf, auditRoles } from './auditTypes.js';

export const PAGE_SIZES = [10, 25, 50];
export const DEFAULT_PAGE_SIZE = PAGE_SIZES[0];

const DAY = 24 * 60 * 60 * 1000;

export const dateRanges = [
  { value: '', label: 'Any date' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days', days: 7 },
  { value: '30d', label: 'Last 30 days', days: 30 },
  { value: '90d', label: 'Last 90 days', days: 90 },
  { value: 'custom', label: 'Custom range…' },
];

const startOfDay = (ms) => {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

// 'YYYY-MM-DD' (date input value) → local midnight, or null.
const parseDay = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime() : null;
};

/**
 * The time window for the date filter, in local time: { since, until } (ms, either may be null).
 * A custom range includes both whole days. `invalid` when the start date is after the end date.
 */
export function dateBounds({ date, from, to }, now = Date.now()) {
  if (date === 'today') return { since: startOfDay(now), until: null };
  const preset = dateRanges.find((r) => r.value === date && r.days);
  if (preset) return { since: now - preset.days * DAY, until: null };
  if (date === 'custom') {
    const since = parseDay(from);
    const end = parseDay(to);
    if (since !== null && end !== null && since > end) return { since: null, until: null, invalid: true };
    return { since, until: end === null ? null : end + DAY };
  }
  return { since: null, until: null };
}

const normalise = (text) => (text ?? '').toLocaleLowerCase().trim();

/** Fields the search box looks in: action, user, role, target, school and description. */
const searchText = (event) =>
  normalise(
    [
      actionOf(event.action).label,
      event.actor.name,
      auditRoles[event.actor.role]?.label,
      event.target.name,
      event.school?.name,
      event.description,
    ].join(' '),
  );

/** Applies search, action, user, school, result and date filters (all combined). */
export function filterAuditLogs(events, filters, now = Date.now()) {
  const needle = normalise(filters.query);
  const { since, until } = dateBounds(filters, now);

  return events.filter((event) => {
    const at = new Date(event.occurredAt).getTime();
    return (
      (!needle || searchText(event).includes(needle)) &&
      (!filters.action || event.action === filters.action) &&
      (!filters.user || event.actor.id === filters.user) &&
      (!filters.school || event.school?.id === filters.school) &&
      (!filters.status || event.result === filters.status) &&
      (since === null || at >= since) &&
      (until === null || at < until)
    );
  });
}

/** Returns the rows for `page`, with the page clamped to the available range. */
export function paginate(items, page, pageSize = DEFAULT_PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * pageSize;
  return { rows: items.slice(start, start + pageSize), page: current, pageCount, offset: start };
}

/** Distinct users who appear in the log, alphabetical, for the user filter. */
export function usersOf(events) {
  const users = new Map(events.map((e) => [e.actor.id, e.actor]));
  return [...users.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Distinct schools the events belong to, alphabetical, for the school filter. */
export function schoolsOf(events) {
  const schools = new Map(events.filter((e) => e.school).map((e) => [e.school.id, e.school]));
  return [...schools.values()].sort((a, b) => a.name.localeCompare(b.name));
}

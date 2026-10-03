// Filter choices, page sizes and date-range logic for the audit log. Search, filters and
// pagination run on the server (GET /api/platform/audit-logs); dates are worked out here, in
// the viewer's local time, and sent as exact instants.

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

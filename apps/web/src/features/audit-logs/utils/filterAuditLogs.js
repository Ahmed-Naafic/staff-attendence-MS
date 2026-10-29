// Filter choices, page sizes and date-range logic for the audit log. Search, filters and
// pagination run on the server (GET /api/platform/audit-logs); dates are worked out here, in
// the platform time zone (Platform Settings → General, as audit times are shown), and sent as
// exact instants.
import { platformDayStart, platformMidnight } from '../../../lib/format.js';

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

// 'YYYY-MM-DD' (date input value) → midnight in the platform time zone, or null.
const parseDay = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  return match ? platformMidnight(Number(match[1]), Number(match[2]), Number(match[3])) : null;
};
const nextDay = (value) => {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return platformMidnight(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
};

/**
 * The time window for the date filter, in the platform time zone: { since, until } (ms, either may be null).
 * A custom range includes both whole days. `invalid` when the start date is after the end date.
 */
export function dateBounds({ date, from, to }, now = Date.now()) {
  if (date === 'today') return { since: platformDayStart(now), until: null };
  const preset = dateRanges.find((r) => r.value === date && r.days);
  if (preset) return { since: now - preset.days * DAY, until: null };
  if (date === 'custom') {
    const since = parseDay(from);
    const end = parseDay(to);
    if (since !== null && end !== null && since > end) return { since: null, until: null, invalid: true };
    // Through the end of the last day (not always 24 hours later, e.g. across a daylight-saving change).
    return { since, until: end === null ? null : nextDay(to) };
  }
  return { since: null, until: null };
}

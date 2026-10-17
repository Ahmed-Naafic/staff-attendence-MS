// Approved Platform Reports filters (see docs/business-rules.md). The API validates them again.

/** Trend periods: days for 7 / 30 days, calendar months for 3 / 6 / 12 months. */
export const periods = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '3m', label: 'Last 3 months' },
  { value: '6m', label: 'Last 6 months' },
  { value: '12m', label: 'Last 12 months' },
];

export const DEFAULT_PERIOD = '12m';

/** School statuses (ACTIVE and SUSPENDED only). */
export const schoolStatusOptions = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

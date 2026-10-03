// Filter choices and page size for the School Owners page. Search, filters and pagination run
// on the server (GET /api/platform/owners); these values become its query parameters.

export const PAGE_SIZE = 8;

export const registeredRanges = [
  { value: '', label: 'Any registration date' },
  { value: '7d', label: 'Registered in the last 7 days' },
  { value: '30d', label: 'Registered in the last 30 days' },
  { value: '90d', label: 'Registered in the last 90 days' },
  { value: '12m', label: 'Registered in the last 12 months' },
];

// Client-side search, filters and pagination for the demo list.
// When the API arrives these become query parameters; the page keeps the same filter shape.

export const PAGE_SIZE = 8;

export const registeredRanges = [
  { value: '', label: 'Any registration date' },
  { value: '7d', label: 'Registered in the last 7 days', days: 7 },
  { value: '30d', label: 'Registered in the last 30 days', days: 30 },
  { value: '90d', label: 'Registered in the last 90 days', days: 90 },
  { value: '12m', label: 'Registered in the last 12 months', days: 365 },
];

const normalise = (text) => text.toLocaleLowerCase().trim();

/** Applies search (name, owner, location), status, location and registration-date filters. */
export function filterSchools(schools, { query, status, location, registered }, now = Date.now()) {
  const needle = normalise(query ?? '');
  const range = registeredRanges.find((r) => r.value === registered && r.days);
  const since = range ? now - range.days * 24 * 60 * 60 * 1000 : null;

  return schools.filter(
    (school) =>
      (!needle || [school.name, school.ownerName, school.location].some((field) => normalise(field).includes(needle))) &&
      (!status || school.status === status) &&
      (!location || school.location === location) &&
      (since === null || new Date(school.registeredAt).getTime() >= since),
  );
}

/** Returns the rows for `page`, with the page clamped to the available range. */
export function paginate(items, page, pageSize = PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * pageSize;
  return { rows: items.slice(start, start + pageSize), page: current, pageCount, offset: start };
}

/** Distinct locations, alphabetical, for the location filter. */
export const locationsOf = (schools) => [...new Set(schools.map((s) => s.location))].sort((a, b) => a.localeCompare(b));

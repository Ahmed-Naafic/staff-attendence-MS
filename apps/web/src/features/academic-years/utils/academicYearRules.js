// Academic year rules in the web app (immediate feedback; the API checks again).
// Rules: docs/business-rules.md → Academic years.

export const NAME_MAX = 40;
export const MAX_DAYS = 731;
const DAY_MS = 24 * 60 * 60 * 1000;

const dayMs = (yearMonthDay) => Date.UTC(...yearMonthDay.split('-').map((n, i) => Number(n) - (i === 1 ? 1 : 0)));
const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

/** Days from start to end, both inclusive. */
export const daysBetween = (startDate, endDate) => Math.round((dayMs(endDate) - dayMs(startDate)) / DAY_MS) + 1;

export const cleanName = (name) => (name ?? '').trim().replace(/\s+/g, ' ');

/** { field: message } for every problem; empty when valid. */
export function validateAcademicYear({ name, startDate, endDate }) {
  const problems = {};
  const cleaned = cleanName(name);
  if (!cleaned) problems.name = 'Name is required, e.g. 2026/2027.';
  else if (cleaned.length > NAME_MAX) problems.name = `Name must be at most ${NAME_MAX} characters.`;
  if (!isDay(startDate)) problems.startDate = 'Choose the start date.';
  if (!isDay(endDate)) problems.endDate = 'Choose the end date.';
  if (!problems.startDate && !problems.endDate) {
    if (endDate <= startDate) problems.endDate = 'End date must be after the start date.';
    else if (daysBetween(startDate, endDate) > MAX_DAYS) problems.endDate = `An academic year can last at most ${MAX_DAYS} days.`;
  }
  return problems;
}

/** A name from the dates' years: '2026/2027', or '2026' when both are in one year. */
export function suggestName(startDate, endDate) {
  if (!isDay(startDate) || !isDay(endDate)) return '';
  const [from, to] = [startDate.slice(0, 4), endDate.slice(0, 4)];
  return from === to ? from : `${from}/${to}`;
}

/** Today's date on this device, 'YYYY-MM-DD'. */
export function today(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Where `day` falls in the year: { phase: 'upcoming' | 'running' | 'ended', percent, daysLeft, total }. */
export function yearProgress(year, day = today()) {
  const total = daysBetween(year.startDate, year.endDate);
  if (day < year.startDate) return { phase: 'upcoming', percent: 0, daysLeft: total, total, startsIn: daysBetween(day, year.startDate) - 1 };
  if (day > year.endDate) return { phase: 'ended', percent: 100, daysLeft: 0, total };
  const elapsed = daysBetween(year.startDate, day);
  return { phase: 'running', percent: Math.round((elapsed / total) * 100), daysLeft: total - elapsed, total };
}

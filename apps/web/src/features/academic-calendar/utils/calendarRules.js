// Academic calendar rules in the web app (immediate feedback and which actions to offer; the API
// checks everything again). Rules: docs/business-rules.md → Academic calendar.

export const ENTRY_NAME_MIN = 2;
export const ENTRY_NAME_MAX = 80;
export const NOTE_MAX = 300;

/** Weekdays in the order the week is shown (Saturday first, as Somali schools count the week). */
export const WEEK = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'];
export const WEEKDAY_NAMES = { MON: 'Monday', TUE: 'Tuesday', WED: 'Wednesday', THU: 'Thursday', FRI: 'Friday', SAT: 'Saturday', SUN: 'Sunday' };
export const WEEKDAY_SHORT = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };

export const ENTRY_TYPES = {
  holiday: { label: 'School holiday', tone: 'info' },
  closure: { label: 'Branch closure', tone: 'warning' },
  reopening: { label: 'Branch reopening', tone: 'success' },
  school_day: { label: 'Extra school day', tone: 'success' },
};

/** Why a day has no school (schoolDays.js reasons). */
export const DAY_REASONS = {
  no_academic_year: 'Outside the academic year',
  no_school_days: 'School days not set',
  not_a_school_day: 'Not a school day',
  holiday: 'School holiday',
  closure: 'Branch closed',
};

export const clean = (value) => (value ?? '').trim().replace(/\s+/g, ' ');

/** 'YYYY-MM-DD' ± n days. */
export const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** School days in display order, e.g. ['SAT', 'SUN', 'MON'] → 'Sat, Sun, Mon'. */
export function daysText(days) {
  if (!days?.length) return 'None';
  return WEEK.filter((d) => days.includes(d))
    .map((d) => WEEKDAY_SHORT[d])
    .join(', ');
}

/** { field: message } for a school days form ({ days: [], effectiveFrom } as chosen). */
export function validateWeekdays({ days, effectiveFrom, followsSchool }, { earliest, yearStart, yearEnd }) {
  const problems = {};
  if (!followsSchool && !days?.length) problems.days = 'Choose at least one school day.';
  if (!effectiveFrom) problems.effectiveFrom = 'Choose the date the days apply from.';
  else if (effectiveFrom < earliest) problems.effectiveFrom = `Choose ${earliest} or a later date.`;
  else if (effectiveFrom < yearStart || effectiveFrom > yearEnd) problems.effectiveFrom = `Choose a date within the year (${yearStart} to ${yearEnd}).`;
  return problems;
}

/**
 * The earliest date new school days can apply from: tomorrow when days already apply today (at this
 * level), else today; never before the year starts.
 */
export function earliestWeekdaysDate({ today, yearStart, appliesToday }) {
  const earliest = appliesToday ? addDays(today, 1) : today;
  return earliest < yearStart ? yearStart : earliest;
}

/** { field: message } for an entry form (values as typed). */
export function validateEntry({ type, name, note, startDate, endDate, branch, holiday, timetableDay }, { creating, needsBranch, firstEditable, yearStart, yearEnd, holidayRange }) {
  const problems = {};
  const n = clean(name);
  if (type !== 'reopening' || n) {
    if (n.length < ENTRY_NAME_MIN) problems.name = 'Name is required, e.g. Eid al-Fitr.';
    else if (n.length > ENTRY_NAME_MAX) problems.name = `Name must be at most ${ENTRY_NAME_MAX} characters.`;
  }
  if ((note ?? '').trim().length > NOTE_MAX) problems.note = `Note must be at most ${NOTE_MAX} characters.`;
  if (creating && needsBranch && (type === 'closure' || type === 'reopening') && !branch) problems.branch = 'Choose a branch.';
  if (creating && type === 'reopening' && !holiday) problems.holiday = 'Choose the holiday to reopen.';
  if (type === 'school_day' && !WEEK.includes(timetableDay)) problems.timetableDay = 'Choose the weekday whose timetable the day follows.';
  if (!startDate) problems.startDate = 'Choose the first day.';
  if (!endDate) problems.endDate = 'Choose the last day.';
  if (startDate && endDate) {
    if (endDate < startDate) problems.endDate = 'The last day cannot be before the first day.';
    else if (startDate < yearStart || endDate > yearEnd) problems[startDate < yearStart ? 'startDate' : 'endDate'] = `Choose dates within the year (${yearStart} to ${yearEnd}).`;
    else if (creating && startDate < firstEditable) problems.startDate = `Days before ${firstEditable} are fixed. Choose ${firstEditable} or later.`;
    else if (holidayRange && (startDate < holidayRange.start || endDate > holidayRange.end)) {
      problems[startDate < holidayRange.start ? 'startDate' : 'endDate'] = `A reopening lies within its holiday (${holidayRange.start} to ${holidayRange.end}).`;
    }
  }
  return problems;
}

/**
 * What can be done with an entry, given the first editable day: past days are fixed.
 *   edit         active and not entirely in the past (names can always be fixed: `rename`)
 *   startLocked  the first day is fixed (it has passed)
 *   cancel       'cancel' (not started), 'end' (running: ends the day before), or null
 */
export function entryActions(entry, firstEditable, { canManage }) {
  if (!canManage || entry.status !== 'active') return { edit: false, rename: false, startLocked: true, cancel: null };
  const past = entry.endDate < firstEditable;
  return {
    edit: !past,
    rename: true,
    startLocked: entry.startDate < firstEditable,
    cancel: past ? null : entry.startDate >= firstEditable ? 'cancel' : 'end',
  };
}

/** Whether the signed-in user can manage an entry: Owners any; Managers their branch's own entries (not school-wide ones). */
export const canManageEntry = (entry, role) => role === 'OWNER' || Boolean(entry.branch);

/** 'YYYY-MM' → weeks of 'YYYY-MM-DD' (null outside the month), weeks starting on Saturday. */
export function monthWeeks(yearMonth) {
  const [y, m] = yearMonth.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // getUTCDay: 0 Sun … 6 Sat → offset from Saturday.
  const lead = (first.getUTCDay() + 1) % 7;
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => `${yearMonth}-${String(i + 1).padStart(2, '0')}`)];
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** 'YYYY-MM' ± n months. */
export function shiftMonth(yearMonth, n) {
  const [y, m] = yearMonth.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + n, 1));
  return date.toISOString().slice(0, 7);
}

/** The last day of 'YYYY-MM'. */
export const monthEnd = (yearMonth) => {
  const [y, m] = yearMonth.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

// Examination rules in the web app (immediate feedback; the API checks everything again and has the
// final say). Mirrors backend/src/features/examinations/examInput.js.

/** The steps of an examination, as the overview shows them. */
export const EXAM_PROGRESS = ['Setup', 'Timetable', 'Marks Entry', 'Approval', 'Publication'];

/** Settings groups, in the order the Settings page shows them. */
export const SETTING_GROUPS = [
  { key: 'grading', label: 'Grading & Marks' },
  { key: 'policies', label: 'Policies' },
  { key: 'timetable', label: 'Timetable Generation' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'reportCard', label: 'Report Card' },
  { key: 'analytics', label: 'Analytics' },
];

const pct = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) && n >= 0 && n <= 100 && Math.abs(Math.round(n * 100) - n * 100) < 1e-6 ? Math.round(n * 100) / 100 : null;
};

/** A new band row for the scale editor (form values are strings). */
export const emptyBand = () => ({ label: '', minPercent: '', maxPercent: '', points: '', passes: true, remark: '' });

/** The usual A–F letter scale, to start from. */
export const LETTER_SCALE = [
  { label: 'A', minPercent: '80', maxPercent: '100', points: '4', passes: true },
  { label: 'B', minPercent: '70', maxPercent: '79', points: '3', passes: true },
  { label: 'C', minPercent: '60', maxPercent: '69', points: '2', passes: true },
  { label: 'D', minPercent: '50', maxPercent: '59', points: '1', passes: true },
  { label: 'F', minPercent: '0', maxPercent: '49', points: '0', passes: false },
];

/**
 * Bands of a grading scale (rows as typed) → { bands } ready to send, or { error, details } with the
 * same rules as the API: 2–20 grades, labels 1–10 characters and unique, 0–100 with two decimals at
 * most, covering 0–100 once (each band ends at most 1 below the next starts, never overlapping),
 * failing grades below passing ones.
 */
export function checkBands(rows) {
  const details = {};
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 20) return { error: 'A scale has 2 to 20 grades.' };
  const bands = rows.map((b, i) => {
    const label = String(b.label ?? '').trim();
    if (!label || label.length > 10) details[`bands.${i}.label`] = 'Grade: 1–10 characters.';
    const minPercent = pct(b.minPercent);
    const maxPercent = pct(b.maxPercent);
    if (minPercent === null) details[`bands.${i}.minPercent`] = 'From: 0–100.';
    if (maxPercent === null) details[`bands.${i}.maxPercent`] = 'To: 0–100.';
    if (minPercent !== null && maxPercent !== null && minPercent > maxPercent) details[`bands.${i}.maxPercent`] = 'To is below From.';
    const points = b.points === '' || b.points === null || b.points === undefined ? null : pct(b.points);
    if (b.points !== '' && b.points !== null && b.points !== undefined && points === null) details[`bands.${i}.points`] = 'Points: 0–100.';
    const remark = String(b.remark ?? '').trim().slice(0, 60) || null;
    return { index: i, label, minPercent, maxPercent, points, passes: Boolean(b.passes), remark };
  });
  if (Object.keys(details).length) return { error: 'Check the grades.', details };
  const labels = new Set();
  for (const b of bands) {
    if (labels.has(b.label.toLowerCase())) details[`bands.${b.index}.label`] = 'Each grade appears once.';
    labels.add(b.label.toLowerCase());
  }
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  if (sorted[0].maxPercent !== 100) details[`bands.${sorted[0].index}.maxPercent`] = 'The top grade goes up to 100.';
  if (sorted.at(-1).minPercent !== 0) details[`bands.${sorted.at(-1).index}.minPercent`] = 'The lowest grade starts at 0.';
  for (let i = 1; i < sorted.length; i += 1) {
    const upper = sorted[i - 1];
    const lower = sorted[i];
    if (lower.maxPercent >= upper.minPercent) details[`bands.${lower.index}.maxPercent`] = `Overlaps ${upper.label}.`;
    else if (upper.minPercent - lower.maxPercent > 1) details[`bands.${lower.index}.maxPercent`] = `Gap below ${upper.label}.`;
  }
  if (Object.keys(details).length) return { error: 'The grades must cover 0–100 once, without gaps or overlaps.', details };
  if (!sorted.some((b) => b.passes)) return { error: 'At least one grade passes.' };
  const lowestPass = Math.min(...sorted.filter((b) => b.passes).map((b) => b.minPercent));
  if (sorted.some((b) => !b.passes && b.minPercent > lowestPass)) return { error: 'Failing grades must all be below the passing ones.' };
  return { bands: sorted.map(({ index, ...b }) => b) };
}

/** Weights (rows { id, weight } as typed) → { weights, total } or { error }; whole percentages adding up to 100. */
export function checkWeights(rows, key) {
  const weights = [];
  for (const r of rows) {
    if (r.weight === '' || r.weight === undefined || r.weight === null) continue;
    const n = Number(r.weight);
    if (!Number.isInteger(n) || n < 0 || n > 100) return { error: 'Each weight is a whole percentage (0–100).' };
    if (n > 0) weights.push({ [key]: r.id, weight: n });
  }
  const total = weights.reduce((sum, w) => sum + w.weight, 0);
  if (weights.length && total !== 100) return { error: `The weights add up to ${total}%; they must add up to 100%.`, total };
  return { weights, total };
}

/** "80–100" for a band. */
export const bandRange = (b) => `${b.minPercent}–${b.maxPercent}`;

/** A room's status label and badge tone. */
export const STATUS_BADGE = { active: { label: 'Active', variant: 'success' }, inactive: { label: 'Inactive', variant: 'neutral' } };

// ---- examinations ------------------------------------------------------------------------------

/** How each state is shown (the API decides the state from the status and today). */
export const EXAM_STATES = {
  draft: { label: 'Draft', variant: 'neutral' },
  planned: { label: 'Planned', variant: 'info' },
  active: { label: 'Active', variant: 'success' },
  completed: { label: 'Completed', variant: 'accent' },
  cancelled: { label: 'Cancelled', variant: 'error' },
};
export const EXAM_STATE_OPTIONS = [{ value: 'all', label: 'All statuses' }, ...Object.entries(EXAM_STATES).map(([value, s]) => ({ value, label: s.label }))];
export const EXAM_SCOPE_OPTIONS = [
  { value: 'all', label: 'All scopes' },
  { value: 'school', label: 'School-wide' },
  { value: 'branch', label: 'Branch' },
];
export const EXAM_NAME_MAX = 80;

/** The name the API gives when none is typed: "Mid-Term – Term 1", or the type's name. */
export const examDefaultName = (type, period) => (type ? (period ? `${type.name} – ${period.name}` : type.name) : '');

/** "School-wide" or the branch's name. */
export const examScopeText = (exam) => (exam.level === 'school' ? 'School-wide' : (exam.branch?.name ?? 'Branch'));

/** 'YYYY-MM-DD' ± n days. */
const shift = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * { field: message } for the examination form, as the API checks it. `locked`: fields fixed because
 * the examination has started (from its `actions`). `context`: { year, period, today, creating }.
 */
export function validateExamination(values, { year, period, today, locked = [], creating }) {
  const problems = {};
  const name = (values.name ?? '').trim().replace(/\s+/g, ' ');
  if (name && (name.length < 2 || name.length > EXAM_NAME_MAX)) problems.name = `Name: 2–${EXAM_NAME_MAX} characters.`;
  if (!creating && !name) problems.name = 'Name is required.';
  if (!values.examType) problems.examType = 'Choose the examination type.';
  if ((values.description ?? '').trim().length > 300) problems.description = 'At most 300 characters.';
  const { startDate, endDate } = values;
  if (!startDate) problems.startDate = 'Choose the first day.';
  if (!endDate) problems.endDate = 'Choose the last day.';
  if (startDate && endDate) {
    if (endDate < startDate) problems.endDate = 'The last day is before the first day.';
    else if (year && (startDate < year.startDate || endDate > year.endDate)) problems[startDate < year.startDate ? 'startDate' : 'endDate'] = `Inside ${year.name}: ${year.startDate} to ${year.endDate}.`;
    else if (period && (startDate < period.startDate || endDate > period.endDate)) problems[startDate < period.startDate ? 'startDate' : 'endDate'] = `Inside ${period.name}: ${period.startDate} to ${period.endDate}.`;
    else if (!locked.includes('startDate') && startDate < today) problems.startDate = `Days before today are fixed. Choose ${today} or later.`;
    else if (locked.includes('startDate') && !locked.includes('endDate') && endDate < shift(today, -1)) problems.endDate = `Days before today are fixed. Choose ${shift(today, -1)} or later.`;
  }
  return problems;
}

/** Papers of a class as a short text: "Mathematics, English (2 papers)". */
export const papersText = (papers) => (papers.length ? `${papers.map((p) => p.subject.name).join(', ')} (${papers.length} paper${papers.length === 1 ? '' : 's'})` : 'No papers');

/** What still stops a draft from being scheduled, from its detail: [message]. */
export function scheduleProblems(detail, today) {
  const problems = [];
  const exam = detail.examination;
  if (!detail.classes.length) problems.push('Choose the classes sitting it.');
  for (const c of detail.classes) if (!c.papers.length) problems.push(`Add papers for ${c.name}.`);
  if (exam.startDate < today) problems.push(`Its first day (${exam.startDate}) has passed: move its dates.`);
  return problems;
}

// ---- timetable ----------------------------------------------------------------------------------

export const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutes = (t) => (HHMM.test(t ?? '') ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null);

/** { field: message } for the generate form, as the API checks it. */
export function validateGenerate({ shifts, gapMinutes, rooms }) {
  const problems = {};
  if (!shifts.length || shifts.length > 4) problems.shifts = 'Give 1–4 shifts.';
  else if (shifts.some((s) => !String(s.name ?? '').trim() || String(s.name).trim().length > 30)) problems.shifts = 'Each shift needs a name (at most 30 characters).';
  else if (shifts.some((s) => minutes(s.start) === null)) problems.shifts = 'Each shift needs a start time like 08:00.';
  else if (shifts.some((s) => !Number.isInteger(Number(s.sessions)) || s.sessions < 1 || s.sessions > 4)) problems.shifts = 'Each shift holds 1–4 sessions.';
  else if (shifts.some((s, i) => i && minutes(s.start) <= minutes(shifts[i - 1].start))) problems.shifts = 'List the shifts in order of their start times.';
  else if (new Set(shifts.map((s) => s.name.trim().toLowerCase())).size !== shifts.length) problems.shifts = 'Give each shift its own name.';
  const gap = Number(gapMinutes);
  if (String(gapMinutes).trim() === '' || !Number.isInteger(gap) || gap < 0 || gap > 180) problems.gapMinutes = 'A whole number of minutes from 0 to 180.';
  if (!rooms.length) problems.rooms = 'Choose the rooms to use.';
  else if (rooms.some((r) => r.capacity !== '' && r.capacity !== null && (!Number.isInteger(Number(r.capacity)) || r.capacity < 1 || r.capacity > 500))) problems.rooms = 'Seats: a whole number from 1 to 500.';
  return problems;
}

/** "Grade 7A ×6, Grade 8A ×4" */
export const sectionsText = (sections) => sections.map((s) => `${s.name} ×${s.count}`).join(', ');

/** Why a paper could not be timetabled (report of a generation). */
export const UNPLACED_REASONS = {
  no_students: 'no students in this branch',
  too_many_students: 'more students than the rooms seat',
  no_session: 'no session left (days, sessions per shift or papers a day)',
};

// ---- attendance and marks -----------------------------------------------------------------------

export const ATTENDANCE_OPTIONS = [
  { value: '', label: 'Not taken' },
  { value: 'present', label: 'Present' },
  { value: 'absent', label: 'Absent' },
  { value: 'late', label: 'Late' },
  { value: 'excused', label: 'Excused' },
];
export const SHEET_STATES = {
  draft: { label: 'Draft', variant: 'neutral' },
  submitted: { label: 'Submitted', variant: 'info' },
  approved: { label: 'Approved', variant: 'success' },
  returned: { label: 'Returned', variant: 'warning' },
};

/** A typed mark: null when empty; else a number 0–max with two decimals at most, or an error message. */
export function parseMark(text, max) {
  const t = String(text ?? '').trim();
  if (!t) return { value: null };
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return { error: 'A number from 0.' };
  if (n > max) return { error: `At most ${max}.` };
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return { error: 'Two decimals at most.' };
  return { value: n };
}

export const RESULT_STATES = {
  draft: { label: 'Pending', variant: 'warning' },
  approved: { label: 'Approved', variant: 'info' },
  published: { label: 'Published', variant: 'success' },
};
/** "76.3" or "—". */
export const pctText = (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(1));

// ---- timetable views ----
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** "Saturday" for "2026-11-28" (calendar date, no time zone shift). */
export const weekdayOf = (date) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
const byTime = (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start);

/**
 * The session a Room Allocation view shows: the chosen one (`choice.id`), else the first of the chosen
 * date (default: today or the next examination day, else the first) and shift (default: its first).
 */
export function pickSession(sessions, choice = {}, today = '') {
  const sorted = [...sessions].sort(byTime);
  if (!sorted.length) return null;
  if (choice.id) return sorted.find((s) => s.id === choice.id) ?? sorted[0];
  const date = choice.date && sorted.some((s) => s.date === choice.date) ? choice.date : (sorted.find((s) => s.date >= today) ?? sorted[0]).date;
  const ofDate = sorted.filter((s) => s.date === date);
  const shift = choice.shift && ofDate.some((s) => s.shiftName === choice.shift) ? choice.shift : ofDate[0].shiftName;
  return ofDate.find((s) => s.shiftName === shift);
}

/** The selectors around a session: dates (with weekday), shifts of its date, sessions of its date and shift. */
export function sessionChoices(sessions, session) {
  const sorted = [...sessions].sort(byTime);
  const dates = [...new Set(sorted.map((s) => s.date))].map((date) => ({ date, label: `${weekdayOf(date)} ${date}` }));
  if (!session) return { dates, shifts: [], list: [], session: null };
  const ofDate = sorted.filter((s) => s.date === session.date);
  return { dates, shifts: [...new Set(ofDate.map((s) => s.shiftName))], list: ofDate.filter((s) => s.shiftName === session.shiftName), session };
}

// ---- timetable tab: filters, date groups, paper groups ----
export const EMPTY_TIMETABLE_FILTERS = { from: '', to: '', shift: '', grade: '', subject: '', q: '' };

/** The choices of the timetable filters, from the sessions themselves (never a fixed list). */
export function timetableFilterOptions(sessions) {
  const shifts = [...new Set(sessions.map((s) => s.shiftName))].sort((a, b) => a.localeCompare(b));
  const grades = new Map();
  const subjects = new Map();
  for (const s of sessions) {
    for (const p of s.papers) {
      grades.set(p.class.id, p.class);
      subjects.set(p.subject.id, p.subject);
    }
  }
  return {
    shifts,
    grades: [...grades.values()].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0) || a.name.localeCompare(b.name)),
    subjects: [...subjects.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

const paperMatches = (p, f, q) =>
  (!f.grade || p.class.id === f.grade) &&
  (!f.subject || p.subject.id === f.subject) &&
  (!q || `${p.subject.name} ${p.subject.code ?? ''} ${p.class.name}`.toLowerCase().includes(q));

/**
 * The sessions the filters keep (dates inclusive, all filters combined), each with `shown`: its papers
 * that match the grade / subject / search filters (all of them when none is set).
 */
export function filterTimetableSessions(sessions, f = EMPTY_TIMETABLE_FILTERS) {
  const q = (f.q ?? '').trim().toLowerCase();
  return [...sessions]
    .sort(byTime)
    .filter((s) => (!f.from || s.date >= f.from) && (!f.to || s.date <= f.to) && (!f.shift || s.shiftName === f.shift))
    .map((s) => ({ ...s, shown: s.papers.filter((p) => paperMatches(p, f, q)) }))
    .filter((s) => s.shown.length);
}

/** How many filters are set (the search counts as one). */
export const activeFilterCount = (f) => Object.values(f).filter((v) => String(v ?? '').trim()).length;

/** Sessions → [{ date, weekday, sessions }] in date and time order. */
export function groupSessionsByDate(sessions) {
  const groups = [];
  for (const s of [...sessions].sort(byTime)) {
    if (groups.at(-1)?.date !== s.date) groups.push({ date: s.date, weekday: weekdayOf(s.date), sessions: [] });
    groups.at(-1).sessions.push(s);
  }
  return groups;
}

/** Papers → [{ subject, classes }]: one entry per subject with its grades in class order. */
export function groupPapersBySubject(papers) {
  const bySubject = new Map();
  for (const p of papers) {
    const g = bySubject.get(p.subject.id) ?? { subject: p.subject, classes: [] };
    g.classes.push(p.class);
    bySubject.set(p.subject.id, g);
  }
  return [...bySubject.values()].map((g) => ({ ...g, classes: g.classes.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0)) }));
}

/** A session's state on `today`: done (before today), today or upcoming. */
export const sessionState = (s, today) => (s.date < today ? 'done' : s.date === today ? 'today' : 'upcoming');
export const SESSION_STATES = {
  done: { label: 'Done', variant: 'neutral' },
  today: { label: 'Today', variant: 'warning' },
  upcoming: { label: 'Upcoming', variant: 'info' },
};

/** "Monday, 23 November 2026" for "2026-11-23" (calendar date, no time zone shift). */
export const longDate = (date) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

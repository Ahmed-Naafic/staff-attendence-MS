// Client-side checks for branch schedules, mirroring the API (backend/src/features/schedules/
// scheduleInput.js) so problems show immediately. The API checks again and has the final say,
// including the effective date against the server's clock.

/** The school week, Saturday to Friday (the order days are shown and listed in). */
export const WEEKDAYS = [
  { value: 'SAT', label: 'Sat' },
  { value: 'SUN', label: 'Sun' },
  { value: 'MON', label: 'Mon' },
  { value: 'TUE', label: 'Tue' },
  { value: 'WED', label: 'Wed' },
  { value: 'THU', label: 'Thu' },
  { value: 'FRI', label: 'Fri' },
];
const ORDER = WEEKDAYS.map((d) => d.value);
export const MAX_SHIFTS = 20;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const CONTROL = /\p{Cc}/u;

export const toMinutes = (value) => {
  const match = TIME.exec(value ?? '');
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};
export const dayList = (days) => ORDER.filter((d) => days.includes(d)).map((d) => WEEKDAYS.find((w) => w.value === d).label).join(', ');

/**
 * The shifts a schedule chooses from, with their default times (changeable for each schedule). One
 * place to change or add them. Shifts saved earlier under another name keep it until it is changed.
 */
export const SHIFT_TEMPLATES = [
  { name: 'Morning-Shift', start: '07:00', end: '12:20' },
  { name: 'Afternoon-Shift', start: '13:00', end: '17:00' },
  { name: 'Night-Shift', start: '18:40', end: '21:00' },
];
const TEMPLATE_NAMES = SHIFT_TEMPLATES.map((t) => t.name);

/** Defaults of a new shift: late after 30 minutes, absent after 1 hour (changeable for each shift). */
export const SHIFT_DEFAULTS = { graceMinutes: 30, absenceCutoffMinutes: 60 };

/** An empty shift row for the editor (form values are strings). */
export const emptyShift = () => ({ name: '', days: [], start: '', end: '', graceMinutes: String(SHIFT_DEFAULTS.graceMinutes), absenceCutoffMinutes: String(SHIFT_DEFAULTS.absenceCutoffMinutes) });

/** A shift row named after a template, with its default times (other values kept). */
export function applyShiftTemplate(row, name) {
  const t = SHIFT_TEMPLATES.find((x) => x.name === name);
  return t ? { ...row, name: t.name, start: t.start, end: t.end } : { ...row, name };
}

/** The next shift to add: the first template not used yet in `rows`, or null when all are used. */
export function nextShift(rows) {
  const used = new Set(rows.map((r) => r.name));
  const t = SHIFT_TEMPLATES.find((x) => !used.has(x.name));
  return t ? applyShiftTemplate(emptyShift(), t.name) : null;
}

/** The names a row can have: the templates, plus its saved name when that is not one of them. */
export const shiftNameOptions = (row) => [...TEMPLATE_NAMES, ...(row.savedName && !TEMPLATE_NAMES.includes(row.savedName) ? [row.savedName] : [])];

/** A saved shift → editor row (its key keeps the shift's identity, so staff assignments follow it). */
export const toRow = (s) => ({ key: s.key, name: s.name, savedName: s.name, days: [...s.days], start: s.start, end: s.end, graceMinutes: String(s.graceMinutes), absenceCutoffMinutes: String(s.absenceCutoffMinutes) });

const wholeMinutes = (value) => (/^\d+$/.test(String(value).trim()) ? Number(value) : null);

/** Editor rows → the request's shifts (names trimmed, days in week order, minutes as numbers; kept shifts with their key). */
export const toRequestShifts = (rows) =>
  rows.map((r) => ({
    ...(r.key && { key: r.key }),
    name: r.name.trim().replace(/\s+/g, ' '),
    days: ORDER.filter((d) => r.days.includes(d)),
    start: r.start,
    end: r.end,
    graceMinutes: wholeMinutes(r.graceMinutes) ?? r.graceMinutes,
    absenceCutoffMinutes: wholeMinutes(r.absenceCutoffMinutes) ?? r.absenceCutoffMinutes,
  }));

/**
 * Problems for a schedule change: { effectiveFrom?, shifts?, 'shifts.<i>.<field>'? }. `earliest` and
 * `latest` are the allowed effective dates from the server ('YYYY-MM-DD').
 */
export function validateSchedule({ effectiveFrom, rows }, { earliest, latest }) {
  const errors = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom ?? '')) errors.effectiveFrom = 'Choose the date the schedule takes effect.';
  else if (effectiveFrom < earliest) errors.effectiveFrom = `Choose ${earliest} or later.`;
  else if (effectiveFrom > latest) errors.effectiveFrom = `Choose ${latest} or earlier (at most one year ahead).`;
  if (!rows.length) errors.shifts = 'Add at least one shift.';
  if (rows.length > MAX_SHIFTS) errors.shifts = `A schedule can have at most ${MAX_SHIFTS} shifts.`;

  const shifts = toRequestShifts(rows);
  const names = new Map();
  shifts.forEach((s, i) => {
    const key = (field) => `shifts.${i}.${field}`;
    if (!s.name) errors[key('name')] = 'Choose the shift.';
    else if (!shiftNameOptions(rows[i]).includes(s.name)) errors[key('name')] = `Choose ${TEMPLATE_NAMES.slice(0, -1).join(', ')} or ${TEMPLATE_NAMES.at(-1)}.`;
    else if (s.name.length > 60) errors[key('name')] = 'The shift name must be at most 60 characters.';
    else if (CONTROL.test(s.name)) errors[key('name')] = 'The shift name cannot contain control characters.';
    else {
      const k = s.name.normalize('NFKC').toUpperCase().toLowerCase();
      if (names.has(k)) errors[key('name')] = `Another shift is already called "${names.get(k)}".`;
      else names.set(k, s.name);
    }
    if (!s.days.length) errors[key('days')] = 'Choose at least one working day.';
    const start = toMinutes(s.start);
    const end = toMinutes(s.end);
    if (start === null) errors[key('start')] = 'Enter the start time.';
    if (end === null) errors[key('end')] = 'Enter the end time.';
    else if (start !== null && end <= start) errors[key('end')] = 'The shift must end after it starts, on the same day (no overnight shifts).';
    const length = start !== null && end !== null && end > start ? end - start : null;
    const grace = typeof s.graceMinutes === 'number' ? s.graceMinutes : null;
    const cutoff = typeof s.absenceCutoffMinutes === 'number' ? s.absenceCutoffMinutes : null;
    if (grace === null) errors[key('graceMinutes')] = 'Enter whole minutes (0 or more).';
    else if (length !== null && grace > length) errors[key('graceMinutes')] = `At most the shift length (${length} min).`;
    if (cutoff === null) errors[key('absenceCutoffMinutes')] = 'Enter whole minutes after the start.';
    else if (grace !== null && cutoff < grace) errors[key('absenceCutoffMinutes')] = 'Not earlier than the end of the grace period.';
    else if (length !== null && cutoff > length) errors[key('absenceCutoffMinutes')] = `Within the shift (at most ${length} min).`;
  });

  const valid = (i) => !Object.keys(errors).some((k) => k.startsWith(`shifts.${i}.`));
  shifts.forEach((b, j) => {
    if (!valid(j)) return;
    for (let i = 0; i < j; i += 1) {
      const a = shifts[i];
      if (!valid(i)) continue;
      const shared = a.days.filter((d) => b.days.includes(d));
      if (shared.length && toMinutes(a.start) < toMinutes(b.end) && toMinutes(b.start) < toMinutes(a.end)) {
        errors[`shifts.${j}.start`] = `Overlaps "${a.name}" (${a.start}–${a.end}) on ${dayList(shared)}. Shifts on the same day cannot overlap.`;
        break;
      }
    }
  });
  return errors;
}

/** "07:10" — the time a check-in becomes late (start + grace). */
export const lateAfter = (shift) => {
  const minutes = toMinutes(shift.start) + shift.graceMinutes;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};
/**
 * The clock times of an editor row (form strings): { late: '07:30' | null, absent: '08:00' | null } —
 * null while the start or the minutes are not valid yet.
 */
export function rowClockTimes(row) {
  const start = toMinutes(row.start);
  const at = (value) => {
    const m = /^\d+$/.test(String(value ?? '').trim()) ? Number(value) : null;
    if (start === null || m === null || start + m >= 1440) return null;
    const t = start + m;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };
  return { late: at(row.graceMinutes), absent: at(row.absenceCutoffMinutes) };
}

/** "09:00" — the absence cutoff time (start + cutoff). */
export const absentAfter = (shift) => {
  const minutes = toMinutes(shift.start) + shift.absenceCutoffMinutes;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

/**
 * The earliest effective date in words, from the API's earliest date and effective delay (Platform
 * Settings → Scheduling & Assignments): 'Tomorrow (2026-11-02)' for 1 day, otherwise
 * '2026-11-04 (3 days from today)'. Used by the schedule, assignment and transfer forms.
 */
export const earliestText = (earliest, delayDays = 1) => (delayDays === 1 ? `Tomorrow (${earliest})` : `${earliest} (${delayDays} days from today)`);

/**
 * The effective-date hint: `first` (nothing in effect today), `what` 'schedule' | 'assignments',
 * `timedChanges` (Platform Settings: any date from today, at a chosen time).
 * A first one that may start today says so; otherwise the earliest date and why.
 */
export function effectiveDateHint({ first, today, earliest, delayDays, what, timedChanges = false }) {
  if (timedChanges) return `Today (${today}) or later, at a time after now. Platform Settings let changes take effect at their scheduled time.`;
  if (first && earliest === today) {
    return what === 'schedule' ? `Your branch has no schedule in effect: it can start today (${today}).` : `No assignments in effect: they can start today (${today}).`;
  }
  const when = earliestText(earliest, delayDays);
  if (first) return `${when} at the earliest (the platform's effective delay).`;
  return what === 'schedule'
    ? `${when} at the earliest, so today's schedule does not change during the day. Until then the current schedule stays in effect.`
    : `${when} at the earliest, so today's assignments do not change during the day. Until then the current assignments stay in effect.`;
}

/** 'From'-style date of a version, set or transfer: '2026-11-01 13:30', or just the date when it starts at 00:00. */
export const whenText = (x) => (x?.effectiveTime && x.effectiveTime !== '00:00' ? `${x.effectiveFrom} ${x.effectiveTime}` : (x?.effectiveFrom ?? ''));

/**
 * The first quarter hour after `now` ({ date, time } in the platform time zone, from the API), as
 * { date, time }: the default for a change at its scheduled time (e.g. 13:07 → 13:15; 23:50 → next day 00:00).
 */
export function nextQuarter(now) {
  const [h, m] = now.time.split(':').map(Number);
  const minutes = (Math.floor((h * 60 + m) / 15) + 1) * 15;
  if (minutes >= 1440) return { date: addOneDay(now.date), time: '00:00' };
  return { date: now.date, time: `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` };
}
const addOneDay = (date) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * The effective time problem with timed changes (Platform Settings), or null: a time is needed and
 * the date and time must be after now (the API checks again with its own clock).
 */
export function effectiveTimeProblem({ timed, date, time, now }) {
  if (!timed) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time ?? '')) return 'Choose the time it takes effect.';
  if (now && /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') && `${date} ${time}` <= `${now.date} ${now.time}`) return `Choose a time after now (${now.time}). Changes cannot start in the past.`;
  return null;
}

/** The time field's hint with timed changes. */
export const effectiveTimeHint = (what, timeZone) =>
  `Takes effect at this time (${timeZone}). Until then the current ${what === 'schedule' ? 'schedule stays' : what === 'transfer' ? 'branch stays' : 'assignments stay'} in effect.`;

/**
 * A preset checkbox ("All days", "Full-time", "Part-time"): ticked only when exactly its days are
 * ticked, so choosing Full-time never shows All days as ticked. → { checked }
 */
export function presetState(picked, days) {
  return { checked: days.length > 0 && picked.length === days.length && days.every((d) => picked.includes(d)) };
}


/**
 * Quick choices of days shown above the day checkboxes: one place to change or add them.
 * Full-time: Saturday to Wednesday; part-time: Thursday and Friday.
 */
export const DAY_PRESETS = [
  { id: 'all', label: 'All days', days: ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI'] },
  { id: 'fulltime', label: 'Full-time', days: ['SAT', 'SUN', 'MON', 'TUE', 'WED'] },
  { id: 'parttime', label: 'Part-time', days: ['THU', 'FRI'] },
];

/**
 * The presets that apply to a set of days (`available`, e.g. a shift's days): each limited to those
 * days, left out when none of its days is available, and the same set shown once (the first label).
 * → [{ id, label, days }]
 */
export function presetsFor(available, presets = DAY_PRESETS) {
  const seen = new Set();
  const result = [];
  for (const p of presets) {
    const days = p.days.filter((d) => available.includes(d));
    const key = [...days].sort().join(',');
    if (!days.length || seen.has(key)) continue;
    seen.add(key);
    result.push({ ...p, days });
  }
  return result;
}

/** Ticking a preset: exactly its days (in `order`); ticking it again when it is ticked clears the days. */
export function togglePreset(picked, days, order) {
  return presetState(picked, days).checked ? [] : order.filter((d) => days.includes(d));
}

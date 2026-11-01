// Client-side checks for branch schedules, mirroring the API (backend/src/features/schedules/
// scheduleInput.js) so problems show immediately. The API checks again and has the final say,
// including the effective date against the server's clock.

export const WEEKDAYS = [
  { value: 'MON', label: 'Mon' },
  { value: 'TUE', label: 'Tue' },
  { value: 'WED', label: 'Wed' },
  { value: 'THU', label: 'Thu' },
  { value: 'FRI', label: 'Fri' },
  { value: 'SAT', label: 'Sat' },
  { value: 'SUN', label: 'Sun' },
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

/** An empty shift row for the editor (form values are strings). */
export const emptyShift = () => ({ name: '', days: [], start: '', end: '', graceMinutes: '0', absenceCutoffMinutes: '' });

/** A saved shift → editor row (its key keeps the shift's identity, so staff assignments follow it). */
export const toRow = (s) => ({ key: s.key, name: s.name, days: [...s.days], start: s.start, end: s.end, graceMinutes: String(s.graceMinutes), absenceCutoffMinutes: String(s.absenceCutoffMinutes) });

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
    if (!s.name) errors[key('name')] = 'Enter a shift name.';
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

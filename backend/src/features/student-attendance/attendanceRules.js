import { zonedInstant, zonedMidnight } from '../../common/zonedTime.js';
import { addDays } from '../academic-calendar/schoolDays.js';
import { HALVES } from '../timetable/bellTimes.js';

/*
 * Student attendance rules that need no database (docs/business-rules.md → Student attendance):
 * which sessions a section has on a day, their times and windows, and what a student's attendance
 * counts as once excuses are applied. Shared by the Manager's sessions (Phase 4), teacher lessons
 * (Phase 5), completion (Phase 6) and reports (Phase 7).
 */

export const STATUSES = ['present', 'absent', 'late', 'excused'];
export const STATUS_TO_DB = { present: 'PRESENT', absent: 'ABSENT', late: 'LATE', excused: 'EXCUSED' };
export const STATUS_FROM_DB = { PRESENT: 'present', ABSENT: 'absent', LATE: 'late', EXCUSED: 'excused' };
export const STATUS_LABELS = { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused', not_marked: 'Not marked', pending: 'Not marked yet' };

export const HALF_TO_DB = { [HALVES.WHOLE]: 'WHOLE_DAY', [HALVES.BEFORE]: 'BEFORE_BREAK', [HALVES.AFTER]: 'AFTER_BREAK' };
export const HALF_FROM_DB = { WHOLE_DAY: HALVES.WHOLE, BEFORE_BREAK: HALVES.BEFORE, AFTER_BREAK: HALVES.AFTER };
export const HALF_LABELS = { [HALVES.WHOLE]: 'Whole day', [HALVES.BEFORE]: 'Before the break', [HALVES.AFTER]: 'After the break' };
export { HALVES };

/**
 * The Manager sessions a section should have on a day, from its day (lessons.js loadSectionDays)
 * and the branch's settings: [{ half, startMinute, endMinute }] (minutes null when the section has
 * no bell times that day). No school: []. Once a day, or a day without a main break: one whole-day
 * session over all the day's periods. Twice: before and after the main break.
 */
export function plannedHalves(day, settings) {
  if (!day?.schoolDay) return [];
  const halves = day.halves ?? [];
  if (!halves.length) return [{ half: HALVES.WHOLE, startMinute: null, endMinute: null }];
  if (settings.halfDayFrequency === 'once_daily' || halves.length === 1) {
    return [{ half: HALVES.WHOLE, startMinute: Math.min(...halves.map((h) => h.startMinute)), endMinute: Math.max(...halves.map((h) => h.endMinute)) }];
  }
  return halves.map((h) => ({ half: h.half, startMinute: h.startMinute, endMinute: h.endMinute }));
}

/**
 * The sessions shown for a section and day: the planned ones, except that sessions already opened
 * fix the day's shape (a later change of settings or bell times does not split or merge them).
 * `existing`: [{ half, … }] opened sessions of that section and day. → [{ half, startMinute,
 * endMinute, session? }].
 */
export function dayShape(planned, dayHalves, existing) {
  if (!existing.length) return planned.map((p) => ({ ...p, session: null }));
  const whole = existing.find((s) => s.half === HALVES.WHOLE);
  if (whole) return [{ half: HALVES.WHOLE, startMinute: null, endMinute: null, session: whole }];
  return [HALVES.BEFORE, HALVES.AFTER]
    .map((half) => {
      const session = existing.find((s) => s.half === half);
      if (session) return { half, startMinute: null, endMinute: null, session };
      const fromDay = (dayHalves ?? []).find((h) => h.half === half);
      return fromDay ? { half, startMinute: fromDay.startMinute, endMinute: fromDay.endMinute, session: null } : null;
    })
    .filter(Boolean);
}

/**
 * The instants of a session on `date` in the platform time zone: { startsAt, endsAt, opensAt,
 * deadlineAt }. Without times, the day itself: open from midnight, due `halfDayDeadlineAfterMinutes`
 * after the day ends.
 */
export function sessionTimes(date, { startMinute, endMinute }, settings, timeZone) {
  if (startMinute === null || startMinute === undefined) {
    const opensAt = zonedMidnight(date, timeZone);
    const dayEnd = zonedMidnight(addDays(date, 1), timeZone);
    return { startsAt: null, endsAt: null, opensAt, deadlineAt: new Date(dayEnd.getTime() + settings.halfDayDeadlineAfterMinutes * 60_000) };
  }
  const startsAt = zonedInstant(date, startMinute, timeZone);
  const endsAt = zonedInstant(date, endMinute, timeZone);
  return {
    startsAt,
    endsAt,
    opensAt: new Date(startsAt.getTime() - settings.halfDayOpensBeforeMinutes * 60_000),
    deadlineAt: new Date(endsAt.getTime() + settings.halfDayDeadlineAfterMinutes * 60_000),
  };
}

/** Until when a Manager can take or correct the attendance of `date`: the end of the day `managerEditDays` after it. */
export const editableUntil = (date, settings, timeZone) => zonedMidnight(addDays(date, settings.managerEditDays + 1), timeZone);

/**
 * Where a session stands at `now`: 'upcoming' (cannot be taken yet), 'open' (before its deadline),
 * 'overdue' (past the deadline, still editable: late entries and corrections), 'locked' (past the
 * correction period). `until`: editableUntil of its date (never before the deadline).
 */
export function windowState({ opensAt, deadlineAt }, until, now) {
  if (now < opensAt) return 'upcoming';
  if (now <= deadlineAt) return 'open';
  return now < (until > deadlineAt ? until : deadlineAt) ? 'overdue' : 'locked';
}

/** Whether an excuse ({ startDate, endDate, half, periods } with 'YYYY-MM-DD' dates, API half) covers a Manager session. */
export function excuseCoversHalf(excuse, date, half) {
  if (excuse.startDate > date || excuse.endDate < date) return false;
  if (excuse.periods?.length) return false;
  return !excuse.half || excuse.half === half;
}

/**
 * What a student's attendance counts as: the mark, except that an excuse turns an absence (or no
 * mark) into 'excused'; without a mark, 'pending' until the deadline and 'not_marked' after it.
 * A student marked present or late who also has an excuse came anyway: the mark stands.
 */
export function effectiveStatus(status, { excused = false, overdue = false } = {}) {
  if (status === 'excused') return 'excused';
  if (excused && (status === 'absent' || !status)) return 'excused';
  if (!status) return overdue ? 'not_marked' : 'pending';
  return status;
}

/** Counts of effective statuses: { present, absent, late, excused, notMarked, total }. */
export function countStatuses(effectives) {
  const counts = { present: 0, absent: 0, late: 0, excused: 0, notMarked: 0, total: effectives.length };
  for (const s of effectives) {
    if (s === 'pending' || s === 'not_marked') counts.notMarked += 1;
    else counts[s] += 1;
  }
  return counts;
}

// ---- teacher lessons (Phase 5) ---------------------------------------------------------------------

/** 'HH:MM' → minutes after midnight. */
export const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** A lesson's instants: { startsAt, endsAt, opensAt, deadlineAt } from the lesson settings. */
export function lessonTimes(date, { start, end }, settings, timeZone) {
  const startsAt = zonedInstant(date, toMinutes(start), timeZone);
  const endsAt = zonedInstant(date, toMinutes(end), timeZone);
  return {
    startsAt,
    endsAt,
    opensAt: new Date(startsAt.getTime() - settings.lessonOpensBeforeMinutes * 60_000),
    deadlineAt: new Date(endsAt.getTime() + settings.lessonDeadlineAfterMinutes * 60_000),
  };
}

/** Until when offline marks of a lesson (taken inside its window) can still be uploaded. */
export const uploadUntil = (deadlineAt, settings) => new Date(deadlineAt.getTime() + settings.offlineGraceMinutes * 60_000);

/**
 * Whether an excuse covers a lesson: its periods when it names some; else its half (the lesson's
 * half of the day); else the whole day. `lesson`: { half (API value or null), period }.
 */
export function excuseCoversLesson(excuse, date, lesson) {
  if (excuse.startDate > date || excuse.endDate < date) return false;
  if (excuse.periods?.length) return excuse.periods.includes(lesson.period);
  if (excuse.half) return excuse.half === lesson.half;
  return true;
}

export const TEACHER_STATUSES = ['present', 'absent'];

/**
 * Whether a teacher's mark is accepted, from the trusted time it was taken (`at`, server clock),
 * the session window and the entry's current mark. → null (accepted) or a refusal code:
 *   OUTSIDE_WINDOW  taken before the lesson opened, or after its deadline when it is not a
 *                   correction of the teacher's own mark within the correction minutes
 *   SET_BY_MANAGER  a Manager set the current mark (Managers correct; teachers do not override)
 *   NEWER_MARK      the current mark was taken later than this one (an older offline mark never wins)
 */
export function teacherMarkRefusal({ at, session, entry, teacherId, settings }) {
  if (entry.markedByRole === 'MANAGER' || entry.markedByRole === 'OWNER') return 'SET_BY_MANAGER';
  if (entry.occurredAt && entry.occurredAt > at) return 'NEWER_MARK';
  if (at < session.opensAt) return 'OUTSIDE_WINDOW';
  if (at <= session.deadlineAt) return null;
  const ownMark = entry.markedById === teacherId && entry.markedAt;
  if (ownMark && at.getTime() <= entry.firstMarkedAt.getTime() + settings.teacherCorrectionMinutes * 60_000) return null;
  return 'OUTSIDE_WINDOW';
}

import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { HttpError } from '../../common/httpError.js';
import { zonedInstant, zonedMidnight } from '../../common/zonedTime.js';
import { getPrisma } from '../../config/prisma.js';
import { locationAt, scheduledLocationAfter } from '../branches/branches.service.js';
import { platformTimeZone } from '../platform-settings/settings.service.js';
import { WEEKDAYS, toTime } from '../schedules/scheduleInput.js';
import { daySchedules } from '../schedules/schedules.service.js';
import { daySets } from '../staff/staff.service.js';
import { staffBranchAt, upcomingTransfer } from '../staff/transfers.service.js';
import { dispatch, OUTBOX } from '../notifications/outbox.js';
import { judgePosition } from './geofence.js';
import { suspendedAt } from './suspensions.js';

/*
 * Staff attendance: check-in and check-out from the Staff mobile app (approved rules:
 * docs/business-rules.md → Attendance check-in and check-out). Every rule is applied by the server
 * against its own clock and the stored history; the staff member, branch, shift, schedule version,
 * assignment set and branch location are always found by the server, never taken from the request.
 *
 * Times: occurredAt (event time, from the device), sentAt (the device clock when sending) and
 * receivedAt (the server clock, trusted) are kept separate. The device clock is checked when the
 * event is uploaded (|sentAt − receivedAt| ≤ 5 min); the event must arrive within 24 hours of its
 * event time and not claim to be later than its sending.
 */

export const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;
export const MAX_DELAY_MS = 24 * 60 * 60 * 1000;
/** Check-in opens this long before a shift starts. */
export const EARLY_CHECK_IN_MINUTES = 30;

const refuse = (code, message, details) => new HttpError(422, code, message, details);
const duplicate = (code, message) => new HttpError(409, code, message);
const isUniqueViolation = (error) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
const asDbDate = (date) => new Date(`${date}T00:00:00Z`);
const fromDbDate = (value) => value.toISOString().slice(0, 10);

/** Local date, weekday (MON…) and minutes after midnight (with seconds as a fraction) of an instant in a time zone. */
export function localMoment(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const weekday = WEEKDAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];
  const minutes = Number(parts.hour) * 60 + Number(parts.minute) + (Number(parts.second) + instant.getUTCMilliseconds() / 1000) / 60;
  return { date, weekday, minutes };
}

/**
 * The staff member's shifts on a weekday from an assignment set and a schedule version (a shift
 * counts when it is assigned that weekday and works that weekday in the schedule), in start order,
 * each with its check-in window [opensAt, endMinute) in minutes after midnight.
 */
export function shiftsWithWindows(assignment, schedule, weekday) {
  const byKey = new Map(schedule.shifts.map((s) => [s.shiftKey, s]));
  const shifts = assignment.shifts
    .filter((a) => a.days.includes(weekday))
    .map((a) => byKey.get(a.shiftKey))
    .filter((s) => s && s.days.includes(weekday))
    .sort((a, b) => a.startMinute - b.startMinute);
  return shifts.map((s, i) => {
    const earlier = shifts.slice(0, i).reduce((end, p) => Math.max(end, p.endMinute), 0);
    // The window opens 30 minutes early, but not before an earlier shift of the day has ended.
    const opensAt = Math.max(0, s.startMinute - EARLY_CHECK_IN_MINUTES, earlier);
    return { shift: s, opensAt, closesAt: s.endMinute };
  });
}

/** The local moment of an instant in the platform time zone (for days without a schedule). */
async function platformMoment(occurredAt) {
  return localMoment(occurredAt, await platformTimeZone());
}

/** The newest of `list` (sorted by effectiveAt) in effect at `instant`, or undefined. */
const inEffectAt = (list, instant) => list.filter((v) => v.effectiveAt <= instant).at(-1);

/**
 * The schedule and assignment set for an event's day (the day in the platform time zone, re-read in
 * the schedule's own zone when they differ) → { moment, schedule, assignment }.
 *
 * An ordinary day (one schedule version and at most one assignment set apply all day) gives those
 * rows exactly. On a day where a version or set takes effect after 00:00 (timed changes), each shift
 * of the day is taken from the schedule version and assignment set in effect at that shift's start
 * (approved 2026-11-01), so a 07:00 shift keeps the old rules and a 14:00 shift has the new ones. The
 * result has the same shape (`composed: true`); each shift carries the `scheduleId` and
 * `checkOutEnabled` of its version and each assigned shift its `assignmentId`. A shift key appears
 * at most once a day (the earliest occurrence), as check-ins are one per shift and day.
 */
async function dayPlan(staffUserId, branchId, occurredAt, client) {
  const zone = await platformTimeZone();
  let moment = localMoment(occurredAt, zone);
  let bounds = dayBounds(moment.date, zone);
  let schedules = await daySchedules(branchId, bounds.start, bounds.end, client);
  if (schedules.length && schedules[0].timeZone !== zone) {
    moment = localMoment(occurredAt, schedules[0].timeZone);
    bounds = dayBounds(moment.date, schedules[0].timeZone);
    schedules = await daySchedules(branchId, bounds.start, bounds.end, client);
  }
  if (!schedules.length) return { moment, schedule: null, assignment: null };
  const sets = staffUserId ? await daySets(staffUserId, bounds.start, bounds.end, client) : [];
  if (schedules.length === 1 && sets.length <= 1) return { moment, schedule: schedules[0], assignment: sets[0] ?? null };
  return { moment, ...composeDay(moment.date, schedules, sets, occurredAt) };
}

/**
 * A split day (see dayPlan): `schedules` and `sets` are the versions and sets that apply during
 * `date`, ordered by effectiveAt; each shift comes from the version in effect at its start, each
 * assigned shift from the set in effect then. → { schedule, assignment } (composed).
 */
export function composeDay(date, schedules, sets, occurredAt) {
  const byKey = new Map();
  for (const version of schedules) {
    for (const s of version.shifts) {
      const startsAt = zonedInstant(date, s.startMinute, version.timeZone);
      if (inEffectAt(schedules, startsAt) !== version) continue;
      const earlier = byKey.get(s.shiftKey);
      if (earlier && earlier.startsAt <= startsAt) continue;
      byKey.set(s.shiftKey, { ...s, startsAt, scheduleId: version.id, checkOutEnabled: version.checkOutEnabled });
    }
  }
  const shifts = [...byKey.values()].sort((a, b) => a.startMinute - b.startMinute);
  const now = inEffectAt(schedules, occurredAt) ?? schedules[0];
  const schedule = { id: now.id, timeZone: now.timeZone, checkOutEnabled: now.checkOutEnabled, shifts, composed: true };
  if (!sets.length) return { schedule, assignment: null };
  const assigned = [];
  for (const s of shifts) {
    const set = inEffectAt(sets, s.startsAt);
    const a = set?.shifts.find((x) => x.shiftKey === s.shiftKey);
    if (a) assigned.push({ shiftKey: a.shiftKey, days: a.days, assignmentId: set.id });
  }
  const setNow = inEffectAt(sets, occurredAt) ?? sets[0];
  return { schedule, assignment: { id: setNow.id, shifts: assigned, composed: true } };
}

/** [00:00, next 00:00) of a local date in a time zone, as instants. */
function dayBounds(date, timeZone) {
  const next = new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return { start: zonedMidnight(date, timeZone), end: zonedMidnight(next, timeZone) };
}

const sameContent = (stored, event) =>
  stored.type === event.type &&
  stored.occurredAt.getTime() === event.occurredAt.getTime() &&
  stored.latitude === event.position?.latitude &&
  stored.longitude === event.position?.longitude &&
  stored.accuracyMeters === event.position?.accuracy;

/** The event shape the app uses (no coordinates echoed back). */
async function toEvent(e, client) {
  const schedule = await client.branchSchedule.findUnique({ where: { id: e.scheduleId }, include: { shifts: true } });
  return eventShape(e, schedule);
}

/** Several events in that shape, reading each schedule version once. */
async function toEvents(events, client) {
  const ids = [...new Set(events.map((e) => e.scheduleId))];
  const schedules = new Map(
    (await client.branchSchedule.findMany({ where: { id: { in: ids } }, include: { shifts: true } })).map((s) => [s.id, s]),
  );
  return events.map((e) => eventShape(e, schedules.get(e.scheduleId)));
}

function eventShape(e, schedule) {
  const shift = schedule?.shifts.find((s) => s.shiftKey === e.shiftKey);
  return {
    id: e.id,
    clientEventId: e.clientEventId,
    type: e.type,
    occurredAt: e.occurredAt.toISOString(),
    receivedAt: e.receivedAt.toISOString(),
    workDate: fromDbDate(e.workDate),
    shift: shift ? { key: shift.shiftKey, name: shift.name, start: toTime(shift.startMinute), end: toTime(shift.endMinute) } : { key: e.shiftKey },
    status: e.status,
    distanceMeters: Math.round(e.distanceMeters * 10) / 10,
    checkInEventId: e.checkInEventId,
  };
}

/**
 * Records a check-in or check-out for the signed-in staff member (`staff`: { id, branchId }).
 * Returns { created, event }: created false when the same event (same clientEventId and content)
 * was already recorded. Refusals throw 422 (a rule), 409 (a duplicate) or 400 (malformed); nothing
 * is recorded for them.
 */
export async function recordEvent(staff, event, receivedAt = new Date()) {
  const prisma = getPrisma();

  // Idempotency first: a retry of a recorded event succeeds whenever it arrives.
  const stored = await prisma.attendanceEvent.findUnique({ where: { staffUserId_clientEventId: { staffUserId: staff.id, clientEventId: event.clientEventId } } });
  if (stored) {
    if (!sameContent(stored, event)) throw duplicate('IDEMPOTENCY_CONFLICT', 'This event id was already used for a different event. Create a new id.');
    return { created: false, event: await toEvent(stored, prisma) };
  }

  // Times (ATT-003, ATT-004): measured against the server's clock when the event arrives.
  const skew = event.sentAt.getTime() - receivedAt.getTime();
  if (Math.abs(skew) > CLOCK_TOLERANCE_MS) {
    throw refuse('CLOCK_SKEW', 'Your device clock differs from the server by more than 5 minutes. Set the date and time automatically and try again.', { skewSeconds: Math.round(skew / 1000) });
  }
  if (event.occurredAt > event.sentAt) throw refuse('EVENT_IN_FUTURE', 'The event time is later than the time it was sent.');
  if (receivedAt.getTime() - event.occurredAt.getTime() > MAX_DELAY_MS) {
    throw refuse('EVENT_TOO_OLD', 'This event was recorded more than 24 hours ago and can no longer be accepted.');
  }

  // The branch of the event's own time (T5): an event saved before a transfer and uploaded after it
  // is judged against the branch the staff member belonged to then, never the new one.
  let branchId = await staffBranchAt(staff.id, event.occurredAt, prisma);
  if (event.type === 'CHECK_OUT') {
    // A transfer that took effect during the day (timed changes): the check-out of a check-in made
    // before it is judged at the check-in's branch, so it can still be closed there.
    const open = await prisma.attendanceEvent.findFirst({
      where: { staffUserId: staff.id, type: 'CHECK_IN', workDate: asDbDate((await platformMoment(event.occurredAt)).date), occurredAt: { lte: event.occurredAt }, checkOut: { is: null } },
      orderBy: { occurredAt: 'desc' },
      select: { branchId: true },
    });
    if (open && open.branchId !== branchId) branchId = open.branchId;
  }
  const branch = await prisma.branch.findUnique({ where: { id: branchId ?? staff.branchId }, select: { id: true, schoolId: true } });
  const { moment, schedule, assignment } = await dayPlan(staff.id, branch.id, event.occurredAt, prisma);
  if (!schedule) throw refuse('NO_SHIFT', 'Your branch has no schedule on this day.');

  let shift;
  let checkIn = null;
  let status = null;
  if (event.type === 'CHECK_IN') {
    const windows = assignment ? shiftsWithWindows(assignment, schedule, moment.weekday) : [];
    if (!windows.length) throw refuse('NO_SHIFT', 'You have no assigned shift on this day.');
    const match = windows.find((w) => moment.minutes >= w.opensAt && moment.minutes < w.closesAt);
    if (!match) {
      throw refuse('OUTSIDE_SHIFT_WINDOW', 'Check-in is open from 30 minutes before your shift until it ends.', {
        windows: windows.map((w) => ({ shift: w.shift.name, opensAt: toTime(Math.ceil(w.opensAt)), closesAt: toTime(w.closesAt) })),
      });
    }
    shift = match.shift;
    // LATE strictly after start + grace (also after the absence cutoff); PRESENT otherwise.
    status = moment.minutes > shift.startMinute + shift.graceMinutes ? 'LATE' : 'PRESENT';
    const suspension = await suspendedAt({ branchId: branch.id, schoolId: branch.schoolId }, event.occurredAt, prisma);
    if (suspension.suspended) {
      throw refuse(
        'BRANCH_SUSPENDED',
        suspension.reasons.includes('school_suspended') ? 'Your school was suspended at that time; check-in is not possible.' : 'Your branch was suspended at that time; check-in is not possible.',
        { reasons: suspension.reasons },
      );
    }
  } else {
    // On a split day the check-out setting is that of the check-in's own version (checked below).
    if (!schedule.composed && !schedule.checkOutEnabled) throw refuse('CHECK_OUT_DISABLED', 'Check-out is not used at your branch on this day.');
    // The open check-in of that day: the latest one without a check-out, at or before this time.
    checkIn = await prisma.attendanceEvent.findFirst({
      where: { staffUserId: staff.id, type: 'CHECK_IN', workDate: asDbDate(moment.date), occurredAt: { lte: event.occurredAt }, checkOut: { is: null } },
      orderBy: { occurredAt: 'desc' },
    });
    if (!checkIn) throw refuse('NO_OPEN_CHECK_IN', 'There is no check-in to check out from today.');
    if (schedule.composed) {
      const version = await prisma.branchSchedule.findUnique({ where: { id: checkIn.scheduleId }, select: { checkOutEnabled: true } });
      if (!version?.checkOutEnabled) throw refuse('CHECK_OUT_DISABLED', 'Check-out is not used at your branch on this day.');
    }
    shift = schedule.shifts.find((s) => s.shiftKey === checkIn.shiftKey) ?? { shiftKey: checkIn.shiftKey };
  }

  // GPS (ATT-002), against the branch location in effect at the event time.
  const location = await locationAt(branch.id, event.occurredAt, prisma);
  const judged = judgePosition(event.position, location);
  if (!judged.accepted) {
    const messages = {
      no_position: 'Your location is needed. Turn on location services and try again.',
      invalid_position: 'Your location could not be read. Try again.',
      accuracy_too_low: 'Your location is not accurate enough (it must be 50 m or better). Move to an open spot and try again.',
      no_branch_location: 'Your branch has no location on record for that time.',
      outside_geofence: 'You are more than 100 m from your branch.',
    };
    throw refuse('LOCATION_REFUSED', messages[judged.reason], { reason: judged.reason });
  }

  try {
    // A late check-in also writes its notification event (outbox) in the same transaction (N6);
    // notifications are created after the commit and can never undo the check-in.
    const id = randomUUID();
    const outbox = status === 'LATE' ? [prisma.notificationEvent.create({ data: { type: OUTBOX.LATE_CHECK_IN, payload: { eventId: id }, dedupeKey: `late-check-in:${id}` } })] : [];
    const [created, ...queued] = await prisma.$transaction([
      prisma.attendanceEvent.create({
        data: {
          id,
          staffUserId: staff.id,
          branchId: branch.id,
          type: event.type,
          clientEventId: event.clientEventId,
          occurredAt: event.occurredAt,
          sentAt: event.sentAt,
          receivedAt,
          workDate: asDbDate(moment.date),
          shiftKey: shift.shiftKey,
          // The version and set the check-in was judged against (on a split day: those of its shift).
          scheduleId: event.type === 'CHECK_OUT' ? checkIn.scheduleId : (shift.scheduleId ?? schedule.id),
          assignmentId: event.type === 'CHECK_OUT' ? checkIn.assignmentId : (assignment.shifts.find((a) => a.shiftKey === shift.shiftKey)?.assignmentId ?? assignment.id),
          locationId: location.id,
          latitude: event.position.latitude,
          longitude: event.position.longitude,
          accuracyMeters: event.position.accuracy,
          distanceMeters: judged.distanceMeters,
          status,
          checkInEventId: checkIn?.id ?? null,
        },
      }),
      ...outbox,
    ]);
    await dispatch(queued.map((q) => q.id));
    return { created: true, event: await toEvent(created, prisma) };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const target = JSON.stringify(error.meta ?? {});
    // A simultaneous delivery of the same event: return the one that was recorded.
    if (target.includes('clientEventId')) return recordEvent(staff, event, receivedAt);
    if (target.includes('checkInEventId')) throw duplicate('ALREADY_CHECKED_OUT', 'You have already checked out from this check-in.');
    throw duplicate('ALREADY_CHECKED_IN', 'You have already checked in for this shift today.');
  }
}

// The branch position the app checks against before saving an event (early feedback only; the server decides).
const appLocation = (l) => (l ? { latitude: l.latitude, longitude: l.longitude, effectiveFrom: l.effectiveFrom.toISOString() } : null);

/**
 * Today for the signed-in staff member: the shifts assigned today with their check-in windows, the
 * check-out setting, the recorded events, and the branch location in effect now and a scheduled
 * change (for the app's on-device check, docs/business-rules.md → Staff mobile app).
 */
export async function today(staff, now = new Date()) {
  const prisma = getPrisma();
  const { moment, schedule, assignment } = await dayPlan(staff.id, staff.branchId, now, prisma);
  const windows = schedule && assignment ? shiftsWithWindows(assignment, schedule, moment.weekday) : [];
  const [events, current, scheduled] = await Promise.all([
    prisma.attendanceEvent.findMany({ where: { staffUserId: staff.id, workDate: asDbDate(moment.date) }, orderBy: { occurredAt: 'asc' } }),
    locationAt(staff.branchId, now, prisma),
    scheduledLocationAfter(staff.branchId, now, prisma),
  ]);
  return {
    date: moment.date,
    timeZone: schedule?.timeZone ?? (await platformTimeZone()),
    checkOutEnabled: schedule?.checkOutEnabled ?? false,
    shifts: windows.map((w) => ({
      key: w.shift.shiftKey,
      name: w.shift.name,
      start: toTime(w.shift.startMinute),
      end: toTime(w.shift.endMinute),
      checkInOpensAt: toTime(w.opensAt),
      lateAfter: toTime(w.shift.startMinute + w.shift.graceMinutes),
    })),
    events: await toEvents(events, prisma),
    branchLocation: appLocation(current),
    scheduledBranchLocation: appLocation(scheduled),
  };
}

/** The signed-in staff member's own profile (read only). */
export async function profile(staff) {
  const user = await getPrisma().user.findUnique({
    where: { id: staff.id },
    select: { name: true, staffId: true, phone: true, jobTitle: true, email: true, branch: { select: { code: true, name: true, school: { select: { code: true, name: true } } } } },
  });
  return {
    name: user.name,
    staffId: user.staffId,
    phone: user.phone,
    jobTitle: user.jobTitle,
    email: user.email ?? null,
    branch: { code: user.branch.code, name: user.branch.name },
    school: { code: user.branch.school.code, name: user.branch.school.name },
    // A scheduled move to another branch of the school (T3), or null.
    upcomingTransfer: await upcomingTransfer(staff.id),
  };
}

export const HISTORY_MAX_DAYS = 62;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The staff member's own recorded events whose work date is from `from` to `to` (YYYY-MM-DD,
 * inclusive), newest first. Without dates: the last 7 days up to today in branch time.
 */
export async function history(staff, { from, to } = {}, now = new Date()) {
  const prisma = getPrisma();
  if (!to || !from) {
    const { moment } = await dayPlan(null, staff.branchId, now, prisma);
    to ??= moment.date;
    from ??= fromDbDate(new Date(asDbDate(to).getTime() - 6 * DAY_MS));
  }
  const days = (asDbDate(to).getTime() - asDbDate(from).getTime()) / DAY_MS + 1;
  if (days < 1) throw new HttpError(400, 'VALIDATION_ERROR', '"from" must be on or before "to".');
  if (days > HISTORY_MAX_DAYS) throw new HttpError(400, 'VALIDATION_ERROR', `Ask for at most ${HISTORY_MAX_DAYS} days at a time.`);
  const events = await prisma.attendanceEvent.findMany({
    where: { staffUserId: staff.id, workDate: { gte: asDbDate(from), lte: asDbDate(to) } },
    orderBy: [{ workDate: 'desc' }, { occurredAt: 'desc' }],
  });
  return { from, to, events: await toEvents(events, prisma) };
}

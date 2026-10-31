import { toTime } from '../schedules/scheduleInput.js';

/*
 * Which staff a branch schedule change affects (N9): only staff whose assigned shifts change.
 * Pure functions (no database), so the targeting rules are tested directly.
 *
 * A schedule version is { checkOutEnabled, shifts: [{ shiftKey, name, days, startMinute, endMinute,
 * graceMinutes, absenceCutoffMinutes }] }; an assignment set is { shifts: [{ shiftKey, days }] }.
 * An assigned shift "is worked" in a version on the assigned days that the shift also works there.
 */

const worked = (version, assigned) => {
  const shift = version?.shifts.find((s) => s.shiftKey === assigned.shiftKey);
  return shift ? { shift, days: assigned.days.filter((d) => shift.days.includes(d)) } : { shift: null, days: [] };
};

const sameTimes = (a, b) =>
  a.name === b.name &&
  a.startMinute === b.startMinute &&
  a.endMinute === b.endMinute &&
  a.graceMinutes === b.graceMinutes &&
  a.absenceCutoffMinutes === b.absenceCutoffMinutes;

/**
 * The effect of moving from `before` to `after` (either may be null: no schedule) on one staff
 * member's assignment set. → { affected, shifts, checkOutChanged, checkOutEnabled }, where `shifts`
 * lists each assigned shift that changes: { name, days, start, end } as it will be, or
 * { name, removed: true } when it is no longer worked on any assigned day. A shift worked in
 * neither version, or identical in both (name, times, grace, absence cutoff and assigned days),
 * does not count. The check-out setting counts only for staff who work an assigned shift in either.
 */
export function scheduleImpact(before, after, assignment) {
  const shifts = [];
  let worksSomething = false;
  for (const assigned of assignment?.shifts ?? []) {
    const was = worked(before, assigned);
    const will = worked(after, assigned);
    if (!was.days.length && !will.days.length) continue;
    worksSomething = true;
    if (!will.days.length) {
      shifts.push({ name: was.shift.name, removed: true });
      continue;
    }
    const unchanged = was.days.length && was.days.join(',') === will.days.join(',') && sameTimes(was.shift, will.shift);
    if (!unchanged) shifts.push({ name: will.shift.name, days: will.days, start: toTime(will.shift.startMinute), end: toTime(will.shift.endMinute) });
  }
  const checkOutChanged = Boolean(worksSomething && before && after && before.checkOutEnabled !== after.checkOutEnabled);
  return { affected: shifts.length > 0 || checkOutChanged, shifts, checkOutChanged, checkOutEnabled: Boolean(after?.checkOutEnabled) };
}

/** The assignment set in effect on a date for each staff member, from sets sorted newest first (effectiveFrom, recordedAt). */
export function latestSets(sets) {
  const byStaff = new Map();
  for (const set of sets) if (!byStaff.has(set.staffUserId)) byStaff.set(set.staffUserId, set);
  return byStaff;
}

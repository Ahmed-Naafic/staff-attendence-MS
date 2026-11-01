/*
 * Transfer form rules for the School Owner (pure; tested in transferRules.test.js). The server
 * applies the same rules and decides (docs/business-rules.md → Staff transfers).
 */

export const TRANSFER_STATES = {
  scheduled: { label: 'Scheduled', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
};

const DAY_ORDER = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** Branches a staff member can move to: the school's active branches other than their current one. */
export const destinationOptions = (branches, currentBranchId) =>
  branches.filter((b) => b.id !== currentBranchId && b.status === 'active').map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }));

/** The initial form: no destination, the earliest date allowed, no shifts chosen. */
export const emptyTransfer = (earliest) => ({ branchId: '', effectiveFrom: earliest, shifts: {} });

/** Toggles a destination shift: chosen with all its working days, or removed. */
export function toggleShift(shifts, shift, on) {
  const next = { ...shifts };
  if (on) next[shift.key] = [...shift.days];
  else delete next[shift.key];
  return next;
}

/** Toggles one day of a chosen shift (a shift with no day left is removed). */
export function toggleDay(shifts, key, day, on) {
  const days = new Set(shifts[key] ?? []);
  if (on) days.add(day);
  else days.delete(day);
  const next = { ...shifts };
  if (days.size) next[key] = DAY_ORDER.filter((d) => days.has(d));
  else delete next[key];
  return next;
}

/** Field errors ({} when valid). `delayDays`: the platform's effective delay (1 when not sent). */
export function validateTransfer(form, { earliest, latest, delayDays = 1 }) {
  const errors = {};
  if (!form.branchId) errors.branchId = 'Choose the destination branch.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.effectiveFrom ?? '')) errors.effectiveFrom = 'Choose the date the transfer takes effect.';
  else if (form.effectiveFrom < earliest) errors.effectiveFrom = `A transfer can start ${delayDays === 1 ? `tomorrow (${earliest})` : `on ${earliest} (${delayDays} days from today)`} at the earliest.`;
  else if (form.effectiveFrom > latest) errors.effectiveFrom = `A transfer can start at most one year ahead (${latest}).`;
  return errors;
}

/** Shifts that overlap on a shared chosen day ({ key: message }), so the form can stop before sending. */
export function overlapProblems(form, shiftList) {
  const chosen = shiftList.filter((s) => form.shifts[s.key]);
  const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const problems = {};
  chosen.forEach((b, j) => {
    for (const a of chosen.slice(0, j)) {
      const shared = form.shifts[a.key].filter((d) => form.shifts[b.key].includes(d));
      if (shared.length && minutes(a.start) < minutes(b.end) && minutes(b.start) < minutes(a.end)) {
        problems[b.key] = `Overlaps "${a.name}" on a shared day.`;
        break;
      }
    }
  });
  return problems;
}

/** The request body (the shifts in the schedule's order). */
export const toTransferBody = (form, shiftList) => ({
  branchId: form.branchId,
  effectiveFrom: form.effectiveFrom,
  // Only with timed changes (Platform Settings); otherwise the transfer starts at 00:00.
  ...(form.effectiveTime && { effectiveTime: form.effectiveTime }),
  shifts: shiftList.filter((s) => form.shifts[s.key]).map((s) => ({ shiftKey: s.key, days: form.shifts[s.key] })),
});

/** "Morning 07:30–13:00 (Mon, Tue)" lines for the review step. */
export const shiftSummary = (form, shiftList, dayList) =>
  shiftList.filter((s) => form.shifts[s.key]).map((s) => `${s.name} ${s.start}–${s.end} (${dayList(form.shifts[s.key])})`);

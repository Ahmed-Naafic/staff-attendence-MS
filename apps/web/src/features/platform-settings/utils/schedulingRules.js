// Scheduling & Assignments rules, mirroring the API's
// (backend/src/features/platform-settings/schedulingPolicy.js) so problems show immediately.
// The API validates again and has the final say.

export const EFFECTIVE_DELAY_MIN = 1;
export const EFFECTIVE_DELAY_MAX = 30;

/** Problem with a typed effective delay, or null when it is a whole number of days from 1 to 30. */
export function delayProblem(value) {
  const text = String(value).trim();
  if (!text) return 'Enter the effective delay in days.';
  const days = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(days) || days < EFFECTIVE_DELAY_MIN || days > EFFECTIVE_DELAY_MAX) {
    return `Effective delay must be a whole number of days from ${EFFECTIVE_DELAY_MIN} to ${EFFECTIVE_DELAY_MAX}.`;
  }
  return null;
}

export const daysText = (days) => `${days} ${days === 1 ? 'day' : 'days'}`;

/** 'tomorrow' for 1 day, otherwise 'N days later', for "a change saved today starts …". */
export const delayExample = (days) => (days === 1 ? 'tomorrow at 00:00' : `${days} days later at 00:00`);

/** The values that differ from the saved ones: { effectiveDelayDays?, immediateFirstSchedule?, immediateFirstAssignment? }. */
export function changedValues(saved, draft) {
  const changed = {};
  const days = Number(String(draft.effectiveDelayDays).trim());
  if (days !== saved.effectiveDelayDays) changed.effectiveDelayDays = days;
  for (const key of ['immediateFirstSchedule', 'immediateFirstAssignment']) if (draft[key] !== saved[key]) changed[key] = draft[key];
  return changed;
}

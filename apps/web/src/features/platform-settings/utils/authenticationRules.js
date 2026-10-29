// Authentication Settings rules, mirroring the API's
// (backend/src/features/platform-settings/authenticationInput.js) so problems show immediately.
// The API validates again and has the final say.

export const SESSION_LIFETIME_MIN = 1;
export const SESSION_LIFETIME_MAX = 72;

/** Problem with a typed session lifetime, or null when it is a whole number of hours from 1 to 72. */
export function lifetimeProblem(value) {
  const text = String(value).trim();
  if (!text) return 'Enter the session lifetime in hours.';
  const hours = /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isInteger(hours) || hours < SESSION_LIFETIME_MIN || hours > SESSION_LIFETIME_MAX) {
    return `Session lifetime must be a whole number of hours from ${SESSION_LIFETIME_MIN} to ${SESSION_LIFETIME_MAX}.`;
  }
  return null;
}

export const hoursText = (hours) => `${hours} ${hours === 1 ? 'hour' : 'hours'}`;

/** Inactivity timeout choices in minutes (the API also sends them); "Disabled" is the default. */
export const INACTIVITY_TIMEOUT_CHOICES = [5, 10, 15, 30, 60, 120, 240, 480];
export const INACTIVITY_DISABLED = 'disabled';

export function minutesText(minutes) {
  if (minutes === null) return 'Disabled';
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return `${minutes} minutes (${hoursText(hours)})`;
}

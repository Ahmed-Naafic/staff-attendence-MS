// Branding rules, mirroring the API's (backend/src/features/platform-settings/brandingInput.js)
// so problems show immediately. The API validates again and has the final say.

/** Shown whenever no valid platform name is available (not set, or the request failed). */
export const DEFAULT_PLATFORM_NAME = 'EduTrack';
export const PLATFORM_NAME_MAX = 60;
const CONTROL = /\p{Cc}/u;

/** Length in characters (an emoji counts once), as the API counts it. */
export const nameLength = (value) => [...value.trim()].length;

/** Problem with a platform name, or null when it is valid: trimmed, 1–60 characters, no control characters. */
export function platformNameProblem(value) {
  if (typeof value !== 'string') return 'Platform name must be text.';
  const name = value.trim();
  if (!name) return 'Platform name is required.';
  if (nameLength(name) > PLATFORM_NAME_MAX) return `Platform name must be at most ${PLATFORM_NAME_MAX} characters.`;
  if (CONTROL.test(name)) return 'Platform name cannot contain line breaks, tabs or other control characters.';
  return null;
}

/** A stored or received name when it meets the rules, otherwise null. */
export const validPlatformName = (value) => (platformNameProblem(value) ? null : value.trim());

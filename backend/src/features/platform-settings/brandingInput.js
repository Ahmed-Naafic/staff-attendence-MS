import { badRequest } from '../../common/httpError.js';

/*
 * Validation for Branding (approved rules): the platform name is trimmed, 1–60 characters, with no
 * control characters (line breaks, tabs, …). The web app applies the same rules for immediate
 * feedback (apps/web/src/features/branding/brandingRules.js); these are the ones that count.
 */

export const PLATFORM_NAME_MAX = 60;
const CONTROL = /\p{Cc}/u;

/** Problem with a platform name, or null when it is valid. Length counts characters, not bytes. */
export function platformNameProblem(value) {
  if (typeof value !== 'string') return 'Platform name must be text.';
  const name = value.trim();
  if (!name) return 'Platform name is required.';
  if ([...name].length > PLATFORM_NAME_MAX) return `Platform name must be at most ${PLATFORM_NAME_MAX} characters.`;
  if (CONTROL.test(name)) return 'Platform name cannot contain line breaks, tabs or other control characters.';
  return null;
}

/** Branding update body: exactly { platformName }. Returns the trimmed name. */
export function readBranding(body) {
  const unknown = Object.keys(body).filter((key) => key !== 'platformName');
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);
  const problem = platformNameProblem(body.platformName);
  if (problem) throw badRequest(problem, { platformName: problem });
  return body.platformName.trim();
}

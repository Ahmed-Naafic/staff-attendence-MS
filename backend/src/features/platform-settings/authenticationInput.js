import { badRequest } from '../../common/httpError.js';
import { INACTIVITY_TIMEOUT_CHOICES, isValidInactivityMinutes, isValidLifetimeHours, SESSION_LIFETIME } from '../auth/authPolicy.js';

/*
 * Validation for Authentication Settings (approved rules). Two settings can be changed:
 *   sessionLifetimeHours      whole number of hours from 1 to 72 (a JSON number, not text)
 *   inactivityTimeoutMinutes  null (disabled) or one of 5, 10, 15, 30, 60, 120, 240, 480
 * A request sends one or both. The failed sign-in limit, password rules and MFA are not accepted.
 * The web app applies the same rules for immediate feedback
 * (apps/web/src/features/platform-settings/utils/authenticationRules.js); these are the ones that count.
 */

const FIELDS = ['sessionLifetimeHours', 'inactivityTimeoutMinutes'];
const LIFETIME_PROBLEM = `Session lifetime must be a whole number of hours from ${SESSION_LIFETIME.minHours} to ${SESSION_LIFETIME.maxHours}.`;
const INACTIVITY_PROBLEM = `Inactivity timeout must be disabled (null) or one of ${INACTIVITY_TIMEOUT_CHOICES.join(', ')} minutes.`;

const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key);

/** Authentication update body: { sessionLifetimeHours?, inactivityTimeoutMinutes? }, at least one. */
export function readAuthentication(body) {
  const unknown = Object.keys(body).filter((key) => !FIELDS.includes(key));
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);
  if (!FIELDS.some((key) => has(body, key))) throw badRequest('Send sessionLifetimeHours or inactivityTimeoutMinutes.');

  const values = {};
  const details = {};
  if (has(body, 'sessionLifetimeHours')) {
    if (isValidLifetimeHours(body.sessionLifetimeHours)) values.sessionLifetimeHours = body.sessionLifetimeHours;
    else details.sessionLifetimeHours = LIFETIME_PROBLEM;
  }
  if (has(body, 'inactivityTimeoutMinutes')) {
    const minutes = body.inactivityTimeoutMinutes;
    if (minutes === null || isValidInactivityMinutes(minutes)) values.inactivityTimeoutMinutes = minutes;
    else details.inactivityTimeoutMinutes = INACTIVITY_PROBLEM;
  }
  if (Object.keys(details).length) throw badRequest(Object.values(details).join(' '), details);
  return values;
}

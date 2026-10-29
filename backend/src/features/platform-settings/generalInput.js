import { badRequest } from '../../common/httpError.js';

/*
 * Validation for General Settings (approved rules). A request sends one or more of the fields
 * below; any other field is refused. The web app applies the same rules for immediate feedback
 * (apps/web/src/features/platform-settings/utils/generalRules.js); these are the ones that count.
 *
 * Optional text (description, supportEmail, supportPhone, websiteUrl): text or null; trimmed, and
 * empty means "Not set" (stored as null). Choices (timezone, language, dateFormat, timeFormat,
 * firstDayOfWeek) must be one of the approved values; they cannot be unset. Invalid values are
 * refused, never replaced by a default.
 */

export const DESCRIPTION_MAX = 500;
export const EMAIL_MAX = 254;
export const URL_MAX = 2048;
export const LANGUAGES = ['en'];
export const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'];
export const TIME_FORMATS = ['12h', '24h'];
export const FIRST_DAYS = ['monday', 'sunday'];

/** IANA time zone identifiers supported by this server (Intl), plus UTC. Never a fixed offset. */
const TIME_ZONES = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);
export const isValidTimeZone = (value) => typeof value === 'string' && TIME_ZONES.has(value);

const CONTROL = /\p{Cc}/u;
const length = (text) => [...text].length;

/** Description: line breaks allowed (\r\n and \r are kept as \n); any other control character is refused. */
export function descriptionProblem(text) {
  if (length(text) > DESCRIPTION_MAX) return `Platform description must be at most ${DESCRIPTION_MAX} characters.`;
  if (CONTROL.test(text.replace(/\n/g, ''))) return 'Platform description cannot contain tabs or other control characters (line breaks are allowed).';
  return null;
}

// Local part: the usual unquoted characters, no leading, trailing or double dots. Domain: dotted
// labels of letters, digits and hyphens (not at either end), ending in a letters-only top-level label.
const LOCAL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const TOP_LEVEL = /^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/; // letters, or an internationalized (punycode) name

function validHostname(host) {
  if (host.length > 253) return false;
  const labels = host.split('.');
  return labels.length >= 2 && labels.every((label) => LABEL.test(label)) && TOP_LEVEL.test(labels.at(-1));
}

export function emailProblem(email) {
  const message = 'Support email must be a valid email address, such as support@example.com.';
  if (length(email) > EMAIL_MAX) return `Support email must be at most ${EMAIL_MAX} characters.`;
  if (/\s/u.test(email) || CONTROL.test(email)) return message;
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (at < 1 || local.length > 64 || !LOCAL.test(local) || !validHostname(domain)) return message;
  return null;
}

/** E.164: "+", a country code that does not start with 0, at most 15 digits in all. No spaces or extensions. */
export const phoneProblem = (phone) =>
  /^\+[1-9][0-9]{1,14}$/.test(phone) ? null : 'Support phone must be in international format: + and up to 15 digits, with no spaces, such as +252612345678.';

export function websiteProblem(url) {
  const message = 'Website URL must be a full https:// address, such as https://www.example.com.';
  if (length(url) > URL_MAX) return `Website URL must be at most ${URL_MAX} characters.`;
  if (/\s/u.test(url) || CONTROL.test(url)) return message;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return message;
  }
  if (parsed.protocol !== 'https:' || !/^https:\/\//i.test(url)) return message;
  if (parsed.username || parsed.password) return 'Website URL cannot contain a user name or password.';
  if (!validHostname(parsed.hostname)) return message;
  return null;
}

const TEXT_FIELDS = {
  description: { label: 'Platform description', normalize: (v) => v.replace(/\r\n?/g, '\n'), problem: descriptionProblem },
  supportEmail: { label: 'Support email', normalize: (v) => v.toLowerCase(), problem: emailProblem },
  supportPhone: { label: 'Support phone', normalize: (v) => v, problem: phoneProblem },
  websiteUrl: { label: 'Website URL', normalize: (v) => v, problem: websiteProblem },
};

const CHOICE_FIELDS = {
  timezone: { label: 'Timezone', valid: isValidTimeZone, problem: 'Timezone must be a time zone name supported by the server, such as Africa/Mogadishu or UTC.' },
  language: { label: 'Language', valid: (v) => LANGUAGES.includes(v), problem: 'Language must be en (English).' },
  dateFormat: { label: 'Date format', valid: (v) => DATE_FORMATS.includes(v), problem: `Date format must be one of ${DATE_FORMATS.join(', ')}.` },
  timeFormat: { label: 'Time format', valid: (v) => TIME_FORMATS.includes(v), problem: 'Time format must be 12h or 24h.' },
  firstDayOfWeek: { label: 'First day of week', valid: (v) => FIRST_DAYS.includes(v), problem: 'First day of week must be monday or sunday.' },
};

export const GENERAL_FIELDS = [...Object.keys(TEXT_FIELDS), ...Object.keys(CHOICE_FIELDS)];
export const FIELD_LABELS = Object.fromEntries([...Object.entries(TEXT_FIELDS), ...Object.entries(CHOICE_FIELDS)].map(([key, f]) => [key, f.label]));

const has = (body, key) => Object.prototype.hasOwnProperty.call(body, key);

/** Problem with one field's value, or null; `value` is the normalized value to store. */
export function readField(key, raw) {
  if (TEXT_FIELDS[key]) {
    if (raw === null) return { value: null };
    if (typeof raw !== 'string') return { problem: `${TEXT_FIELDS[key].label} must be text.` };
    const trimmed = raw.trim();
    if (!trimmed) return { value: null };
    const value = TEXT_FIELDS[key].normalize(trimmed);
    const problem = TEXT_FIELDS[key].problem(value);
    return problem ? { problem } : { value };
  }
  const field = CHOICE_FIELDS[key];
  return typeof raw === 'string' && field.valid(raw) ? { value: raw } : { problem: field.problem };
}

/** General update body: one or more of GENERAL_FIELDS. Returns the normalized values; nothing else. */
export function readGeneral(body) {
  const unknown = Object.keys(body).filter((key) => !GENERAL_FIELDS.includes(key));
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);
  if (!GENERAL_FIELDS.some((key) => has(body, key))) throw badRequest(`Send at least one of: ${GENERAL_FIELDS.join(', ')}.`);

  const values = {};
  const details = {};
  for (const key of GENERAL_FIELDS) {
    if (!has(body, key)) continue;
    const { value, problem } = readField(key, body[key]);
    if (problem) details[key] = problem;
    else values[key] = value;
  }
  if (Object.keys(details).length) throw badRequest(Object.values(details).join(' '), details);
  return values;
}

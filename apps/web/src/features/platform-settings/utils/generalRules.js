// General Settings rules, mirroring the API's
// (backend/src/features/platform-settings/generalInput.js) so problems show immediately.
// The API validates again and has the final say (e.g. which time zones the server supports).

export const DESCRIPTION_MAX = 500;
export const EMAIL_MAX = 254;
export const URL_MAX = 2048;
export const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'];
export const TIME_FORMATS = ['12h', '24h'];
export const FIRST_DAYS = ['monday', 'sunday'];
export const LANGUAGES = ['en'];

const CONTROL = /\p{Cc}/u;
export const textLength = (text) => [...text].length;

const LOCAL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const TOP_LEVEL = /^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

function validHostname(host) {
  if (host.length > 253) return false;
  const labels = host.split('.');
  return labels.length >= 2 && labels.every((label) => LABEL.test(label)) && TOP_LEVEL.test(labels.at(-1));
}

function descriptionProblem(text) {
  if (textLength(text) > DESCRIPTION_MAX) return `Platform description must be at most ${DESCRIPTION_MAX} characters.`;
  if (CONTROL.test(text.replace(/\n/g, ''))) return 'Platform description cannot contain tabs or other control characters (line breaks are allowed).';
  return null;
}

function emailProblem(email) {
  const message = 'Support email must be a valid email address, such as support@example.com.';
  if (textLength(email) > EMAIL_MAX) return `Support email must be at most ${EMAIL_MAX} characters.`;
  if (/\s/u.test(email) || CONTROL.test(email)) return message;
  const at = email.lastIndexOf('@');
  const local = email.slice(0, at);
  if (at < 1 || local.length > 64 || !LOCAL.test(local) || !validHostname(email.slice(at + 1))) return message;
  return null;
}

const phoneProblem = (phone) =>
  /^\+[1-9][0-9]{1,14}$/.test(phone) ? null : 'Support phone must be in international format: + and up to 15 digits, with no spaces, such as +252612345678.';

function websiteProblem(url) {
  const message = 'Website URL must be a full https:// address, such as https://www.example.com.';
  if (textLength(url) > URL_MAX) return `Website URL must be at most ${URL_MAX} characters.`;
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

const TEXT = {
  description: { normalize: (v) => v.replace(/\r\n?/g, '\n'), problem: descriptionProblem },
  supportEmail: { normalize: (v) => v.toLowerCase(), problem: emailProblem },
  supportPhone: { normalize: (v) => v, problem: phoneProblem },
  websiteUrl: { normalize: (v) => v, problem: websiteProblem },
};

const timeZones = () => {
  try {
    return new Set([...Intl.supportedValuesOf('timeZone'), 'UTC']);
  } catch {
    return null; // Older browsers: the server checks.
  }
};
const TIME_ZONES = timeZones();

const CHOICES = {
  timezone: { valid: (v) => (TIME_ZONES ? TIME_ZONES.has(v) : Boolean(v)), problem: 'Choose a time zone.' },
  language: { valid: (v) => LANGUAGES.includes(v), problem: 'Choose a language.' },
  dateFormat: { valid: (v) => DATE_FORMATS.includes(v), problem: 'Choose a date format.' },
  timeFormat: { valid: (v) => TIME_FORMATS.includes(v), problem: 'Choose a time format.' },
  firstDayOfWeek: { valid: (v) => FIRST_DAYS.includes(v), problem: 'Choose the first day of the week.' },
};

export const GENERAL_FIELDS = [...Object.keys(TEXT), ...Object.keys(CHOICES)];

/**
 * Checks one field as typed: { value } (the value to send: trimmed, null when empty for the
 * optional text fields) or { problem }.
 */
export function checkField(key, raw) {
  if (TEXT[key]) {
    const trimmed = String(raw ?? '').trim();
    if (!trimmed) return { value: null };
    const value = TEXT[key].normalize(trimmed);
    const problem = TEXT[key].problem(value);
    return problem ? { problem } : { value };
  }
  return CHOICES[key].valid(raw) ? { value: raw } : { problem: CHOICES[key].problem };
}

/** The stored value as the form shows it ('' for not set) compared with what would be sent. */
export const sameAsStored = (key, stored, raw) => {
  const { value, problem } = checkField(key, raw);
  return !problem && (value ?? '') === (stored ?? '');
};

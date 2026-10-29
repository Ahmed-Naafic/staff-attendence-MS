import { badRequest } from '../../common/httpError.js';
import { isValidPhone } from '../schools/schoolInput.js';

/*
 * Validation for Branch Management requests (School Owner). Collects every problem so the web app
 * can show them next to the fields: 400 { code: 'VALIDATION_ERROR', details: { field: message } }.
 * Rules: docs/business-rules.md → Branch management. The web app applies the same rules first.
 */

export const NAME_MAX = 120;
/** Approved accuracy threshold for a captured position, in metres. */
export const ACCURACY_MAX = 50;
/** A location change may be scheduled at most this far ahead. */
export const SCHEDULE_MAX_MS = 366 * 24 * 60 * 60 * 1000;
/** An effective time up to this far in the past counts as "now" (the request took time to arrive). */
export const NOW_GRACE_MS = 60 * 1000;

const FIELDS = {
  name: { label: 'Branch name', required: true, max: NAME_MAX },
  address: { label: 'Address', required: true, max: 200 },
  city: { label: 'City', required: true, max: 80 },
  phone: { label: 'Phone', required: false, max: 24 },
};
const DETAIL_FIELDS = Object.keys(FIELDS);

// Fields a request may never set: refused with a clear message instead of "unknown field".
const FIXED = {
  code: 'The branch code is generated and cannot be set or changed.',
  number: 'The branch number is generated and cannot be set or changed.',
  schoolId: 'The school is decided by your account and cannot be set.',
  school: 'The school is decided by your account and cannot be set.',
  status: 'Use Suspend or Reactivate to change the status.',
  id: 'The branch id cannot be set.',
};

// Control characters left after whitespace has been collapsed (tabs and line breaks become spaces).
const CONTROL = /\p{Cc}/u;

/** Trimmed, with runs of whitespace collapsed to one space. */
export const normalizeText = (value) => value.trim().replace(/\s+/g, ' ');

/**
 * The key two branch names are compared by: NFKC, then upper-case and lower-case (locale-independent
 * case folding, so "Straße" and "STRASSE" match; no Turkish i rules), then NFKC again.
 */
export const nameKey = (name) => normalizeText(name).normalize('NFKC').toUpperCase().toLowerCase().normalize('NFKC');

function refuseUnknown(body, allowed) {
  const keys = Object.keys(body);
  const fixed = keys.filter((key) => FIXED[key]);
  if (fixed.length) throw badRequest(FIXED[fixed[0]], Object.fromEntries(fixed.map((key) => [key, FIXED[key]])));
  const unknown = keys.filter((key) => !allowed.includes(key));
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);
}

function readDetails(body, { partial }) {
  const values = {};
  const errors = {};
  for (const field of DETAIL_FIELDS) {
    if (partial && !(field in body)) continue;
    const rule = FIELDS[field];
    const raw = body[field];
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      errors[field] = `${rule.label} must be text.`;
      continue;
    }
    const value = normalizeText(raw ?? '');
    if (!value) {
      if (rule.required) errors[field] = `${rule.label} is required.`;
      else values[field] = null;
    } else if (value.length > rule.max) errors[field] = `${rule.label} must be at most ${rule.max} characters.`;
    else if (CONTROL.test(value)) errors[field] = `${rule.label} cannot contain control characters.`;
    else if (field === 'phone' && !isValidPhone(value)) errors[field] = 'Enter a valid phone number, e.g. +252 61 2345678.';
    else values[field] = value;
  }
  return { values, errors };
}

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

/**
 * A captured position { latitude, longitude, accuracy, confirmed: true } → { latitude, longitude,
 * accuracyMeters } (coordinates to 6 decimal places, accuracy to 0.1 m); null with `errors` filled in.
 */
function readPosition(source, errors, prefix = '') {
  const key = (name) => (prefix ? `${prefix}.${name}` : name);
  const { latitude, longitude, accuracy, confirmed } = source;
  if (!isNumber(latitude) || latitude < -90 || latitude > 90) errors[key('latitude')] = 'Latitude must be a number from -90 to 90.';
  if (!isNumber(longitude) || longitude < -180 || longitude > 180) errors[key('longitude')] = 'Longitude must be a number from -180 to 180.';
  if (!isNumber(accuracy) || accuracy <= 0) errors[key('accuracy')] = 'The accuracy of the captured position is missing.';
  else if (accuracy > ACCURACY_MAX) {
    errors[key('accuracy')] = `The position is accurate to ${Math.round(accuracy)} m; it must be ${ACCURACY_MAX} m or better. Capture it again.`;
  }
  if (isNumber(latitude) && isNumber(longitude) && round(latitude, 6) === 0 && round(longitude, 6) === 0) {
    errors[key('latitude')] = 'The position 0, 0 is not a real location. Capture it again.';
  }
  if (confirmed !== true) errors[key('confirmed')] = 'Confirm that this is the branch location.';
  if (Object.keys(errors).length) return null;
  return { latitude: round(latitude, 6), longitude: round(longitude, 6), accuracyMeters: round(accuracy, 1) };
}

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const POSITION_KEYS = ['latitude', 'longitude', 'accuracy', 'confirmed'];

/** Create: name, address, city, optional phone and the first location (effective at once). */
export function readBranchCreation(body) {
  refuseUnknown(body, [...DETAIL_FIELDS, 'location']);
  const { values, errors } = readDetails(body, { partial: false });
  let location = null;
  if (!isObject(body.location)) errors.location = 'Capture the branch location.';
  else {
    const unknown = Object.keys(body.location).filter((k) => !POSITION_KEYS.includes(k));
    if (unknown.length) throw badRequest(`Unknown location fields: ${unknown.join(', ')}.`);
    location = readPosition(body.location, errors, 'location');
  }
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return { ...values, location };
}

/** Edit: any of name, address, city, phone (never the code, school, status or location). */
export function readBranchUpdate(body) {
  if (['location', 'latitude', 'longitude'].some((key) => key in body)) {
    throw badRequest('Use Change Location to change the branch location.', { location: 'The location is changed with Change Location.' });
  }
  refuseUnknown(body, DETAIL_FIELDS);
  const { values, errors } = readDetails(body, { partial: true });
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  if (!Object.keys(values).length) throw badRequest('Send at least one field to change.');
  return values;
}

/** Suspension reason: required, 3–500 characters. */
export function readBranchSuspension(body) {
  refuseUnknown(body, ['reason']);
  const reason = typeof body.reason === 'string' ? normalizeText(body.reason) : '';
  if (!reason) throw badRequest('A reason is required to suspend a branch.', { reason: 'Enter the reason for suspending this branch.' });
  if (reason.length < 3 || reason.length > 500) throw badRequest('The reason must be 3–500 characters.', { reason: 'The reason must be 3–500 characters.' });
  return reason;
}

/**
 * Location change: a captured position plus effectiveFrom ('now' or an ISO date-time with a zone).
 * Times are judged by the server's clock `now`: up to a minute in the past counts as now; earlier
 * is refused (no backdating); at most a year ahead. Returns { position, effectiveFrom: Date, immediate }.
 */
export function readLocationChange(body, now = new Date()) {
  refuseUnknown(body, [...POSITION_KEYS, 'effectiveFrom']);
  const errors = {};
  const position = readPosition(body, errors);
  let effectiveFrom = null;
  let immediate = false;
  const raw = body.effectiveFrom;
  if (raw === 'now') {
    effectiveFrom = now;
    immediate = true;
  } else if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(raw) || Number.isNaN(Date.parse(raw))) {
    errors.effectiveFrom = 'Choose when the new location takes effect: now, or a date and time.';
  } else {
    const at = new Date(raw);
    if (at.getTime() < now.getTime() - NOW_GRACE_MS) errors.effectiveFrom = 'The effective time cannot be in the past. Choose now or a later time.';
    else if (at.getTime() > now.getTime() + SCHEDULE_MAX_MS) errors.effectiveFrom = 'The effective time can be at most one year ahead.';
    else if (at.getTime() <= now.getTime()) {
      effectiveFrom = now;
      immediate = true;
    } else effectiveFrom = at;
  }
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return { position, effectiveFrom, immediate };
}

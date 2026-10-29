// Client-side checks for Branch Management, mirroring the API's rules (backend/src/features/
// branches/branchInput.js) so problems show immediately. The API validates again and has the
// final say (including name uniqueness and the server-clock checks of effective times).

const PHONE_PATTERN = /^\+?\d(?:[ -]?\d)+$/;
const CONTROL = /\p{Cc}/u;

/** Approved accuracy threshold for a captured position, in metres. */
export const ACCURACY_MAX = 50;
export const PAGE_SIZE = 8;

export const BRANCH_FIELDS = {
  name: { label: 'Branch name', required: true, max: 120 },
  address: { label: 'Address', required: true, max: 200 },
  city: { label: 'City', required: true, max: 80 },
  phone: { label: 'Phone', required: false, max: 24 },
};

/** Trimmed, with runs of whitespace collapsed to one space (as the server stores it). */
export const normalizeText = (value) => (value ?? '').trim().replace(/\s+/g, ' ');

/** How the server compares names: NFKC + locale-independent case folding. */
export const nameKey = (name) => normalizeText(name).normalize('NFKC').toUpperCase().toLowerCase().normalize('NFKC');

function problem(field, value) {
  const rule = BRANCH_FIELDS[field];
  if (!value) return rule.required ? `${rule.label} is required.` : null;
  if (value.length > rule.max) return `${rule.label} must be at most ${rule.max} characters.`;
  if (CONTROL.test(value)) return `${rule.label} cannot contain control characters.`;
  if (field === 'phone') {
    const digits = value.replace(/\D/g, '').length;
    if (!PHONE_PATTERN.test(value) || digits < 7 || digits > 15) return 'Enter a valid phone number, e.g. +252 61 2345678.';
  }
  return null;
}

/** Normalized values ready to send. */
export const cleanBranchValues = (values, fields) => Object.fromEntries(fields.map((field) => [field, normalizeText(values[field])]));

/** { field: message } for every invalid field (empty when all are valid). */
export function validateBranch(values, fields) {
  return Object.fromEntries(fields.map((field) => [field, problem(field, values[field])]).filter(([, message]) => message));
}

/** Suspension reason: required, 3–500 characters. */
export function validateReason(reason) {
  const value = normalizeText(reason);
  if (!value) return 'Enter the reason for suspending this branch.';
  if (value.length < 3 || value.length > 500) return 'The reason must be 3–500 characters.';
  return null;
}

/** Why a captured position cannot be used, or null. */
export function positionProblem(position) {
  if (!position) return 'Capture the branch location.';
  const { latitude, longitude, accuracy } = position;
  if (![latitude, longitude, accuracy].every(Number.isFinite)) return 'The captured position is incomplete. Capture it again.';
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return 'The captured position is not valid. Capture it again.';
  if (latitude === 0 && longitude === 0) return 'The position 0, 0 is not a real location. Capture it again.';
  if (accuracy > ACCURACY_MAX) {
    return `The position is only accurate to ${Math.round(accuracy)} m; it must be ${ACCURACY_MAX} m or better. Move to an open spot, wait a moment and capture again.`;
  }
  return null;
}

/** Message for a failed device-location request (GeolocationPositionError code, or our own reasons). */
export function locationErrorMessage(reason) {
  switch (reason) {
    case 'unsupported':
      return 'This browser cannot share your location. Use a browser with location services (on a phone or laptop with GPS).';
    case 'insecure':
      return 'Location can only be shared on a secure (https) connection.';
    case 1:
      return 'Location permission was denied. Allow location for this site in your browser settings, then try again.';
    case 2:
      return 'Your location is not available. Turn on location services (GPS) on this device and try again.';
    case 3:
      return 'Finding your location took too long. Move to an open spot and try again.';
    default:
      return 'Your location could not be captured. Try again.';
  }
}

/** A <input type="datetime-local"> value read as UTC → ISO time, or null when it is not a full date and time. */
export function utcFromInput(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value ?? '')) return null;
  const iso = `${value}:00.000Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Problem with a scheduled effective time (UTC input value), judged against `now`; the server checks again. */
export function effectiveProblem(value, now = Date.now()) {
  const iso = utcFromInput(value);
  if (!iso) return 'Choose the date and time (UTC) the new location takes effect.';
  const at = Date.parse(iso);
  if (at <= now) return 'Choose a time in the future, or choose Now.';
  if (at > now + 366 * 24 * 60 * 60 * 1000) return 'The effective time can be at most one year ahead.';
  return null;
}

/** e.g. 2.046934, 45.318162 */
export const formatPosition = (l) => `${Number(l.latitude).toFixed(6)}, ${Number(l.longitude).toFixed(6)}`;

/** e.g. 2026-10-24 14:05 UTC — owner pages show times in UTC (see business-rules.md, Not yet decided). */
export const formatUtc = (iso) => `${new Date(iso).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

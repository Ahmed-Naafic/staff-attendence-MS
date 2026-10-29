/*
 * On-device location check before an event is saved (docs/business-rules.md → Staff mobile app →
 * Location check on the device). It uses the same limits and distance formula as the server
 * (backend/src/features/attendance/geofence.js) only for early feedback: the server judges every
 * event again against the branch location in effect at the event time and has the final say.
 */

export const GEOFENCE_RADIUS_M = 100;
export const ACCURACY_MAX_M = 50;
const EARTH_RADIUS_M = 6_371_008.8;

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const radians = (degrees) => (degrees * Math.PI) / 180;

/** Great-circle (haversine) distance between two { latitude, longitude } points, in metres. */
export function distanceMeters(a, b) {
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Bearing from a to b in degrees (0 = north, clockwise), for the location diagram. */
export function bearingDegrees(a, b) {
  const y = Math.sin(radians(b.longitude - a.longitude)) * Math.cos(radians(b.latitude));
  const x = Math.cos(radians(a.latitude)) * Math.sin(radians(b.latitude)) - Math.sin(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.cos(radians(b.longitude - a.longitude));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** The branch location in effect at `at` from today's data (the scheduled change once it applies). */
export function branchLocationAt(today, at) {
  const scheduled = today?.scheduledBranchLocation;
  if (scheduled && Date.parse(scheduled.effectiveFrom) <= at.getTime()) return scheduled;
  const current = today?.branchLocation;
  if (current && Date.parse(current.effectiveFrom) <= at.getTime()) return current;
  return null;
}

const usable = ({ latitude, longitude }) =>
  isNumber(latitude) && isNumber(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && !(latitude === 0 && longitude === 0);

/**
 * { ok, reason, distanceMeters } for a position { latitude, longitude, accuracy } against a branch
 * location (or null). Reasons, in order: no_position, invalid_position, accuracy_too_low,
 * no_branch_location, outside_geofence. Boundaries are inclusive (50 m, 100 m), as on the server.
 */
export function checkPosition(position, branchLocation) {
  const refuse = (reason, distance = null) => ({ ok: false, reason, distanceMeters: distance });
  if (!position) return refuse('no_position');
  if (!usable(position)) return refuse('invalid_position');
  if (!isNumber(position.accuracy) || position.accuracy <= 0 || position.accuracy > ACCURACY_MAX_M) return refuse('accuracy_too_low');
  if (!branchLocation) return refuse('no_branch_location');
  const distance = distanceMeters(position, branchLocation);
  if (distance > GEOFENCE_RADIUS_M) return refuse('outside_geofence', distance);
  return { ok: true, reason: null, distanceMeters: distance };
}

export const POSITION_MESSAGES = {
  no_position: 'Your location is needed. Turn on location services and try again.',
  invalid_position: 'Your location could not be read. Try again.',
  accuracy_too_low: 'Your location is not accurate enough (it must be 50 m or better). Move to an open spot and try again.',
  no_branch_location: 'Your branch location is not available on this phone. Connect to the internet and refresh, then try again.',
  outside_geofence: 'You are more than 100 m from your branch. Move closer and try again.',
};

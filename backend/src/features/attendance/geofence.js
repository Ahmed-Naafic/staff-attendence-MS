import { notFound } from '../../common/httpError.js';
import { getPrisma } from '../../config/prisma.js';
import { ACCURACY_MAX } from '../branches/branchInput.js';
import { locationAt, operatingState } from '../branches/branches.service.js';

/*
 * Attendance geofence (approved rules: docs/business-rules.md → GPS and geofence, and Branch
 * management → GPS location). A position is accepted when it is usable, accurate to 50 m or better
 * and at most 100 m from the branch location in effect at the event's time. Not used by any route
 * yet: the attendance API decides which events are judged (check-in, check-out) and which event
 * times are allowed (offline limits are not decided).
 */

/** Check-in is refused more than this far from the branch, in metres. */
export const GEOFENCE_RADIUS_M = 100;
/** Mean Earth radius (IUGG), in metres. */
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

/** Coordinates in range and not exactly 0, 0 (no real position). */
const usable = ({ latitude, longitude }) =>
  isNumber(latitude) && isNumber(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && !(latitude === 0 && longitude === 0);

/**
 * Judges a reported position { latitude, longitude, accuracy } against a branch location
 * { latitude, longitude } (or null when none is in effect). Returns { accepted, reason,
 * distanceMeters }: reason is null when accepted, otherwise the first problem found, in order:
 * no_position, invalid_position, accuracy_too_low, no_branch_location, outside_geofence.
 * Boundaries are inclusive: exactly 100 m and exactly 50 m accuracy are accepted.
 */
export function judgePosition(position, branchLocation) {
  const refuse = (reason, distance = null) => ({ accepted: false, reason, distanceMeters: distance });
  if (!position || typeof position !== 'object') return refuse('no_position');
  if (!usable(position)) return refuse('invalid_position');
  if (!isNumber(position.accuracy) || position.accuracy <= 0 || position.accuracy > ACCURACY_MAX) return refuse('accuracy_too_low');
  if (!branchLocation) return refuse('no_branch_location');
  const distance = distanceMeters(position, branchLocation);
  if (distance > GEOFENCE_RADIUS_M) return refuse('outside_geofence', distance);
  return { accepted: true, reason: null, distanceMeters: distance };
}

/**
 * Judges a position for a branch at the event time `at`: against the location in effect then
 * (never a later one), with the branch's operating state now (branch and school both ACTIVE).
 * Returns { operating, operatingReasons, locationId, accepted, reason, distanceMeters }; 404 when
 * the branch does not exist. Writes nothing.
 */
export async function checkBranchPosition({ branchId, position, at }, client = getPrisma()) {
  if (!(at instanceof Date) || Number.isNaN(at.getTime())) throw new TypeError('checkBranchPosition needs a valid event time.');
  const branch = await client.branch.findUnique({ where: { id: branchId }, select: { id: true, status: true, school: { select: { status: true } } } });
  if (!branch) throw notFound('Branch not found.');
  const location = await locationAt(branch.id, at, client);
  const { operating, reasons } = operatingState(branch, branch.school);
  return { operating, operatingReasons: reasons, locationId: location?.id ?? null, ...judgePosition(position, location) };
}

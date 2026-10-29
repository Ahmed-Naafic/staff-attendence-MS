/*
 * Checks that API answers have the shape this app relies on (the contracts in backend/src:
 * features/auth/auth.routes.js and features/attendance/attendance.service.js). A wrong shape is
 * reported as an invalid response instead of failing later on a missing field.
 */
import { ApiError } from './client';

const isString = (v) => typeof v === 'string';
const isNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isTime = (v) => isString(v) && /^\d{2}:\d{2}$/.test(v);
const isDay = (v) => isString(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isInstant = (v) => isString(v) && !Number.isNaN(Date.parse(v));

function check(ok, what) {
  if (!ok) throw new ApiError({ kind: 'invalid_response', message: `The server sent an unexpected answer (${what}).` });
}

export function checkUser(user) {
  check(isObject(user) && isString(user.id) && isString(user.name) && isString(user.role) && typeof user.mustChangePassword === 'boolean', 'user');
  return user;
}

export function checkLogin(data) {
  check(isObject(data) && isString(data.token) && data.token.length >= 20 && isInstant(data.expiresAt), 'sign-in');
  checkUser(data.user);
  return data;
}

export function checkSession(data) {
  check(isObject(data) && (data.user === null || isObject(data.user)), 'session');
  if (data.user) checkUser(data.user);
  return data;
}

export function checkEvent(e) {
  check(
    isObject(e) &&
      isString(e.id) &&
      isString(e.clientEventId) &&
      (e.type === 'CHECK_IN' || e.type === 'CHECK_OUT') &&
      isInstant(e.occurredAt) &&
      isInstant(e.receivedAt) &&
      isDay(e.workDate) &&
      isObject(e.shift) &&
      isNumber(e.distanceMeters),
    'attendance event',
  );
  return e;
}

const checkLocation = (l) => check(l === null || (isObject(l) && isNumber(l.latitude) && isNumber(l.longitude) && isInstant(l.effectiveFrom)), 'branch location');

export function checkToday(data) {
  check(isObject(data) && isDay(data.date) && isString(data.timeZone) && typeof data.checkOutEnabled === 'boolean' && Array.isArray(data.shifts) && Array.isArray(data.events), 'today');
  for (const s of data.shifts) check(isObject(s) && isString(s.key) && isString(s.name) && isTime(s.start) && isTime(s.end) && isTime(s.checkInOpensAt) && isTime(s.lateAfter), 'shift');
  data.events.forEach(checkEvent);
  checkLocation(data.branchLocation ?? null);
  checkLocation(data.scheduledBranchLocation ?? null);
  return { ...data, branchLocation: data.branchLocation ?? null, scheduledBranchLocation: data.scheduledBranchLocation ?? null };
}

export function checkProfile(data) {
  check(isObject(data) && isString(data.name) && isObject(data.branch) && isObject(data.school), 'profile');
  return data;
}

export function checkHistory(data) {
  check(isObject(data) && isDay(data.from) && isDay(data.to) && Array.isArray(data.events), 'history');
  data.events.forEach(checkEvent);
  return data;
}

export function checkEventResponse(data) {
  check(isObject(data), 'attendance event');
  checkEvent(data.event);
  return data;
}

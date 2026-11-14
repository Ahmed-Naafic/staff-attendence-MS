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

// ---- teachers' lesson attendance (backend/src/features/student-attendance/lessonAttendance.service.js) ----

function checkLesson(l) {
  check(
    isObject(l) && isString(l.key) && isDay(l.date) && isNumber(l.period) && isTime(l.start) && isTime(l.end) && isObject(l.section) && isString(l.section.id) && isObject(l.subject) && isString(l.subject.name) && isString(l.state) && isInstant(l.deadlineAt) && isInstant(l.uploadUntil) && Array.isArray(l.students),
    'lesson',
  );
  for (const s of l.students) check(isObject(s) && isString(s.id) && isString(s.name) && (s.status === null || isString(s.status)) && isString(s.effective), 'lesson student');
  return l;
}

export function checkLessons(data) {
  check(isObject(data) && isDay(data.date) && Array.isArray(data.lessons), 'lessons');
  data.lessons.forEach(checkLesson);
  return data;
}

export function checkLessonMarks(data) {
  check(isObject(data) && Array.isArray(data.results), 'lesson marks');
  for (const r of data.results) check(isObject(r) && isString(r.student) && (r.result === 'recorded' || r.result === 'refused'), 'lesson mark result');
  if (data.lesson) checkLesson(data.lesson);
  return data;
}

/** The teacher's week: { date, days, rows, lessons: [{ weekday, period, start, end, section, subject }], perDay, total }. */
export function checkTimetable(data) {
  check(isObject(data) && isDay(data.date) && Array.isArray(data.days) && Array.isArray(data.lessons) && isNumber(data.total), 'timetable');
  for (const l of data.lessons) {
    check(isObject(l) && isString(l.weekday) && isTime(l.start) && isTime(l.end) && isObject(l.section) && isString(l.section.displayName) && isObject(l.subject) && isString(l.subject.name), 'timetable lesson');
  }
  return data;
}

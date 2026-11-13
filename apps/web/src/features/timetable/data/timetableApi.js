import { apiRequest } from '../../../lib/api.js';

/*
 * Bell schedules and section timetables. The school, and a Manager's branch, are decided by the
 * server from the account. Writes throw ApiError: 400 VALIDATION_ERROR (details per field, e.g.
 * 'periods.2', 'lessons.5'), 403 FORBIDDEN (a Manager and a school-wide schedule), 404 NOT_FOUND,
 * 409 NAME_TAKEN / TEACHER_CLASH (details.clashes) / BELL_SCHEDULE_IN_USE / BELL_SCHEDULE_INACTIVE /
 * BELL_TIMES_MISSING / BELL_TIMES_IN_USE / VERSION_IN_EFFECT / VERSION_EXISTS / SECTION_INACTIVE /
 * YEAR_CLOSED / SCHOOL_SUSPENDED / BRANCH_NOT_OPERATING.
 */
const base = (role) => (role === 'OWNER' ? '/owner' : '/manager');
const id = (value) => encodeURIComponent(value);

// ---- bell schedules ----
/** { today, items: [bell schedule with `current` times] }; filters: status, branch (Owner: 'school' or an id). */
export const loadBellSchedules = (role, { status, branch } = {}) => apiRequest(`${base(role)}/bell-schedules`, { query: { status, branch: role === 'OWNER' ? branch : undefined } });
/** { today, firstEditableDate, bellSchedule: { …, versions: [{ id, effectiveFrom, state, periods, summary, lessonNumbers }] } } */
export const loadBellSchedule = (role, bellId) => apiRequest(`${base(role)}/bell-schedules/${id(bellId)}`);
export const createBellSchedule = async (role, values) => (await apiRequest(`${base(role)}/bell-schedules`, { method: 'POST', body: values })).bellSchedule;
export const updateBellSchedule = async (role, bellId, values) => (await apiRequest(`${base(role)}/bell-schedules/${id(bellId)}`, { method: 'PATCH', body: values })).bellSchedule;
export const setBellScheduleActive = async (role, bellId, active) =>
  (await apiRequest(`${base(role)}/bell-schedules/${id(bellId)}/${active ? 'reactivate' : 'deactivate'}`, { method: 'POST' })).bellSchedule;
/** { effectiveFrom, periods } → the schedule, with `warnings` (lessons that no longer take place). */
export const saveBellTimes = (role, bellId, body) => apiRequest(`${base(role)}/bell-schedules/${id(bellId)}/times`, { method: 'PUT', body });
export const cancelBellTimes = (role, bellId, versionId) => apiRequest(`${base(role)}/bell-schedules/${id(bellId)}/times/${id(versionId)}/cancel`, { method: 'POST' });

// ---- timetables ----
/** Sections of a year with their timetable today: { today, academicYear, items: [{ section, timetable, nextChange }] }. */
export const loadTimetables = (role, { academicYear, branch } = {}) => apiRequest(`${base(role)}/timetables`, { query: { academicYear, branch: role === 'OWNER' ? branch : undefined } });
/** One section: { today, firstEditableDate, section, versions, selected, curriculumSet, subjects, teachers }. */
export const loadTimetable = (role, sectionId, versionId) => apiRequest(`${base(role)}/sections/${id(sectionId)}/timetable`, { query: { version: versionId || undefined } });
/** { effectiveFrom, bellSchedule, lessons: [{ weekday, period, subject, teacher?, room? }] } → the timetable, with `warnings`. */
export const saveTimetable = (role, sectionId, body) => apiRequest(`${base(role)}/sections/${id(sectionId)}/timetable`, { method: 'PUT', body });
export const cancelTimetableVersion = (role, sectionId, versionId) => apiRequest(`${base(role)}/sections/${id(sectionId)}/timetable/${id(versionId)}/cancel`, { method: 'POST' });
/** The section's days from..to: { days: [{ date, schoolDay, reason, timetableDay, bellSchedule, periods, halves }] }. */
export const loadSectionLessons = (role, sectionId, { from, to } = {}) => apiRequest(`${base(role)}/sections/${id(sectionId)}/lessons`, { query: { from, to } });

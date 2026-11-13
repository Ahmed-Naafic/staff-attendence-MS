import { apiDownload, apiRequest } from '../../../lib/api.js';

/*
 * Student attendance (Manager half-day sessions, excuses, settings). The school, and a Manager's
 * branch, are decided by the server from the account. Errors (ApiError): 403 FEATURE_DISABLED (the
 * school's Student Attendance is off), 403 FORBIDDEN (Owner on a Manager action), 403
 * SETTING_LOCKED, 400 VALIDATION_ERROR (details per field, e.g. 'marks.3.reason'), 404 NOT_FOUND,
 * 409 NOT_A_SCHOOL_DAY / HALF_NOT_AVAILABLE / SESSION_NOT_OPEN_YET / EDIT_PERIOD_OVER /
 * SUSPENDED_THEN / STALE_MARKS (details.students) / YEAR_CLOSED / SECTION_INACTIVE /
 * BRANCH_NOT_OPERATING / ALREADY_CANCELLED.
 */
const base = (role) => (role === 'OWNER' ? '/owner' : '/manager');
const id = (value) => encodeURIComponent(value);

// ---- settings (available while the feature is off) ----
/** { featureEnabled, fields, platformDefaults, school: { values, effective, sources }, branchOverridable, branch, canEdit } */
export const loadAttendanceSettings = (role, { branch } = {}) => apiRequest(`${base(role)}/student-attendance/settings`, { query: { branch: role === 'OWNER' ? branch || undefined : undefined } });
/** { <key>: value | null, branchOverridable? (Owner) } → the settings screen again. */
export const saveAttendanceSettings = (role, body) => apiRequest(`${base(role)}/student-attendance/settings`, { method: 'PUT', body });

// ---- the day and its sessions ----
/** { date, today, branches, totals, items: [{ section, schoolDay, reasonText, students, halves: [{ half, label, start, end, state, canTake, session }] }] } */
export const loadAttendanceDay = (role, { date, branch } = {}) => apiRequest(`${base(role)}/student-attendance/day`, { query: { date, branch: role === 'OWNER' ? branch || undefined : undefined } });
/** Manager: opens (or returns) a section's session → { created, session, section, students, counts, canMark, reasonRequiredForChanges } */
export const openAttendanceSession = (body) => apiRequest('/manager/student-attendance/sessions', { method: 'POST', body });
export const loadAttendanceSession = (role, sessionId) => apiRequest(`${base(role)}/student-attendance/sessions/${id(sessionId)}`);
/** Manager: { marks: [{ student, status, reason?, note?, version }] } → the session. */
export const saveAttendanceMarks = (sessionId, marks) => apiRequest(`/manager/student-attendance/sessions/${id(sessionId)}/marks`, { method: 'PUT', body: { marks } });
/** Manager: adds students enrolled since the session opened → { added, …session }. */
export const refreshClassList = (sessionId) => apiRequest(`/manager/student-attendance/sessions/${id(sessionId)}/class-list`, { method: 'POST' });
export const loadSessionHistory = (role, sessionId) => apiRequest(`${base(role)}/student-attendance/sessions/${id(sessionId)}/history`);

// ---- excuses ----
/** { items, total, page, pageSize, pageCount, canManage } */
export const loadExcuses = (role, filters = {}) => apiRequest(`${base(role)}/student-excuses`, { query: { ...filters, branch: role === 'OWNER' ? filters.branch || undefined : undefined } });
/** Manager: { student, startDate, endDate?, half?, periods?, reason, note? } */
export const createExcuse = async (body) => (await apiRequest('/manager/student-excuses', { method: 'POST', body })).excuse;
export const cancelExcuse = async (excuseId) => (await apiRequest(`/manager/student-excuses/${id(excuseId)}/cancel`, { method: 'POST' })).excuse;

// ---- completion ----
/** { from, to, today, totals: { halves, lessons }, days: [{ date, branches: [{ branch, halves, lessons, attention }] }] } */
export const loadCompletion = (role, { from, to, branch } = {}) => apiRequest(`${base(role)}/student-attendance/completion`, { query: { from: from || undefined, to: to || undefined, branch: role === 'OWNER' ? branch || undefined : undefined } });

// ---- reports ----
const reportQuery = (role, f) => ({ ...f, branch: role === 'OWNER' ? f.branch || undefined : undefined });
/** { filters, branches, totals, sections, students: { items, total, page, pageSize, pageCount }, options: { sections, classes, subjects } } */
export const loadReport = (role, filters) => apiRequest(`${base(role)}/student-attendance/reports`, { query: reportQuery(role, filters) });
/** { blob, filename, rows } of the whole report as 'csv' or 'xlsx'. */
export const downloadReport = (role, filters, format) => apiDownload(`${base(role)}/student-attendance/reports/export.${format}`, { query: reportQuery(role, { ...filters, page: undefined, pageSize: undefined }) });
/** One student: { student, from, to, summary: { manager, lessons }, items } */
export const loadStudentHistory = (role, studentId, { from, to } = {}) => apiRequest(`${base(role)}/student-attendance/students/${id(studentId)}`, { query: { from, to } });

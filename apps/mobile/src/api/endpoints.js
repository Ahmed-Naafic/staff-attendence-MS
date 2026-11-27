/*
 * The API routes the Staff app uses (docs/architecture.md → API). Each returns checked data.
 */
import { checkExamDuties, checkExamRoom, checkMarkSheet, checkMarkSheets, checkEventResponse, checkHistory, checkLessonMarks, checkLessons, checkLogin, checkProfile, checkSession, checkTeaching, checkTimetable, checkToday, checkUser } from './contracts';

export const signIn = (api, { phone, password, device }) =>
  api
    .request('/api/auth/login', { method: 'POST', auth: false, body: { identifier: phone, password, client: 'mobile', ...(device && { device }) } })
    .then(({ data }) => checkLogin(data));

export const readSession = (api) => api.request('/api/auth/session').then(({ data }) => checkSession(data).user);

/** Ends the session on the server (idempotent; 204). */
export const signOut = (api) => api.request('/api/auth/logout', { method: 'POST' });

/** Saves the account's theme ('light' | 'dark'), shared with the web app. */
export const saveTheme = (api, theme) => api.request('/api/auth/preferences', { method: 'PUT', body: { theme } }).then(({ data }) => checkUser(data.user));

/** Checks the signed-in account's password (the app lock after three failed attempts): 204, or 422 WRONG_PASSWORD. */
export const verifyPassword = (api, password) => api.request('/api/auth/verify-password', { method: 'POST', body: { password } }).then(() => true);

/** Replaces the temporary password; the current session stays valid. */
export const changeTemporaryPassword = (api, { currentPassword, newPassword }) =>
  api.request('/api/auth/password', { method: 'POST', body: { currentPassword, newPassword } }).then(({ data }) => checkUser(data.user));

export const fetchToday = (api, options) => api.request('/api/attendance/today', options).then(({ data }) => checkToday(data));

export const fetchProfile = (api, options) => api.request('/api/attendance/profile', options).then(({ data }) => checkProfile(data));

export const fetchHistory = (api, { from, to }, options) =>
  api.request(`/api/attendance/history?from=${from}&to=${to}`, options).then(({ data }) => checkHistory(data));

/** POST an attendance event: { created (201) or false (200, already recorded), event }. */
export const postEvent = (api, body) =>
  api.request('/api/attendance/events', { method: 'POST', body }).then(({ status, data }) => ({ created: status === 201, event: checkEventResponse(data).event }));

// ---- teachers' lesson attendance (/api/teacher) ----

/** The teacher's lessons of a day with class lists: { date, serverTime, lessons: [...] }. */
export const fetchLessons = (api, date, options) =>
  api.request(`/api/teacher/lessons${date ? `?date=${date}` : ''}`, options).then(({ data }) => checkLessons(data));

/** PUT one lesson's marks: { section, date, period, sentAt, marks: [{ student, status, occurredAt }] } → { results, lesson }. */
export const putLessonMarks = (api, body) => api.request('/api/teacher/lessons/marks', { method: 'PUT', body }).then(({ data }) => checkLessonMarks(data));

/** The teacher's classes and subjects (live teaching assignments, every branch): see checkTeaching. */
export const fetchMyTeaching = (api, date, options) =>
  api.request(`/api/teacher/teaching${date ? `?date=${date}` : ''}`, options).then(({ data }) => checkTeaching(data));

/** The teacher's week (published timetables, every branch): see checkTimetable. */
export const fetchMyTimetable = (api, date, options) =>
  api.request(`/api/teacher/timetable${date ? `?date=${date}` : ''}`, options).then(({ data }) => checkTimetable(data));

// ---- examinations (/api/teacher/exams): online only ----

/** Today's and the next two weeks' invigilation duties. */
export const fetchExamDuties = (api, options) => api.request('/api/teacher/exams/duties', options).then(({ data }) => checkExamDuties(data));
export const fetchExamRoom = (api, sessionId, roomId) => api.request(`/api/teacher/exams/duties/${sessionId}/rooms/${roomId}`).then(({ data }) => checkExamRoom(data));
/** body: { session, room, marks: [{ student, status }] } → the room again. */
export const putExamAttendance = (api, body) => api.request('/api/teacher/exams/attendance', { method: 'PUT', body }).then(({ data }) => checkExamRoom(data));
export const fetchMarkSheets = (api, options) => api.request('/api/teacher/exams/marks', options).then(({ data }) => checkMarkSheets(data));
export const fetchMarkSheet = (api, paperId, sectionId) => api.request(`/api/teacher/exams/marks/${paperId}/${sectionId}`).then(({ data }) => checkMarkSheet(data));
export const putMarks = (api, paperId, sectionId, marks) => api.request(`/api/teacher/exams/marks/${paperId}/${sectionId}`, { method: 'PUT', body: { marks } }).then(({ data }) => checkMarkSheet(data));
export const submitMarks = (api, paperId, sectionId) => api.request(`/api/teacher/exams/marks/${paperId}/${sectionId}/submit`, { method: 'POST' }).then(({ data }) => checkMarkSheet(data));

/*
 * The API routes the Staff app uses (docs/architecture.md → API). Each returns checked data.
 */
import { checkEventResponse, checkHistory, checkLogin, checkProfile, checkSession, checkToday, checkUser } from './contracts';

export const signIn = (api, { phone, password }) =>
  api
    .request('/api/auth/login', { method: 'POST', auth: false, body: { identifier: phone, password, client: 'mobile' } })
    .then(({ data }) => checkLogin(data));

export const readSession = (api) => api.request('/api/auth/session').then(({ data }) => checkSession(data).user);

/** Ends the session on the server (idempotent; 204). */
export const signOut = (api) => api.request('/api/auth/logout', { method: 'POST' });

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

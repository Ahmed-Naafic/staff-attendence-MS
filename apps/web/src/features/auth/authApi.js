import { apiRequest } from '../../lib/api.js';

/** The signed-in user ({ id, name, role }) or null when there is no valid session. */
export async function fetchSession() {
  return (await apiRequest('/auth/session', { quietUnauthorized: true })).user ?? null;
}

/** identifier: an email (any account) or a phone number (staff). */
export const signIn = async (identifier, password) =>
  (await apiRequest('/auth/login', { method: 'POST', body: { identifier, password }, quietUnauthorized: true })).user;

/** Saves the signed-in account's theme ('light' | 'dark'), shared with the mobile app. */
export const saveTheme = (theme) => apiRequest('/auth/preferences', { method: 'PUT', body: { theme } });

export const signOut = () => apiRequest('/auth/logout', { method: 'POST', quietUnauthorized: true });

/** Replaces a temporary password (first sign-in or after a reset) → the user, now without mustChangePassword. */
export const changePassword = async (currentPassword, newPassword) =>
  (await apiRequest('/auth/password', { method: 'POST', body: { currentPassword, newPassword } })).user;

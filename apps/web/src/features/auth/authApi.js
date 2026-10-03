import { apiRequest } from '../../lib/api.js';

/** The signed-in user ({ id, name, role }) or null when there is no valid session. */
export async function fetchSession() {
  return (await apiRequest('/auth/session', { quietUnauthorized: true })).user ?? null;
}

export const signIn = async (email, password) =>
  (await apiRequest('/auth/login', { method: 'POST', body: { email, password }, quietUnauthorized: true })).user;

export const signOut = () => apiRequest('/auth/logout', { method: 'POST', quietUnauthorized: true });

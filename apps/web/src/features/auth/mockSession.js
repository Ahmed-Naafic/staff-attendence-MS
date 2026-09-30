/*
 * DEMO SESSION — NOT AUTHENTICATION.
 *
 * A fixed, signed-in-looking user so the web shell can be built and reviewed before
 * the authentication phase. There is no login, token or server check behind it.
 * Replace this with the real session source in Phase 9 (Backend Integration & Authorization);
 * nothing outside features/auth should import this file.
 */
export const mockSession = {
  isDemo: true,
  user: {
    id: 'demo-super-admin',
    name: 'Demo Administrator',
    role: 'SUPER_ADMIN',
  },
};

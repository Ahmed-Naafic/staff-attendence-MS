/*
 * App configuration from environment variables (inlined by Expo at bundle time; see
 * apps/mobile/.env.example). No server address or secret is hardcoded here.
 */

/** The EduTrack API origin, e.g. http://192.168.1.20:4000 (no trailing slash, no /api). */
export function apiBaseUrl() {
  const value = process.env.EXPO_PUBLIC_API_URL;
  if (typeof value !== 'string' || !/^https?:\/\/[^\s/]+/.test(value.trim())) return null;
  return value.trim().replace(/\/+$/, '');
}

/** How long one API request may take before it is treated as failed (the event stays queued). */
export const REQUEST_TIMEOUT_MS = 15000;

export const APP_VERSION = '0.1.0';

/*
 * What the app tells the staff member about a failed request. Server messages for refusals (4xx)
 * are written for end users and are shown as sent; anything else gets a plain message. Stack
 * traces and raw responses are never shown.
 */

export function userMessage(error) {
  if (!error) return 'Something went wrong. Try again.';
  switch (error.kind) {
    case 'config':
      return error.message;
    case 'network':
      return 'No connection to the EduTrack server. Check your internet connection and try again.';
    case 'timeout':
      return 'The server took too long to answer. Try again.';
    case 'invalid_response':
      return 'The server sent an answer the app could not read. Try again later.';
    case 'http':
      if (error.status >= 500) return 'Something went wrong on the server. Try again in a moment.';
      // A failed sign-in has its own message; any other 401 means the session ended.
      if (error.status === 401) return error.message && error.message !== 'Sign in to continue.' ? error.message : 'Your session has ended. Sign in again.';
      return error.message || 'The request was refused.';
    default:
      return 'Something went wrong. Try again.';
  }
}

/** Short titles for refused attendance events (codes from the attendance API). */
const REFUSAL_TITLES = {
  CLOCK_SKEW: 'Check your phone’s clock',
  EVENT_TOO_OLD: 'Too late to upload',
  EVENT_IN_FUTURE: 'Event time is not valid',
  NO_SHIFT: 'No shift today',
  OUTSIDE_SHIFT_WINDOW: 'Check-in is not open',
  NO_OPEN_CHECK_IN: 'No check-in to close',
  CHECK_OUT_DISABLED: 'Check-out is not used',
  BRANCH_SUSPENDED: 'Branch suspended',
  LOCATION_REFUSED: 'Location not accepted',
  ALREADY_CHECKED_IN: 'Already checked in',
  ALREADY_CHECKED_OUT: 'Already checked out',
  IDEMPOTENCY_CONFLICT: 'Event not accepted',
  VALIDATION_ERROR: 'Event not accepted',
};

export const refusalTitle = (code) => REFUSAL_TITLES[code] ?? 'Not accepted';

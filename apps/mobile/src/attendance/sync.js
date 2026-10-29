/*
 * Uploads an account's pending events, oldest first, each with its stored clientEventId
 * (docs/business-rules.md → Offline and retries). The server's answer decides the event's state:
 *  - 201 or 200 (already recorded)            → recorded
 *  - 4xx refusal by a rule or as a duplicate  → rejected (final, never sent again unchanged)
 *  - CLOCK_SKEW                               → stays pending (the event is fine; the phone clock
 *                                               is not). Sent again after the clock is fixed.
 *  - no answer, timeout, 5xx, session ended,
 *    password change, rate limit, forbidden   → stays pending
 * Uploading stops at the first event that stays pending, so a check-out is never sent before
 * the check-in it closes. One upload runs at a time.
 */
import { postEvent } from '../api/endpoints';
import { userMessage } from '../api/errors';
import { markAttempt, markRecorded, markRejected, pendingFor, uploadBody } from './queue';

/** True when a failure is the server's final decision about the event itself. */
export function isFinalRefusal(error) {
  if (error?.kind !== 'http') return false;
  if (error.status === 422) return error.code !== 'CLOCK_SKEW';
  return error.status === 400 || error.status === 409;
}

let running = null;

/**
 * syncPending({ db, api, userId, clock }) → { recorded: [item], rejected: [item], stoppedBy: ApiError | null }.
 * A call while an upload is running gets that upload's result.
 */
export function syncPending(options) {
  running ??= upload(options).finally(() => {
    running = null;
  });
  return running;
}

async function upload({ db, api, userId, clock = () => new Date() }) {
  const result = { recorded: [], rejected: [], stoppedBy: null };
  for (const item of await pendingFor(db, userId)) {
    try {
      const { event } = await postEvent(api, uploadBody(item, clock()));
      await markRecorded(db, item.clientEventId, event, clock());
      result.recorded.push({ ...item, state: 'recorded', serverEvent: event });
    } catch (error) {
      if (isFinalRefusal(error)) {
        const refusal = { code: error.code ?? 'REFUSED', message: userMessage(error) };
        await markRejected(db, item.clientEventId, refusal, clock());
        result.rejected.push({ ...item, state: 'rejected', errorCode: refusal.code, errorMessage: refusal.message });
        continue;
      }
      await markAttempt(db, item.clientEventId, { code: error?.code ?? error?.kind ?? 'ERROR', message: userMessage(error) }, clock());
      result.stoppedBy = error;
      break;
    }
  }
  return result;
}

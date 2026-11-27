/*
 * Uploads an account's pending outbox records, oldest first, with the handler of each kind. The
 * server's answer decides: accepted → recorded; a final refusal (the handler says which) → rejected
 * with the server's reason; no answer, timeout, 5xx, session ended, clock → stays pending and the
 * upload stops (sent again later with the same record). One upload runs at a time.
 */
import { putMarks } from '../api/endpoints';
import { userMessage } from '../api/errors';
import { markOutboxAttempt, markOutboxRecorded, markOutboxRejected, pendingOutbox } from './outbox';

/** A refusal that is the server's decision about the record (not about the connection or session). */
export function isFinalOutboxRefusal(error) {
  if (error?.kind !== 'http') return false;
  if (error.status === 401 || error.status === 429) return false;
  if (error.code === 'CLOCK_SKEW' || error.code === 'PASSWORD_CHANGE_REQUIRED') return false;
  return error.status >= 400 && error.status < 500;
}

/** Upload handlers by kind: (api, payload) → result kept with the record. */
export const HANDLERS = {
  // An examination mark sheet's draft marks (PUT; the same marks again change nothing). Submitting
  // the sheet is online only and never queued.
  'exam-marks': async (api, p) => {
    const sheet = await putMarks(api, p.paperId, p.sectionId, p.marks);
    return { status: sheet?.sheet?.status ?? sheet?.status ?? null };
  },
};

let running = null;

/** → { recorded, rejected, stoppedBy }. A call while an upload is running gets that upload's result. */
export function syncOutbox(options) {
  running ??= upload(options).finally(() => {
    running = null;
  });
  return running;
}

async function upload({ db, api, userId, clock = () => new Date(), handlers = HANDLERS }) {
  const result = { recorded: 0, rejected: 0, stoppedBy: null };
  for (const item of await pendingOutbox(db, userId)) {
    const handler = handlers[item.kind];
    if (!handler) continue;
    try {
      const answer = await handler(api, item.payload);
      await markOutboxRecorded(db, item.id, answer, clock());
      result.recorded += 1;
    } catch (error) {
      if (isFinalOutboxRefusal(error)) {
        await markOutboxRejected(db, item.id, { code: error.code ?? 'REFUSED', message: userMessage(error) }, clock());
        result.rejected += 1;
        continue;
      }
      await markOutboxAttempt(db, item.id, { code: error?.code ?? error?.kind ?? 'ERROR', message: userMessage(error) }, clock());
      result.stoppedBy = error;
      break;
    }
  }
  return result;
}

/*
 * Uploads a teacher's pending lesson marks, one request per lesson (oldest lesson first), with the
 * time each mark was taken and the phone's clock at sending. The server answers each mark:
 *  - recorded                                   → recorded
 *  - refused (outside the lesson time, set by a
 *    Manager, a later mark exists, not on list)  → rejected (final, with the server's reason)
 * A refusal of the whole lesson (not the teacher's lesson, too late to upload, attendance switched
 * off, invalid) rejects its marks. No answer, timeout, 5xx, session ended, password change and
 * CLOCK_SKEW (the phone's clock is wrong, the marks are fine) keep them pending and stop the upload.
 * Nothing is sent when nothing is waiting. One upload runs at a time.
 */
import { putLessonMarks } from '../api/endpoints';
import { userMessage } from '../api/errors';
import { groupByLesson, markAttemptMarks, markRecordedMark, markRejectedMark, pendingMarks } from './lessonQueue';

/** True when a failure is the server's final decision about the lesson's marks. */
export function isFinalLessonRefusal(error) {
  if (error?.kind !== 'http') return false;
  if (error.code === 'CLOCK_SKEW' || error.code === 'PASSWORD_CHANGE_REQUIRED' || error.code === 'TOO_MANY_REQUESTS') return false;
  if (error.status === 401 || error.status === 429) return false;
  return error.status >= 400 && error.status < 500;
}

let running = null;

/** → { recorded, rejected, stoppedBy }. A call while an upload is running gets that upload's result. */
export function syncLessonMarks(options) {
  running ??= upload(options).finally(() => {
    running = null;
  });
  return running;
}

async function upload({ db, api, userId, clock = () => new Date() }) {
  const result = { recorded: 0, rejected: 0, stoppedBy: null };
  const groups = groupByLesson(await pendingMarks(db, userId));
  for (const lesson of groups) {
    try {
      const { results } = await putLessonMarks(api, {
        section: lesson.sectionId,
        date: lesson.date,
        period: lesson.period,
        sentAt: clock().toISOString(),
        marks: lesson.marks.map((m) => ({ student: m.studentId, status: m.status, occurredAt: m.occurredAt })),
      });
      for (let i = 0; i < lesson.marks.length; i += 1) {
        const answer = results[i];
        if (answer?.result === 'recorded') {
          await markRecordedMark(db, lesson.marks[i].clientMarkId, clock());
          result.recorded += 1;
        } else {
          await markRejectedMark(db, lesson.marks[i].clientMarkId, { code: answer?.code ?? 'REFUSED', message: answer?.message ?? 'Not accepted.' }, clock());
          result.rejected += 1;
        }
      }
    } catch (error) {
      const ids = lesson.marks.map((m) => m.clientMarkId);
      if (isFinalLessonRefusal(error)) {
        for (const id of ids) await markRejectedMark(db, id, { code: error.code ?? 'REFUSED', message: userMessage(error) }, clock());
        result.rejected += ids.length;
        continue;
      }
      await markAttemptMarks(db, ids, { code: error?.code ?? error?.kind ?? 'ERROR', message: userMessage(error) }, clock());
      result.stoppedBy = error;
      break;
    }
  }
  return result;
}

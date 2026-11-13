/*
 * Teachers' lesson marks on the phone (docs/business-rules.md → Student attendance → Teacher lesson
 * attendance). Every mark is written here with the time it was taken BEFORE it is uploaded, so marks
 * taken offline survive a restart and keep their time. Uploaded per lesson; the server answers each
 * mark: recorded, or refused with a reason (final). Rows are never deleted: a refused mark is hidden
 * only when dismissed.
 */

const toMark = (row) => ({
  clientMarkId: row.client_mark_id,
  userId: row.user_id,
  sectionId: row.section_id,
  date: row.lesson_date,
  period: row.period,
  studentId: row.student_id,
  status: row.status,
  occurredAt: row.occurred_at,
  state: row.state,
  attempts: row.attempts,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  createdAt: row.created_at,
});

export const lessonKey = ({ sectionId, date, period }) => `${sectionId}|${date}|${period}`;

/** Stores marks of one lesson as pending. `marks`: [{ clientMarkId, studentId, status }], all taken at `occurredAt`. */
export async function enqueueMarks(db, userId, lesson, marks, occurredAt = new Date()) {
  const at = occurredAt.toISOString();
  for (const m of marks) {
    await db.runAsync(
      `INSERT INTO lesson_mark_queue (client_mark_id, user_id, section_id, lesson_date, period, student_id, status, occurred_at, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [m.clientMarkId, userId, lesson.sectionId, lesson.date, lesson.period, m.studentId, m.status, at, at],
    );
  }
}

/** Pending marks of an account, oldest first. */
export async function pendingMarks(db, userId) {
  return (await db.getAllAsync("SELECT * FROM lesson_mark_queue WHERE user_id = ? AND state = 'pending' ORDER BY occurred_at ASC, created_at ASC", [userId])).map(toMark);
}

/** Pending marks grouped by lesson, the lesson with the oldest mark first: [{ sectionId, date, period, marks }]. */
export function groupByLesson(marks) {
  const groups = new Map();
  for (const m of marks) {
    const key = lessonKey(m);
    if (!groups.has(key)) groups.set(key, { sectionId: m.sectionId, date: m.date, period: m.period, marks: [] });
    groups.get(key).marks.push(m);
  }
  return [...groups.values()];
}

export async function countPendingMarks(db, userId) {
  const row = await db.getFirstAsync("SELECT COUNT(*) AS n FROM lesson_mark_queue WHERE user_id = ? AND state = 'pending'", [userId]);
  return row?.n ?? 0;
}

/** Pending and not-dismissed refused marks of one lesson (shown over the server's list). */
export async function lessonOutstanding(db, userId, lesson) {
  return (
    await db.getAllAsync(
      "SELECT * FROM lesson_mark_queue WHERE user_id = ? AND section_id = ? AND lesson_date = ? AND period = ? AND (state = 'pending' OR (state = 'rejected' AND dismissed_at IS NULL)) ORDER BY occurred_at ASC",
      [userId, lesson.sectionId, lesson.date, lesson.period],
    )
  ).map(toMark);
}

/** Every pending and not-dismissed refused mark of an account (the sync screen). */
export async function outstandingMarks(db, userId) {
  return (await db.getAllAsync("SELECT * FROM lesson_mark_queue WHERE user_id = ? AND (state = 'pending' OR (state = 'rejected' AND dismissed_at IS NULL)) ORDER BY occurred_at DESC", [userId])).map(toMark);
}

export const markAttemptMarks = (db, ids, { code = null, message = null } = {}, now = new Date()) =>
  Promise.all(ids.map((id) => db.runAsync("UPDATE lesson_mark_queue SET attempts = attempts + 1, last_attempt_at = ?, error_code = ?, error_message = ? WHERE client_mark_id = ? AND state = 'pending'", [now.toISOString(), code, message, id])));

export const markRecordedMark = (db, id, now = new Date()) =>
  db.runAsync("UPDATE lesson_mark_queue SET state = 'recorded', attempts = attempts + 1, last_attempt_at = ?, error_code = NULL, error_message = NULL WHERE client_mark_id = ? AND state = 'pending'", [now.toISOString(), id]);

export const markRejectedMark = (db, id, { code, message }, now = new Date()) =>
  db.runAsync("UPDATE lesson_mark_queue SET state = 'rejected', attempts = attempts + 1, last_attempt_at = ?, error_code = ?, error_message = ? WHERE client_mark_id = ? AND state = 'pending'", [now.toISOString(), code, message, id]);

export const dismissRejectedMark = (db, id, now = new Date()) =>
  db.runAsync("UPDATE lesson_mark_queue SET dismissed_at = ? WHERE client_mark_id = ? AND state = 'rejected'", [now.toISOString(), id]);

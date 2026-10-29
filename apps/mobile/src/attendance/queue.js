/*
 * The offline attendance queue (docs/business-rules.md → Staff mobile app → Offline queue).
 * Every event is written here with its clientEventId BEFORE the first upload attempt, so it
 * survives a crash or restart, and it is uploaded with the same id until the server answers.
 *
 * States: pending (not answered by the server yet), recorded (accepted: 201 or 200), rejected
 * (a 4xx refusal; final). Rows are never deleted: a rejected event is hidden only when the staff
 * member dismisses it (dismissed_at).
 */

const toItem = (row) => ({
  clientEventId: row.client_event_id,
  userId: row.user_id,
  type: row.type,
  occurredAt: row.occurred_at,
  position: { latitude: row.latitude, longitude: row.longitude, accuracy: row.accuracy },
  distanceEstimate: row.distance_estimate,
  state: row.state,
  attempts: row.attempts,
  lastAttemptAt: row.last_attempt_at,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  serverEvent: row.server_event ? JSON.parse(row.server_event) : null,
  createdAt: row.created_at,
  dismissedAt: row.dismissed_at,
});

/** Stores a new event as pending. `event`: { clientEventId, type, occurredAt (ISO), position, distanceEstimate }. */
export async function enqueue(db, userId, event, now = new Date()) {
  await db.runAsync(
    `INSERT INTO attendance_queue (client_event_id, user_id, type, occurred_at, latitude, longitude, accuracy, distance_estimate, state, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [event.clientEventId, userId, event.type, event.occurredAt, event.position.latitude, event.position.longitude, event.position.accuracy, event.distanceEstimate ?? null, now.toISOString()],
  );
  return getItem(db, event.clientEventId);
}

export async function getItem(db, clientEventId) {
  const row = await db.getFirstAsync('SELECT * FROM attendance_queue WHERE client_event_id = ?', [clientEventId]);
  return row ? toItem(row) : null;
}

/** Pending events of an account, oldest event first (the upload order). */
export async function pendingFor(db, userId) {
  return (await db.getAllAsync("SELECT * FROM attendance_queue WHERE user_id = ? AND state = 'pending' ORDER BY occurred_at ASC, created_at ASC", [userId])).map(toItem);
}

/** Pending and not-dismissed rejected events (the sync screen), newest first. */
export async function outstandingFor(db, userId) {
  return (
    await db.getAllAsync(
      "SELECT * FROM attendance_queue WHERE user_id = ? AND (state = 'pending' OR (state = 'rejected' AND dismissed_at IS NULL)) ORDER BY occurred_at DESC",
      [userId],
    )
  ).map(toItem);
}

/** Every event of an account from a time on (today's home state), oldest first. */
export async function itemsSince(db, userId, sinceIso) {
  return (await db.getAllAsync('SELECT * FROM attendance_queue WHERE user_id = ? AND occurred_at >= ? ORDER BY occurred_at ASC', [userId, sinceIso])).map(toItem);
}

export async function countPending(db, userId) {
  const row = await db.getFirstAsync("SELECT COUNT(*) AS n FROM attendance_queue WHERE user_id = ? AND state = 'pending'", [userId]);
  return row?.n ?? 0;
}

/** An attempt that got no decision (network, timeout, 5xx, session ended, clock): stays pending. */
export const markAttempt = (db, clientEventId, { code = null, message = null } = {}, now = new Date()) =>
  db.runAsync(
    "UPDATE attendance_queue SET attempts = attempts + 1, last_attempt_at = ?, error_code = ?, error_message = ? WHERE client_event_id = ? AND state = 'pending'",
    [now.toISOString(), code, message, clientEventId],
  );

export const markRecorded = (db, clientEventId, serverEvent, now = new Date()) =>
  db.runAsync(
    "UPDATE attendance_queue SET state = 'recorded', attempts = attempts + 1, last_attempt_at = ?, error_code = NULL, error_message = NULL, server_event = ? WHERE client_event_id = ? AND state = 'pending'",
    [now.toISOString(), JSON.stringify(serverEvent), clientEventId],
  );

export const markRejected = (db, clientEventId, { code, message }, now = new Date()) =>
  db.runAsync(
    "UPDATE attendance_queue SET state = 'rejected', attempts = attempts + 1, last_attempt_at = ?, error_code = ?, error_message = ? WHERE client_event_id = ? AND state = 'pending'",
    [now.toISOString(), code, message, clientEventId],
  );

/** Hides a rejected event from the sync screen (kept on the device). */
export const dismissRejected = (db, clientEventId, now = new Date()) =>
  db.runAsync("UPDATE attendance_queue SET dismissed_at = ? WHERE client_event_id = ? AND state = 'rejected'", [now.toISOString(), clientEventId]);

/** The request body for an event; `sentAt` is the device clock now, at each attempt. */
export const uploadBody = (item, sentAt = new Date()) => ({
  clientEventId: item.clientEventId,
  type: item.type,
  occurredAt: item.occurredAt,
  sentAt: sentAt.toISOString(),
  position: { latitude: item.position.latitude, longitude: item.position.longitude, accuracy: item.position.accuracy },
});

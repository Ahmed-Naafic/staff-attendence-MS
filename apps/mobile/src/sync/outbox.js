/*
 * The generic outbox (docs/mobile/offline-sync.md): records of further offline features waiting to
 * upload, one row each, written BEFORE the first upload attempt. It follows the rules of the two
 * existing queues (attendance events, lesson marks), which stay as they are:
 * - states: pending (no server decision yet), recorded (accepted), rejected (refused: final);
 * - each row keeps the account and the branch it was made in; nothing is ever sent for another
 *   account or moved to another branch;
 * - a refused row is never changed or sent again. Where the server allows a correction, a NEW row
 *   with a new id is made; it names the row it replaces, and the original row stays (`replaced_by`).
 * Financial actions (payments, cash closing) never go through the outbox: they are online only.
 */

const toItem = (row) => ({
  id: row.id,
  userId: row.user_id,
  kind: row.kind,
  label: row.label,
  payload: JSON.parse(row.payload),
  branch: row.branch_id || row.branch_name ? { id: row.branch_id, name: row.branch_name } : null,
  state: row.state,
  attempts: row.attempts,
  lastAttemptAt: row.last_attempt_at,
  errorCode: row.error_code,
  errorMessage: row.error_message,
  result: row.result ? JSON.parse(row.result) : null,
  replacesId: row.replaces_id,
  replacedBy: row.replaced_by,
  createdAt: row.created_at,
  dismissedAt: row.dismissed_at,
});

/** Kinds that may be uploaded through the outbox. Financial operations are deliberately absent. */
export const OUTBOX_KINDS = ['exam-marks'];

/** Adds a record as pending: { id, kind, label, payload, branch?, replacesId? }. */
export async function addToOutbox(db, userId, record, now = new Date()) {
  if (!OUTBOX_KINDS.includes(record.kind)) throw new Error(`Not an offline record kind: ${record.kind}`);
  await db.runAsync(
    `INSERT INTO outbox (id, user_id, kind, label, payload, branch_id, branch_name, state, replaces_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [record.id, userId, record.kind, record.label, JSON.stringify(record.payload), record.branch?.id ?? null, record.branch?.name ?? null, record.replacesId ?? null, now.toISOString()],
  );
  if (record.replacesId) await db.runAsync("UPDATE outbox SET replaced_by = ? WHERE id = ? AND user_id = ? AND state = 'rejected'", [record.id, record.replacesId, userId]);
  return getOutboxItem(db, record.id);
}

export async function getOutboxItem(db, id) {
  const row = await db.getFirstAsync('SELECT * FROM outbox WHERE id = ?', [id]);
  return row ? toItem(row) : null;
}

/** Pending records of an account, oldest first (the upload order). */
export async function pendingOutbox(db, userId) {
  return (await db.getAllAsync("SELECT * FROM outbox WHERE user_id = ? AND state = 'pending' ORDER BY created_at ASC", [userId])).map(toItem);
}

export async function countPendingOutbox(db, userId) {
  const row = await db.getFirstAsync("SELECT COUNT(*) AS n FROM outbox WHERE user_id = ? AND state = 'pending'", [userId]);
  return row?.n ?? 0;
}

/** Every record of an account (the sync history), newest first. */
export async function outboxHistory(db, userId) {
  return (await db.getAllAsync('SELECT * FROM outbox WHERE user_id = ? ORDER BY created_at DESC', [userId])).map(toItem);
}

/** The latest pending record of a kind for one target (e.g. one mark sheet), or null. */
export async function pendingFor(db, userId, kind, match) {
  return (await pendingOutbox(db, userId)).filter((i) => i.kind === kind && match(i.payload)).pop() ?? null;
}

export const markOutboxAttempt = (db, id, { code = null, message = null } = {}, now = new Date()) =>
  db.runAsync("UPDATE outbox SET attempts = attempts + 1, last_attempt_at = ?, error_code = ?, error_message = ? WHERE id = ? AND state = 'pending'", [now.toISOString(), code, message, id]);

export const markOutboxRecorded = (db, id, result, now = new Date()) =>
  db.runAsync("UPDATE outbox SET state = 'recorded', attempts = attempts + 1, last_attempt_at = ?, error_code = NULL, error_message = NULL, result = ? WHERE id = ? AND state = 'pending'", [
    now.toISOString(),
    result === undefined ? null : JSON.stringify(result),
    id,
  ]);

export const markOutboxRejected = (db, id, { code, message }, now = new Date()) =>
  db.runAsync("UPDATE outbox SET state = 'rejected', attempts = attempts + 1, last_attempt_at = ?, error_code = ?, error_message = ? WHERE id = ? AND state = 'pending'", [now.toISOString(), code, message, id]);

/** A pending record replaced by a newer one for the same target before it was uploaded (never sent). */
export const supersedePending = (db, id, byId) => db.runAsync("UPDATE outbox SET state = 'rejected', error_code = 'REPLACED', error_message = 'Replaced by a newer version before it was uploaded.', replaced_by = ? WHERE id = ? AND state = 'pending'", [byId, id]);

export const dismissOutbox = (db, id, now = new Date()) => db.runAsync("UPDATE outbox SET dismissed_at = ? WHERE id = ? AND state = 'rejected'", [now.toISOString(), id]);

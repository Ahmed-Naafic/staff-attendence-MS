/*
 * The sync history of an account on this phone (the Sync screen) and its clean-up
 * (docs/mobile/offline-sync.md → Sync history):
 * - every kind of waiting record in one list: attendance events, lesson marks (one row per lesson),
 *   and outbox records;
 * - status: pending (not tried yet), syncing (an upload is running), failed (tried, no decision yet:
 *   it will be sent again), synced (accepted), rejected (refused by the server, with its reason);
 * - synced and rejected records are kept for 90 days, then removed. Pending records and temporary
 *   failures are never removed by the clean-up.
 */
import { lessonKey } from '../lessons/lessonQueue';
import { outboxHistory } from './outbox';

export const KEEP_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Removes synced and rejected records older than 90 days (every account on this phone). → rows removed. */
export async function cleanUpHistory(db, now = new Date()) {
  const before = new Date(now.getTime() - KEEP_DAYS * DAY_MS).toISOString();
  let removed = 0;
  for (const table of ['attendance_queue', 'lesson_mark_queue', 'outbox']) {
    const r = await db.runAsync(`DELETE FROM ${table} WHERE state IN ('recorded', 'rejected') AND COALESCE(last_attempt_at, created_at) < ?`, [before]);
    removed += r?.changes ?? 0;
  }
  return removed;
}

/** The display status of a stored record. */
export function statusOf(row, syncing = false) {
  if (row.state === 'recorded') return 'synced';
  if (row.state === 'rejected') return 'rejected';
  if (syncing) return 'syncing';
  return row.attempts > 0 ? 'failed' : 'pending';
}

const TYPE_LABEL = { CHECK_IN: 'Check-in', CHECK_OUT: 'Check-out' };

/**
 * One list of an account's records, newest first:
 * [{ key, kind, title, detail, at, branch, status, reason, code, count, ref }].
 */
export async function syncHistory(db, userId, { syncing = false } = {}) {
  const events = await db.getAllAsync('SELECT * FROM attendance_queue WHERE user_id = ? AND dismissed_at IS NULL', [userId]);
  const marks = await db.getAllAsync('SELECT * FROM lesson_mark_queue WHERE user_id = ? AND dismissed_at IS NULL', [userId]);
  const outbox = await outboxHistory(db, userId);
  const rows = [];

  for (const e of events) {
    rows.push({
      key: `event:${e.client_event_id}`,
      kind: 'attendance',
      title: TYPE_LABEL[e.type] ?? e.type,
      detail: 'Staff attendance',
      at: e.occurred_at,
      branch: e.branch_name ?? null,
      status: statusOf(e, syncing && e.state === 'pending'),
      reason: e.error_message,
      code: e.error_code,
      count: 1,
      ref: { table: 'attendance_queue', id: e.client_event_id },
    });
  }

  // Lesson marks: one row per lesson and status (a class list is many marks).
  const lessons = new Map();
  for (const m of marks) {
    const status = statusOf(m, syncing && m.state === 'pending');
    const key = `${lessonKey({ sectionId: m.section_id, date: m.lesson_date, period: m.period })}|${status}|${status === 'rejected' ? m.error_code : ''}`;
    if (!lessons.has(key)) {
      lessons.set(key, {
        key: `marks:${key}`,
        kind: 'lesson-marks',
        title: 'Lesson marks',
        detail: `${m.lesson_date} · period ${m.period}`,
        at: m.occurred_at,
        branch: m.branch_name ?? null,
        status,
        reason: m.error_message,
        code: m.error_code,
        count: 0,
        ref: { table: 'lesson_mark_queue', ids: [] },
      });
    }
    const g = lessons.get(key);
    g.count += 1;
    g.ref.ids.push(m.client_mark_id);
    if (m.occurred_at > g.at) g.at = m.occurred_at;
  }
  rows.push(...lessons.values());

  for (const o of outbox) {
    if (o.dismissedAt || o.errorCode === 'REPLACED') continue;
    rows.push({
      key: `outbox:${o.id}`,
      kind: o.kind,
      title: o.label,
      detail: o.replacesId ? 'Correction of a refused record' : o.kind === 'exam-marks' ? 'Examination marks (draft)' : o.kind,
      at: o.createdAt,
      branch: o.branch?.name ?? null,
      status: statusOf(o, syncing && o.state === 'pending'),
      reason: o.errorMessage,
      code: o.errorCode,
      count: 1,
      ref: { table: 'outbox', id: o.id, payload: o.payload, replacedBy: o.replacedBy },
    });
  }
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** Hides a rejected record from the list (kept on the phone until the 90-day clean-up). */
export async function dismissRecord(db, ref, now = new Date()) {
  const at = now.toISOString();
  if (ref.table === 'attendance_queue') return db.runAsync("UPDATE attendance_queue SET dismissed_at = ? WHERE client_event_id = ? AND state = 'rejected'", [at, ref.id]);
  if (ref.table === 'outbox') return db.runAsync("UPDATE outbox SET dismissed_at = ? WHERE id = ? AND state = 'rejected'", [at, ref.id]);
  for (const id of ref.ids ?? []) await db.runAsync("UPDATE lesson_mark_queue SET dismissed_at = ? WHERE client_mark_id = ? AND state = 'rejected'", [at, id]);
  return null;
}

/** Counts of an account's waiting records by kind (sign-out and switch warnings). */
export async function waitingCounts(db, userId) {
  const one = async (sql) => (await db.getFirstAsync(sql, [userId]))?.n ?? 0;
  return {
    events: await one("SELECT COUNT(*) AS n FROM attendance_queue WHERE user_id = ? AND state = 'pending'"),
    marks: await one("SELECT COUNT(*) AS n FROM lesson_mark_queue WHERE user_id = ? AND state = 'pending'"),
    drafts: await one("SELECT COUNT(*) AS n FROM outbox WHERE user_id = ? AND state = 'pending'"),
  };
}

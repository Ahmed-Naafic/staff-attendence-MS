/*
 * The device database (expo-sqlite): the offline attendance queue and a small key-value table
 * (theme preference, last loaded day and profile for offline use). The session token is NOT kept
 * here; it is in secure storage (src/auth/tokenStore.js).
 */
import * as SQLite from 'expo-sqlite';

const MIGRATIONS = [
  // 1: queue and key-value store
  `CREATE TABLE IF NOT EXISTS attendance_queue (
     client_event_id TEXT PRIMARY KEY NOT NULL,
     user_id TEXT NOT NULL,
     type TEXT NOT NULL CHECK (type IN ('CHECK_IN', 'CHECK_OUT')),
     occurred_at TEXT NOT NULL,
     latitude REAL NOT NULL,
     longitude REAL NOT NULL,
     accuracy REAL NOT NULL,
     distance_estimate REAL,
     state TEXT NOT NULL CHECK (state IN ('pending', 'recorded', 'rejected')),
     attempts INTEGER NOT NULL DEFAULT 0,
     last_attempt_at TEXT,
     error_code TEXT,
     error_message TEXT,
     server_event TEXT,
     created_at TEXT NOT NULL,
     dismissed_at TEXT
   );
   CREATE INDEX IF NOT EXISTS attendance_queue_user_state ON attendance_queue (user_id, state, occurred_at);
   CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);`,
];

/** Brings a database to the latest version (PRAGMA user_version). */
export async function migrate(db) {
  const row = await db.getFirstAsync('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  for (let i = version; i < MIGRATIONS.length; i += 1) {
    await db.execAsync(MIGRATIONS[i]);
    await db.execAsync(`PRAGMA user_version = ${i + 1}`);
  }
}

let opening = null;

/** The app database, opened and migrated once. */
export function getDatabase() {
  opening ??= SQLite.openDatabaseAsync('edutrack.db').then(async (db) => {
    await db.execAsync('PRAGMA journal_mode = WAL');
    await migrate(db);
    return db;
  });
  return opening;
}

/** Key-value helpers (JSON values). */
export async function readValue(db, key) {
  const row = await db.getFirstAsync('SELECT value FROM kv WHERE key = ?', [key]);
  if (!row) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

export const writeValue = (db, key, value) => db.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', [key, JSON.stringify(value)]);
export const deleteValue = (db, key) => db.runAsync('DELETE FROM kv WHERE key = ?', [key]);

/** Tests only: forget the open database so the next getDatabase() opens a fresh one. */
export function resetDatabaseForTests() {
  opening = null;
}

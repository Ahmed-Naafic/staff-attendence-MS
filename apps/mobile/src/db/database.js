/*
 * The device database (expo-sqlite with SQLCipher): the offline attendance queue, teachers' lesson
 * marks waiting to upload, and a small key-value table (theme preference, last loaded day, profile,
 * lessons, classes and timetable for offline use). The session token is NOT kept here; it is in
 * secure storage (src/auth/tokenStore.js).
 *
 * Encryption (docs/mobile/offline-security.md):
 * - the whole file is encrypted with SQLCipher (app.json → expo-sqlite plugin `useSQLCipher`);
 * - its key is 32 random bytes made on the device on first use and kept only in secure storage
 *   (Android Keystore / iOS Keychain, this device only), never in code, logs or the database;
 * - the unencrypted database of earlier versions (edutrack.db) is copied into the encrypted one
 *   once and then deleted. Rows are copied with INSERT OR IGNORE, so an interrupted copy is simply
 *   repeated on the next start, and the old file is deleted only after a complete copy;
 * - if the key is lost (e.g. secure storage was cleared) the encrypted file cannot be read: it is
 *   deleted and a new, empty database is made. Nothing can be recovered from it without the key.
 */
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

export const DATABASE_NAME = 'edutrack-secure.db';
export const LEGACY_DATABASE_NAME = 'edutrack.db';
export const KEY_NAME = 'edutrack.db.key';
const LEGACY_DONE = 'device:legacy-import-done';

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
  // 2: teachers' lesson marks waiting to upload (src/lessons/lessonQueue.js)
  `CREATE TABLE IF NOT EXISTS lesson_mark_queue (
     client_mark_id TEXT PRIMARY KEY NOT NULL,
     user_id TEXT NOT NULL,
     section_id TEXT NOT NULL,
     lesson_date TEXT NOT NULL,
     period INTEGER NOT NULL,
     student_id TEXT NOT NULL,
     status TEXT NOT NULL CHECK (status IN ('present', 'absent')),
     occurred_at TEXT NOT NULL,
     state TEXT NOT NULL CHECK (state IN ('pending', 'recorded', 'rejected')),
     attempts INTEGER NOT NULL DEFAULT 0,
     last_attempt_at TEXT,
     error_code TEXT,
     error_message TEXT,
     created_at TEXT NOT NULL,
     dismissed_at TEXT
   );
   CREATE INDEX IF NOT EXISTS lesson_mark_queue_user_state ON lesson_mark_queue (user_id, state, occurred_at);`,
  // 3: the branch each waiting record was made in (shown on the Sync screen; never changed), and the
  //    generic outbox for further offline features (src/sync/outbox.js)
  `ALTER TABLE attendance_queue ADD COLUMN branch_id TEXT;
   ALTER TABLE attendance_queue ADD COLUMN branch_name TEXT;
   ALTER TABLE lesson_mark_queue ADD COLUMN branch_id TEXT;
   ALTER TABLE lesson_mark_queue ADD COLUMN branch_name TEXT;
   CREATE TABLE IF NOT EXISTS outbox (
     id TEXT PRIMARY KEY NOT NULL,
     user_id TEXT NOT NULL,
     kind TEXT NOT NULL,
     label TEXT NOT NULL,
     payload TEXT NOT NULL,
     branch_id TEXT,
     branch_name TEXT,
     state TEXT NOT NULL CHECK (state IN ('pending', 'recorded', 'rejected')),
     attempts INTEGER NOT NULL DEFAULT 0,
     last_attempt_at TEXT,
     error_code TEXT,
     error_message TEXT,
     result TEXT,
     replaces_id TEXT,
     replaced_by TEXT,
     created_at TEXT NOT NULL,
     dismissed_at TEXT
   );
   CREATE INDEX IF NOT EXISTS outbox_user_state ON outbox (user_id, state, created_at);`,
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

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const SECURE_OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

/** The database key (64 hex characters), made and stored on first use. */
export async function databaseKey({ secureStore = SecureStore, randomBytes = Crypto.getRandomBytesAsync } = {}) {
  const stored = await secureStore.getItemAsync(KEY_NAME, SECURE_OPTIONS);
  if (stored && /^[0-9a-f]{64}$/.test(stored)) return stored;
  const key = toHex(await randomBytes(32));
  await secureStore.setItemAsync(KEY_NAME, key, SECURE_OPTIONS);
  return key;
}

async function keyed(sqlite, name, key) {
  const db = await sqlite.openDatabaseAsync(name);
  // Must be the first statement on the connection. The key is raw hex (no key derivation needed).
  await db.execAsync(`PRAGMA key = "x'${key}'"`);
  return db;
}

/** True when the keyed database can be read (the key is right, or the file is new). */
async function readable(db) {
  try {
    await db.getFirstAsync('SELECT count(*) AS n FROM sqlite_master');
    return true;
  } catch {
    return false;
  }
}

/** Opens the encrypted database; an unreadable one (lost key) is deleted and made again. */
export async function openEncrypted({ sqlite = SQLite, secureStore = SecureStore, randomBytes = Crypto.getRandomBytesAsync, name = DATABASE_NAME } = {}) {
  const key = await databaseKey({ secureStore, randomBytes });
  let db = await keyed(sqlite, name, key);
  if (!(await readable(db))) {
    await db.closeAsync?.().catch(() => {});
    await sqlite.deleteDatabaseAsync?.(name).catch(() => {});
    db = await keyed(sqlite, name, key);
  }
  return db;
}

const LEGACY_TABLES = ['attendance_queue', 'lesson_mark_queue', 'outbox', 'kv'];
const quote = (path) => `'${String(path).replace(/'/g, "''")}'`;

/**
 * Copies the unencrypted database of earlier versions into `db` once, then deletes it.
 * `legacyPath`: the old file's full path (null: there is none to look for).
 * → 'copied' | 'none' | 'done' (already copied earlier) | 'failed' (kept; tried again next start).
 */
export async function importLegacy(db, { legacyPath, deleteLegacy = async () => {} } = {}) {
  if (await readValue(db, LEGACY_DONE)) return 'done';
  if (!legacyPath) return 'none';
  let attached = false;
  let copied = false;
  try {
    // KEY '' attaches a plain (unencrypted) file to the encrypted connection.
    await db.execAsync(`ATTACH DATABASE ${quote(legacyPath)} AS legacy KEY ''`);
    attached = true;
    const tables = (await db.getAllAsync("SELECT name FROM legacy.sqlite_master WHERE type = 'table'")).map((r) => r.name);
    for (const table of LEGACY_TABLES.filter((t) => tables.includes(t))) {
      const ours = new Set((await db.getAllAsync(`PRAGMA main.table_info(${table})`)).map((c) => c.name));
      const cols = (await db.getAllAsync(`PRAGMA legacy.table_info(${table})`)).map((c) => c.name).filter((c) => ours.has(c));
      if (!cols.length) continue;
      const list = cols.join(', ');
      await db.execAsync(`INSERT OR IGNORE INTO main.${table} (${list}) SELECT ${list} FROM legacy.${table}`);
      copied = true;
    }
    await db.execAsync('DETACH DATABASE legacy');
    attached = false;
    await writeValue(db, LEGACY_DONE, true);
  } catch {
    if (attached) await db.execAsync('DETACH DATABASE legacy').catch(() => {});
    return 'failed';
  }
  // ATTACH creates an empty file when there was none; either way the old file goes now.
  await deleteLegacy().catch(() => {});
  return copied ? 'copied' : 'none';
}

let opening = null;

/** The app database, opened (encrypted), migrated and with the old database imported, once. */
export function getDatabase() {
  opening ??= openEncrypted().then(async (db) => {
    await db.execAsync('PRAGMA journal_mode = WAL');
    await migrate(db);
    const dir = typeof db.databasePath === 'string' ? db.databasePath.replace(/[^/\\]+$/, '') : null;
    await importLegacy(db, {
      legacyPath: dir ? `${dir}${LEGACY_DATABASE_NAME}` : null,
      deleteLegacy: () => SQLite.deleteDatabaseAsync(LEGACY_DATABASE_NAME),
    });
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

/**
 * Keys that belong to the device, not to an account: kept when someone signs out. Everything else
 * in `kv` is account data (day, profile, lessons with class lists, classes, timetable, dashboards,
 * fee data, notification preferences, reminder context) and is removed at sign-out.
 */
const DEVICE_KEYS = new Set(['theme.preference', LEGACY_DONE]);
const isDeviceKey = (key) => DEVICE_KEYS.has(key) || key.startsWith('device:');

/**
 * Removes every cached account copy from the device (sign-out, session ended, another account
 * signing in). Waiting uploads (the queues) are kept for their own account; nothing of one account
 * is ever shown to or sent by another (every queue read filters by user_id).
 */
export async function clearAccountCaches(db) {
  const keys = (await db.getAllAsync('SELECT key FROM kv')).map((r) => r.key).filter((k) => !isDeviceKey(k));
  for (const key of keys) await deleteValue(db, key);
  return keys.length;
}

/** Wipes the whole device database (remote wipe): every table and the key are removed. */
export async function wipeDatabase({ sqlite = SQLite, secureStore = SecureStore } = {}) {
  const db = await opening?.catch(() => null);
  opening = null;
  await db?.closeAsync?.().catch(() => {});
  await sqlite.deleteDatabaseAsync?.(DATABASE_NAME).catch(() => {});
  await sqlite.deleteDatabaseAsync?.(LEGACY_DATABASE_NAME).catch(() => {});
  await secureStore.deleteItemAsync(KEY_NAME, SECURE_OPTIONS).catch(() => {});
}

/** Tests only: forget the open database so the next getDatabase() opens a fresh one. */
export function resetDatabaseForTests() {
  opening = null;
}

/* global __openTestDatabase */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { clearAccountCaches, databaseKey, importLegacy, KEY_NAME, migrate, openEncrypted, readValue, writeValue } from '../database';
import { enqueue, pendingFor } from '../../attendance/queue';

const event = (id) => ({ clientEventId: id, type: 'CHECK_IN', occurredAt: '2026-11-27T05:00:00.000Z', position: { latitude: 2.04, longitude: 45.31, accuracy: 10 }, distanceEstimate: 12 });

let dir;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'edutrack-db-'));
  global.__secureStore.clear();
});
afterEach(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // Windows keeps a just-closed SQLite file locked for a moment; the temp folder is left behind.
  }
});

test('the database key is 32 random bytes, made once and kept in secure storage', async () => {
  const first = await databaseKey();
  expect(first).toMatch(/^[0-9a-f]{64}$/);
  expect(global.__secureStore.get(KEY_NAME)).toBe(first);
  expect(await databaseKey()).toBe(first);
});

test('the unencrypted database of earlier versions is copied once, then deleted', async () => {
  const legacyPath = join(dir, 'edutrack.db');
  const legacy = __openTestDatabase(legacyPath);
  await legacy.execAsync(`CREATE TABLE attendance_queue (client_event_id TEXT PRIMARY KEY NOT NULL, user_id TEXT NOT NULL, type TEXT NOT NULL, occurred_at TEXT NOT NULL,
    latitude REAL NOT NULL, longitude REAL NOT NULL, accuracy REAL NOT NULL, distance_estimate REAL, state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT, error_code TEXT, error_message TEXT, server_event TEXT, created_at TEXT NOT NULL, dismissed_at TEXT);
    CREATE TABLE kv (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL); PRAGMA user_version = 1;`);
  await legacy.runAsync("INSERT INTO attendance_queue (client_event_id, user_id, type, occurred_at, latitude, longitude, accuracy, state, created_at) VALUES ('e1', 'u1', 'CHECK_IN', '2026-11-27T05:00:00.000Z', 2.04, 45.31, 10, 'pending', '2026-11-27T05:00:00.000Z')");
  await writeValue(legacy, 'theme.preference', 'dark');
  await legacy.closeAsync();

  const db = __openTestDatabase(join(dir, 'edutrack-secure.db'));
  await migrate(db);
  const deleteLegacy = jest.fn(async () => {});
  expect(await importLegacy(db, { legacyPath, deleteLegacy })).toBe('copied');
  expect((await pendingFor(db, 'u1')).map((i) => i.clientEventId)).toEqual(['e1']);
  expect(await readValue(db, 'theme.preference')).toBe('dark');
  expect(deleteLegacy).toHaveBeenCalledTimes(1);
  // Later starts do nothing.
  expect(await importLegacy(db, { legacyPath, deleteLegacy })).toBe('done');
  expect(deleteLegacy).toHaveBeenCalledTimes(1);
  await db.closeAsync();
});

test('an import that fails keeps the old file and is tried again', async () => {
  const db = __openTestDatabase(join(dir, 'edutrack-secure.db'));
  await migrate(db);
  const deleteLegacy = jest.fn(async () => {});
  // A path that cannot be attached (a directory).
  expect(await importLegacy(db, { legacyPath: dir, deleteLegacy })).toBe('failed');
  expect(deleteLegacy).not.toHaveBeenCalled();
  expect(await importLegacy(db, { legacyPath: join(dir, 'missing.db'), deleteLegacy })).toBe('none');
  expect(deleteLegacy).toHaveBeenCalledTimes(1);
  await db.closeAsync();
});

test('signing out removes cached account data and keeps waiting uploads and device settings', async () => {
  const db = __openTestDatabase();
  await migrate(db);
  await enqueue(db, 'u1', event('e2'));
  for (const key of ['today:u1', 'profile:u1', 'lessons:u1', 'teaching:u1', 'timetable:u1', 'preferences:u1', 'reminders:context', 'dashboard:teacher:u1']) await writeValue(db, key, { x: 1 });
  await writeValue(db, 'theme.preference', 'light');
  await writeValue(db, 'device:workspace', 'teacher');
  expect(await clearAccountCaches(db)).toBe(8);
  expect((await db.getAllAsync('SELECT key FROM kv ORDER BY key')).map((r) => r.key)).toEqual(['device:workspace', 'theme.preference']);
  expect(await pendingFor(db, 'u1')).toHaveLength(1);
});

test('a database whose key was lost is deleted and made again', async () => {
  const broken = { execAsync: jest.fn(async () => {}), getFirstAsync: jest.fn(async () => { throw new Error('file is not a database'); }), closeAsync: jest.fn(async () => {}) };
  const fresh = __openTestDatabase();
  const sqlite = { openDatabaseAsync: jest.fn().mockResolvedValueOnce(broken).mockResolvedValueOnce(fresh), deleteDatabaseAsync: jest.fn(async () => {}) };
  const db = await openEncrypted({ sqlite });
  expect(db).toBe(fresh);
  expect(sqlite.deleteDatabaseAsync).toHaveBeenCalledWith('edutrack-secure.db');
  expect(broken.execAsync.mock.calls[0][0]).toMatch(/^PRAGMA key = "x'[0-9a-f]{64}'"$/);
});

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { getPrisma } from '../../config/prisma.js';

/*
 * The restore check (docs/data-backup/recovery-procedures.md → Verification): reads the staged
 * branch next to the running database and compares them. It proves that the restored database
 * opens, has the application's tables and migrations, and can be signed in to; it does not prove
 * the data is what you expect on a given day — the counts are shown so the Super Admin can judge.
 * Read only on both sides.
 */

/** Tables whose row counts are compared (the platform's main records). */
export const COUNTED_TABLES = ['School', 'Branch', 'User', 'BranchSchedule', 'StaffAssignment', 'AttendanceEvent', 'AuditEvent'];

async function snapshotOf(client) {
  const tables = (await client.$queryRawUnsafe(`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)).map((r) => r.name);
  const migrations = tables.includes('_prisma_migrations')
    ? await client.$queryRawUnsafe(`SELECT migration_name AS name, finished_at IS NOT NULL AND rolled_back_at IS NULL AS ok FROM "_prisma_migrations"`)
    : [];
  const counts = {};
  for (const table of COUNTED_TABLES) {
    // Table names come from the fixed list above, never from a request.
    counts[table] = tables.includes(table) ? Number((await client.$queryRawUnsafe(`SELECT count(*)::bigint AS n FROM "${table}"`))[0].n) : null;
  }
  const superAdmins = tables.includes('User')
    ? Number((await client.$queryRawUnsafe(`SELECT count(*)::bigint AS n FROM "User" WHERE "role" = 'SUPER_ADMIN' AND "status" = 'ACTIVE'`))[0].n)
    : 0;
  return {
    tables,
    applied: migrations.filter((m) => m.ok).map((m) => m.name),
    unfinished: migrations.filter((m) => !m.ok).map((m) => m.name),
    counts,
    superAdmins,
  };
}

/**
 * Compares the database at `uri` (the staged branch) with the running one.
 * → { ok, checks: [{ key, label, ok, detail }], counts: { table: { backup, current } }, missingMigrations, checkedAt }.
 * `ok` is false when the staged database cannot be used by this application as it is.
 */
export async function verifyStagedDatabase(uri, { now = new Date(), current = getPrisma(), connect = (connectionString) => new PrismaClient({ adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 30_000 }) }) } = {}) {
  const staged = connect(uri);
  try {
    const [backup, live] = [await snapshotOf(staged), await snapshotOf(current)];
    const missingMigrations = live.applied.filter((m) => !backup.applied.includes(m));
    const missingTables = live.tables.filter((t) => !backup.tables.includes(t));
    const checks = [
      { key: 'opens', label: 'The restored database opens and answers queries', ok: true, detail: `${backup.tables.length} tables` },
      { key: 'migrations', label: 'Database migrations recorded and finished', ok: backup.applied.length > 0 && backup.unfinished.length === 0, detail: `${backup.applied.length} applied${backup.unfinished.length ? `, ${backup.unfinished.length} unfinished` : ''}` },
      {
        key: 'schema',
        label: 'Same schema version as the running application',
        ok: missingMigrations.length === 0,
        detail: missingMigrations.length
          ? `${missingMigrations.length} newer migration(s) missing: ${missingMigrations.join(', ')}. After a production restore, apply them at once (prisma migrate deploy).`
          : 'Up to date',
        warning: missingMigrations.length > 0,
      },
      { key: 'tables', label: "All of the application's tables present", ok: missingTables.length === 0 || missingMigrations.length > 0, detail: missingTables.length ? `Missing: ${missingTables.join(', ')}` : 'All present' },
      { key: 'admin', label: 'At least one active Super Admin can sign in', ok: backup.superAdmins > 0, detail: `${backup.superAdmins} active Super Admin account(s)` },
    ];
    const counts = Object.fromEntries(COUNTED_TABLES.map((t) => [t, { backup: backup.counts[t], current: live.counts[t] }]));
    // A schema behind the application is a warning (fixable by applying migrations), not a failure.
    const ok = checks.every((c) => c.ok || c.warning);
    return { ok, checks, counts, missingMigrations, checkedAt: now.toISOString() };
  } finally {
    await staged.$disconnect().catch(() => {});
  }
}

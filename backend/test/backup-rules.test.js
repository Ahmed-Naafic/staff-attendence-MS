/*
 * Data & Backup rules without a database: next scheduled run, overdue detection, configuration
 * validation, names, and the restore check's verdicts (with fake database clients).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { nextScheduledAt, readConfiguration, scheduleOverdue, scheduleText, stampName } from '../src/features/backups/backupRules.js';
import { verifyStagedDatabase } from '../src/features/backups/verify.js';

const at = (iso) => new Date(iso);

describe('schedule', () => {
  test('next run: daily, weekly (Monday = 1 … Sunday = 7) and monthly, in UTC', () => {
    const now = at('2026-11-04T10:30:00Z'); // a Wednesday
    assert.equal(nextScheduledAt({ frequency: 'daily', hour: 2 }, now).toISOString(), '2026-11-05T02:00:00.000Z');
    assert.equal(nextScheduledAt({ frequency: 'daily', hour: 12 }, now).toISOString(), '2026-11-04T12:00:00.000Z');
    assert.equal(nextScheduledAt({ frequency: 'weekly', hour: 2, day: 1 }, now).toISOString(), '2026-11-09T02:00:00.000Z');
    assert.equal(nextScheduledAt({ frequency: 'weekly', hour: 2, day: 7 }, now).toISOString(), '2026-11-08T02:00:00.000Z');
    assert.equal(nextScheduledAt({ frequency: 'weekly', hour: 12, day: 3 }, now).toISOString(), '2026-11-04T12:00:00.000Z');
    assert.equal(nextScheduledAt({ frequency: 'monthly', hour: 2, day: 1 }, now).toISOString(), '2026-12-01T02:00:00.000Z');
    assert.equal(nextScheduledAt({ frequency: 'monthly', hour: 2, day: 28 }, at('2026-12-30T00:00:00Z')).toISOString(), '2027-01-28T02:00:00.000Z');
    assert.equal(nextScheduledAt(null, now), null);
  });

  test('overdue after the interval plus 3 hours', () => {
    const daily = { frequency: 'daily', hour: 2 };
    const now = at('2026-11-04T10:00:00Z');
    assert.equal(scheduleOverdue(daily, at('2026-11-03T08:00:00Z'), now), false);
    assert.equal(scheduleOverdue(daily, at('2026-11-03T06:59:00Z'), now), true);
    assert.equal(scheduleOverdue({ frequency: 'weekly', hour: 2, day: 1 }, at('2026-10-30T02:00:00Z'), now), false);
    assert.equal(scheduleOverdue(daily, null, now), false);
    assert.equal(scheduleOverdue(null, at('2020-01-01T00:00:00Z'), now), false);
  });

  test('text', () => {
    assert.equal(scheduleText({ frequency: 'monthly', hour: 23, day: 15 }), 'Monthly on day 15 at 23:00 UTC');
    assert.equal(scheduleText(null), 'No schedule');
  });
});

describe('configuration', () => {
  const current = { schedule: { frequency: 'daily', hour: 2, day: null, retentionDays: 14 }, manualRetentionDays: 30 };
  test('partial changes merge onto the current schedule', () => {
    assert.deepEqual(readConfiguration({ hour: 5 }, current), { schedule: { frequency: 'daily', hour: 5, day: null, retentionDays: 14 } });
    assert.deepEqual(readConfiguration({ manualRetentionDays: 90 }, current), { manualRetentionDays: 90 });
    assert.deepEqual(readConfiguration({ frequency: 'monthly', day: 28 }, current).schedule.day, 28);
  });
  test('limits: Neon keeps scheduled snapshots at most 35 days; monthly day 1–28; weekly needs a day', () => {
    const errors = (body) => {
      try {
        readConfiguration(body, current);
        return null;
      } catch (error) {
        return error.details ?? error.message;
      }
    };
    assert.ok(errors({ retentionDays: 36 }).retentionDays);
    assert.ok(errors({ frequency: 'monthly', day: 31 }).day);
    assert.ok(errors({ frequency: 'weekly' }).day);
    assert.ok(errors({ hour: 24 }).hour);
    assert.ok(errors({ hour: '2' }).hour);
    assert.ok(errors({ manualRetentionDays: 366 }).manualRetentionDays);
    assert.match(errors({}), /at least one/);
    assert.match(errors({ apiKey: 'x' }), /Unknown field/);
  });
  test('names', () => {
    assert.equal(stampName('edutrack-manual', at('2026-11-04T10:30:05.123Z')), 'edutrack-manual-20261104-103005');
  });
});

describe('restore check verdicts', () => {
  const fake = ({ tables = ['_prisma_migrations', 'User', 'School'], migrations = ['m1', 'm2'], unfinished = [], admins = 1 } = {}) => ({
    async $queryRawUnsafe(sql) {
      if (sql.includes('information_schema')) return tables.map((name) => ({ name }));
      if (sql.includes('_prisma_migrations')) return [...migrations.map((name) => ({ name, ok: true })), ...unfinished.map((name) => ({ name, ok: false }))];
      if (sql.includes("'SUPER_ADMIN'")) return [{ n: admins }];
      return [{ n: 3 }];
    },
    async $disconnect() {},
  });
  const check = (staged, current = fake()) => verifyStagedDatabase('postgresql://staged', { current, connect: () => staged, now: at('2026-11-04T10:00:00Z') });

  test('identical databases pass', async () => {
    const result = await check(fake());
    assert.equal(result.ok, true);
    assert.deepEqual(result.missingMigrations, []);
    assert.equal(result.counts.User.backup, 3);
  });
  test('a backup behind the application: usable, with a warning listing the migrations to apply', async () => {
    const result = await check(fake({ migrations: ['m1'] }), fake({ migrations: ['m1', 'm2'] }));
    assert.equal(result.ok, true);
    assert.deepEqual(result.missingMigrations, ['m2']);
    assert.equal(result.checks.find((c) => c.key === 'schema').warning, true);
  });
  test('no active Super Admin, unfinished migrations or missing tables fail the check', async () => {
    assert.equal((await check(fake({ admins: 0 }))).ok, false);
    assert.equal((await check(fake({ unfinished: ['m3'] }))).ok, false);
    assert.equal((await check(fake({ tables: ['_prisma_migrations', 'User'] }))).ok, false);
    assert.equal((await check(fake({ tables: [], migrations: [] }))).ok, false);
  });
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canDelete, canProtect, changedConfig, configProblems, confirmationOk, formatBytes, hourOptions, retentionConsequences } from './backupRules.js';

const saved = { schedule: { frequency: 'daily', hour: 2, day: null, retentionDays: 14 }, manualRetentionDays: 30 };
const draftOf = (over) => ({ frequency: 'daily', hour: '2', day: '1', retentionDays: '14', manualRetentionDays: '30', ...over });

test('sizes', () => {
  assert.equal(formatBytes(null), 'Not reported');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(250 * 1024 * 1024), '250 MB');
});

test('hours are UTC with the platform time zone beside them', () => {
  const options = hourOptions('Africa/Mogadishu', new Date('2026-11-04T00:00:00Z'));
  assert.equal(options.length, 24);
  assert.equal(options[2].label, '02:00 UTC (05:00 Africa/Mogadishu)');
  assert.equal(hourOptions('UTC')[0].label, '00:00 UTC');
});

test('changed values: the whole schedule when it changes, retention alone otherwise', () => {
  assert.deepEqual(changedConfig(saved, draftOf()), {});
  assert.deepEqual(changedConfig(saved, draftOf({ hour: '4' })), { frequency: 'daily', hour: 4, retentionDays: 14 });
  assert.deepEqual(changedConfig(saved, draftOf({ frequency: 'weekly', day: '3' })), { frequency: 'weekly', hour: 2, day: 3, retentionDays: 14 });
  assert.deepEqual(changedConfig(saved, draftOf({ manualRetentionDays: '60' })), { manualRetentionDays: 60 });
  assert.deepEqual(changedConfig(saved, draftOf({ day: '5' })), {}, 'the day does not matter for a daily schedule');
  assert.deepEqual(changedConfig({ schedule: null, manualRetentionDays: 30 }, draftOf()), { frequency: 'daily', hour: 2, retentionDays: 14 }, 'no schedule yet: saving sets one');
});

test('limits and consequences', () => {
  assert.deepEqual(Object.keys(configProblems(draftOf({ retentionDays: '36', manualRetentionDays: 'x' }))).sort(), ['manualRetentionDays', 'retentionDays']);
  assert.match(retentionConsequences(saved, draftOf({ retentionDays: '7' }))[0], /kept 7 days instead of 14/);
  assert.match(retentionConsequences(saved, draftOf({ manualRetentionDays: '60' }))[0], /more Neon storage/);
  assert.deepEqual(retentionConsequences(saved, draftOf()), []);
});

test('actions and confirmation', () => {
  assert.ok(canDelete({ status: 'COMPLETED', protected: false, providerRef: 'snap-1' }));
  assert.ok(!canDelete({ status: 'COMPLETED', protected: true, providerRef: 'snap-1' }));
  assert.ok(!canDelete({ status: 'RESTORING', protected: false, providerRef: 'snap-1' }));
  assert.ok(!canProtect({ status: 'COMPLETED', kind: 'SCHEDULED' }));
  assert.ok(confirmationOk('RESTORE PRODUCTION'));
  assert.ok(!confirmationOk('restore production'));
});

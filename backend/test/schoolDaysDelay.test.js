/*
 * Platform Settings → "School days follow the effective delay" (pure, no database): how many days
 * ahead a change of school days can start when school days already apply today.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readScheduling, schedulingSettings, schoolDaysDelay } from '../src/features/platform-settings/schedulingPolicy.js';

test('off by default: tomorrow at the earliest, whatever the delay', () => {
  assert.equal(schedulingSettings({}).schoolDaysFollowDelay, false);
  assert.equal(schoolDaysDelay(schedulingSettings({ effectiveDelayDays: 5 })), 1);
});

test('on: the effective delay; with timed changes a change may start today (as for staff changes)', () => {
  assert.equal(schoolDaysDelay(schedulingSettings({ effectiveDelayDays: 5, schoolDaysFollowDelay: true })), 5);
  assert.equal(schoolDaysDelay(schedulingSettings({ effectiveDelayDays: 5, schoolDaysFollowDelay: true, timedChanges: true })), 0);
  assert.equal(schoolDaysDelay(schedulingSettings({ timedChanges: true })), 0);
  assert.equal(schoolDaysDelay(schedulingSettings({ schoolDaysFollowDelay: true })), 1, 'the default delay is 1 day');
});

test('the switch is read like the others', () => {
  assert.deepEqual(readScheduling({ schoolDaysFollowDelay: true }), { schoolDaysFollowDelay: true });
  assert.throws(() => readScheduling({ schoolDaysFollowDelay: 'yes' }), /true or false/);
});

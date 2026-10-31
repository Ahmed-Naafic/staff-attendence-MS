import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedSettings, settingsForm, settingsProblems } from './notificationSettingsRules.js';

const LIMITS = { checkInLead: { min: 0, max: 30 }, checkOutLead: { min: 0, max: 120 }, digestHour: { min: 0, max: 23 } };
const SAVED = {
  pushEnabled: true,
  checkInReminderEnabled: true,
  checkOutReminderEnabled: true,
  uploadReminderEnabled: true,
  staffCanAdjustTiming: true,
  checkInLeadDefault: 15,
  checkInLeadMin: 0,
  checkInLeadMax: 30,
  checkOutLeadDefault: 10,
  checkOutLeadMin: 0,
  checkOutLeadMax: 60,
  digestHour: 6,
};

test('platform notification settings: hard limits, minimum ≤ maximum, default within them', () => {
  const form = settingsForm(SAVED);
  assert.deepEqual(settingsProblems(form, LIMITS), {});
  assert.match(settingsProblems({ ...form, checkInLeadMax: '31' }, LIMITS).checkInLeadMax, /0 to 30/);
  assert.match(settingsProblems({ ...form, digestHour: '24' }, LIMITS).digestHour, /0 to 23/);
  assert.match(settingsProblems({ ...form, checkOutLeadMin: '50', checkOutLeadMax: '40' }, LIMITS).checkOutLeadMin, /minimum cannot be more/);
  assert.match(settingsProblems({ ...form, checkInLeadDefault: '25', checkInLeadMax: '20' }, LIMITS).checkInLeadDefault, /from 0 to 20/);
  assert.ok(settingsProblems({ ...form, checkInLeadMin: '1.5' }, LIMITS).checkInLeadMin);
});

test('only changed fields are sent, numbers as numbers', () => {
  const form = { ...settingsForm(SAVED), pushEnabled: false, checkOutLeadMax: '90' };
  assert.deepEqual(changedSettings(form, SAVED), { pushEnabled: false, checkOutLeadMax: 90 });
  assert.deepEqual(changedSettings(settingsForm(SAVED), SAVED), {});
});

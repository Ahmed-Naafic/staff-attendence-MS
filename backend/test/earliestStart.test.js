/*
 * The first date new bell times or a new timetable can start (pure, no database): tomorrow once the
 * version in effect today started earlier (the day is under way) — or today when Platform Settings
 * allow changes to take effect at their time (timed changes).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { earliestStart } from '../src/features/timetable/timetable.service.js';

const today = '2026-11-21';
const v = (effectiveFrom) => ({ id: effectiveFrom, effectiveFrom });

test('nothing in effect, or it started today: today', () => {
  assert.equal(earliestStart([], today), today);
  assert.equal(earliestStart([v(today)], today), today);
  assert.equal(earliestStart([v('2026-12-01')], today), today, 'only a later version');
});

test('in effect since before today: tomorrow, unless timed changes are on', () => {
  assert.equal(earliestStart([v('2026-11-01')], today), '2026-11-22');
  assert.equal(earliestStart([v('2026-11-01')], today, { timedChanges: false }), '2026-11-22');
  assert.equal(earliestStart([v('2026-11-01')], today, { timedChanges: true }), today);
});

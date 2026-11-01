import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedValues, daysText, delayExample, delayProblem } from './schedulingRules.js';

test('effective delay: whole days from 1 to 30', () => {
  for (const ok of ['1', '7', '30', ' 3 ']) assert.equal(delayProblem(ok), null, ok);
  assert.equal(delayProblem(''), 'Enter the effective delay in days.');
  for (const bad of ['0', '31', '1.5', '-1', 'two', '1e1']) assert.match(delayProblem(bad), /whole number of days from 1 to 30/, bad);
});

test('texts: day/days and when a change saved today starts', () => {
  assert.equal(daysText(1), '1 day');
  assert.equal(daysText(3), '3 days');
  assert.equal(delayExample(1), 'tomorrow at 00:00');
  assert.equal(delayExample(5), '5 days later at 00:00');
});

test('only changed values are sent', () => {
  const saved = { effectiveDelayDays: 1, immediateFirstSchedule: true, immediateFirstAssignment: true };
  assert.deepEqual(changedValues(saved, { effectiveDelayDays: '1', immediateFirstSchedule: true, immediateFirstAssignment: true }), {});
  assert.deepEqual(changedValues(saved, { effectiveDelayDays: '3', immediateFirstSchedule: false, immediateFirstAssignment: true }), { effectiveDelayDays: 3, immediateFirstSchedule: false });
  const timed = { ...saved, timedChanges: false };
  assert.deepEqual(changedValues(timed, { effectiveDelayDays: '1', immediateFirstSchedule: true, immediateFirstAssignment: true, timedChanges: true }), { timedChanges: true });
});

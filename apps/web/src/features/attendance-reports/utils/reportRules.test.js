import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHECK_OUT, daysInclusive, formatMeters, formatWorked, isFiltered, presetRange, readView, validateRange, viewRange } from './reportRules.js';

const ID = '0b7a1c5e-6f1d-4c3b-9a2e-1f2d3c4b5a69';
const params = (query) => new URLSearchParams(query);

test('presets use the server’s today: weeks start on Monday; months on the 1st; year ends', () => {
  // 2026-10-28 is a Wednesday.
  assert.deepEqual(presetRange('today', '2026-10-28'), { from: '2026-10-28', to: '2026-10-28' });
  assert.deepEqual(presetRange('yesterday', '2026-10-28'), { from: '2026-10-27', to: '2026-10-27' });
  assert.deepEqual(presetRange('week', '2026-10-28'), { from: '2026-10-26', to: '2026-10-28' });
  assert.deepEqual(presetRange('week', '2026-10-26'), { from: '2026-10-26', to: '2026-10-26' });
  assert.deepEqual(presetRange('week', '2026-11-01'), { from: '2026-10-26', to: '2026-11-01' });
  assert.deepEqual(presetRange('month', '2026-10-28'), { from: '2026-10-01', to: '2026-10-28' });
  assert.deepEqual(presetRange('yesterday', '2027-01-01'), { from: '2026-12-31', to: '2026-12-31' });
  assert.deepEqual(presetRange('week', '2027-01-01'), { from: '2026-12-28', to: '2027-01-01' });
});

test('custom ranges: inclusive, at most 62 days, ordered, not after today, real dates', () => {
  const today = '2026-10-28';
  assert.equal(daysInclusive('2026-10-28', '2026-10-28'), 1);
  assert.deepEqual(validateRange('2026-08-28', today, today), {}); // 62 days
  assert.match(validateRange('2026-08-27', today, today).from, /at most 62 days \(from 2026-08-28/);
  assert.match(validateRange('2026-10-20', '2026-10-10', today).from, /on or before/);
  assert.match(validateRange('2026-10-20', '2026-10-29', today).to, /after today/);
  assert.equal(validateRange('', today, today).from, 'Choose a start date.');
  assert.equal(validateRange('2026-02-30', today, today).from, 'Choose a start date.');
  assert.deepEqual(viewRange({ range: 'custom', from: '2026-10-29', to: '2026-10-29' }, today).from, null);
  assert.deepEqual(viewRange({ range: 'month' }, null), { from: null, to: null, errors: {} });
});

test('the view from the URL: invalid values fall back; Managers have no branch, branch sort or Branches tab', () => {
  const owner = readView(params(`tab=branches&branch=${ID}&shift=${ID}&status=late&checkOut=missing&sort=branch:asc&page=3&range=week`), 'OWNER');
  assert.deepEqual([owner.tab, owner.branch, owner.shift, owner.status, owner.checkOut, owner.sort, owner.page, owner.range], ['branches', ID, ID, 'late', 'missing', 'branch:asc', 3, 'week']);
  const manager = readView(params(`tab=branches&branch=${ID}&shift=${ID}&sort=branch:asc`), 'MANAGER');
  assert.deepEqual([manager.tab, manager.branch, manager.shift, manager.sort], ['overview', '', ID, 'date:desc']);
  // D16: an Owner's shift filter needs one branch.
  assert.equal(readView(params(`shift=${ID}`), 'OWNER').shift, '');
  const junk = readView(params('tab=x&status=absent&checkOut=closed&sort=evil&page=-4&branch=1&range=year'), 'OWNER');
  assert.deepEqual([junk.tab, junk.status, junk.checkOut, junk.sort, junk.page, junk.branch, junk.range], ['overview', '', '', 'date:desc', 1, '', 'today']);
  assert.equal(isFiltered(readView(params(''), 'OWNER')), false);
  assert.equal(isFiltered(readView(params('q=amina'), 'OWNER')), true);
});

test('labels: check-out states are never attendance statuses or absence; durations and metres', () => {
  assert.deepEqual(
    Object.values(CHECK_OUT).map((s) => s.label),
    ['Checked out', 'Not checked out yet', 'No check-out', 'Check-out not required'],
  );
  assert.ok(Object.values(CHECK_OUT).every((s) => !/absent/i.test(s.label)));
  assert.equal(formatWorked(365), '6 h 5 min');
  assert.equal(formatWorked(120), '2 h');
  assert.equal(formatWorked(0), '0 min');
  assert.equal(formatWorked(null), null);
  assert.equal(formatMeters(20), '20 m');
  assert.equal(formatMeters(28.4), '28.4 m');
  assert.equal(formatMeters(null), null);
});

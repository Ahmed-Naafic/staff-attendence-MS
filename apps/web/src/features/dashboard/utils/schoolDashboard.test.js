import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clockText, compactMoney, dashboardRequest, percentText, quickActions } from './schoolDashboard.js';

test('the dashboard request follows the role; a Manager never sends a branch', () => {
  assert.deepEqual(dashboardRequest('OWNER', { academicYear: 'y1', branch: 'b1', from: '2026-11-01', to: '' }), { path: '/owner/dashboard', query: { academicYear: 'y1', branch: 'b1', from: '2026-11-01' } });
  assert.deepEqual(dashboardRequest('MANAGER', { academicYear: 'y1', branch: 'b2' }), { path: '/manager/dashboard', query: { academicYear: 'y1' } });
  assert.deepEqual(dashboardRequest('OWNER', {}), { path: '/owner/dashboard', query: {} });
});

test('compact amounts for chart axes', () => {
  assert.equal(compactMoney(5670000), '$56.7K');
  assert.equal(compactMoney(120000000), '$1.2M');
  assert.equal(compactMoney(4500), '$45');
  assert.equal(compactMoney(0), '$0');
  assert.equal(compactMoney(25000000), '$250K');
  assert.equal(compactMoney(-150000, 'SOS'), '-Sh1.5K');
  assert.equal(compactMoney(null), '—');
});

test('percentages keep one decimal at most', () => {
  assert.equal(percentText(75), '75%');
  assert.equal(percentText(61.84), '61.8%');
  assert.equal(percentText(undefined), '0%');
});

test('quick actions per role and module', () => {
  const owner = quickActions('OWNER', { fees: true, examinations: true }).map((a) => a.key);
  assert.deepEqual(owner, ['branch', 'student', 'exam', 'structures', 'invoice', 'clearance', 'reports']);
  assert.deepEqual(quickActions('OWNER', { fees: false, examinations: false }).map((a) => a.key), ['branch', 'student', 'reports']);
  const manager = quickActions('MANAGER', { fees: true });
  assert.deepEqual(manager.map((a) => a.key), ['student', 'payment', 'invoice', 'clearance']);
  assert.equal(manager.find((a) => a.key === 'payment').to, '/fees/payments?record=1');
  assert.ok(!manager.some((a) => a.key === 'branch'), 'Managers do not add branches');
  assert.deepEqual(quickActions('MANAGER', { fees: false }).map((a) => a.key), ['student']);
});

test('clock times', () => {
  assert.equal(clockText('07:30'), '7:30 AM');
  assert.equal(clockText('12:05'), '12:05 PM');
  assert.equal(clockText('00:00'), '12:00 AM');
  assert.equal(clockText('14:00'), '2:00 PM');
});

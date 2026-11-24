import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { checkPayment, fromCents, money, monthName, obligationState, toCents, yearMonths } from './feeFormat.js';

describe('fee display rules', () => {
  test('money and amounts typed by staff', () => {
    assert.equal(money(123450), '$1,234.50');
    assert.equal(money(-500, 'USD'), '-$5.00');
    assert.equal(money(null), '—');
    assert.equal(toCents('20'), 2000);
    assert.equal(toCents('20.5'), 2050);
    assert.equal(toCents('1,200.25'), 120025);
    assert.equal(toCents('abc'), null);
    assert.equal(toCents('-5'), null);
    assert.equal(fromCents(2000), '20');
    assert.equal(fromCents(2050), '20.50');
  });

  test('months of a year', () => {
    assert.equal(monthName('2026-11-01'), 'November 2026');
    const months = yearMonths({ startDate: '2026-09-01', endDate: '2027-06-30' });
    assert.equal(months.length, 10);
    assert.deepEqual([months[0].value, months.at(-1).value], ['2026-09', '2027-06']);
  });

  test('obligation state: overdue wins over unpaid', () => {
    assert.equal(obligationState({ status: 'open', paymentState: 'unpaid', overdue: true }), 'overdue');
    assert.equal(obligationState({ status: 'paid', paymentState: 'paid', overdue: false }), 'paid');
    assert.equal(obligationState({ status: 'cancelled', paymentState: 'unpaid', overdue: true }), 'cancelled');
  });

  test('a payment being entered: chosen months, balances, part payments, total', () => {
    const lines = [
      { period: 'January', balance: 2000, selected: true, amount: '20', currency: 'USD' },
      { period: 'March', balance: 2000, selected: false, amount: '', currency: 'USD' },
      { period: 'April', balance: 2000, selected: true, amount: '20', currency: 'USD' },
    ];
    assert.deepEqual(checkPayment(4000, lines, { allowPartial: true }).problems, []);
    assert.match(checkPayment(3000, lines, { allowPartial: true }).problems[0], /add up/);
    const partial = lines.map((l) => (l.period === 'April' ? { ...l, amount: '10' } : l));
    assert.match(checkPayment(3000, partial, { allowPartial: false }).problems[0], /part payments/);
    assert.deepEqual(checkPayment(3000, partial, { allowPartial: true }).problems, []);
    const over = lines.map((l) => (l.period === 'April' ? { ...l, amount: '25' } : l));
    assert.match(checkPayment(4500, over, { allowPartial: true }).problems[0], /at most/);
    assert.match(checkPayment(0, lines.map((l) => ({ ...l, selected: false })), { allowPartial: true }).problems[0], /Choose/);
  });
});

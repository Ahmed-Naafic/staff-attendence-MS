/*
 * Fee Management rules without the database (src/features/fees/feeRules.js): months, discounts and
 * their combination, payment allocation checks, withdrawal billing, clearance, document numbers and
 * invoice status.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  addMonths,
  applyDiscounts,
  chargeableMonth,
  chargeWithdrawalMonth,
  checkAllocations,
  counterKey,
  discountCovers,
  discountValue,
  evaluateClearance,
  formatMoney,
  formatNumber,
  invoiceStatus,
  isOverdue,
  monthlyDueDate,
  monthsBetween,
  statusAfterPayment,
  validNumberFormat,
} from '../src/features/fees/feeRules.js';
import { resolveFeeSettings, validFeeValue } from '../src/features/fees/feeSettings.js';

describe('months and dates', () => {
  test('month arithmetic crosses years', () => {
    assert.equal(addMonths('2026-11-01', 2), '2027-01-01');
    assert.equal(addMonths('2027-01-01', -1), '2026-12-01');
    assert.deepEqual(monthsBetween('2026-09-15', '2026-12-02'), ['2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01']);
  });
  test('the due day never passes the end of the month', () => {
    assert.equal(monthlyDueDate('2027-02-01', 10), '2027-02-10');
    assert.equal(monthlyDueDate('2027-02-01', 28), '2027-02-28');
  });
  test('overdue after the due date plus grace days, only while something is owed', () => {
    const o = { status: 'OPEN', netAmount: 2000, paidAmount: 0, dueDate: '2026-11-10' };
    assert.equal(isOverdue(o, '2026-11-10'), false);
    assert.equal(isOverdue(o, '2026-11-11'), true);
    assert.equal(isOverdue(o, '2026-11-12', 3), false);
    assert.equal(isOverdue({ ...o, paidAmount: 2000, status: 'PAID' }, '2026-12-30'), false);
    assert.equal(isOverdue({ ...o, status: 'CANCELLED' }, '2026-12-30'), false);
  });
  test('money is shown in the currency', () => {
    assert.equal(formatMoney(123450, 'USD'), '$1,234.50');
    assert.equal(formatMoney(-2000, 'USD'), '-$20.00');
    assert.equal(formatMoney(5000, 'DJF'), 'Fdj50');
  });
});

describe('enrollment and withdrawal billing', () => {
  const withdrawal = { policy: 'full', cutoffDay: 15 };
  test('a student is charged from their enrollment month, not before', () => {
    const e = { enrolledDay: '2026-11-20', endedDay: null, status: 'ACTIVE' };
    assert.equal(chargeableMonth('2026-10-01', e, withdrawal), false);
    assert.equal(chargeableMonth('2026-11-01', e, withdrawal), true);
    assert.equal(chargeableMonth('2026-12-01', e, withdrawal), true);
  });
  test('no month after an official withdrawal is charged; the withdrawal month follows the policy', () => {
    const e = { enrolledDay: '2026-09-01', endedDay: '2026-11-10', status: 'TRANSFERRED_OUT' };
    assert.equal(chargeableMonth('2026-12-01', e, withdrawal), false);
    assert.equal(chargeableMonth('2026-10-01', e, withdrawal), true);
    assert.equal(chargeableMonth('2026-11-01', e, { policy: 'full' }), true);
    assert.equal(chargeableMonth('2026-11-01', e, { policy: 'none' }), false);
    assert.equal(chargeableMonth('2026-11-01', e, { policy: 'cutoff', cutoffDay: 15 }), false);
    assert.equal(chargeWithdrawalMonth('2026-11-20', { policy: 'cutoff', cutoffDay: 15 }), true);
  });
});

describe('discounts', () => {
  const pct = (name, bp, extra = {}) => ({ id: name, name, category: 'DISCOUNT', type: 'PERCENTAGE', value: bp, maxAmount: null, combinable: true, ...extra });
  const fixed = (name, cents, extra = {}) => ({ id: name, name, category: 'DISCOUNT', type: 'FIXED', value: cents, maxAmount: null, combinable: true, ...extra });
  test('percentage, fixed, maximum and never more than the fee', () => {
    assert.equal(discountValue(2000, pct('a', 1000)), 200);
    assert.equal(discountValue(2000, fixed('b', 500)), 500);
    assert.equal(discountValue(2000, pct('c', 5000, { maxAmount: 300 })), 300);
    assert.equal(discountValue(400, fixed('d', 500)), 400);
    assert.equal(discountValue(2000, pct('full', 10000)), 2000);
  });
  test('best: only the largest applies', () => {
    const r = applyDiscounts(2000, [pct('sibling', 1000), fixed('merit', 500)], { combination: 'best' });
    assert.equal(r.total, 500);
    assert.deepEqual(r.applied.map((d) => d.name), ['merit']);
  });
  test('stack: combinable ones add up; a non-combinable one stands alone; the largest candidate wins', () => {
    const r = applyDiscounts(2000, [pct('sibling', 1000), fixed('merit', 500), pct('staff child', 3000, { combinable: false })], { combination: 'stack' });
    assert.equal(r.total, 700);
    assert.deepEqual(r.applied.map((d) => d.name).sort(), ['merit', 'sibling']);
    const r2 = applyDiscounts(2000, [pct('sibling', 1000), pct('staff child', 5000, { combinable: false })], { combination: 'stack' });
    assert.equal(r2.total, 1000);
    assert.deepEqual(r2.applied.map((d) => d.name), ['staff child']);
  });
  test('the combined limit scales discounts down in proportion', () => {
    const r = applyDiscounts(2000, [pct('a', 4000), pct('b', 4000)], { combination: 'stack', maxCombinedPercent: 50 });
    assert.equal(r.total, 1000);
    assert.equal(r.applied.reduce((n, d) => n + d.amount, 0), 1000);
  });
  test('a discount covers its months, kinds, classes and branches only', () => {
    const policy = { status: 'ACTIVE', appliesTo: ['MONTHLY'], classIds: ['c1'], branchIds: [], startDate: null, endDate: '2027-03-31' };
    const sd = { startMonth: '2026-11-01', endMonth: null, revokedAt: null };
    const ctx = { month: '2026-12-01', kind: 'MONTHLY', classId: 'c1', branchId: 'b1' };
    assert.equal(discountCovers(sd, policy, ctx), true);
    assert.equal(discountCovers(sd, policy, { ...ctx, month: '2026-10-01' }), false);
    assert.equal(discountCovers(sd, policy, { ...ctx, month: '2027-04-01' }), false);
    assert.equal(discountCovers(sd, policy, { ...ctx, kind: 'EXAM' }), false);
    assert.equal(discountCovers(sd, policy, { ...ctx, classId: 'c2' }), false);
    assert.equal(discountCovers({ ...sd, revokedAt: new Date() }, policy, ctx), false);
    // Database rows carry Date values.
    assert.equal(discountCovers({ ...sd, startMonth: new Date('2026-11-01T00:00:00Z') }, { ...policy, endDate: new Date('2027-03-31T00:00:00Z') }, ctx), true);
  });
});

describe('payment allocation', () => {
  const o = (id, title, net, paid = 0, status = 'OPEN') => [id, { id, title, netAmount: net, paidAmount: paid, status }];
  // January unpaid, February paid, March and April unpaid ($20 each).
  const map = new Map([o('jan', 'January', 2000), o('feb', 'February', 2000, 2000, 'PAID'), o('mar', 'March', 2000), o('apr', 'April', 2000)]);
  const policy = { allowPartial: true, minimumPartial: 0 };
  test('any unpaid months may be chosen, leaving older ones unpaid', () => {
    const { problems } = checkAllocations(4000, [{ obligationId: 'jan', amount: 2000 }, { obligationId: 'apr', amount: 2000 }], map, policy);
    assert.deepEqual(problems, {});
  });
  test('a paid month cannot be chosen; no allocation above a balance; the total must equal the amount', () => {
    assert.match(checkAllocations(2000, [{ obligationId: 'feb', amount: 2000 }], map, policy).problems.allocations, /nothing left/);
    assert.match(checkAllocations(2500, [{ obligationId: 'jan', amount: 2500 }], map, policy).problems.allocations, /at most/);
    assert.match(checkAllocations(4000, [{ obligationId: 'jan', amount: 2000 }], map, policy).problems.allocations, /add up/);
    assert.match(checkAllocations(2000, [{ obligationId: 'x', amount: 2000 }], map, policy).problems.allocations, /not part/);
    assert.match(checkAllocations(4000, [{ obligationId: 'jan', amount: 2000 }, { obligationId: 'jan', amount: 2000 }], map, policy).problems.allocations, /twice/);
  });
  test('part payments follow the school policy', () => {
    assert.deepEqual(checkAllocations(1000, [{ obligationId: 'mar', amount: 1000 }], map, policy).problems, {});
    assert.match(checkAllocations(1000, [{ obligationId: 'mar', amount: 1000 }], map, { allowPartial: false }).problems.allocations, /in full/);
    assert.match(checkAllocations(500, [{ obligationId: 'mar', amount: 500 }], map, { allowPartial: true, minimumPartial: 1000 }).problems.amount, /at least/);
  });
  test('status after payment', () => {
    assert.equal(statusAfterPayment({ status: 'OPEN', netAmount: 2000 }, 2000), 'PAID');
    assert.equal(statusAfterPayment({ status: 'OPEN', netAmount: 2000 }, 1000), 'OPEN');
    assert.equal(statusAfterPayment({ status: 'CANCELLED', netAmount: 2000 }, 2000), 'CANCELLED');
  });
});

describe('clearance', () => {
  const policy = { examFeeRequired: true, monthlyBlocks: 'overdue', partialQualifies: false, partialMinimumPercent: 50, graceDays: 0 };
  const exam = { id: 'e1' };
  const fee = (net, paid) => ({ kind: 'EXAM', examinationId: 'e1', status: paid >= net ? 'PAID' : 'OPEN', netAmount: net, paidAmount: paid, dueDate: '2026-12-01' });
  const month = (due, net, paid) => ({ kind: 'MONTHLY', status: paid >= net ? 'PAID' : 'OPEN', netAmount: net, paidAmount: paid, dueDate: due });
  test('cleared when the examination fee and overdue monthly fees are paid', () => {
    const c = evaluateClearance([fee(2000, 2000), month('2026-11-10', 2000, 2000), month('2026-12-10', 2000, 0)], { exam, policy, asOf: '2026-12-01' });
    assert.equal(c.status, 'CLEARED');
    assert.equal(c.eligible, true);
  });
  test('partially cleared: some paid; eligible only when part payment qualifies and enough is paid', () => {
    const list = [fee(2000, 2000), month('2026-11-10', 2000, 0)];
    const c = evaluateClearance(list, { exam, policy, asOf: '2026-12-01' });
    assert.equal(c.status, 'PARTIALLY_CLEARED');
    assert.equal(c.eligible, false);
    assert.equal(evaluateClearance(list, { exam, policy: { ...policy, partialQualifies: true, partialMinimumPercent: 50 }, asOf: '2026-12-01' }).eligible, true);
  });
  test('not cleared when nothing required is paid; monthly fees can be left out by policy', () => {
    const list = [fee(2000, 0), month('2026-11-10', 2000, 0)];
    assert.equal(evaluateClearance(list, { exam, policy, asOf: '2026-12-01' }).status, 'NOT_CLEARED');
    const noMonthly = evaluateClearance([fee(2000, 2000), month('2026-11-10', 2000, 0)], { exam, policy: { ...policy, monthlyBlocks: 'none' }, asOf: '2026-12-01' });
    assert.equal(noMonthly.status, 'CLEARED');
  });
  test('an exception clears with its reason; examination and monthly fees stay separate', () => {
    const c = evaluateClearance([fee(2000, 0)], { exam, policy, asOf: '2026-12-01', exception: { reason: 'Orphan support' } });
    assert.equal(c.status, 'CLEARED');
    assert.equal(c.byException, true);
    assert.match(c.reasons[0], /Orphan support/);
    const cancelled = evaluateClearance([{ ...fee(2000, 0), status: 'CANCELLED' }], { exam, policy, asOf: '2026-12-01' });
    assert.equal(cancelled.required, 0);
  });
});

describe('documents', () => {
  test('number formats', () => {
    assert.equal(formatNumber('RCP-{YYYY}-{SEQ5}', { sequence: 42, day: '2026-11-23' }), 'RCP-2026-00042');
    assert.equal(formatNumber('INV{YY}{MM}-B{BRANCH}-{SEQ}', { sequence: 7, day: '2026-11-23', branchNumber: 2 }), 'INV2611-B02-0007');
    assert.equal(counterKey('receipt', 'RCP-{YYYY}-{SEQ5}', '2026-11-23'), 'receipt:2026');
    assert.equal(counterKey('receipt', 'R-{SEQ}', '2026-11-23'), 'receipt');
    assert.equal(validNumberFormat('RCP-{YYYY}-{SEQ5}'), true);
    assert.equal(validNumberFormat('RCP-{YYYY}'), false);
    assert.equal(validNumberFormat('RCP-{DAY}-{SEQ}'), false);
  });
  test('invoice status follows its fees; drafts and cancelled invoices keep theirs; no overdue status', () => {
    const line = (net, paid, status = 'OPEN') => ({ obligation: { netAmount: net, paidAmount: paid, status } });
    assert.equal(invoiceStatus('ISSUED', [line(2000, 0), line(2000, 0)]), 'ISSUED');
    assert.equal(invoiceStatus('ISSUED', [line(2000, 2000), line(2000, 0)]), 'PARTIALLY_PAID');
    assert.equal(invoiceStatus('PARTIALLY_PAID', [line(2000, 2000), line(2000, 2000)]), 'PAID');
    assert.equal(invoiceStatus('PAID', [line(2000, 0)]), 'ISSUED');
    assert.equal(invoiceStatus('DRAFT', [line(2000, 2000)]), 'DRAFT');
    assert.equal(invoiceStatus('CANCELLED', [line(2000, 0)]), 'CANCELLED');
  });
});

describe('fee settings', () => {
  test('defaults apply; values outside the limits are ignored; required roles are kept', () => {
    const s = resolveFeeSettings({ values: { dueDay: 40, allowPartialPayments: false, reversalRoles: ['MANAGER'] } });
    assert.equal(s.dueDay, 10);
    assert.equal(s.allowPartialPayments, false);
    assert.deepEqual(s.reversalRoles, ['OWNER', 'MANAGER']);
    assert.equal(validFeeValue('receiptNumberFormat', 'R-{SEQ5}'), 'R-{SEQ5}');
    assert.equal(validFeeValue('receiptNumberFormat', 'R-{X}'), null);
    assert.equal(validFeeValue('billingStartMonth', '2026-11'), '2026-11');
    assert.equal(validFeeValue('billingStartMonth', '2026-13'), null);
  });
});

import { badRequest, forbidden } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { calendarToday } from '../academic-calendar/calendar.service.js';
import { yearOf } from './feeAccess.js';
import { accountStatus, fullName, totalsOf, toPayment, paymentInclude } from './feeAccounts.service.js';
import { closingStatusToday, closingWhere, toClosing } from './feeClosings.service.js';
import { generationStatus } from './feeGeneration.service.js';
import { dayRange } from './feePayments.service.js';
import { feeSettingsOf } from './feeSettings.js';
import { addDays, asDbDate, daysBetween, formatPercent, fromDbDate, isOverdue, monthLabel, monthOf, monthsBetween, monthShort } from './feeRules.js';

/*
 * Fee reports and the overview (docs/business-rules.md → Fee Management → Reports). Every figure comes
 * from the records: obligations (their amounts as charged, discounts, adjustments, cancellations),
 * allocations of payments not reversed, payments, reversals and cash closings. Expected = what is
 * payable on fees not cancelled; collected = what is paid towards them; outstanding = the difference;
 * overdue = the part past its due date (plus grace days). Cash received is by payment date.
 */

export const REPORTS = {
  collection: { label: 'Fee collection', group: 'basic', description: 'Expected, collected and outstanding fees by class.' },
  outstanding: { label: 'Outstanding fees', group: 'basic', description: 'Students who still owe fees, with their balances.' },
  overdue: { label: 'Overdue fees', group: 'basic', description: 'Students with fees past their due date, oldest first.' },
  daily: { label: 'Daily payments', group: 'basic', description: 'Cash received each day, reversals and net.' },
  history: { label: 'Payment history', group: 'basic', description: 'Every payment with its receipt, status and who recorded it.' },
  closings: { label: 'Cash closing', group: 'basic', description: 'Cash closings with recorded, counted and differences.' },
  trends: { label: 'Monthly collection trends', group: 'advanced', description: 'Fees charged and collected for each month, and cash received in it.' },
  classes: { label: 'Class comparison', group: 'advanced', description: 'Collection rate, outstanding and discounts per class.' },
  branches: { label: 'Branch comparison', group: 'advanced', description: 'Collection rate, outstanding and discounts per branch.' },
  discounts: { label: 'Discount analysis', group: 'advanced', description: 'What each discount and scholarship policy takes off, and individual adjustments.' },
  performance: { label: 'Payment performance', group: 'advanced', description: 'Fees paid on time, late or not yet, per month.' },
  expected: { label: 'Expected vs actual', group: 'advanced', description: 'Expected fees against collections per month, with the running totals.' },
};

export function readReportQuery(query, { role }) {
  const one = (k) => (Array.isArray(query[k]) ? query[k][0] : query[k]) || undefined;
  const errors = {};
  const out = { academicYear: one('academicYear') ?? 'current', branch: role === 'OWNER' ? one('branch') : undefined, classId: one('class'), sectionId: one('section'), from: one('from'), to: one('to'), status: one('status') ?? 'all', kind: one('kind') ?? 'all' };
  for (const k of ['branch', 'classId', 'sectionId']) if (out[k] && !isUuid(out[k])) errors[k] = 'Choose from the list.';
  for (const k of ['from', 'to']) if (out[k] && !/^\d{4}-\d{2}-\d{2}$/.test(out[k])) errors[k] = 'Choose a date.';
  if (!['all', 'recorded', 'reversed', 'paid', 'partial', 'unpaid', 'overdue'].includes(out.status)) errors.status = 'Unknown status.';
  if (!['all', 'monthly', 'exam', 'other'].includes(out.kind)) errors.kind = 'Unknown fee kind.';
  if (Object.keys(errors).length) throw badRequest('Check the filters.', errors);
  return out;
}

/** Obligations of the year in the scope and filters (branch where charged; class; section; due date range; fee kind). */
async function obligationsOf(scope, year, f, { includeCancelled = false } = {}) {
  return getPrisma().feeObligation.findMany({
    where: {
      schoolId: scope.school.id,
      academicYearId: year.id,
      ...(!includeCancelled && { status: { not: 'CANCELLED' } }),
      ...(scope.branch && { branchId: scope.branch.id }),
      ...(f.branch && { branchId: f.branch }),
      ...(f.classId && { classId: f.classId }),
      ...(f.sectionId && { sectionId: f.sectionId }),
      ...(f.kind && f.kind !== 'all' && { kind: f.kind.toUpperCase() }),
      ...((f.from || f.to) && { dueDate: { ...(f.from && { gte: asDbDate(f.from) }), ...(f.to && { lte: asDbDate(f.to) }) } }),
    },
    select: {
      id: true, studentId: true, branchId: true, classId: true, sectionId: true, kind: true, status: true, billingMonth: true, dueDate: true,
      standardAmount: true, amount: true, discountAmount: true, netAmount: true, paidAmount: true,
      branch: { select: { name: true } }, class: { select: { name: true, sequence: true } },
    },
  });
}

const pct = (part, whole) => (whole > 0 ? Math.round((part * 10000) / whole) : 0);
const obligationMonth = (o) => (o.billingMonth ? fromDbDate(o.billingMonth) : monthOf(fromDbDate(o.dueDate)));

function groupTotals(list, keyOf, labelOf, today, grace) {
  const groups = new Map();
  for (const o of list) {
    const key = keyOf(o);
    if (!groups.has(key)) groups.set(key, { key, label: labelOf(o), rows: [] });
    groups.get(key).rows.push(o);
  }
  return [...groups.values()].map((g) => {
    const t = totalsOf(g.rows, today, grace);
    return { key: g.key, label: g.label, students: new Set(g.rows.map((o) => o.studentId)).size, expected: t.due, collected: t.paid, outstanding: t.balance, overdue: t.overdue, discounts: t.discounts, adjustments: t.adjustments, standard: t.standard, rate: pct(t.paid, t.due), sample: g.rows[0] };
  });
}

const MONEY = (key, label) => ({ key, label, kind: 'money', align: 'right' });
const INT = (key, label) => ({ key, label, kind: 'int', align: 'right' });
const TEXT = (key, label, extra = {}) => ({ key, label, kind: 'text', ...extra });
const PCT = (key, label) => ({ key, label, kind: 'percent', align: 'right' });
const DATE = (key, label) => ({ key, label, kind: 'date' });

/** Builds one report → { report, title, columns, rows, totals, chart?, summary? }. */
export async function buildReport(scope, name, f) {
  const meta = REPORTS[name];
  if (!meta) throw badRequest('Unknown report.');
  if (name === 'branches' && scope.role !== 'OWNER') throw forbidden('Branch comparison is for the School Owner.');
  const prisma = getPrisma();
  const [settings, today] = await Promise.all([feeSettingsOf(scope.school.id), calendarToday()]);
  const grace = settings.overdueGraceDays;
  const year = await yearOf(prisma, scope, f.academicYear);
  const base = { report: name, title: meta.label, description: meta.description, currency: settings.currency, academicYear: year ? { id: year.id, name: year.name } : null, generatedAt: new Date().toISOString(), today };
  if (!year && !['daily', 'history', 'closings'].includes(name)) return { ...base, columns: [], rows: [], totals: null };

  if (name === 'collection' || name === 'classes') {
    const list = await obligationsOf(scope, year, f);
    const rows = groupTotals(list, (o) => o.classId ?? 'none', (o) => o.class?.name ?? 'No class', today, grace).sort((a, b) => (a.sample.class?.sequence ?? 999) - (b.sample.class?.sequence ?? 999));
    const columns =
      name === 'collection'
        ? [TEXT('label', 'Class', { bold: true }), INT('students', 'Students'), MONEY('expected', 'Expected'), MONEY('collected', 'Collected'), MONEY('outstanding', 'Outstanding'), PCT('rate', 'Rate')]
        : [TEXT('label', 'Class', { bold: true }), INT('students', 'Students'), MONEY('standard', 'Standard fees'), MONEY('discounts', 'Discounts'), MONEY('expected', 'Expected'), MONEY('collected', 'Collected'), MONEY('outstanding', 'Outstanding'), MONEY('overdue', 'Overdue'), PCT('rate', 'Rate')];
    const t = totalsOf(list, today, grace);
    return {
      ...base,
      columns,
      rows: rows.map(({ sample: _s, ...r }) => r),
      totals: { label: 'Total', students: new Set(list.map((o) => o.studentId)).size, standard: t.standard, discounts: t.discounts, expected: t.due, collected: t.paid, outstanding: t.balance, overdue: t.overdue, rate: pct(t.paid, t.due) },
      summary: { expected: t.due, collected: t.paid, outstanding: t.balance, overdue: t.overdue, rate: pct(t.paid, t.due) },
      chart: { type: 'bar', series: rows.map((r) => ({ label: r.label, expected: r.expected, collected: r.collected })) },
    };
  }

  if (name === 'branches') {
    const list = await obligationsOf(scope, year, f);
    const rows = groupTotals(list, (o) => o.branchId, (o) => o.branch.name, today, grace).sort((a, b) => a.label.localeCompare(b.label));
    const t = totalsOf(list, today, grace);
    return {
      ...base,
      columns: [TEXT('label', 'Branch', { bold: true }), INT('students', 'Students'), MONEY('standard', 'Standard fees'), MONEY('discounts', 'Discounts'), MONEY('expected', 'Expected'), MONEY('collected', 'Collected'), MONEY('outstanding', 'Outstanding'), MONEY('overdue', 'Overdue'), PCT('rate', 'Rate')],
      rows: rows.map(({ sample: _s, ...r }) => r),
      totals: { label: 'Total', students: new Set(list.map((o) => o.studentId)).size, standard: t.standard, discounts: t.discounts, expected: t.due, collected: t.paid, outstanding: t.balance, overdue: t.overdue, rate: pct(t.paid, t.due) },
      chart: { type: 'bar', series: rows.map((r) => ({ label: r.label, expected: r.expected, collected: r.collected })) },
    };
  }

  if (name === 'outstanding' || name === 'overdue') {
    const list = await obligationsOf(scope, year, f);
    const byStudent = new Map();
    for (const o of list) {
      if (!byStudent.has(o.studentId)) byStudent.set(o.studentId, []);
      byStudent.get(o.studentId).push(o);
    }
    const students = await prisma.student.findMany({ where: { id: { in: [...byStudent.keys()] } }, select: { id: true, firstName: true, middleName: true, lastName: true, studentNumber: true, guardianName: true, guardianPhone: true, branch: { select: { name: true } } } });
    const rows = [];
    for (const s of students) {
      const mine = byStudent.get(s.id);
      const t = totalsOf(mine, today, grace);
      const overdueOnes = mine.filter((o) => isOverdue({ ...o, dueDate: fromDbDate(o.dueDate) }, today, grace));
      if (name === 'outstanding' ? t.balance <= 0 : t.overdue <= 0) continue;
      const oldest = overdueOnes.map((o) => fromDbDate(o.dueDate)).sort()[0] ?? null;
      const cls = mine.find((o) => o.class)?.class?.name ?? '';
      rows.push({ student: fullName(s), studentNumber: s.studentNumber, class: cls, branch: s.branch.name, guardian: `${s.guardianName} ${s.guardianPhone}`, expected: t.due, paid: t.paid, outstanding: t.balance, overdue: t.overdue, oldestDue: oldest, daysOverdue: oldest ? daysBetween(oldest, today) : 0, months: overdueOnes.filter((o) => o.kind === 'MONTHLY').length, status: accountStatus(t) });
    }
    rows.sort(name === 'overdue' ? (a, b) => b.daysOverdue - a.daysOverdue || b.overdue - a.overdue : (a, b) => b.outstanding - a.outstanding);
    const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
    return {
      ...base,
      columns:
        name === 'outstanding'
          ? [TEXT('student', 'Student', { bold: true }), TEXT('studentNumber', 'Student ID'), TEXT('class', 'Class'), ...(scope.branch ? [] : [TEXT('branch', 'Branch')]), MONEY('expected', 'Total due'), MONEY('paid', 'Paid'), MONEY('outstanding', 'Outstanding'), MONEY('overdue', 'Overdue')]
          : [TEXT('student', 'Student', { bold: true }), TEXT('studentNumber', 'Student ID'), TEXT('class', 'Class'), TEXT('guardian', 'Guardian'), DATE('oldestDue', 'Oldest due'), INT('daysOverdue', 'Days overdue'), INT('months', 'Months'), MONEY('overdue', 'Overdue')],
      rows,
      totals: { student: `${rows.length} students`, expected: sum('expected'), paid: sum('paid'), outstanding: sum('outstanding'), overdue: sum('overdue') },
    };
  }

  if (name === 'daily' || name === 'history') {
    const from = f.from ?? (name === 'daily' ? addDays(today, -29) : null);
    const to = f.to ?? today;
    const where = {
      schoolId: scope.school.id,
      ...(scope.branch && { branchId: scope.branch.id }),
      ...(f.branch && { branchId: f.branch }),
      receivedAt: dayRange(from, to),
      ...(f.status === 'recorded' && { status: 'RECORDED' }),
      ...(f.status === 'reversed' && { status: 'REVERSED' }),
      ...(f.classId && { allocations: { some: { obligation: { classId: f.classId } } } }),
    };
    if (name === 'history') {
      const payments = await prisma.feePayment.findMany({ where, include: { ...paymentInclude, student: { select: { id: true, firstName: true, middleName: true, lastName: true, studentNumber: true } } }, orderBy: { receivedAt: 'desc' }, take: 5000 });
      const rows = payments.map(toPayment).map((p) => ({ date: p.receivedAt.slice(0, 10), time: p.receivedAt.slice(11, 16), receipt: p.receipt?.number ?? '', student: p.student.name, studentNumber: p.student.studentNumber, covers: p.allocations.map((a) => (a.obligation.month ? monthShort(a.obligation.month) : a.obligation.title)).join(', '), amount: p.amount, status: p.status === 'reversed' ? 'Reversed' : 'Recorded', recordedBy: p.recordedBy.name, branch: p.branch.name }));
      return {
        ...base,
        from,
        to,
        columns: [DATE('date', 'Date'), TEXT('receipt', 'Receipt'), TEXT('student', 'Student', { bold: true }), TEXT('covers', 'Covers'), MONEY('amount', 'Amount'), TEXT('status', 'Status'), TEXT('recordedBy', 'Recorded by'), ...(scope.branch ? [] : [TEXT('branch', 'Branch')])],
        rows,
        totals: { date: `${rows.length} payments`, amount: rows.filter((r) => r.status === 'Recorded').reduce((n, r) => n + r.amount, 0) },
      };
    }
    const payments = await prisma.feePayment.findMany({ where: { ...where, status: undefined }, select: { amount: true, receivedAt: true, status: true, reversedAt: true } });
    const days = new Map();
    for (const day of dayList(from, to)) days.set(day, { date: day, payments: 0, received: 0, reversed: 0, net: 0 });
    for (const p of payments) {
      const day = p.receivedAt.toISOString().slice(0, 10);
      const d = days.get(day) ?? { date: day, payments: 0, received: 0, reversed: 0, net: 0 };
      d.payments += 1;
      d.received += p.amount;
      if (p.status === 'REVERSED') d.reversed += p.amount;
      d.net = d.received - d.reversed;
      days.set(day, d);
    }
    const rows = [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
    const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
    return { ...base, from, to, columns: [DATE('date', 'Date'), INT('payments', 'Payments'), MONEY('received', 'Received'), MONEY('reversed', 'Reversed'), MONEY('net', 'Net')], rows, totals: { date: 'Total', payments: sum('payments'), received: sum('received'), reversed: sum('reversed'), net: sum('net') }, chart: { type: 'line', series: [...rows].reverse().map((r) => ({ label: r.date.slice(5), value: r.net })) } };
  }

  if (name === 'closings') {
    const closings = await prisma.cashClosing.findMany({ where: closingWhere(scope, { role: 'all', result: 'all', from: f.from, to: f.to, branch: f.branch }), include: { branch: { select: { id: true, name: true } } }, orderBy: { closedAt: 'desc' }, take: 2000 });
    const rows = closings.map(toClosing).map((c) => ({ date: c.closingDate, time: c.closedAt.slice(11, 16), person: c.user.name, role: c.user.roleLabel, branch: c.branch?.name ?? 'School', payments: c.paymentsCount, recorded: c.recordedAmount, reversed: c.reversedAmount, expected: c.expectedAmount, counted: c.countedAmount, difference: c.difference, result: c.result[0].toUpperCase() + c.result.slice(1), explanation: c.explanation ?? '' }));
    const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
    return {
      ...base,
      columns: [DATE('date', 'Date'), TEXT('person', 'Closed by', { bold: true }), TEXT('role', 'Role'), ...(scope.branch ? [] : [TEXT('branch', 'Branch')]), INT('payments', 'Payments'), MONEY('expected', 'Expected'), MONEY('counted', 'Counted'), MONEY('difference', 'Difference'), TEXT('result', 'Result'), TEXT('explanation', 'Explanation')],
      rows,
      totals: { date: `${rows.length} closings`, payments: sum('payments'), expected: sum('expected'), counted: sum('counted'), difference: sum('difference') },
    };
  }

  if (name === 'trends' || name === 'expected' || name === 'performance') {
    const list = await obligationsOf(scope, year, f);
    const months = monthsBetween(fromDbDate(year.startDate), fromDbDate(year.endDate));
    if (name === 'performance') {
      const ids = list.filter((o) => o.paidAmount > 0).map((o) => o.id);
      const lastPaid = new Map();
      for (let i = 0; i < ids.length; i += 1000) {
        const allocations = await prisma.feeAllocation.findMany({ where: { obligationId: { in: ids.slice(i, i + 1000) }, payment: { status: 'RECORDED' } }, select: { obligationId: true, payment: { select: { receivedAt: true } } } });
        for (const a of allocations) {
          const day = a.payment.receivedAt.toISOString().slice(0, 10);
          if (!lastPaid.has(a.obligationId) || lastPaid.get(a.obligationId) < day) lastPaid.set(a.obligationId, day);
        }
      }
      const rows = months.map((m) => {
        const mine = list.filter((o) => obligationMonth(o) === m && o.netAmount > 0);
        const paid = mine.filter((o) => o.paidAmount >= o.netAmount);
        const onTime = paid.filter((o) => (lastPaid.get(o.id) ?? '') <= addDays(fromDbDate(o.dueDate), grace));
        const days = paid.map((o) => daysBetween(fromDbDate(o.dueDate), lastPaid.get(o.id) ?? fromDbDate(o.dueDate)));
        return { month: m, label: monthLabel(m), fees: mine.length, onTime: onTime.length, late: paid.length - onTime.length, partial: mine.filter((o) => o.paidAmount > 0 && o.paidAmount < o.netAmount).length, unpaid: mine.filter((o) => o.paidAmount === 0).length, onTimeRate: pct(onTime.length, mine.length), avgDays: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : 0 };
      }).filter((r) => r.fees);
      const sum = (k) => rows.reduce((n, r) => n + r[k], 0);
      return { ...base, columns: [TEXT('label', 'Month', { bold: true }), INT('fees', 'Fees'), INT('onTime', 'Paid on time'), INT('late', 'Paid late'), INT('partial', 'Partly paid'), INT('unpaid', 'Unpaid'), PCT('onTimeRate', 'On time'), INT('avgDays', 'Avg days from due')], rows, totals: { label: 'Total', fees: sum('fees'), onTime: sum('onTime'), late: sum('late'), partial: sum('partial'), unpaid: sum('unpaid'), onTimeRate: pct(sum('onTime'), sum('fees')) }, chart: { type: 'bar', series: rows.map((r) => ({ label: monthShort(r.month), onTime: r.onTime, late: r.late, unpaid: r.unpaid + r.partial })) } };
    }
    const cash = await prisma.feePayment.findMany({ where: { schoolId: scope.school.id, status: 'RECORDED', ...(scope.branch && { branchId: scope.branch.id }), ...(f.branch && { branchId: f.branch }), receivedAt: { gte: asDbDate(months[0]), lt: asDbDate(addDays(fromDbDate(year.endDate), 1)) } }, select: { amount: true, receivedAt: true } });
    let runExpected = 0;
    let runCollected = 0;
    const rows = months.map((m) => {
      const mine = list.filter((o) => obligationMonth(o) === m);
      const t = totalsOf(mine, today, grace);
      const received = cash.filter((p) => monthOf(p.receivedAt.toISOString().slice(0, 10)) === m).reduce((n, p) => n + p.amount, 0);
      runExpected += t.due;
      runCollected += t.paid;
      return { month: m, label: monthLabel(m), expected: t.due, collected: t.paid, outstanding: t.balance, variance: t.paid - t.due, received, rate: pct(t.paid, t.due), cumulativeExpected: runExpected, cumulativeCollected: runCollected, cumulativeRate: pct(runCollected, runExpected) };
    });
    const t = totalsOf(list, today, grace);
    const totals = { label: 'Total', expected: t.due, collected: t.paid, outstanding: t.balance, variance: t.paid - t.due, received: rows.reduce((n, r) => n + r.received, 0), rate: pct(t.paid, t.due) };
    if (name === 'trends') return { ...base, columns: [TEXT('label', 'Month', { bold: true }), MONEY('expected', 'Charged'), MONEY('collected', 'Collected'), MONEY('outstanding', 'Outstanding'), PCT('rate', 'Rate'), MONEY('received', 'Cash received')], rows, totals, chart: { type: 'line', series: rows.map((r) => ({ label: monthShort(r.month), expected: r.expected, collected: r.collected })) } };
    return { ...base, columns: [TEXT('label', 'Month', { bold: true }), MONEY('expected', 'Expected'), MONEY('collected', 'Actual'), MONEY('variance', 'Variance'), PCT('rate', 'Rate'), MONEY('cumulativeExpected', 'Expected to date'), MONEY('cumulativeCollected', 'Actual to date'), PCT('cumulativeRate', 'Rate to date')], rows, totals, chart: { type: 'line', series: rows.map((r) => ({ label: monthShort(r.month), expected: r.cumulativeExpected, collected: r.cumulativeCollected })) } };
  }

  if (name === 'discounts') {
    const list = await obligationsOf(scope, year, f);
    const ids = list.map((o) => o.id);
    const applied = [];
    for (let i = 0; i < ids.length; i += 2000) applied.push(...(await prisma.feeObligationDiscount.findMany({ where: { obligationId: { in: ids.slice(i, i + 2000) } }, select: { name: true, category: true, type: true, value: true, amount: true, obligationId: true, studentDiscountId: true } })));
    const studentOf = new Map(list.map((o) => [o.id, o.studentId]));
    const groups = new Map();
    for (const d of applied) {
      const key = `${d.name}|${d.category}`;
      const g = groups.get(key) ?? { policy: d.name, category: d.category === 'SCHOLARSHIP' ? 'Scholarship' : 'Discount', value: d.type === 'PERCENTAGE' ? formatPercent(d.value) : null, fixed: d.type === 'FIXED' ? d.value : null, students: new Set(), fees: 0, amount: 0 };
      g.students.add(studentOf.get(d.obligationId));
      g.fees += 1;
      g.amount += d.amount;
      groups.set(key, g);
    }
    const t = totalsOf(list, today, grace);
    const rows = [...groups.values()].map((g) => ({ ...g, students: g.students.size, value: g.value ?? '', share: pct(g.amount, t.standard) })).sort((a, b) => b.amount - a.amount);
    const adjusted = list.filter((o) => o.standardAmount !== o.amount);
    if (adjusted.length) rows.push({ policy: 'Individual fee adjustments', category: 'Adjustment', value: '', students: new Set(adjusted.map((o) => o.studentId)).size, fees: adjusted.length, amount: adjusted.reduce((n, o) => n + o.standardAmount - o.amount, 0), share: pct(adjusted.reduce((n, o) => n + o.standardAmount - o.amount, 0), t.standard) });
    return {
      ...base,
      columns: [TEXT('policy', 'Discount', { bold: true }), TEXT('category', 'Kind'), TEXT('value', 'Value'), INT('students', 'Students'), INT('fees', 'Fees reduced'), MONEY('amount', 'Amount'), PCT('share', 'Of standard fees')],
      rows,
      totals: { policy: 'Total', students: new Set(applied.map((d) => studentOf.get(d.obligationId)).concat(adjusted.map((o) => o.studentId))).size, fees: rows.reduce((n, r) => n + r.fees, 0), amount: rows.reduce((n, r) => n + r.amount, 0), share: pct(rows.reduce((n, r) => n + r.amount, 0), t.standard) },
      summary: { standard: t.standard, discounts: t.discounts, adjustments: t.adjustments, expected: t.due },
    };
  }
  throw badRequest('Unknown report.');
}

function dayList(from, to) {
  const out = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---- overview ------------------------------------------------------------------------------------------

export async function feeOverview(scope, f) {
  const prisma = getPrisma();
  const [settings, today] = await Promise.all([feeSettingsOf(scope.school.id), calendarToday()]);
  const grace = settings.overdueGraceDays;
  const year = await yearOf(prisma, scope, f.academicYear);
  const [generation, closing] = await Promise.all([generationStatus(scope), closingStatusToday(scope)]);
  if (!year) return { currency: settings.currency, academicYear: null, today, kpis: null, trend: [], recentPayments: [], overdueStudents: [], statusCounts: null, generation, closing };
  const list = await obligationsOf(scope, year, f);
  const t = totalsOf(list, today, grace);
  const months = monthsBetween(fromDbDate(year.startDate), fromDbDate(year.endDate));
  const trend = months.map((m) => {
    const mine = list.filter((o) => obligationMonth(o) === m);
    return { month: m, label: monthShort(m), expected: mine.reduce((n, o) => n + o.netAmount, 0), collected: mine.reduce((n, o) => n + o.paidAmount, 0) };
  });
  const byStudent = new Map();
  for (const o of list) {
    if (!byStudent.has(o.studentId)) byStudent.set(o.studentId, []);
    byStudent.get(o.studentId).push(o);
  }
  const statusCounts = { cleared: 0, partial: 0, outstanding: 0 };
  const overdueRows = [];
  for (const [studentId, mine] of byStudent) {
    const st = totalsOf(mine, today, grace);
    const s = accountStatus(st);
    if (s !== 'none') statusCounts[s] += 1;
    if (st.overdue > 0) overdueRows.push({ studentId, overdue: st.overdue, oldest: mine.filter((o) => isOverdue({ ...o, dueDate: fromDbDate(o.dueDate) }, today, grace)).map((o) => fromDbDate(o.dueDate)).sort()[0], className: mine.find((o) => o.class)?.class?.name ?? null });
  }
  overdueRows.sort((a, b) => b.overdue - a.overdue);
  const top = overdueRows.slice(0, 8);
  const students = await prisma.student.findMany({ where: { id: { in: top.map((r) => r.studentId) } }, select: { id: true, firstName: true, middleName: true, lastName: true, studentNumber: true } });
  const recent = await prisma.feePayment.findMany({
    where: { schoolId: scope.school.id, ...(scope.branch && { branchId: scope.branch.id }), ...(f.branch && { branchId: f.branch }), ...((f.from || f.to) && { receivedAt: dayRange(f.from, f.to) }) },
    include: { ...paymentInclude, student: { select: { id: true, firstName: true, middleName: true, lastName: true, studentNumber: true } } },
    orderBy: { receivedAt: 'desc' },
    take: 8,
  });
  const received = await prisma.feePayment.aggregate({ where: { schoolId: scope.school.id, status: 'RECORDED', ...(scope.branch && { branchId: scope.branch.id }), ...(f.branch && { branchId: f.branch }), receivedAt: dayRange(today, today) }, _sum: { amount: true }, _count: { _all: true } });
  return {
    currency: settings.currency,
    academicYear: { id: year.id, name: year.name },
    today,
    kpis: { expected: t.due, collected: t.paid, outstanding: t.balance, overdue: t.overdue, rate: pct(t.paid, t.due), discounts: t.discounts, students: byStudent.size, receivedToday: received._sum.amount ?? 0, paymentsToday: received._count._all },
    statusCounts,
    trend,
    recentPayments: recent.map(toPayment),
    overdueStudents: top.map((r) => {
      const s = students.find((x) => x.id === r.studentId);
      return { id: r.studentId, name: s ? fullName(s) : '—', studentNumber: s?.studentNumber ?? '', class: r.className, overdue: r.overdue, oldestDue: r.oldest, daysOverdue: r.oldest ? daysBetween(r.oldest, today) : 0 };
    }),
    overdueCount: overdueRows.length,
    generation: { autoGenerate: generation.autoGenerate, months: generation.months.slice(-3), lastRun: generation.runs[0] ?? null },
    closing,
  };
}

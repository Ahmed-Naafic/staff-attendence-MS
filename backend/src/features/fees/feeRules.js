/*
 * Fee Management rules that do not need the database (docs/business-rules.md → Fee Management):
 * months, money, discounts, payment allocation checks, withdrawal billing, clearance, document
 * numbers and invoice status. Every amount is a whole number of minor units (cents).
 */

// ---- months and dates ----------------------------------------------------------------------------

/** 'YYYY-MM-DD' of the first day of the month of a 'YYYY-MM-DD' date. */
export const monthOf = (day) => `${day.slice(0, 7)}-01`;
/** 'YYYY-MM' → 'YYYY-MM-01'. */
export const monthStart = (ym) => `${ym.slice(0, 7)}-01`;
export const asDbDate = (day) => new Date(`${day}T00:00:00Z`);
export const fromDbDate = (value) => (value ? value.toISOString().slice(0, 10) : null);

/** The month `n` months after the month of `day` ('YYYY-MM-01'). */
export function addMonths(day, n) {
  const [y, m] = day.split('-').map(Number);
  const index = y * 12 + (m - 1) + n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

/** Days in the month of 'YYYY-MM-..'. */
export function daysInMonth(day) {
  const [y, m] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Every month ('YYYY-MM-01') from the month of `from` to the month of `to`, both included. */
export function monthsBetween(from, to) {
  const months = [];
  for (let m = monthOf(from); m <= monthOf(to); m = addMonths(m, 1)) months.push(m);
  return months;
}

export function addDays(day, n) {
  const d = asDbDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (from, to) => Math.round((asDbDate(to) - asDbDate(from)) / 86_400_000);

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** 'January 2027' for a month. */
export const monthLabel = (month) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
/** 'Jan' for a month. */
export const monthShort = (month) => MONTH_NAMES[Number(month.slice(5, 7)) - 1].slice(0, 3);

/** The due date of a monthly fee: the school's due day of that month (never past the month's end). */
export const monthlyDueDate = (month, dueDay) => `${month.slice(0, 8)}${String(Math.min(dueDay, daysInMonth(month))).padStart(2, '0')}`;

/** Overdue: still owed after its due date plus the grace days. */
export const isOverdue = ({ status, netAmount, paidAmount, dueDate }, today, graceDays = 0) => status === 'OPEN' && netAmount - paidAmount > 0 && addDays(dueDate, graceDays) < today;

// ---- money -----------------------------------------------------------------------------------------

export const CURRENCIES = {
  USD: { symbol: '$', name: 'US dollar', decimals: 2 },
  SOS: { symbol: 'Sh', name: 'Somali shilling', decimals: 2 },
  KES: { symbol: 'KSh', name: 'Kenyan shilling', decimals: 2 },
  ETB: { symbol: 'Br', name: 'Ethiopian birr', decimals: 2 },
  DJF: { symbol: 'Fdj', name: 'Djiboutian franc', decimals: 0 },
  EUR: { symbol: '€', name: 'Euro', decimals: 2 },
  GBP: { symbol: '£', name: 'Pound sterling', decimals: 2 },
};

/** '$1,234.50' (negative: '-$1,234.50'). */
export function formatMoney(cents, currency = 'USD') {
  const c = CURRENCIES[currency] ?? CURRENCIES.USD;
  const value = Math.abs(cents) / 100;
  const text = value.toLocaleString('en-US', { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals });
  return `${cents < 0 ? '-' : ''}${c.symbol}${text}`;
}

/** Basis points as '12.5%'. */
export const formatPercent = (bp) => `${(bp / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;

// ---- discounts -------------------------------------------------------------------------------------

/** What one discount takes off `amount`: percentage (basis points) or fixed, capped by its maximum and the amount. */
export function discountValue(amount, { type, value, maxAmount }) {
  let d = type === 'PERCENTAGE' ? Math.round((amount * value) / 10000) : value;
  if (maxAmount !== null && maxAmount !== undefined) d = Math.min(d, maxAmount);
  return Math.max(0, Math.min(d, amount));
}

/**
 * The discounts applied to an obligation of `amount`, by the school's combination policy:
 * - 'best': only the single largest discount;
 * - 'stack': combinable discounts are added together (one candidate), each non-combinable one stands
 *   alone; the largest candidate applies.
 * The total never exceeds `maxCombinedPercent` of the amount (scaled down in proportion) or the amount.
 * discounts: [{ id, name, category, type, value, maxAmount, combinable }] → { total, applied: [{ ...d, amount }] }.
 */
export function applyDiscounts(amount, discounts, { combination = 'best', maxCombinedPercent = 100 } = {}) {
  if (!discounts.length || amount <= 0) return { total: 0, applied: [] };
  const valued = discounts.map((d) => ({ ...d, amount: discountValue(amount, d) })).filter((d) => d.amount > 0);
  if (!valued.length) return { total: 0, applied: [] };
  const candidates = [];
  if (combination === 'stack') {
    const together = valued.filter((d) => d.combinable !== false);
    if (together.length) candidates.push(together);
    for (const d of valued.filter((x) => x.combinable === false)) candidates.push([d]);
  } else {
    for (const d of valued) candidates.push([d]);
  }
  const sum = (list) => list.reduce((n, d) => n + d.amount, 0);
  // The largest candidate; ties go to the first (stable).
  let best = candidates[0];
  for (const c of candidates) if (sum(c) > sum(best)) best = c;
  const cap = Math.min(amount, Math.floor((amount * maxCombinedPercent) / 100));
  const raw = sum(best);
  if (raw <= cap) return { total: raw, applied: best };
  // Scale each down in proportion, the rounding remainder on the largest.
  const scaled = best.map((d) => ({ ...d, amount: Math.floor((d.amount * cap) / raw) }));
  const remainder = cap - sum(scaled);
  if (remainder > 0) scaled.reduce((a, b) => (b.amount > a.amount ? b : a)).amount += remainder;
  return { total: cap, applied: scaled.filter((d) => d.amount > 0) };
}

/** Whether a discount assignment and its policy cover a month for a kind of fee, class and branch. */
export function discountCovers(sd, policy, { month, kind, classId, branchId }) {
  if (sd.revokedAt || policy.status !== 'ACTIVE') return false;
  if (!policy.appliesTo.includes(kind)) return false;
  // Dates come as 'YYYY-MM-DD' or as Date values straight from the database.
  const m = (v) => monthOf(v instanceof Date ? v.toISOString().slice(0, 10) : v);
  if (m(sd.startMonth) > month || (sd.endMonth && m(sd.endMonth) < month)) return false;
  if (policy.startDate && m(policy.startDate) > month) return false;
  if (policy.endDate && m(policy.endDate) < month) return false;
  if (policy.classIds.length && classId && !policy.classIds.includes(classId)) return false;
  if (policy.branchIds.length && branchId && !policy.branchIds.includes(branchId)) return false;
  return true;
}

// ---- payments --------------------------------------------------------------------------------------

/**
 * Checks a payment's allocations against the obligations they pay and the partial payment policy.
 * obligations: Map(id → { id, title, status, netAmount, paidAmount }); allocations: [{ obligationId, amount }].
 * → { problems: { field: message }, total }. Rules: at least one; each obligation once, OPEN, with a
 * balance; each amount a positive whole number not above that balance; the sum equals the amount
 * received; without partial payments every obligation is paid in full; with them, a payment that
 * leaves any chosen obligation partly paid is at least the minimum (unless it pays everything chosen).
 */
export function checkAllocations(amount, allocations, obligations, { allowPartial, minimumPartial = 0, currency = 'USD' }) {
  const problems = {};
  if (!Number.isInteger(amount) || amount <= 0) problems.amount = 'Enter the amount received.';
  if (!allocations.length) problems.allocations = 'Choose what this payment pays.';
  const seen = new Set();
  let total = 0;
  let partial = false;
  let selectedBalance = 0;
  for (const a of allocations) {
    const o = obligations.get(a.obligationId);
    if (!o) {
      problems.allocations = 'A chosen fee is not part of this student’s account.';
      continue;
    }
    if (seen.has(o.id)) problems.allocations = `${o.title} is chosen twice.`;
    seen.add(o.id);
    const balance = o.netAmount - o.paidAmount;
    if (o.status !== 'OPEN' || balance <= 0) problems.allocations = `${o.title} has nothing left to pay.`;
    else if (!Number.isInteger(a.amount) || a.amount <= 0) problems.allocations = `Enter what is paid for ${o.title}.`;
    else if (a.amount > balance) problems.allocations = `${o.title}: at most ${formatMoney(balance, currency)} is still owed.`;
    else {
      if (a.amount < balance) partial = true;
      selectedBalance += balance;
    }
    total += Number.isInteger(a.amount) ? a.amount : 0;
  }
  if (!problems.amount && !problems.allocations && total !== amount) {
    problems.allocations = `The amounts chosen add up to ${formatMoney(total, currency)}, not the ${formatMoney(amount, currency)} received. Every payment is allocated in full.`;
  }
  if (!Object.keys(problems).length && partial) {
    if (!allowPartial) problems.allocations = 'Your school does not accept part payments: pay each chosen fee in full.';
    else if (minimumPartial > 0 && amount < Math.min(minimumPartial, selectedBalance)) problems.amount = `A part payment is at least ${formatMoney(minimumPartial, currency)}.`;
  }
  return { problems, total };
}

/** Obligation status after its paid amount changes (a cancelled one stays cancelled). */
export const statusAfterPayment = (o, paid) => (o.status === 'CANCELLED' ? 'CANCELLED' : paid >= o.netAmount ? 'PAID' : 'OPEN');

// ---- withdrawal ------------------------------------------------------------------------------------

/**
 * Whether the month a student withdrew in is charged: 'full' always; 'none' never; 'cutoff' when they
 * left on or after the cut-off day of that month.
 */
export function chargeWithdrawalMonth(endedDay, { policy = 'full', cutoffDay = 15 } = {}) {
  if (policy === 'none') return false;
  if (policy === 'cutoff') return Number(endedDay.slice(8, 10)) >= cutoffDay;
  return true;
}

/**
 * Whether an enrollment is charged the monthly fee of `month`: enrolled in or before that month, and
 * not withdrawn before it (the withdrawal month by the policy). endedDay: 'YYYY-MM-DD' or null.
 */
export function chargeableMonth(month, { enrolledDay, endedDay, status }, withdrawal) {
  if (monthOf(enrolledDay) > month) return false;
  if (status === 'ACTIVE' || !endedDay) return true;
  const endMonth = monthOf(endedDay);
  if (endMonth < month) return false;
  if (endMonth > month) return true;
  // Completed (year over) or graduated at the end: the month is charged; leaving mid-year follows the policy.
  return status === 'TRANSFERRED_OUT' ? chargeWithdrawalMonth(endedDay, withdrawal) : true;
}

// ---- clearance -------------------------------------------------------------------------------------

export const CLEARANCE_STATES = ['CLEARED', 'PARTIALLY_CLEARED', 'NOT_CLEARED'];

/**
 * A student's fee clearance for an examination (or in general, without `exam`).
 * obligations: [{ kind, status, netAmount, paidAmount, dueDate, examinationId }] (not cancelled ones);
 * policy: { examFeeRequired, monthlyBlocks: 'none' | 'overdue' | 'all', partialQualifies,
 * partialMinimumPercent, graceDays }; asOf: the day balances are judged on (the clearance deadline);
 * exception: a granted exception or null.
 * → { status, eligible, required, paid, outstanding, reasons: [text] }.
 * The required fees: the examination's fee (when required) and the monthly fees the policy counts
 * (overdue on asOf, or every one due by asOf). Cleared: nothing required is owed. Partially cleared:
 * some of it is paid (eligible when part payments qualify and enough is paid). Not cleared: none paid.
 */
export function evaluateClearance(obligations, { exam = null, policy, asOf, exception = null }) {
  const counted = [];
  const live = obligations.filter((o) => o.status !== 'CANCELLED');
  if (exam) {
    const fee = live.find((o) => o.kind === 'EXAM' && o.examinationId === exam.id);
    if (fee && policy.examFeeRequired) counted.push(fee);
  } else {
    counted.push(...live.filter((o) => o.kind === 'EXAM' && o.dueDate <= asOf));
  }
  const monthly = live.filter((o) => o.kind !== 'EXAM');
  if (!exam || policy.monthlyBlocks === 'all') counted.push(...monthly.filter((o) => o.dueDate <= asOf));
  else if (policy.monthlyBlocks === 'overdue') counted.push(...monthly.filter((o) => addDays(o.dueDate, policy.graceDays ?? 0) < asOf));
  const required = counted.reduce((n, o) => n + o.netAmount, 0);
  const paid = counted.reduce((n, o) => n + Math.min(o.paidAmount, o.netAmount), 0);
  const outstanding = required - paid;
  const reasons = [];
  let status;
  let eligible;
  if (outstanding <= 0) {
    status = 'CLEARED';
    eligible = true;
    reasons.push(required ? 'Every required fee is paid.' : 'No fees are required yet.');
  } else if (paid > 0) {
    status = 'PARTIALLY_CLEARED';
    const percent = required ? Math.floor((paid * 100) / required) : 100;
    eligible = Boolean(exam) && policy.partialQualifies && percent >= (policy.partialMinimumPercent ?? 0);
    reasons.push(`${percent}% of the required fees is paid.`);
    if (exam) reasons.push(eligible ? 'Part payment qualifies under your school’s policy.' : policy.partialQualifies ? `At least ${policy.partialMinimumPercent}% must be paid to qualify.` : 'Your school requires the fees to be paid in full.');
  } else {
    status = 'NOT_CLEARED';
    eligible = false;
    reasons.push('None of the required fees is paid.');
  }
  if (exam) {
    const fee = live.find((o) => o.kind === 'EXAM' && o.examinationId === exam.id);
    if (fee && !policy.examFeeRequired) reasons.push('The examination fee is not required for clearance.');
    if (!fee) reasons.push('No examination fee is charged for this examination.');
    if (policy.monthlyBlocks === 'none') reasons.push('Monthly fees do not affect examination clearance.');
    else reasons.push(policy.monthlyBlocks === 'overdue' ? 'Overdue monthly fees count.' : 'Every monthly fee due by the deadline counts.');
  }
  if (exception && !eligible) {
    eligible = true;
    reasons.unshift(`Cleared by exception: ${exception.reason}`);
    return { status: 'CLEARED', eligible, byException: true, required, paid, outstanding, reasons };
  }
  return { status, eligible, byException: false, required, paid, outstanding, reasons };
}

// ---- documents -------------------------------------------------------------------------------------

/**
 * A document number from a format: {YYYY} year, {YY}, {MM} month, {BRANCH} branch number, {SEQ} or
 * {SEQn} the sequence padded to n digits (default 4). Text outside braces is kept.
 */
export function formatNumber(format, { sequence, day, branchNumber = 1 }) {
  const out = format
    .replace(/\{YYYY\}/g, day.slice(0, 4))
    .replace(/\{YY\}/g, day.slice(2, 4))
    .replace(/\{MM\}/g, day.slice(5, 7))
    .replace(/\{BRANCH\}/g, String(branchNumber).padStart(2, '0'))
    .replace(/\{SEQ(\d)?\}/g, (_, n) => String(sequence).padStart(Number(n ?? 4), '0'));
  return out.slice(0, 40);
}

/** The counter a format uses: per year when it shows the year, else one running counter. */
export const counterKey = (kind, format, day) => (/\{YY(YY)?\}/.test(format) ? `${kind}:${day.slice(0, 4)}` : kind);

/** A number format is valid when it has a sequence and only known parts. */
export function validNumberFormat(format) {
  if (typeof format !== 'string' || !format.trim() || format.length > 30) return false;
  if (!/\{SEQ\d?\}/.test(format)) return false;
  const parts = format.match(/\{[^}]*\}/g) ?? [];
  return parts.every((p) => /^\{(YYYY|YY|MM|BRANCH|SEQ\d?)\}$/.test(p)) && !/[{}]/.test(format.replace(/\{[^}]*\}/g, ''));
}

/** Invoice status from its lines' obligations (a draft or cancelled invoice keeps its status). */
export function invoiceStatus(current, lines) {
  if (current === 'DRAFT' || current === 'CANCELLED') return current;
  const live = lines.filter((l) => l.obligation.status !== 'CANCELLED');
  const due = live.reduce((n, l) => n + l.obligation.netAmount, 0);
  const paid = live.reduce((n, l) => n + l.obligation.paidAmount, 0);
  if (due > 0 && paid >= due) return 'PAID';
  if (due === 0 && live.length) return 'PAID';
  if (paid > 0) return 'PARTIALLY_PAID';
  return 'ISSUED';
}

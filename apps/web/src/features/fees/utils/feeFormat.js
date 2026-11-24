/*
 * Fee Management display rules for the web app. Amounts travel as whole minor units (cents); the
 * school's currency decides the symbol. Status words and badge variants live here so every page
 * shows the same thing.
 */

export const CURRENCIES = {
  USD: { symbol: '$', decimals: 2 },
  SOS: { symbol: 'Sh', decimals: 2 },
  KES: { symbol: 'KSh', decimals: 2 },
  ETB: { symbol: 'Br', decimals: 2 },
  DJF: { symbol: 'Fdj', decimals: 0 },
  EUR: { symbol: '€', decimals: 2 },
  GBP: { symbol: '£', decimals: 2 },
};

/** 1234550 → '$12,345.50'. */
export function money(cents, currency = 'USD') {
  if (cents === null || cents === undefined) return '—';
  const c = CURRENCIES[currency] ?? CURRENCIES.USD;
  const text = (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals });
  return `${cents < 0 ? '-' : ''}${c.symbol}${text}`;
}

/** A typed amount ('20', '20.5', '1,200') → cents, or null when it is not an amount. */
export function toCents(text) {
  if (text === null || text === undefined) return null;
  const clean = String(text).replace(/[,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  return Math.round(Number.parseFloat(clean) * 100);
}

/** Cents → the plain number typed in a field ('20' or '20.50'). */
export const fromCents = (cents) => (cents === null || cents === undefined ? '' : cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));

/** Basis points → '12.5%'. */
export const percent = (bp) => `${(bp / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
/** Rate in hundredths of a percent (7550) → '75.5%'. */
export const rate = (v) => `${(v / 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** '2026-11-01' or '2026-11' → 'November 2026'. */
export const monthName = (m) => (m ? `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : '—');
export const monthShort = (m) => (m ? MONTHS[Number(m.slice(5, 7)) - 1].slice(0, 3) : '');
/** '2026-11-23' → '23 Nov 2026'. */
export const dayText = (d) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
export const dateTimeText = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

/** The months of a year (from its start and end dates) as select options. */
export function yearMonths(year) {
  if (!year?.startDate) return [];
  const out = [];
  let [y, m] = year.startDate.split('-').map(Number);
  const [ey, em] = year.endDate.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    const value = `${y}-${String(m).padStart(2, '0')}`;
    out.push({ value, label: monthName(value) });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export const ACCOUNT_STATUS = {
  cleared: { label: 'Cleared', variant: 'success' },
  partial: { label: 'Partially paid', variant: 'warning' },
  outstanding: { label: 'Outstanding', variant: 'error' },
  none: { label: 'No fees', variant: 'neutral' },
};
export const PAYMENT_STATE = {
  paid: { label: 'Paid', variant: 'success' },
  partial: { label: 'Partly paid', variant: 'warning' },
  unpaid: { label: 'Unpaid', variant: 'neutral' },
  overdue: { label: 'Overdue', variant: 'error' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
  not_charged: { label: 'Not charged', variant: 'neutral' },
  upcoming: { label: 'Upcoming', variant: 'neutral' },
};
export const INVOICE_STATUS = {
  draft: { label: 'Draft', variant: 'neutral' },
  issued: { label: 'Issued', variant: 'info' },
  partially_paid: { label: 'Partially paid', variant: 'warning' },
  paid: { label: 'Paid', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
};
export const CLEARANCE = {
  cleared: { label: 'Cleared', variant: 'success' },
  partially_cleared: { label: 'Partially cleared', variant: 'warning' },
  not_cleared: { label: 'Not cleared', variant: 'error' },
};
export const CLOSING_RESULT = {
  balanced: { label: 'Balanced', variant: 'success' },
  shortage: { label: 'Shortage', variant: 'error' },
  surplus: { label: 'Surplus', variant: 'warning' },
};
export const KIND_LABEL = { monthly: 'Monthly fee', exam: 'Examination fee', other: 'Other charge' };
export const ROLE_LABEL = { OWNER: 'School Owner', MANAGER: 'Manager', ACCOUNTANT: 'Accountant' };

/** The state of an obligation for its badge (overdue wins over unpaid and partly paid). */
export const obligationState = (o) => (o.status === 'cancelled' ? 'cancelled' : o.paymentState === 'paid' ? 'paid' : o.overdue ? 'overdue' : o.paymentState);

/**
 * Checks a payment being entered: { total, problems } where problems name what is wrong (nothing
 * chosen, an amount above a balance, a part payment when the school does not accept them, the total
 * not matching the amount received).
 */
export function checkPayment(received, lines, { allowPartial, minimumPartial = 0 }) {
  const chosen = lines.filter((l) => l.selected);
  const problems = [];
  let total = 0;
  let partial = false;
  for (const l of chosen) {
    const cents = toCents(l.amount);
    if (cents === null || cents <= 0) problems.push(`Enter the amount paid for ${l.period}.`);
    else if (cents > l.balance) problems.push(`${l.period}: at most ${money(l.balance, l.currency)} is owed.`);
    else {
      total += cents;
      if (cents < l.balance) partial = true;
    }
  }
  if (!chosen.length) problems.push('Choose what this payment pays.');
  if (partial && !allowPartial) problems.push('Your school does not accept part payments: pay each chosen fee in full.');
  if (partial && allowPartial && minimumPartial > 0 && total < minimumPartial) problems.push(`A part payment is at least ${money(minimumPartial, chosen[0]?.currency)}.`);
  if (received !== null && chosen.length && total !== received) problems.push(`The fees chosen add up to ${money(total, chosen[0]?.currency)}, not the amount received.`);
  return { total, problems };
}

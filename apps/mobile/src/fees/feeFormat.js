/*
 * Money and amounts as the server stores them (integer cents of the school's currency; same symbols
 * and decimals as backend/src/features/fees/feeRules.js).
 */

const CURRENCIES = {
  USD: { symbol: '$', decimals: 2 },
  SOS: { symbol: 'Sh', decimals: 2 },
  KES: { symbol: 'KSh', decimals: 2 },
  ETB: { symbol: 'Br', decimals: 2 },
  DJF: { symbol: 'Fdj', decimals: 0 },
  EUR: { symbol: '€', decimals: 2 },
  GBP: { symbol: '£', decimals: 2 },
};

export function formatMoney(cents, currency = 'USD') {
  if (cents === null || cents === undefined || Number.isNaN(cents)) return '—';
  const c = CURRENCIES[currency] ?? CURRENCIES.USD;
  const value = Math.abs(cents) / 100;
  const text = value.toLocaleString('en-US', { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals });
  return `${cents < 0 ? '-' : ''}${c.symbol}${text}`;
}

/** "12.50" typed by a person → 1250 cents, or null when it is not a valid amount. */
export function parseAmount(text, currency = 'USD') {
  const c = CURRENCIES[currency] ?? CURRENCIES.USD;
  const clean = String(text ?? '').trim().replace(/,/g, '');
  const pattern = c.decimals ? /^\d+(\.\d{1,2})?$/ : /^\d+$/;
  if (!pattern.test(clean)) return null;
  const cents = Math.round(Number(clean) * 100);
  return cents > 0 ? cents : null;
}

/**
 * Spreads an amount over open fees, oldest due first (the order the server lists them), never more
 * than a fee's balance: [{ obligationId, amount }]. What is left over is returned as `rest`.
 */
export function allocate(amount, items) {
  let left = amount;
  const allocations = [];
  for (const o of items) {
    if (left <= 0) break;
    const take = Math.min(left, o.balance);
    if (take > 0) allocations.push({ obligationId: o.id, amount: take });
    left -= take;
  }
  return { allocations, rest: left };
}

/** Basis points as a percentage, e.g. 8250 → "82.5%". */
export const formatRate = (bp) => (bp === null || bp === undefined ? '—' : `${(bp / 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`);

/** A report cell for display by column type. */
export function cellText(column, value, currency) {
  if (value === null || value === undefined || value === '') return '—';
  if (column.kind === 'money') return formatMoney(value, currency);
  if (column.kind === 'percent') return formatRate(value);
  return String(value);
}

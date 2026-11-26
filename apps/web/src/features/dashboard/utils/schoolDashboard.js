/*
 * Display rules of the School Owner's and the Managers' dashboards: the API path and query for the
 * filters, compact amounts for chart axes, the student lifecycle words, and the quick actions of each
 * role (only pages the role has; the server checks permissions again).
 */

const PREFIX = { OWNER: '/owner', MANAGER: '/manager' };

/** The dashboard request of a role with the filters; a Manager never sends a branch (theirs is the account's). */
export function dashboardRequest(role, { academicYear, branch, from, to } = {}) {
  const query = {};
  if (academicYear) query.academicYear = academicYear;
  if (role === 'OWNER' && branch) query.branch = branch;
  if (from) query.from = from;
  if (to) query.to = to;
  return { path: `${PREFIX[role] ?? '/manager'}/dashboard`, query };
}

const CURRENCY_SYMBOL = { USD: '$', SOS: 'Sh', KES: 'KSh', ETB: 'Br', DJF: 'Fdj', EUR: '€', GBP: '£' };

/** Cents → a short amount for axes and tight places: 5670000 → '$56.7K', 120000000 → '$1.2M', 4500 → '$45'. */
export function compactMoney(cents, currency = 'USD') {
  if (cents === null || cents === undefined) return '—';
  const symbol = CURRENCY_SYMBOL[currency] ?? '$';
  const value = Math.abs(cents) / 100;
  const sign = cents < 0 ? '-' : '';
  const short = (n, unit) => `${sign}${symbol}${Number(n.toFixed(n >= 100 ? 0 : 1)).toLocaleString('en-US')}${unit}`;
  if (value >= 1_000_000) return short(value / 1_000_000, 'M');
  if (value >= 1_000) return short(value / 1_000, 'K');
  return `${sign}${symbol}${Math.round(value).toLocaleString('en-US')}`;
}

/** A percentage (one decimal at most): 75 → '75%', 61.84 → '61.8%'. */
export const percentText = (value) => `${Number((value ?? 0).toFixed(1)).toLocaleString('en-US')}%`;

/** The student lifecycle (Student.status), in the order the school sees it. */
export const STUDENT_STATUS = {
  enrolled: { label: 'Enrolled', color: 'var(--color-brand-navy)' },
  pending_enrollment: { label: 'Waiting for enrollment', color: 'var(--color-brand-gold)' },
  transferred_out: { label: 'Transferred out', color: 'var(--color-brand-steel)' },
  graduated: { label: 'Graduated', color: 'var(--color-success)' },
};

/** Examination states as words and badge variants. */
export const EXAM_STATE = {
  active: { label: 'Ongoing', variant: 'success' },
  planned: { label: 'Upcoming', variant: 'info' },
  completed: { label: 'Completed', variant: 'neutral' },
  draft: { label: 'Draft', variant: 'warning' },
};

/**
 * Quick actions of each role: the page and, where the page supports it, the form it opens
 * (?new=1, ?record=1). Fee actions only when the school has Fee Management.
 */
export function quickActions(role, { fees = true, examinations = true } = {}) {
  if (role === 'OWNER') {
    return [
      { key: 'branch', label: 'Add Branch', to: '/branches?new=1', icon: 'building' },
      { key: 'student', label: 'Add Student', to: '/students?new=1', icon: 'student' },
      examinations && { key: 'exam', label: 'Create Examination', to: '/examinations/list?new=1', icon: 'exam' },
      fees && { key: 'structures', label: 'Fee Structures', to: '/fees/structures', icon: 'structures' },
      fees && { key: 'invoice', label: 'Generate Invoice', to: '/fees/invoices?new=single', icon: 'invoice' },
      fees && { key: 'clearance', label: 'Fee Clearance', to: '/fees/clearance', icon: 'clearance' },
      { key: 'reports', label: 'View Reports', to: fees ? '/fees/reports' : '/student-attendance/reports', icon: 'reports' },
    ].filter(Boolean);
  }
  return [
    { key: 'student', label: 'Add Student', to: '/students?new=1', icon: 'student' },
    fees && { key: 'payment', label: 'Record Payment', to: '/fees/payments?record=1', icon: 'payment' },
    fees && { key: 'invoice', label: 'Generate Invoice', to: '/fees/invoices?new=single', icon: 'invoice' },
    fees && { key: 'clearance', label: 'Fee Clearance', to: '/fees/clearance', icon: 'clearance' },
  ].filter(Boolean);
}

/** '07:30' → '7:30 AM'. */
export function clockText(hhmm) {
  if (!hhmm) return '';
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

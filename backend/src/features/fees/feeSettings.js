import { badRequest, forbidden } from '../../common/httpError.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockActiveSchool } from '../branches/branches.service.js';
import { CURRENCIES, formatMoney, validNumberFormat } from './feeRules.js';

/*
 * Fee settings (docs/business-rules.md → Fee Management → Settings): the one place that says which
 * policies exist, their limits and defaults. The School Owner sets them for the whole school (one row);
 * a value not set uses the default below. Every service reads them through feeSettingsOf().
 * Kinds: int, money (minor units), boolean, choice, roles (some of OWNER/MANAGER/ACCOUNTANT), text.
 */

const ROLE_OPTIONS = [
  { value: 'OWNER', label: 'School Owner' },
  { value: 'MANAGER', label: 'Managers' },
  { value: 'ACCOUNTANT', label: 'Accountants' },
];

export const FEE_SETTINGS = {
  // General
  currency: { group: 'general', label: 'Currency', kind: 'choice', options: Object.entries(CURRENCIES).map(([value, c]) => ({ value, label: `${c.name} (${c.symbol})` })), fallback: 'USD', help: 'Amounts already recorded keep their value; only how they are shown changes.' },
  // Payments
  allowPartialPayments: { group: 'payments', label: 'Accept part payments of a fee', kind: 'boolean', fallback: true, help: 'Off: each fee chosen in a payment is paid in full.' },
  minimumPartialPayment: { group: 'payments', label: 'Smallest part payment', kind: 'money', min: 0, max: 100_000_00, fallback: 0, help: 'A payment that leaves a fee partly paid must be at least this much. 0: no minimum.' },
  reversalRoles: { group: 'payments', label: 'Who may reverse payments', kind: 'roles', options: ROLE_OPTIONS, fallback: ['OWNER', 'MANAGER'], required: ['OWNER'], help: 'Reversing needs a reason, keeps the payment and voids its receipt.' },
  receiptFormat: { group: 'payments', label: 'Receipt paper size', kind: 'choice', options: [{ value: 'a5', label: 'A5' }, { value: 'a4', label: 'A4' }, { value: 'thermal', label: 'Receipt printer (80 mm)' }], fallback: 'a5' },
  receiptNumberFormat: { group: 'payments', label: 'Receipt number format', kind: 'text', format: 'number', fallback: 'RCP-{YYYY}-{SEQ5}', help: '{YYYY} year, {YY}, {MM} month, {BRANCH} branch number, {SEQ5} the sequence (5 digits). The sequence restarts each year when the year is shown.' },
  // Monthly fees
  dueDay: { group: 'monthly', label: 'Day of the month a monthly fee is due', kind: 'int', min: 1, max: 28, fallback: 10, help: 'Fees are generated on the 1st; after this day an unpaid fee is overdue.' },
  overdueGraceDays: { group: 'monthly', label: 'Grace days before a fee counts as overdue', kind: 'int', min: 0, max: 60, fallback: 0 },
  autoGenerate: { group: 'monthly', label: 'Generate monthly fees automatically on the 1st', kind: 'boolean', fallback: true, help: 'Off: fees are generated only when someone runs the generation.' },
  billingStartMonth: { group: 'monthly', label: 'First month EduTrack charges monthly fees', kind: 'month', fallback: null, help: 'Empty: from the start of the academic year (each student from their enrollment month). Set it when your school starts using EduTrack fees during a year, so earlier months are not charged.' },
  generationAlertAfter: { group: 'monthly', label: 'Tell the School Owner after this many failed generation attempts', kind: 'int', min: 1, max: 10, fallback: 3 },
  withdrawalBilling: {
    group: 'monthly',
    label: 'Fee of the month a student withdraws',
    kind: 'choice',
    options: [
      { value: 'full', label: 'Charge the whole month' },
      { value: 'none', label: 'Do not charge that month' },
      { value: 'cutoff', label: 'Charge only when they leave on or after a day' },
    ],
    fallback: 'full',
    help: 'Months after an official withdrawal are never charged.',
  },
  withdrawalCutoffDay: { group: 'monthly', label: 'Withdrawal cut-off day', kind: 'int', min: 1, max: 28, fallback: 15 },
  // Adjustments and discounts
  managersAdjustFees: { group: 'discounts', label: 'Managers may adjust a student’s fees', kind: 'boolean', fallback: true, help: 'Every adjustment needs a reason and keeps the original amount.' },
  managerAdjustmentLimit: { group: 'discounts', label: 'Most a Manager may reduce a fee (%)', kind: 'int', min: 0, max: 100, fallback: 50, help: 'The School Owner has no limit.' },
  discountCombination: {
    group: 'discounts',
    label: 'When a student has several discounts',
    kind: 'choice',
    options: [
      { value: 'best', label: 'Apply only the largest' },
      { value: 'stack', label: 'Add combinable discounts together' },
    ],
    fallback: 'best',
  },
  maxCombinedDiscount: { group: 'discounts', label: 'Most discounts may take off a fee together (%)', kind: 'int', min: 0, max: 100, fallback: 100 },
  // Examination fees and clearance
  examFeeRequired: { group: 'clearance', label: 'The examination fee must be paid for clearance', kind: 'boolean', fallback: true },
  monthlyBlocksExams: {
    group: 'clearance',
    label: 'Monthly fees that block examination clearance',
    kind: 'choice',
    options: [
      { value: 'none', label: 'None' },
      { value: 'overdue', label: 'Overdue monthly fees' },
      { value: 'all', label: 'Every monthly fee due by the deadline' },
    ],
    fallback: 'overdue',
  },
  partialQualifies: { group: 'clearance', label: 'Part payment can qualify for clearance', kind: 'boolean', fallback: false },
  partialMinimumPercent: { group: 'clearance', label: 'Share of the required fees that must be paid (%)', kind: 'int', min: 0, max: 100, fallback: 50 },
  clearanceDeadlineDays: { group: 'clearance', label: 'Clearance deadline (days before an examination starts)', kind: 'int', min: 0, max: 60, fallback: 0, help: 'The examination fee is due then, and balances are judged on that day. 0: the first day of the examination.' },
  exceptionRoles: { group: 'clearance', label: 'Who may grant a clearance exception', kind: 'roles', options: ROLE_OPTIONS, fallback: ['OWNER', 'MANAGER'], required: ['OWNER'], help: 'An exception needs a reason and is recorded in the audit log.' },
  // Invoices
  invoiceNumberFormat: { group: 'invoices', label: 'Invoice number format', kind: 'text', format: 'number', fallback: 'INV-{YYYY}-{SEQ4}' },
  invoiceNote: { group: 'invoices', label: 'Note printed on invoices', kind: 'text', max: 300, fallback: 'This invoice shows the fees due for the period. It has no payment deadline.' },
  // Notifications
  staffOverdueNotifications: { group: 'notifications', label: 'Tell staff about overdue fees', kind: 'boolean', fallback: true },
  staffFirstAfterDays: { group: 'notifications', label: 'First staff notice (days after a fee becomes overdue)', kind: 'int', min: 0, max: 90, fallback: 3 },
  staffRepeatDays: { group: 'notifications', label: 'Repeat staff notices every (days)', kind: 'int', min: 1, max: 90, fallback: 7 },
  staffRecipients: { group: 'notifications', label: 'Staff who receive overdue notices', kind: 'roles', options: ROLE_OPTIONS, fallback: ['MANAGER', 'ACCOUNTANT'] },
  remindersStop: {
    group: 'notifications',
    label: 'Reminders about a student stop',
    kind: 'choice',
    options: [
      { value: 'full_payment', label: 'When the overdue fees are paid in full' },
      { value: 'any_payment', label: 'When any payment is received' },
    ],
    fallback: 'full_payment',
  },
  parentReminders: { group: 'notifications', label: 'Remind parents about overdue fees', kind: 'boolean', fallback: false, help: 'EduTrack lists the guardians due a reminder; staff send it from their phone (WhatsApp or SMS) and it is logged.' },
  parentFirstAfterDays: { group: 'notifications', label: 'First parent reminder (days overdue)', kind: 'int', min: 0, max: 90, fallback: 7 },
  parentRepeatDays: { group: 'notifications', label: 'Repeat parent reminders every (days)', kind: 'int', min: 1, max: 90, fallback: 14 },
};
export const FEE_SETTING_KEYS = Object.keys(FEE_SETTINGS);
export const FEE_DEFAULTS = Object.fromEntries(FEE_SETTING_KEYS.map((k) => [k, FEE_SETTINGS[k].fallback]));

/** The value as stored for a key, or null when it is not valid (then the default applies). */
export function validFeeValue(key, value) {
  const s = FEE_SETTINGS[key];
  if (!s || value === null || value === undefined) return null;
  if (s.kind === 'int' || s.kind === 'money') return Number.isInteger(value) && value >= s.min && value <= s.max ? value : null;
  if (s.kind === 'boolean') return typeof value === 'boolean' ? value : null;
  if (s.kind === 'choice') return s.options.some((o) => o.value === value) ? value : null;
  if (s.kind === 'roles') {
    if (!Array.isArray(value) || value.some((v) => !s.options.some((o) => o.value === v))) return null;
    const set = [...new Set([...(s.required ?? []), ...value])];
    return s.options.map((o) => o.value).filter((v) => set.includes(v));
  }
  if (s.kind === 'month') return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
  if (s.kind === 'text') {
    if (typeof value !== 'string') return null;
    const text = value.trim();
    if (s.format === 'number') return validNumberFormat(text) ? text : null;
    return text.length <= (s.max ?? 200) ? text : null;
  }
  return null;
}

const storedOf = (row) => Object.fromEntries(FEE_SETTING_KEYS.map((k) => [k, validFeeValue(k, row?.values?.[k])]));
export const resolveFeeSettings = (row) => {
  const stored = storedOf(row);
  return Object.fromEntries(FEE_SETTING_KEYS.map((k) => [k, stored[k] ?? FEE_DEFAULTS[k]]));
};

/** The fee policies that apply to a school. */
export async function feeSettingsOf(schoolId, client = getPrisma()) {
  return resolveFeeSettings(await client.feeSettings.findUnique({ where: { schoolId } }));
}

/** The clearance policy in the shape feeRules.evaluateClearance takes. */
export const clearancePolicy = (s) => ({
  examFeeRequired: s.examFeeRequired,
  monthlyBlocks: s.monthlyBlocksExams,
  partialQualifies: s.partialQualifies,
  partialMinimumPercent: s.partialMinimumPercent,
  graceDays: s.overdueGraceDays,
  deadlineDays: s.clearanceDeadlineDays,
});

const fields = () =>
  FEE_SETTING_KEYS.map((key) => {
    const { group, label, kind, min, max, options, fallback, help, required } = FEE_SETTINGS[key];
    return { key, group, label, kind, ...(min !== undefined && { min, max }), ...(options && { options }), ...(required && { required }), default: fallback, ...(help && { help }) };
  });

/** The settings screen: fields, the school's stored values and what applies. Everyone in the school reads. */
export async function getFeeSettings(scope) {
  const row = await getPrisma().feeSettings.findUnique({ where: { schoolId: scope.school.id } });
  return {
    fields: fields(),
    values: storedOf(row),
    effective: resolveFeeSettings(row),
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    updatedBy: row?.updatedByName ?? null,
    canEdit: scope.role === 'OWNER',
    latePenalties: 'Late payment penalties are not charged in this version of EduTrack.',
  };
}

const shown = (key, value, currency) => {
  if (value === null || value === undefined) return 'Default';
  const s = FEE_SETTINGS[key];
  if (s.kind === 'boolean') return value ? 'Yes' : 'No';
  if (s.kind === 'choice') return s.options.find((o) => o.value === value)?.label ?? String(value);
  if (s.kind === 'roles') return value.map((v) => s.options.find((o) => o.value === v)?.label ?? v).join(', ') || 'Nobody';
  if (s.kind === 'money') return formatMoney(value, currency);
  if (s.kind === 'month') return value || 'Start of the year';
  return String(value);
};

/** Reads { values: { key: value | null } } from a request body; 400 with a message per field. */
export function readFeeSettingsChange(body) {
  if (typeof body.values !== 'object' || body.values === null || Array.isArray(body.values)) throw badRequest('Send the settings to change.');
  const errors = {};
  const values = {};
  for (const [key, value] of Object.entries(body.values)) {
    const s = FEE_SETTINGS[key];
    if (!s) errors[key] = 'Unknown setting.';
    else if (value === null) values[key] = null;
    else {
      const valid = validFeeValue(key, value);
      if (valid === null) {
        errors[key] =
          s.kind === 'int' || s.kind === 'money'
            ? `A whole number from ${s.min} to ${s.max}.`
            : s.kind === 'boolean'
              ? 'Yes or no.'
              : s.kind === 'month'
                ? 'A month (YYYY-MM).'
                : s.format === 'number'
                ? 'Use {SEQ} (or {SEQ5}) and optionally {YYYY}, {YY}, {MM}, {BRANCH}; at most 30 characters.'
                : s.kind === 'text'
                  ? `At most ${s.max ?? 200} characters.`
                  : 'Choose from the options.';
      } else values[key] = valid;
    }
  }
  if (Object.keys(errors).length) throw badRequest('Check the highlighted settings.', errors);
  if (!Object.keys(values).length) throw badRequest('Nothing to change.');
  return { values };
}

/** The School Owner changes fee policies; one audit event lists every changed value. */
export async function saveFeeSettings(scope, { values }, user, req) {
  if (scope.role !== 'OWNER') throw forbidden('Only the School Owner changes fee policies.');
  await getPrisma().$transaction(async (tx) => {
    await lockActiveSchool(tx, scope.school);
    const row = await tx.feeSettings.findUnique({ where: { schoolId: scope.school.id } });
    const before = row?.values ?? {};
    const currency = resolveFeeSettings(row).currency;
    const next = { ...before };
    const changes = [];
    for (const [key, value] of Object.entries(values)) {
      const old = validFeeValue(key, before[key]);
      if (JSON.stringify(old) === JSON.stringify(value)) continue;
      if (value === null) delete next[key];
      else next[key] = value;
      changes.push({ field: FEE_SETTINGS[key].label, from: shown(key, old, currency), to: shown(key, value, currency) });
    }
    if (!changes.length) return;
    const data = { values: next, updatedById: user.id, updatedByName: user.name };
    if (row) await tx.feeSettings.update({ where: { id: row.id }, data });
    else await tx.feeSettings.create({ data: { schoolId: scope.school.id, ...data } });
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.FEE_SETTINGS_CHANGED,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { type: 'school', id: scope.school.id, name: scope.school.name },
      schoolId: scope.school.id,
      description: `Fee policies changed: ${changes.map((c) => c.field).join('; ')}.`,
      change: { fields: changes },
      req,
    });
  });
  return getFeeSettings(scope);
}

// ---- receipt and invoice branding ----------------------------------------------------------------

export const toBranding = (b, school) =>
  b
    ? { id: b.id, version: b.version, schoolName: b.schoolName, logo: b.logo, address: b.address, phone: b.phone, email: b.email, website: b.website, footer: b.footer, showSignature: b.showSignature, signatureLabel: b.signatureLabel, createdAt: b.createdAt.toISOString(), createdBy: b.createdByName }
    : { id: null, version: 0, schoolName: school.name, logo: null, address: school.address ?? null, phone: school.phone ?? null, email: school.email ?? null, website: school.website ?? null, footer: 'Thank you.', showSignature: true, signatureLabel: 'Received by', createdAt: null, createdBy: null };

/** The branding in use (the latest version), or null when the school has none yet. */
export const currentBranding = (schoolId, client = getPrisma()) => client.feeBranding.findFirst({ where: { schoolId }, orderBy: { version: 'desc' } });

export async function getBranding(scope) {
  const prisma = getPrisma();
  const [latest, school] = await Promise.all([currentBranding(scope.school.id), prisma.school.findUnique({ where: { id: scope.school.id } })]);
  return { branding: toBranding(latest, school), canEdit: scope.role === 'OWNER' };
}

const BRANDING_FIELDS = { schoolName: 120, address: 200, phone: 60, email: 120, website: 120, footer: 300, signatureLabel: 60 };

export function readBranding(body) {
  const errors = {};
  const values = {};
  for (const [key, max] of Object.entries(BRANDING_FIELDS)) {
    const v = body[key];
    if (v === undefined) continue;
    if (v !== null && typeof v !== 'string') errors[key] = 'Text only.';
    else if ((v ?? '').trim().length > max) errors[key] = `At most ${max} characters.`;
    else values[key] = (v ?? '').trim() || null;
  }
  if (body.schoolName !== undefined && !values.schoolName) errors.schoolName = 'Enter the name printed on receipts and invoices.';
  if (body.showSignature !== undefined) {
    if (typeof body.showSignature !== 'boolean') errors.showSignature = 'Yes or no.';
    else values.showSignature = body.showSignature;
  }
  if (body.logo !== undefined) {
    if (body.logo === null) values.logo = null;
    else if (typeof body.logo !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(body.logo)) errors.logo = 'Upload a JPEG or PNG image.';
    else if (body.logo.length > 300_000) errors.logo = 'The logo is too large (at most about 200 KB).';
    else values.logo = body.logo;
  }
  if (Object.keys(errors).length) throw badRequest('Check the highlighted fields.', errors);
  return values;
}

/** Saves the branding as a new version (receipts and invoices already issued keep theirs). School Owner only. */
export async function saveBranding(scope, values, user, req) {
  if (scope.role !== 'OWNER') throw forbidden('Only the School Owner changes receipts and invoices.');
  await getPrisma().$transaction(async (tx) => {
    await lockActiveSchool(tx, scope.school);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fee-branding:${scope.school.id}`}))`;
    const school = await tx.school.findUnique({ where: { id: scope.school.id } });
    const latest = await currentBranding(scope.school.id, tx);
    const base = toBranding(latest, school);
    const next = { ...base, ...values };
    const keys = ['schoolName', 'logo', 'address', 'phone', 'email', 'website', 'footer', 'showSignature', 'signatureLabel'];
    const changed = keys.filter((k) => (next[k] ?? null) !== (base[k] ?? null) || !latest);
    if (latest && !changed.length) return;
    await tx.feeBranding.create({
      data: { schoolId: scope.school.id, version: (latest?.version ?? 0) + 1, ...Object.fromEntries(keys.map((k) => [k, next[k] ?? (k === 'showSignature' ? true : null)])), schoolName: next.schoolName || school.name, createdById: user.id, createdByName: user.name },
    });
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.FEE_BRANDING_CHANGED,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { type: 'school', id: scope.school.id, name: scope.school.name },
      schoolId: scope.school.id,
      description: `Receipt and invoice design changed: ${changed.map((k) => (k === 'logo' ? 'logo' : k.replace(/[A-Z]/g, (c) => ` ${c.toLowerCase()}`))).join(', ')}.`,
      req,
    });
  });
  return getBranding(scope);
}

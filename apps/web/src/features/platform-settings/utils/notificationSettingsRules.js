/*
 * Platform notification settings (Super Admin, N5): checks matching the server's, for immediate
 * feedback (pure; tested in notificationSettingsRules.test.js).
 */

export const NUMBER_FIELDS = ['checkInLeadDefault', 'checkInLeadMin', 'checkInLeadMax', 'checkOutLeadDefault', 'checkOutLeadMin', 'checkOutLeadMax', 'digestHour'];
export const SWITCH_FIELDS = ['pushEnabled', 'checkInReminderEnabled', 'checkOutReminderEnabled', 'uploadReminderEnabled', 'staffCanAdjustTiming'];

/** Form values (numbers as text) from the saved settings. */
export const settingsForm = (s) => ({
  ...Object.fromEntries(SWITCH_FIELDS.map((k) => [k, s[k]])),
  ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, String(s[k])])),
});

const whole = (text) => (/^\d+$/.test(String(text).trim()) ? Number(text) : NaN);

/** Field errors ({} when valid), with the hard limits from the server (`limits`). */
export function settingsProblems(form, limits) {
  const errors = {};
  const ranges = {
    checkInLeadDefault: limits.checkInLead,
    checkInLeadMin: limits.checkInLead,
    checkInLeadMax: limits.checkInLead,
    checkOutLeadDefault: limits.checkOutLead,
    checkOutLeadMin: limits.checkOutLead,
    checkOutLeadMax: limits.checkOutLead,
    digestHour: limits.digestHour,
  };
  for (const key of NUMBER_FIELDS) {
    const n = whole(form[key]);
    const { min, max } = ranges[key];
    if (!Number.isInteger(n) || n < min || n > max) errors[key] = `Enter a whole number from ${min} to ${max}.`;
  }
  for (const kind of ['checkIn', 'checkOut']) {
    const [lo, hi, def] = ['Min', 'Max', 'Default'].map((s) => whole(form[`${kind}Lead${s}`]));
    if (errors[`${kind}LeadMin`] || errors[`${kind}LeadMax`] || errors[`${kind}LeadDefault`]) continue;
    if (lo > hi) errors[`${kind}LeadMin`] = 'The minimum cannot be more than the maximum.';
    else if (def < lo || def > hi) errors[`${kind}LeadDefault`] = `The default must be from ${lo} to ${hi} minutes.`;
  }
  return errors;
}

/** Only the changed fields, as the API expects them (numbers as numbers). */
export function changedSettings(form, saved) {
  const changes = {};
  for (const k of SWITCH_FIELDS) if (form[k] !== saved[k]) changes[k] = form[k];
  for (const k of NUMBER_FIELDS) if (Number(form[k]) !== saved[k]) changes[k] = Number(form[k]);
  return changes;
}

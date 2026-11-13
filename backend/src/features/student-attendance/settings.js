import { badRequest, HttpError, notFound } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockActiveSchool, lockOperatingBranch } from '../branches/branches.service.js';

/*
 * Student attendance settings (docs/business-rules.md → Student attendance → Settings): the one
 * place that says which settings exist, their limits and defaults, and what applies to a branch.
 *
 * Three levels: the platform defaults below; the school's values (School Owner), which also say
 * which settings the school's Managers may change; and a branch's own values (its Manager), used
 * only for the settings the school lets branches change. A value not set at a level comes from the
 * level above. Every service reads settings through effectiveSettings / effectiveSettingsFor, never
 * from the table directly.
 *
 * Sessions keep the times and deadline they had when they opened, so a change applies to sessions
 * opened afterwards; the correction period (managerEditDays) is a rule and applies when checked.
 */

export const SETTINGS = {
  halfDayFrequency: {
    label: 'Manager attendance per day',
    kind: 'choice',
    options: [
      { value: 'twice_daily', label: 'Twice: before and after the main break' },
      { value: 'once_daily', label: 'Once a day' },
    ],
    fallback: 'twice_daily',
    help: 'On days without a main break, once.',
  },
  halfDayOpensBeforeMinutes: { label: 'Can be taken from (minutes before the half starts)', kind: 'minutes', min: 0, max: 240, fallback: 15 },
  halfDayDeadlineAfterMinutes: { label: 'Due by (minutes after the half ends)', kind: 'minutes', min: 0, max: 1440, fallback: 60, help: 'Marks after this count as late entries.' },
  managerEditDays: { label: 'Managers can take or correct attendance for (days after the date)', kind: 'days', min: 0, max: 90, fallback: 7 },
  correctionReasonRequired: { label: 'A reason is needed to change a mark after it is due', kind: 'boolean', fallback: true },
  lessonOpensBeforeMinutes: { label: 'Lesson attendance can be taken from (minutes before the lesson)', kind: 'minutes', min: 0, max: 60, fallback: 5, phase: 'teachers' },
  lessonDeadlineAfterMinutes: { label: 'Lesson attendance due by (minutes after the lesson ends)', kind: 'minutes', min: 0, max: 720, fallback: 30, phase: 'teachers' },
  teacherCorrectionMinutes: { label: 'Teachers can correct their own marks for (minutes)', kind: 'minutes', min: 0, max: 1440, fallback: 60, phase: 'teachers' },
  offlineGraceMinutes: { label: 'Offline marks can be uploaded until (minutes after the deadline)', kind: 'minutes', min: 0, max: 4320, fallback: 1440, phase: 'teachers' },
  teacherReminders: { label: 'Remind teachers when a lesson’s attendance was not taken', kind: 'boolean', fallback: true, phase: 'notifications', help: 'Sent once after the lesson’s deadline, while offline marks can still be uploaded.' },
  managerAlerts: { label: 'Tell the branch’s Managers when a day’s attendance is incomplete', kind: 'boolean', fallback: true, phase: 'notifications', help: 'Sent once a day, after the day’s last deadline.' },
};
export const SETTING_KEYS = Object.keys(SETTINGS);
export const PLATFORM_DEFAULTS = Object.fromEntries(SETTING_KEYS.map((k) => [k, SETTINGS[k].fallback]));

const FREQUENCY_TO_DB = { twice_daily: 'TWICE_DAILY', once_daily: 'ONCE_DAILY' };
const FREQUENCY_FROM_DB = { TWICE_DAILY: 'twice_daily', ONCE_DAILY: 'once_daily' };
const toApi = (key, value) => (value === null || value === undefined ? null : key === 'halfDayFrequency' ? FREQUENCY_FROM_DB[value] : value);
const toDb = (key, value) => (value === null ? null : key === 'halfDayFrequency' ? FREQUENCY_TO_DB[value] : value);

/** Stored values of one row as API values ({ key: value | null }); no row: all null. */
const storedOf = (row) => Object.fromEntries(SETTING_KEYS.map((k) => [k, toApi(k, row?.[k])]));

/**
 * What applies, from the school row and a branch row (either may be missing). → { values, sources }:
 * values: { key: value }, sources: { key: 'platform' | 'school' | 'branch' }. Pure.
 */
export function resolveSettings(schoolRow, branchRow) {
  const school = storedOf(schoolRow);
  const branch = storedOf(branchRow);
  const overridable = new Set(schoolRow?.branchOverridable ?? []);
  const values = {};
  const sources = {};
  for (const key of SETTING_KEYS) {
    if (branchRow && overridable.has(key) && branch[key] !== null) {
      values[key] = branch[key];
      sources[key] = 'branch';
    } else if (school[key] !== null) {
      values[key] = school[key];
      sources[key] = 'school';
    } else {
      values[key] = PLATFORM_DEFAULTS[key];
      sources[key] = 'platform';
    }
  }
  return { values, sources };
}

/** The settings that apply to each of `branchIds` of one school (one query): Map branchId → values. */
export async function effectiveSettingsFor(schoolId, branchIds, client = getPrisma()) {
  const rows = await client.studentAttendanceSettings.findMany({ where: { schoolId, OR: [{ branchId: null }, { branchId: { in: branchIds } }] } });
  const schoolRow = rows.find((r) => !r.branchId) ?? null;
  return new Map(branchIds.map((id) => [id, resolveSettings(schoolRow, rows.find((r) => r.branchId === id) ?? null).values]));
}

/** The settings that apply to one branch ({ id, schoolId }). */
export async function effectiveSettings(branch, client = getPrisma()) {
  return (await effectiveSettingsFor(branch.schoolId, [branch.id], client)).get(branch.id);
}

// ---- reading and changing ------------------------------------------------------------------------

const fields = () =>
  SETTING_KEYS.map((key) => {
    const { label, kind, min, max, options, fallback, help, phase } = SETTINGS[key];
    return { key, label, kind, ...(min !== undefined && { min, max }), ...(options && { options }), default: fallback, ...(help && { help }), ...(phase && { phase }) };
  });

async function findBranch(client, school, id) {
  const branch = isUuid(id) ? await client.branch.findFirst({ where: { id, schoolId: school.id }, select: { id: true, name: true, code: true } }) : null;
  if (!branch) throw notFound('Branch not found.');
  return branch;
}

/**
 * The settings screen. Owner: the school's values and what branches may change, plus one branch's
 * when `branch` is given. Manager: the school's values (read only), what they may change, and their
 * branch's values. Both: what applies and where each value comes from.
 */
export async function getSettings(scope, { branch: branchId } = {}) {
  const prisma = getPrisma();
  const branch = scope.branch ?? (branchId ? await findBranch(prisma, scope.school, branchId) : null);
  const [rows, school] = await Promise.all([
    prisma.studentAttendanceSettings.findMany({ where: { schoolId: scope.school.id, OR: [{ branchId: null }, ...(branch ? [{ branchId: branch.id }] : [])] } }),
    prisma.school.findUnique({ where: { id: scope.school.id }, select: { studentAttendanceEnabled: true } }),
  ]);
  const schoolRow = rows.find((r) => !r.branchId) ?? null;
  const branchRow = branch ? (rows.find((r) => r.branchId === branch.id) ?? null) : null;
  const schoolLevel = resolveSettings(schoolRow, null);
  const result = {
    // Whether Student Attendance is switched on for the school (Super Admin); settings can be prepared either way.
    featureEnabled: school?.studentAttendanceEnabled === true,
    fields: fields(),
    platformDefaults: PLATFORM_DEFAULTS,
    school: { values: storedOf(schoolRow), effective: schoolLevel.values, sources: schoolLevel.sources, updatedAt: schoolRow?.updatedAt ?? null, updatedBy: schoolRow?.updatedByName ?? null },
    branchOverridable: schoolRow?.branchOverridable ?? [],
    branch: null,
    canEdit: scope.branch ? (schoolRow?.branchOverridable ?? []).length > 0 : true,
  };
  if (branch) {
    const applied = resolveSettings(schoolRow, branchRow);
    const overridable = new Set(result.branchOverridable);
    result.branch = {
      id: branch.id,
      name: branch.name,
      code: branch.code,
      // Values the school no longer lets the branch change are not shown as the branch's.
      values: Object.fromEntries(Object.entries(storedOf(branchRow)).map(([k, v]) => [k, overridable.has(k) ? v : null])),
      effective: applied.values,
      sources: applied.sources,
      updatedAt: branchRow?.updatedAt ?? null,
      updatedBy: branchRow?.updatedByName ?? null,
    };
  }
  return result;
}

const invalid = (errors) => badRequest('Check the highlighted fields.', errors);

/** One setting's value from a request: a valid value, or null (not set at this level). */
function readValue(key, raw, errors) {
  if (raw === null) return null;
  const spec = SETTINGS[key];
  if (spec.kind === 'boolean') {
    if (typeof raw !== 'boolean') errors[key] = 'Choose on or off.';
    return raw;
  }
  if (spec.kind === 'choice') {
    if (!spec.options.some((o) => o.value === raw)) errors[key] = `Choose one of: ${spec.options.map((o) => o.value).join(', ')}.`;
    return raw;
  }
  if (!Number.isInteger(raw) || raw < spec.min || raw > spec.max) errors[key] = `Enter a whole number from ${spec.min} to ${spec.max}.`;
  return raw;
}

/**
 * A settings change: { <key>: value | null, …, branchOverridable?: [keys] (Owner only) }. Only the
 * keys sent change; null clears the value at this level (the level above applies).
 */
export function readSettingsChange(body, { role }) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Send a JSON object.');
  const errors = {};
  const values = {};
  for (const [key, raw] of Object.entries(body)) {
    if (key === 'branchOverridable') continue;
    if (key === 'school' || key === 'schoolId') errors[key] = 'The school is decided by your account and cannot be set.';
    else if (key === 'branch' || key === 'branchId') errors[key] = role === 'MANAGER' ? 'Your branch is decided by your account and cannot be set.' : 'Branch values are set by the branch’s Manager.';
    else if (!SETTINGS[key]) errors[key] = 'Unknown setting.';
    else values[key] = readValue(key, raw, errors);
  }
  let branchOverridable;
  if (body.branchOverridable !== undefined) {
    if (role !== 'OWNER') errors.branchOverridable = 'Your School Owner decides which settings branches may change.';
    else if (!Array.isArray(body.branchOverridable) || body.branchOverridable.some((k) => !SETTINGS[k])) errors.branchOverridable = 'Choose settings from the list.';
    else branchOverridable = [...new Set(body.branchOverridable)].sort((a, b) => SETTING_KEYS.indexOf(a) - SETTING_KEYS.indexOf(b));
  }
  if (Object.keys(errors).length) throw invalid(errors);
  if (!Object.keys(values).length && branchOverridable === undefined) throw badRequest('Send at least one setting.');
  return { values, branchOverridable };
}

const show = (key, value) => {
  if (value === null || value === undefined) return 'Default';
  if (SETTINGS[key]?.kind === 'boolean') return value ? 'On' : 'Off';
  if (SETTINGS[key]?.kind === 'choice') return SETTINGS[key].options.find((o) => o.value === value)?.label ?? String(value);
  return String(value);
};
const listText = (keys) => keys.map((k) => SETTINGS[k].label).join('; ') || 'None';

const TX = { timeout: 20000, maxWait: 10000 };
const lockSettings = (tx, schoolId) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`student-attendance-settings:${schoolId}`}))`;

/**
 * Owner: changes the school's values and what branches may change. A setting branches may no
 * longer change is cleared from every branch (they follow the school again). Audited; an unchanged
 * submission writes and records nothing.
 */
export async function saveSchoolSettings(scope, { values, branchOverridable }, user, req) {
  await getPrisma().$transaction(async (tx) => {
    await lockSettings(tx, scope.school.id);
    await lockActiveSchool(tx, scope.school);
    const row = await tx.studentAttendanceSettings.findFirst({ where: { schoolId: scope.school.id, branchId: null } });
    const before = storedOf(row);
    const changes = [];
    const data = {};
    for (const [key, value] of Object.entries(values)) {
      if (before[key] === value) continue;
      data[key] = toDb(key, value);
      changes.push({ field: SETTINGS[key].label, from: show(key, before[key]), to: show(key, value) });
    }
    const oldList = row?.branchOverridable ?? [];
    const revoked = branchOverridable ? oldList.filter((k) => !branchOverridable.includes(k)) : [];
    if (branchOverridable && branchOverridable.join() !== oldList.join()) {
      data.branchOverridable = branchOverridable;
      changes.push({ field: 'Branches may change', from: listText(oldList), to: listText(branchOverridable) });
    }
    if (!changes.length) return;
    const actor = { updatedById: user.id, updatedByName: user.name };
    if (row) await tx.studentAttendanceSettings.update({ where: { id: row.id }, data: { ...data, ...actor } });
    else await tx.studentAttendanceSettings.create({ data: { schoolId: scope.school.id, ...data, ...actor } });
    let cleared = 0;
    if (revoked.length) {
      cleared = (await tx.studentAttendanceSettings.updateMany({ where: { schoolId: scope.school.id, branchId: { not: null } }, data: Object.fromEntries(revoked.map((k) => [k, null])) })).count;
    }
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.STUDENT_ATTENDANCE_SETTINGS_CHANGED,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { type: 'School', id: scope.school.id, name: scope.school.name },
      schoolId: scope.school.id,
      description: `Changed the student attendance settings of ${scope.school.name}.`,
      change: { level: 'school', fields: changes, ...(revoked.length && { branchValuesCleared: { settings: listText(revoked), branches: cleared } }) },
      req,
    });
  }, TX);
  return getSettings(scope);
}

/** Manager: changes their branch's values, only for the settings the school lets branches change (403 otherwise). */
export async function saveBranchSettings(scope, { values }, user, req) {
  await getPrisma().$transaction(async (tx) => {
    await lockSettings(tx, scope.school.id);
    await lockOperatingBranch(tx, scope, 'attendance settings');
    const rows = await tx.studentAttendanceSettings.findMany({ where: { schoolId: scope.school.id, OR: [{ branchId: null }, { branchId: scope.branch.id }] } });
    const schoolRow = rows.find((r) => !r.branchId) ?? null;
    const row = rows.find((r) => r.branchId === scope.branch.id) ?? null;
    const allowed = new Set(schoolRow?.branchOverridable ?? []);
    const locked = Object.keys(values).filter((k) => !allowed.has(k));
    if (locked.length) {
      throw new HttpError(403, 'SETTING_LOCKED', 'Your School Owner sets these for every branch.', Object.fromEntries(locked.map((k) => [k, 'Set by your School Owner.'])));
    }
    const before = storedOf(row);
    const changes = [];
    const data = {};
    for (const [key, value] of Object.entries(values)) {
      if (before[key] === value) continue;
      data[key] = toDb(key, value);
      changes.push({ field: SETTINGS[key].label, from: show(key, before[key]), to: show(key, value) });
    }
    if (!changes.length) return;
    const actor = { updatedById: user.id, updatedByName: user.name };
    if (row) await tx.studentAttendanceSettings.update({ where: { id: row.id }, data: { ...data, ...actor } });
    else await tx.studentAttendanceSettings.create({ data: { schoolId: scope.school.id, branchId: scope.branch.id, ...data, ...actor } });
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.STUDENT_ATTENDANCE_SETTINGS_CHANGED,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { type: 'Branch', id: scope.branch.id, name: scope.branch.name },
      schoolId: scope.school.id,
      description: `Changed the student attendance settings of ${scope.branch.name}.`,
      change: { level: 'branch', fields: changes },
      req,
    });
  }, TX);
  return getSettings(scope);
}

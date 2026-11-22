import { badRequest, HttpError } from '../../common/httpError.js';
import { getPrisma } from '../../config/prisma.js';
import { AUDIT_ACTIONS } from '../audit-logs/auditActions.js';
import { recordAuditEvent } from '../audit-logs/auditService.js';
import { lockActiveSchool, lockOperatingBranch } from '../branches/branches.service.js';

/*
 * Examination settings (docs/business-rules.md → Examinations → Settings): the one place that says
 * which settings exist, their limits and defaults, and what applies to a branch. Three levels, as for
 * student attendance (features/student-attendance/settings.js): the platform defaults below; the
 * school's values (School Owner), which also say which settings Managers may set for their branch;
 * and a branch's own values for those. A value not set at a level comes from the level above.
 * Every service reads settings through effectiveExamSettings, never from the table directly.
 */

export const EXAM_SETTINGS = {
  // Grading & marks
  maxMarksLimit: { group: 'grading', label: 'Highest marks a paper can be out of', kind: 'int', min: 1, max: 1000, fallback: 100 },
  passPercent: { group: 'grading', label: 'Pass mark of a paper (%)', kind: 'int', min: 0, max: 100, fallback: 50 },
  overallPassPercent: { group: 'grading', label: 'Pass mark of the overall result (%)', kind: 'int', min: 0, max: 100, fallback: 50 },
  maxFailedSubjects: { group: 'grading', label: 'Most failed subjects allowed to pass overall', kind: 'int', min: 0, max: 30, fallback: 2 },
  absentCountsAsZero: { group: 'grading', label: 'An absent student’s paper counts as zero', kind: 'boolean', fallback: true, help: 'Off: the paper is left out of the student’s result and shown as Absent.' },
  // Policies
  markEntryDays: { group: 'policies', label: 'Days after a paper to submit its marks', kind: 'int', min: 0, max: 60, fallback: 7, branchable: true },
  publishedCorrectionDays: { group: 'policies', label: 'Days after publication that results can be corrected', kind: 'int', min: 0, max: 365, fallback: 30 },
  managersCreateExams: { group: 'policies', label: 'Managers may create examinations for their branch', kind: 'boolean', fallback: true, help: 'Off: only the School Owner creates examinations. Managers still see their branch’s.' },
  paperMinutes: { group: 'policies', label: 'Length of a paper unless set on the paper (minutes)', kind: 'int', min: 15, max: 480, fallback: 120 },
  // Timetable generation
  distributionMethod: { group: 'timetable', label: 'How students are spread across rooms', kind: 'choice', options: [{ value: 'alphabetical', label: 'Alphabetical' }, { value: 'random', label: 'Random' }], fallback: 'alphabetical', branchable: true },
  studentsPerInvigilator: { group: 'timetable', label: 'One invigilator per (students)', kind: 'int', min: 1, max: 200, fallback: 30, branchable: true },
  roomsPerInvigilator: { group: 'timetable', label: 'Rooms one invigilator may supervise in a session', kind: 'int', min: 1, max: 4, fallback: 1, branchable: true },
  avoidOwnSubject: { group: 'timetable', label: 'Teachers do not invigilate their own subject', kind: 'boolean', fallback: false, branchable: true },
  maxPapersPerDay: { group: 'timetable', label: 'Most papers a class sits in a day', kind: 'int', min: 1, max: 6, fallback: 2, branchable: true },
  // Notifications
  notifyTimetable: { group: 'notifications', label: 'Tell teachers when an examination timetable is published or changed', kind: 'boolean', fallback: true },
  notifyMarksDue: { group: 'notifications', label: 'Remind teachers of marks still to enter', kind: 'boolean', fallback: true },
  notifyResults: { group: 'notifications', label: 'Tell Managers and the School Owner when results wait for approval or are published', kind: 'boolean', fallback: true },
  // Report card
  reportShowAttendance: { group: 'reportCard', label: 'Show attendance on report cards', kind: 'boolean', fallback: true },
  reportShowRank: { group: 'reportCard', label: 'Show the student’s position in class', kind: 'boolean', fallback: false },
  // Analytics
  analyticsLevel: { group: 'analytics', label: 'Examination analytics', kind: 'choice', options: [{ value: 'basic', label: 'Basic' }, { value: 'advanced', label: 'Advanced' }], fallback: 'basic' },
};
export const EXAM_SETTING_KEYS = Object.keys(EXAM_SETTINGS);
export const BRANCHABLE_KEYS = EXAM_SETTING_KEYS.filter((k) => EXAM_SETTINGS[k].branchable);
export const PLATFORM_DEFAULTS = Object.fromEntries(EXAM_SETTING_KEYS.map((k) => [k, EXAM_SETTINGS[k].fallback]));

/** The value as stored for a key, or null when it is not a valid value (then the level above applies). */
export function validValue(key, value) {
  const s = EXAM_SETTINGS[key];
  if (!s || value === null || value === undefined) return null;
  if (s.kind === 'int') return Number.isInteger(value) && value >= s.min && value <= s.max ? value : null;
  if (s.kind === 'boolean') return typeof value === 'boolean' ? value : null;
  if (s.kind === 'choice') return s.options.some((o) => o.value === value) ? value : null;
  return null;
}

const storedOf = (row) => Object.fromEntries(EXAM_SETTING_KEYS.map((k) => [k, validValue(k, row?.values?.[k])]));

/** What applies, from the school row and (optional) branch row: { values, sources }. */
export function resolveExamSettings(schoolRow, branchRow) {
  const school = storedOf(schoolRow);
  const branch = storedOf(branchRow);
  const overridable = new Set((schoolRow?.branchOverridable ?? []).filter((k) => BRANCHABLE_KEYS.includes(k)));
  const values = {};
  const sources = {};
  for (const key of EXAM_SETTING_KEYS) {
    if (branchRow && overridable.has(key) && branch[key] !== null) [values[key], sources[key]] = [branch[key], 'branch'];
    else if (school[key] !== null) [values[key], sources[key]] = [school[key], 'school'];
    else [values[key], sources[key]] = [PLATFORM_DEFAULTS[key], 'platform'];
  }
  return { values, sources };
}

/** The settings that apply to a branch ({ id, schoolId }), or to the school when branch is null. */
export async function effectiveExamSettings(schoolId, branchId = null, client = getPrisma()) {
  const rows = await client.examSettings.findMany({ where: { schoolId, OR: [{ branchId: null }, ...(branchId ? [{ branchId }] : [])] } });
  return resolveExamSettings(rows.find((r) => !r.branchId) ?? null, branchId ? (rows.find((r) => r.branchId === branchId) ?? null) : null).values;
}

const fields = () =>
  EXAM_SETTING_KEYS.map((key) => {
    const { group, label, kind, min, max, options, fallback, help, branchable } = EXAM_SETTINGS[key];
    return { key, group, label, kind, ...(min !== undefined && { min, max }), ...(options && { options }), default: fallback, branchable: Boolean(branchable), ...(help && { help }) };
  });

/**
 * The settings screen. School Owner: the school's values and which settings branches may set.
 * Manager: the school's values (read only), the ones they may set, and their branch's values.
 * Both: what applies and where each value comes from.
 */
export async function getExamSettings(scope) {
  const prisma = getPrisma();
  const rows = await prisma.examSettings.findMany({ where: { schoolId: scope.school.id, OR: [{ branchId: null }, ...(scope.branch ? [{ branchId: scope.branch.id }] : [])] } });
  const schoolRow = rows.find((r) => !r.branchId) ?? null;
  const branchRow = scope.branch ? (rows.find((r) => r.branchId === scope.branch.id) ?? null) : null;
  const overridable = (schoolRow?.branchOverridable ?? []).filter((k) => BRANCHABLE_KEYS.includes(k));
  const school = resolveExamSettings(schoolRow, null);
  const result = {
    fields: fields(),
    school: { values: storedOf(schoolRow), effective: school.values, sources: school.sources, updatedAt: schoolRow?.updatedAt?.toISOString() ?? null, updatedBy: schoolRow?.updatedByName ?? null },
    branchOverridable: overridable,
    branch: null,
    canEdit: scope.branch ? overridable.length > 0 : true,
  };
  if (scope.branch) {
    const applied = resolveExamSettings(schoolRow, branchRow);
    const stored = storedOf(branchRow);
    result.branch = {
      id: scope.branch.id,
      name: scope.branch.name,
      values: Object.fromEntries(Object.entries(stored).map(([k, v]) => [k, overridable.includes(k) ? v : null])),
      effective: applied.values,
      sources: applied.sources,
      updatedAt: branchRow?.updatedAt?.toISOString() ?? null,
      updatedBy: branchRow?.updatedByName ?? null,
    };
  }
  return result;
}

const shown = (key, value) => {
  if (value === null || value === undefined) return 'Default';
  const s = EXAM_SETTINGS[key];
  if (s.kind === 'boolean') return value ? 'Yes' : 'No';
  if (s.kind === 'choice') return s.options.find((o) => o.value === value)?.label ?? String(value);
  return String(value);
};

/**
 * Changes settings: `values` { key: value | null (back to the level above) } and, School Owner only,
 * `branchOverridable` (keys Managers may set). Owner → the school row; Manager → their branch row,
 * only keys the school lets branches set (403 SETTING_LOCKED otherwise). One audit event with every
 * changed field; nothing changed → nothing recorded. Turning a key off for branches clears it there.
 */
export async function saveExamSettings(scope, { values, branchOverridable }, user, req) {
  const prisma = getPrisma();
  await prisma.$transaction(async (tx) => {
    await lockActiveSchool(tx, scope.school);
    if (scope.branch) await lockOperatingBranch(tx, scope, 'examination settings');
    const schoolRow = await tx.examSettings.findFirst({ where: { schoolId: scope.school.id, branchId: null } });
    const branchId = scope.branch?.id ?? null;
    const row = branchId ? await tx.examSettings.findUnique({ where: { branchId } }) : schoolRow;
    if (branchId) {
      const allowed = new Set(schoolRow?.branchOverridable ?? []);
      const locked = Object.keys(values).filter((k) => !allowed.has(k));
      if (locked.length) throw new HttpError(403, 'SETTING_LOCKED', 'Your School Owner sets these for every branch.', Object.fromEntries(locked.map((k) => [k, 'Set by your School Owner.'])));
      if (branchOverridable !== undefined) throw badRequest('Only the School Owner decides what branches may set.');
    }
    const before = row?.values ?? {};
    const next = { ...before };
    const changes = [];
    for (const [key, value] of Object.entries(values)) {
      const old = validValue(key, before[key]);
      if (old === value) continue;
      if (value === null) delete next[key];
      else next[key] = value;
      changes.push({ field: EXAM_SETTINGS[key].label, from: shown(key, old), to: shown(key, value) });
    }
    let overridable = row?.branchOverridable ?? [];
    if (!branchId && branchOverridable !== undefined) {
      const wanted = [...new Set(branchOverridable)].sort();
      const had = [...overridable].sort();
      if (JSON.stringify(wanted) !== JSON.stringify(had)) {
        changes.push({ field: 'Branches may set', from: had.map((k) => EXAM_SETTINGS[k].label).join('; ') || 'Nothing', to: wanted.map((k) => EXAM_SETTINGS[k].label).join('; ') || 'Nothing' });
        // Settings branches may no longer set: their branch values are cleared (branches follow the school again).
        const removed = had.filter((k) => !wanted.includes(k));
        if (removed.length) {
          const branchRows = await tx.examSettings.findMany({ where: { schoolId: scope.school.id, branchId: { not: null } } });
          for (const b of branchRows) {
            const kept = Object.fromEntries(Object.entries(b.values ?? {}).filter(([k]) => !removed.includes(k)));
            if (Object.keys(kept).length !== Object.keys(b.values ?? {}).length) await tx.examSettings.update({ where: { id: b.id }, data: { values: kept } });
          }
        }
        overridable = wanted;
      }
    }
    if (!changes.length) return;
    const data = { values: next, ...(branchId ? {} : { branchOverridable: overridable }), updatedById: user.id, updatedByName: user.name };
    if (row) await tx.examSettings.update({ where: { id: row.id }, data });
    else await tx.examSettings.create({ data: { schoolId: scope.school.id, branchId, ...data } });
    await recordAuditEvent({
      client: tx,
      action: AUDIT_ACTIONS.EXAM_SETTINGS_CHANGED,
      actor: { id: user.id, name: user.name, role: user.role },
      target: { type: branchId ? 'branch' : 'school', id: branchId ?? scope.school.id, name: branchId ? scope.branch.name : scope.school.name },
      schoolId: scope.school.id,
      description: `Examination settings changed${branchId ? ` for ${scope.branch.name}` : ' for the school'}.`,
      change: { fields: changes },
      req,
    });
  });
  return getExamSettings(scope);
}

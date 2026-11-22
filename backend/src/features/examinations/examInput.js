import { badRequest } from '../../common/httpError.js';
import { isUuid } from '../../common/validate.js';
import { nameKey, normalizeText } from '../branches/branchInput.js';
import { BRANCHABLE_KEYS, EXAM_SETTING_KEYS, EXAM_SETTINGS, validValue } from './examSettings.js';

/*
 * Request readers for the examination configuration (docs/business-rules.md → Examinations).
 * Each returns clean values or throws 400 VALIDATION_ERROR with a message per field.
 */

export { nameKey as examNameKey };

const fail = (details) => {
  if (Object.keys(details).length) throw badRequest('Check the highlighted fields.', details);
};
const refuseUnknown = (body, allowed) => {
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length) throw badRequest(`Unknown fields: ${unknown.join(', ')}.`);
};
const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

function readName(body, errors, { required, max = 60, field = 'name', label = 'Name' }) {
  if (body[field] === undefined) {
    if (required) errors[field] = `${label} is required.`;
    return undefined;
  }
  const value = typeof body[field] === 'string' ? normalizeText(body[field]) : '';
  if (value.length < 2 || value.length > max) errors[field] = `${label}: 2–${max} characters.`;
  return value;
}

function readInt(body, field, errors, { min, max, required = false, label }) {
  if (body[field] === undefined) {
    if (required) errors[field] = `${label} is required.`;
    return undefined;
  }
  const v = body[field];
  if (!Number.isInteger(v) || v < min || v > max) errors[field] = `${label}: a whole number from ${min} to ${max}.`;
  return v;
}

function readText(body, field, errors, { max = 300 } = {}) {
  if (body[field] === undefined) return undefined;
  if (body[field] === null || body[field] === '') return null;
  if (typeof body[field] !== 'string') {
    errors[field] = 'Must be text.';
    return undefined;
  }
  const v = body[field].trim();
  if (v.length > max) errors[field] = `At most ${max} characters.`;
  return v || null;
}

// ---- academic periods ------------------------------------------------------------------------

/** { academicYear (create), name, startDate, endDate }. */
export function readPeriod(body, { creating }) {
  refuseUnknown(body, ['academicYear', 'name', 'startDate', 'endDate']);
  const errors = {};
  if (creating && !isUuid(body.academicYear)) errors.academicYear = 'Choose the academic year.';
  if (!creating && body.academicYear !== undefined) errors.academicYear = 'A period stays in its academic year.';
  const name = readName(body, errors, { required: creating });
  for (const f of ['startDate', 'endDate']) {
    if (body[f] === undefined) {
      if (creating) errors[f] = 'Choose the date.';
    } else if (!isDay(body[f])) errors[f] = 'Use a date like 2026-09-01.';
  }
  if (isDay(body.startDate) && isDay(body.endDate) && body.endDate < body.startDate) errors.endDate = 'The end is before the start.';
  fail(errors);
  if (!creating && name === undefined && body.startDate === undefined && body.endDate === undefined) throw badRequest('Nothing to change.');
  return { academicYear: body.academicYear, name, startDate: body.startDate, endDate: body.endDate };
}

// ---- examination types ---------------------------------------------------------------------------

/** { name, description, defaultMaxMarks, stopsLessons, gradingScale (id | null) }. */
export function readExamType(body, { creating }) {
  refuseUnknown(body, ['name', 'description', 'defaultMaxMarks', 'stopsLessons', 'gradingScale']);
  const errors = {};
  const name = readName(body, errors, { required: creating });
  const description = readText(body, 'description', errors);
  const defaultMaxMarks = readInt(body, 'defaultMaxMarks', errors, { min: 1, max: 1000, required: creating, label: 'Marks out of' });
  if (body.stopsLessons !== undefined && typeof body.stopsLessons !== 'boolean') errors.stopsLessons = 'Must be true or false.';
  if (body.gradingScale !== undefined && body.gradingScale !== null && !isUuid(body.gradingScale)) errors.gradingScale = 'Choose a grading scale.';
  fail(errors);
  const values = { name, description, defaultMaxMarks, stopsLessons: body.stopsLessons, gradingScale: body.gradingScale };
  if (!creating && Object.values(values).every((v) => v === undefined)) throw badRequest('Nothing to change.');
  return values;
}

// ---- grading scales ----------------------------------------------------------------------------

const pct = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 && Math.abs(Math.round(v * 100) - v * 100) < 1e-6 ? Math.round(v * 100) / 100 : null);

/**
 * The bands of a scale, checked as a set: labels 1–10 characters and unique; percentages 0–100 with
 * at most two decimals; min ≤ max; sorted from the top they start at 100, end at 0, and each band
 * ends just below the next one starts (at most 1 percentage point apart, never overlapping), so every
 * percentage has exactly one grade. → { bands } or { error, details }.
 */
export function checkBands(raw) {
  const details = {};
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 20) return { error: 'A scale has 2 to 20 grades.' };
  const bands = raw.map((b, i) => {
    const at = (f) => `bands.${i}.${f}`;
    if (typeof b !== 'object' || b === null) {
      details[`bands.${i}`] = 'Each grade is an object.';
      return null;
    }
    const label = typeof b.label === 'string' ? b.label.trim() : '';
    if (!label || label.length > 10) details[at('label')] = 'Grade: 1–10 characters.';
    const minPercent = pct(b.minPercent);
    const maxPercent = pct(b.maxPercent);
    if (minPercent === null) details[at('minPercent')] = 'From: 0–100 (two decimals at most).';
    if (maxPercent === null) details[at('maxPercent')] = 'To: 0–100 (two decimals at most).';
    if (minPercent !== null && maxPercent !== null && minPercent > maxPercent) details[at('maxPercent')] = 'To is below From.';
    const points = b.points === undefined || b.points === null || b.points === '' ? null : pct(b.points);
    if (b.points !== undefined && b.points !== null && b.points !== '' && points === null) details[at('points')] = 'Points: 0–100.';
    if (typeof b.passes !== 'boolean') details[at('passes')] = 'Say whether this grade passes.';
    const remark = typeof b.remark === 'string' ? b.remark.trim().slice(0, 60) || null : null;
    return { index: i, label, minPercent, maxPercent, points, passes: b.passes, remark };
  });
  if (Object.keys(details).length) return { error: 'Check the grades.', details };
  const labels = new Set();
  for (const b of bands) {
    const k = b.label.toLowerCase();
    if (labels.has(k)) details[`bands.${b.index}.label`] = 'Each grade appears once.';
    labels.add(k);
  }
  const sorted = [...bands].sort((a, b) => b.minPercent - a.minPercent);
  if (sorted[0].maxPercent !== 100) details[`bands.${sorted[0].index}.maxPercent`] = 'The top grade goes up to 100.';
  if (sorted.at(-1).minPercent !== 0) details[`bands.${sorted.at(-1).index}.minPercent`] = 'The lowest grade starts at 0.';
  for (let i = 1; i < sorted.length; i += 1) {
    const upper = sorted[i - 1];
    const lower = sorted[i];
    if (lower.maxPercent >= upper.minPercent) details[`bands.${lower.index}.maxPercent`] = `Overlaps ${upper.label} (from ${upper.minPercent}).`;
    else if (upper.minPercent - lower.maxPercent > 1) details[`bands.${lower.index}.maxPercent`] = `Leaves a gap below ${upper.label} (from ${upper.minPercent}).`;
  }
  if (Object.keys(details).length) return { error: 'The grades must cover 0–100 once, without gaps or overlaps.', details };
  // A grading scale whose passing grades are not all above its failing ones is refused too.
  const lowestPass = Math.min(...sorted.filter((b) => b.passes).map((b) => b.minPercent));
  if (sorted.some((b) => !b.passes && b.minPercent > lowestPass)) return { error: 'Failing grades must all be below the passing ones.' };
  if (!sorted.some((b) => b.passes)) return { error: 'At least one grade passes.' };
  return { bands: sorted.map(({ index, ...b }) => b) };
}

/** { name, isDefault, bands }. */
export function readGradingScale(body, { creating }) {
  refuseUnknown(body, ['name', 'isDefault', 'bands']);
  const errors = {};
  const name = readName(body, errors, { required: creating });
  if (body.isDefault !== undefined && typeof body.isDefault !== 'boolean') errors.isDefault = 'Must be true or false.';
  let bands;
  if (body.bands !== undefined || creating) {
    const checked = checkBands(body.bands);
    if (checked.error) {
      Object.assign(errors, checked.details ?? {});
      errors.bands = checked.error;
    } else bands = checked.bands;
  }
  fail(errors);
  if (!creating && name === undefined && body.isDefault === undefined && bands === undefined) throw badRequest('Nothing to change.');
  return { name, isDefault: body.isDefault, bands };
}

/** The grade of a percentage on a scale's bands (sorted or not): the band with the highest minimum not above it. */
export function gradeOf(bands, percent) {
  return [...bands].sort((a, b) => Number(b.minPercent) - Number(a.minPercent)).find((b) => percent >= Number(b.minPercent)) ?? null;
}

// ---- result formula -------------------------------------------------------------------------------

const METHODS = ['WEIGHTED', 'AVERAGE', 'LAST'];

function readWeights(list, key, field, errors) {
  if (list === undefined) return [];
  if (!Array.isArray(list) || list.length > 30) {
    errors[field] = 'Send a list of weights.';
    return [];
  }
  const seen = new Set();
  const out = [];
  for (const [i, w] of list.entries()) {
    if (typeof w !== 'object' || w === null || !isUuid(w[key]) || !Number.isInteger(w.weight) || w.weight < 0 || w.weight > 100) {
      errors[`${field}.${i}`] = 'Each weight is a whole percentage (0–100).';
      continue;
    }
    if (seen.has(w[key])) errors[`${field}.${i}`] = 'Listed twice.';
    seen.add(w[key]);
    out.push({ [key]: w[key], weight: w.weight });
  }
  if (out.length && !Object.keys(errors).some((k) => k.startsWith(field)) && out.reduce((n, w) => n + w.weight, 0) !== 100) errors[field] = 'The weights add up to 100%.';
  return out;
}

/** { method, typeWeights: [{ examTypeId, weight }], periodWeights: [{ periodId, weight }] }. */
export function readFormula(body) {
  refuseUnknown(body, ['method', 'typeWeights', 'periodWeights']);
  const errors = {};
  if (!METHODS.includes(body.method)) errors.method = 'Choose how the final result is calculated.';
  const typeWeights = readWeights(body.typeWeights, 'examTypeId', 'typeWeights', errors);
  const periodWeights = readWeights(body.periodWeights, 'periodId', 'periodWeights', errors);
  if (body.method === 'WEIGHTED' && !typeWeights.length && !errors.typeWeights) errors.typeWeights = 'Give each examination type its weight.';
  fail(errors);
  return { method: body.method, typeWeights: body.method === 'WEIGHTED' ? typeWeights : [], periodWeights };
}

// ---- rooms --------------------------------------------------------------------------------------

/** { name, defaultCapacity, branch (School Owner, create) }. There is no location. */
export function readRoom(body, { creating, role }) {
  refuseUnknown(body, ['name', 'defaultCapacity', 'branch']);
  const errors = {};
  const name = readName(body, errors, { required: creating, max: 40, label: 'Room' });
  const defaultCapacity = readInt(body, 'defaultCapacity', errors, { min: 1, max: 500, required: creating, label: 'Default capacity' });
  if (body.branch !== undefined) {
    if (!creating) errors.branch = 'A room stays in its branch.';
    else if (role !== 'OWNER') errors.branch = 'Rooms are added to your branch.';
    else if (!isUuid(body.branch)) errors.branch = 'Choose the branch.';
  } else if (creating && role === 'OWNER') errors.branch = 'Choose the branch.';
  fail(errors);
  if (!creating && name === undefined && defaultCapacity === undefined) throw badRequest('Nothing to change.');
  return { name, defaultCapacity, branch: body.branch };
}

// ---- settings ---------------------------------------------------------------------------------

/** { values: { key: value | null }, branchOverridable? (School Owner) }. */
export function readExamSettingsChange(body, { role }) {
  refuseUnknown(body, ['values', 'branchOverridable']);
  const errors = {};
  const values = {};
  if (body.values !== undefined) {
    if (typeof body.values !== 'object' || body.values === null || Array.isArray(body.values)) errors.values = 'Send the settings to change.';
    else {
      for (const [key, value] of Object.entries(body.values)) {
        if (!EXAM_SETTING_KEYS.includes(key)) errors[key] = 'Unknown setting.';
        else if (value !== null && validValue(key, value) === null) {
          const s = EXAM_SETTINGS[key];
          errors[key] = s.kind === 'int' ? `A whole number from ${s.min} to ${s.max}.` : s.kind === 'boolean' ? 'Yes or no.' : 'Choose one of the options.';
        } else values[key] = value;
      }
    }
  }
  let branchOverridable;
  if (body.branchOverridable !== undefined) {
    if (role !== 'OWNER') errors.branchOverridable = 'Only the School Owner decides what branches may set.';
    else if (!Array.isArray(body.branchOverridable) || body.branchOverridable.some((k) => !BRANCHABLE_KEYS.includes(k))) errors.branchOverridable = 'Only some settings can be set per branch.';
    else branchOverridable = body.branchOverridable;
  }
  fail(errors);
  if (!Object.keys(values).length && branchOverridable === undefined) throw badRequest('Nothing to change.');
  return { values, branchOverridable };
}

/** List filters: academicYear (id or 'current'), status (active | inactive | all), branch (School Owner). */
export function readExamListQuery(query, { role }) {
  const one = (k) => (Array.isArray(query[k]) ? query[k][0] : query[k]);
  const errors = {};
  const academicYear = one('academicYear') || 'current';
  if (academicYear !== 'current' && !isUuid(academicYear)) errors.academicYear = 'Choose an academic year.';
  const status = one('status') || 'active';
  if (!['active', 'inactive', 'all'].includes(status)) errors.status = 'Choose active, inactive or all.';
  const branch = role === 'OWNER' ? one('branch') || null : null;
  if (branch && !isUuid(branch)) errors.branch = 'Choose a branch.';
  fail(errors);
  return { academicYear, status, branch };
}

// ---- examinations -----------------------------------------------------------------------------

export const EXAM_NAME_MAX = 80;
export const EXAM_STATES = ['draft', 'planned', 'active', 'completed', 'cancelled'];
const MAX_CLASSES = 100;

function readIdList(body, field, errors, label) {
  if (body[field] === undefined) return undefined;
  if (!Array.isArray(body[field]) || body[field].length > MAX_CLASSES || body[field].some((v) => !isUuid(v))) {
    errors[field] = `Choose the ${label}.`;
    return undefined;
  }
  return [...new Set(body[field])];
}

/**
 * { academicYear (create: id or 'current'), name (optional: from the type and period), description,
 *   examType, period (id | null), branch (School Owner: id, or null for every branch), startDate,
 *   endDate, stopsLessons (default: the type's), classes: [classId] }.
 */
export function readExamination(body, { creating, role }) {
  refuseUnknown(body, ['academicYear', 'name', 'description', 'examType', 'period', 'branch', 'startDate', 'endDate', 'stopsLessons', 'classes']);
  const errors = {};
  if (creating) {
    if (body.academicYear !== undefined && body.academicYear !== 'current' && !isUuid(body.academicYear)) errors.academicYear = 'Choose the academic year.';
  } else if (body.academicYear !== undefined) errors.academicYear = 'An examination stays in its academic year.';
  const name = body.name === null || body.name === '' ? (creating ? undefined : (errors.name = 'Name is required.', undefined)) : readName(body, errors, { required: false, max: EXAM_NAME_MAX });
  const description = readText(body, 'description', errors, { max: 300 });
  if (body.examType !== undefined ? !isUuid(body.examType) : creating) errors.examType = 'Choose the examination type.';
  if (body.period !== undefined && body.period !== null && !isUuid(body.period)) errors.period = 'Choose the period, or none.';
  if (body.branch !== undefined) {
    if (role !== 'OWNER') errors.branch = 'Your examinations are for your branch.';
    else if (body.branch !== null && !isUuid(body.branch)) errors.branch = 'Choose a branch, or every branch.';
  }
  for (const f of ['startDate', 'endDate']) {
    if (body[f] === undefined) {
      if (creating) errors[f] = 'Choose the date.';
    } else if (!isDay(body[f])) errors[f] = 'Use a date like 2026-11-24.';
  }
  if (isDay(body.startDate) && isDay(body.endDate) && body.endDate < body.startDate) errors.endDate = 'The last day is before the first day.';
  if (body.stopsLessons !== undefined && typeof body.stopsLessons !== 'boolean') errors.stopsLessons = 'Yes or no.';
  const classes = readIdList(body, 'classes', errors, 'classes sitting it');
  fail(errors);
  const values = {
    academicYear: creating ? (body.academicYear ?? 'current') : undefined,
    name,
    description,
    examType: body.examType,
    period: body.period,
    branch: body.branch,
    startDate: body.startDate,
    endDate: body.endDate,
    stopsLessons: body.stopsLessons,
    classes,
  };
  if (!creating && Object.values(values).every((v) => v === undefined)) throw badRequest('Nothing to change.');
  return values;
}

/** Papers: { class, subject, maxMarks?, durationMinutes? } to add; { maxMarks?, durationMinutes? } to change. */
export function readPaper(body, { creating }) {
  refuseUnknown(body, creating ? ['class', 'subject', 'maxMarks', 'durationMinutes'] : ['maxMarks', 'durationMinutes']);
  const errors = {};
  if (creating && !isUuid(body.class)) errors.class = 'Choose the class.';
  if (creating && !isUuid(body.subject)) errors.subject = 'Choose the subject.';
  const maxMarks = readInt(body, 'maxMarks', errors, { min: 1, max: 1000, label: 'Marks out of' });
  const durationMinutes = readInt(body, 'durationMinutes', errors, { min: 15, max: 480, label: 'Length (minutes)' });
  fail(errors);
  if (!creating && maxMarks === undefined && durationMinutes === undefined) throw badRequest('Nothing to change.');
  return { class: body.class, subject: body.subject, maxMarks, durationMinutes };
}

/** { reason? } when cancelling or ending early. */
export function readCancel(body) {
  refuseUnknown(body, ['reason']);
  const errors = {};
  const reason = readText(body, 'reason', errors, { max: 300 });
  fail(errors);
  return { reason: reason ?? null };
}

/** Examinations list: academicYear, period, scope (all | school | branch), branch (School Owner), state, q. */
export function readExaminationsQuery(query, { role }) {
  const one = (k) => (Array.isArray(query[k]) ? query[k][0] : query[k]);
  const errors = {};
  const academicYear = one('academicYear') || 'current';
  if (academicYear !== 'current' && !isUuid(academicYear)) errors.academicYear = 'Choose an academic year.';
  const period = one('period') || null;
  if (period && !isUuid(period)) errors.period = 'Choose a period.';
  const scope = one('scope') || 'all';
  if (!['all', 'school', 'branch'].includes(scope)) errors.scope = 'Choose all, school-wide or branch.';
  const branch = role === 'OWNER' ? one('branch') || null : null;
  if (branch && !isUuid(branch)) errors.branch = 'Choose a branch.';
  const state = one('state') || 'all';
  if (state !== 'all' && !EXAM_STATES.includes(state)) errors.state = 'Choose a status.';
  const q = typeof one('q') === 'string' ? one('q').trim().slice(0, EXAM_NAME_MAX) : '';
  fail(errors);
  return { academicYear, period, scope, branch, state, q };
}

// ---- timetable ----------------------------------------------------------------------------------

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutesOf = (v) => {
  const m = HHMM.exec(v);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Generating a branch's timetable: { shifts: [{ name, start 'HH:MM', sessions 1–4 }] (1–4, in order),
 * gapMinutes 0–180, rooms: [{ room, capacity? }] (1–100), useAllRooms, excludedStaff: [userId],
 * distribution ('alphabetical' | 'random'), maxPapersPerDay (1–6) }. Unset: the settings.
 */
export function readTimetableGenerate(body) {
  refuseUnknown(body, ['shifts', 'gapMinutes', 'rooms', 'useAllRooms', 'excludedStaff', 'distribution', 'maxPapersPerDay']);
  const errors = {};
  let shifts = [];
  if (!Array.isArray(body.shifts) || body.shifts.length < 1 || body.shifts.length > 4) errors.shifts = 'Give 1–4 shifts.';
  else {
    shifts = body.shifts.map((s) => ({ name: typeof s?.name === 'string' ? normalizeText(s.name) : '', start: minutesOf(s?.start), sessions: s?.sessions }));
    if (shifts.some((s) => s.name.length < 1 || s.name.length > 30)) errors.shifts = 'Each shift needs a name (at most 30 characters).';
    else if (shifts.some((s) => s.start === null)) errors.shifts = 'Each shift needs a start time like 08:00.';
    else if (shifts.some((s) => !Number.isInteger(s.sessions) || s.sessions < 1 || s.sessions > 4)) errors.shifts = 'Each shift holds 1–4 sessions.';
    else if (shifts.some((s, i) => i && s.start <= shifts[i - 1].start)) errors.shifts = 'List the shifts in order of their start times.';
    else if (new Set(shifts.map((s) => s.name.toLowerCase())).size !== shifts.length) errors.shifts = 'Give each shift its own name.';
  }
  const gapMinutes = body.gapMinutes === undefined ? 30 : body.gapMinutes;
  if (!Number.isInteger(gapMinutes) || gapMinutes < 0 || gapMinutes > 180) errors.gapMinutes = 'A whole number of minutes from 0 to 180.';
  let rooms = [];
  if (!Array.isArray(body.rooms) || !body.rooms.length || body.rooms.length > 100) errors.rooms = 'Choose the rooms to use.';
  else {
    rooms = body.rooms.map((r) => ({ roomId: r?.room, capacity: r?.capacity ?? null }));
    if (rooms.some((r) => !isUuid(r.roomId))) errors.rooms = 'Choose your rooms.';
    else if (new Set(rooms.map((r) => r.roomId)).size !== rooms.length) errors.rooms = 'Each room once.';
    else if (rooms.some((r) => r.capacity !== null && (!Number.isInteger(r.capacity) || r.capacity < 1 || r.capacity > 500))) errors.rooms = 'Seats: a whole number from 1 to 500.';
  }
  if (body.useAllRooms !== undefined && typeof body.useAllRooms !== 'boolean') errors.useAllRooms = 'Yes or no.';
  const excludedStaff = body.excludedStaff ?? [];
  if (!Array.isArray(excludedStaff) || excludedStaff.length > 500 || excludedStaff.some((v) => !isUuid(v))) errors.excludedStaff = 'Choose staff members.';
  if (body.distribution !== undefined && !['alphabetical', 'random'].includes(body.distribution)) errors.distribution = 'Alphabetical or random.';
  if (body.maxPapersPerDay !== undefined && (!Number.isInteger(body.maxPapersPerDay) || body.maxPapersPerDay < 1 || body.maxPapersPerDay > 6)) errors.maxPapersPerDay = 'A whole number from 1 to 6.';
  fail(errors);
  return { shifts, gapMinutes, rooms, useAllRooms: body.useAllRooms ?? false, excludedStaff: [...new Set(excludedStaff)], distribution: body.distribution, maxPapersPerDay: body.maxPapersPerDay };
}

/** Moving a paper: { session } (an existing session of the timetable) or { date, start 'HH:MM' } (a new one). */
export function readSittingMove(body) {
  refuseUnknown(body, ['session', 'date', 'start']);
  const errors = {};
  if (body.session !== undefined) {
    if (!isUuid(body.session)) errors.session = 'Choose a session.';
    if (body.date !== undefined || body.start !== undefined) errors.session = 'Choose a session, or a new date and time.';
  } else {
    if (!isDay(body.date)) errors.date = 'Use a date like 2026-12-01.';
    if (minutesOf(body.start) === null) errors.start = 'Use a time like 08:00.';
  }
  fail(errors);
  return body.session ? { session: body.session } : { date: body.date, start: minutesOf(body.start) };
}

/** A room's invigilators in a session: { room, staff: [userId] } (0–10). */
export function readInvigilators(body) {
  refuseUnknown(body, ['room', 'staff']);
  const errors = {};
  if (!isUuid(body.room)) errors.room = 'Choose the room.';
  if (!Array.isArray(body.staff) || body.staff.length > 10 || body.staff.some((v) => !isUuid(v))) errors.staff = 'Choose up to 10 staff members.';
  else if (new Set(body.staff).size !== body.staff.length) errors.staff = 'Each person once.';
  fail(errors);
  return { room: body.room, staff: body.staff };
}

/** The branch of a timetable (School Owner; a branch examination's own branch when omitted); a Manager's is theirs. */
export function readTimetableBranch(query, { role }) {
  if (role !== 'OWNER') return null;
  const branch = Array.isArray(query.branch) ? query.branch[0] : query.branch;
  if (branch === undefined || branch === '') return null;
  if (!isUuid(branch)) throw badRequest('Choose the branch.', { branch: 'Choose the branch.' });
  return branch;
}

/** Invigilator matrix filters: ?shift (name), ?session (1-20, place in the day), ?from / ?to (dates), ?format (pdf | xlsx). */
export function readInvigilatorFilters(query, { exporting = false } = {}) {
  const one = (k) => (Array.isArray(query[k]) ? query[k][0] : query[k]);
  const errors = {};
  const shift = typeof one('shift') === 'string' && one('shift').trim() ? one('shift').trim().slice(0, 60) : null;
  let session = null;
  if (one('session') !== undefined && one('session') !== '') {
    session = Number(one('session'));
    if (!Number.isInteger(session) || session < 1 || session > 20) errors.session = 'A session number from 1 to 20.';
  }
  const day = (k) => {
    const v = one(k);
    if (v === undefined || v === '') return null;
    if (!isDay(v)) errors[k] = 'Use a date like 2026-11-24.';
    return v;
  };
  const from = day('from');
  const to = day('to');
  if (from && to && isDay(from) && isDay(to) && to < from) errors.to = 'The last day is before the first day.';
  let format = null;
  if (exporting) {
    format = one('format') ?? 'pdf';
    if (!['pdf', 'xlsx'].includes(format)) errors.format = 'PDF or Excel (xlsx).';
  }
  fail(errors);
  return { shift, session, from, to, ...(exporting && { format }) };
}

// ---- attendance -----------------------------------------------------------------------------------

const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'];

/** { session? (teacher), room?, marks: [{ student, status, note? }] (1–500) }. */
export function readExamAttendance(body, { teacher = false } = {}) {
  refuseUnknown(body, teacher ? ['session', 'room', 'marks'] : ['room', 'marks']);
  const errors = {};
  if (teacher && !isUuid(body.session)) errors.session = 'Choose the session.';
  if ((teacher || body.room !== undefined) && !isUuid(body.room)) errors.room = 'Choose the room.';
  let marks = [];
  if (!Array.isArray(body.marks) || !body.marks.length || body.marks.length > 500) errors.marks = 'Send the students’ attendance.';
  else {
    marks = body.marks.map((m) => ({ studentId: m?.student, status: m?.status, note: typeof m?.note === 'string' ? m.note.trim().slice(0, 200) || null : null }));
    if (marks.some((m) => !isUuid(m.studentId))) errors.marks = 'Choose the students.';
    else if (marks.some((m) => !ATTENDANCE_STATUSES.includes(m.status))) errors.marks = 'Each student is present, absent, late or excused.';
    else if (new Set(marks.map((m) => m.studentId)).size !== marks.length) errors.marks = 'Each student once.';
  }
  fail(errors);
  return { session: body.session, room: body.room ?? null, marks };
}

// ---- marks ----------------------------------------------------------------------------------------

/** { marks: [{ student, marks (0 up, two decimals at most, or null), absent? }] } (1–500). */
export function readMarkEntries(body) {
  refuseUnknown(body, ['marks']);
  const errors = {};
  let marks = [];
  if (!Array.isArray(body.marks) || !body.marks.length || body.marks.length > 500) errors.marks = 'Send the students’ marks.';
  else {
    marks = body.marks.map((m) => ({ studentId: m?.student, marks: m?.marks ?? null, absent: m?.absent ?? false }));
    const decimals = (v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
    if (marks.some((m) => !isUuid(m.studentId))) errors.marks = 'Choose the students.';
    else if (marks.some((m) => m.marks !== null && (typeof m.marks !== 'number' || !Number.isFinite(m.marks) || m.marks < 0 || m.marks > 1000 || !decimals(m.marks)))) errors.marks = 'Marks are numbers from 0, with two decimals at most.';
    else if (marks.some((m) => typeof m.absent !== 'boolean')) errors.marks = 'Absent is yes or no.';
    else if (new Set(marks.map((m) => m.studentId)).size !== marks.length) errors.marks = 'Each student once.';
  }
  fail(errors);
  return marks;
}

/** { reason } (3–300 characters) when returning marks. */
export function readReturnReason(body) {
  refuseUnknown(body, ['reason']);
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 3 || reason.length > 300) throw badRequest('Check the highlighted fields.', { reason: 'Say why (3–300 characters).' });
  return { reason };
}

/** Mark sheets list: branch (School Owner), class, subject, status. */
export function readMarkSheetsQuery(query, { role }) {
  const one = (k) => (Array.isArray(query[k]) ? query[k][0] : query[k]) || null;
  const errors = {};
  const branch = role === 'OWNER' ? one('branch') : null;
  for (const [k, v] of [['branch', branch], ['class', one('class')], ['subject', one('subject')]]) if (v && !isUuid(v)) errors[k] = 'Choose one.';
  const status = one('status') ?? 'all';
  if (!['all', 'draft', 'submitted', 'approved', 'returned'].includes(status)) errors.status = 'Choose a status.';
  fail(errors);
  return { branch, classId: one('class'), subjectId: one('subject'), status };
}

// ---- results ----------------------------------------------------------------------------------------

/** Final results: academicYear (id or 'current'), section. */
export function readFinalResultsQuery(query) {
  const one = (k) => (Array.isArray(query[k]) ? query[k][0] : query[k]) || null;
  const errors = {};
  const academicYear = one('academicYear') ?? 'current';
  if (academicYear !== 'current' && !isUuid(academicYear)) errors.academicYear = 'Choose an academic year.';
  if (!isUuid(one('section'))) errors.section = 'Choose a class.';
  fail(errors);
  return { academicYear, section: one('section') };
}

/** Handing final results to Promotion: { academicYear, section, overwrite? }. */
export function readHandOver(body) {
  refuseUnknown(body, ['academicYear', 'section', 'overwrite']);
  const errors = {};
  const academicYear = body.academicYear ?? 'current';
  if (academicYear !== 'current' && !isUuid(academicYear)) errors.academicYear = 'Choose an academic year.';
  if (!isUuid(body.section)) errors.section = 'Choose a class.';
  if (body.overwrite !== undefined && typeof body.overwrite !== 'boolean') errors.overwrite = 'Yes or no.';
  fail(errors);
  return { academicYear, section: body.section, overwrite: body.overwrite ?? false };
}

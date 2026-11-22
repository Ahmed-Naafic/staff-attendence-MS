/*
 * Examination rules in the Staff app (docs/business-rules.md → Examinations → Attendance; Marks).
 * The server checks everything again; these give immediate feedback and decide what to show.
 */

export const EXAM_STATUSES = ['present', 'late', 'absent', 'excused'];
export const EXAM_STATUS_LABELS = { present: 'Present', late: 'Late', absent: 'Absent', excused: 'Excused' };
export const EXAM_STATUS_TONES = { present: 'success', late: 'warning', absent: 'error', excused: 'info' };
export const SHEET_LABELS = { draft: 'In progress', submitted: 'Submitted', approved: 'Approved', returned: 'Returned' };
export const SHEET_TONES = { draft: 'neutral', submitted: 'info', approved: 'success', returned: 'warning' };

/** Attendance changes to send: [{ student, status }] for seats whose shown status differs. */
export function attendanceChanges(seats, draft) {
  return seats.filter((s) => draft[s.student.id] && draft[s.student.id] !== s.attendance).map((s) => ({ student: s.student.id, status: draft[s.student.id] }));
}

/** Every seat not yet marked (nor in the draft) becomes present. */
export function restPresent(seats, draft) {
  const next = { ...draft };
  for (const s of seats) if (!s.attendance && !next[s.student.id]) next[s.student.id] = 'present';
  return next;
}

/** "3 present · 1 absent · 2 not taken" from seats and the draft. */
export function attendanceCount(seats, draft) {
  const shown = seats.map((s) => draft[s.student.id] ?? s.attendance);
  const parts = EXAM_STATUSES.map((k) => [k, shown.filter((v) => v === k).length]).filter(([, n]) => n).map(([k, n]) => `${n} ${EXAM_STATUS_LABELS[k].toLowerCase()}`);
  const open = shown.filter((v) => !v).length;
  if (open) parts.push(`${open} not taken`);
  return parts.join(' · ') || 'No students';
}

/** A typed mark: { value } (null when empty) or { error }. */
export function parseMark(text, max) {
  const t = String(text ?? '').trim();
  if (!t) return { value: null };
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) return { error: 'A number from 0' };
  if (n > max) return { error: `At most ${max}` };
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return { error: 'Two decimals at most' };
  return { value: n };
}

/** Marks to send from what was typed: { entries: [{ student, marks, absent }], errors: { studentId: message } }. */
export function markChanges(students, typed, absent, max) {
  const entries = [];
  const errors = {};
  for (const s of students) {
    if (s.lockedByAttendance) continue;
    const id = s.student.id;
    if (typed[id] === undefined && absent[id] === undefined) continue;
    const isAbsent = absent[id] ?? s.absent;
    const parsed = typed[id] !== undefined ? parseMark(typed[id], max) : { value: s.marks };
    if (parsed.error && !isAbsent) {
      errors[id] = parsed.error;
      continue;
    }
    const marks = isAbsent ? null : parsed.value;
    if (marks !== s.marks || isAbsent !== s.absent) entries.push({ student: id, marks, absent: isAbsent });
  }
  return { entries, errors };
}

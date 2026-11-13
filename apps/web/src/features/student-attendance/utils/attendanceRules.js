/*
 * Student attendance screen rules (the server decides; these keep the screens consistent and
 * catch mistakes before sending).
 */

export const STATUS_OPTIONS = [
  { value: 'present', label: 'Present', short: 'P' },
  { value: 'absent', label: 'Absent', short: 'A' },
  { value: 'late', label: 'Late', short: 'L' },
  { value: 'excused', label: 'Excused', short: 'E' },
];
export const EFFECTIVE_LABELS = { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused', not_marked: 'Not marked', pending: 'Not marked yet' };
export const EFFECTIVE_VARIANTS = { present: 'success', absent: 'error', late: 'warning', excused: 'info', not_marked: 'neutral', pending: 'neutral' };

export const STATE_LABELS = { upcoming: 'Not open yet', open: 'Open', overdue: 'Past due', locked: 'Closed', suspended: 'Branch suspended' };
export const HALF_OPTIONS = [
  { value: '', label: 'Whole day' },
  { value: 'before_break', label: 'Before the break' },
  { value: 'after_break', label: 'After the break' },
];

/** Badge for a session cell of the day overview. */
export function sessionBadge(half) {
  const { state, session } = half;
  if (state === 'suspended') return { variant: 'neutral', label: STATE_LABELS.suspended };
  if (session?.complete) return { variant: 'success', label: 'Complete' };
  if (session) return { variant: state === 'open' ? 'info' : 'warning', label: `${session.counts.notMarked} not marked` };
  if (state === 'upcoming') return { variant: 'neutral', label: STATE_LABELS.upcoming };
  if (state === 'open') return { variant: 'info', label: 'Not taken yet' };
  if (state === 'overdue') return { variant: 'warning', label: 'Missing' };
  return { variant: 'error', label: 'Missed' };
}

/** `draft`: { studentId: { status, reason, note } } over `students` (from the server). The marks to send: only real changes. */
export function changedMarks(students, draft) {
  const marks = [];
  for (const s of students) {
    const d = draft[s.student.id];
    if (!d?.status) continue;
    const reason = (d.reason ?? '').trim();
    const note = (d.note ?? '').trim();
    const same = d.status === s.status && reason === (s.reason ?? '') && note === (s.note ?? '');
    if (same) continue;
    marks.push({ student: s.student.id, status: d.status, ...(reason && { reason }), ...(note && { note }), version: s.version });
  }
  return marks;
}

/** Problems before sending: { studentId: message }. Excused needs a reason; so does changing a mark after it was due when required. */
export function markProblems(students, draft, { reasonRequiredForChanges }) {
  const problems = {};
  for (const s of students) {
    const d = draft[s.student.id];
    if (!d?.status) continue;
    const reason = (d.reason ?? '').trim();
    if (d.status === 'excused' && !reason) problems[s.student.id] = 'Give the reason for the excuse.';
    else if (reasonRequiredForChanges && s.status && d.status !== s.status && !reason) problems[s.student.id] = 'Give the reason for changing this mark.';
  }
  return problems;
}

/** Whether a row needs a reason field shown. */
export const needsReason = (s, d, { reasonRequiredForChanges }) => d?.status === 'excused' || (reasonRequiredForChanges && Boolean(s.status) && Boolean(d?.status) && d.status !== s.status);

/** The draft for students without a mark yet, all set to `status` (marked ones keep theirs). */
export function markRemaining(students, draft, status) {
  const next = { ...draft };
  for (const s of students) if (!s.status && !next[s.student.id]?.status) next[s.student.id] = { ...next[s.student.id], status };
  return next;
}

/** The starting draft: each student's saved mark. */
export const draftFrom = (students) => Object.fromEntries(students.map((s) => [s.student.id, { status: s.status, reason: s.reason ?? '', note: s.note ?? '' }]));

/** "12 present · 1 absent · 2 not marked" */
export function countsText(counts) {
  const parts = [];
  for (const [key, label] of [['present', 'present'], ['late', 'late'], ['absent', 'absent'], ['excused', 'excused'], ['notMarked', 'not marked']]) if (counts[key]) parts.push(`${counts[key]} ${label}`);
  return parts.join(' · ') || 'No students';
}

/** Settings form: values that differ from what is stored at this level → the request body. */
export function settingsChanges(stored, form) {
  const body = {};
  for (const [key, value] of Object.entries(form)) if ((stored[key] ?? null) !== (value ?? null)) body[key] = value ?? null;
  return body;
}

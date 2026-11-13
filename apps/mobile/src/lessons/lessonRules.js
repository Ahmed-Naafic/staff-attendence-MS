/*
 * Lesson screen rules. The server decides; these keep the screens right while offline (the phone's
 * clock against the lesson's times) and show marks waiting on the phone over the server's list.
 */

export const STATUS_LABELS = { present: 'Present', absent: 'Absent', late: 'Late', excused: 'Excused', not_marked: 'Not marked', pending: 'Not marked yet' };
export const STATUS_TONES = { present: 'success', absent: 'error', late: 'warning', excused: 'info', not_marked: 'neutral', pending: 'neutral' };

/** 'upcoming' | 'open' | 'closed', from the lesson's opening and deadline and the phone's clock. */
export function lessonState(lesson, now = new Date()) {
  if (lesson.opensAt && now < new Date(lesson.opensAt)) return 'upcoming';
  if (now <= new Date(lesson.deadlineAt)) return 'open';
  return 'closed';
}

export const STATE_LABELS = { upcoming: 'Not open yet', open: 'Open', closed: 'Closed' };

/**
 * The class list as the teacher should see it: each student's server status, replaced by the latest
 * mark still waiting on the phone (`pending`, oldest first) and flagged `waiting`; refused marks
 * (`refused`) are reported per student.
 */
export function withPhoneMarks(students, outstanding) {
  const latest = new Map();
  const refused = new Map();
  for (const m of outstanding) {
    if (m.state === 'pending') latest.set(m.studentId, m);
    else refused.set(m.studentId, m);
  }
  return students.map((s) => {
    const waiting = latest.get(s.id);
    const problem = refused.get(s.id);
    return { ...s, status: waiting ? waiting.status : s.status, waiting: Boolean(waiting), refused: problem ? problem.errorMessage : null };
  });
}

/** The marks to store: students whose draft differs from what they show now. */
export function changedMarks(students, draft) {
  return students.filter((s) => draft[s.id] && draft[s.id] !== s.status && !s.setByManager).map((s) => ({ studentId: s.id, status: draft[s.id] }));
}

/** Every not-yet-marked student (and not set by a Manager) as present; others keep their draft. */
export function allPresent(students, draft) {
  const next = { ...draft };
  for (const s of students) if (!s.setByManager && !next[s.id] && !s.status) next[s.id] = 'present';
  return next;
}

/** "18 present · 2 absent · 3 not marked" for a class list. */
export function countText(students, draft = {}) {
  let present = 0;
  let absent = 0;
  let other = 0;
  let open = 0;
  for (const s of students) {
    const status = draft[s.id] ?? s.status;
    if (status === 'present') present += 1;
    else if (status === 'absent') absent += 1;
    else if (status) other += 1;
    else open += 1;
  }
  return [present && `${present} present`, absent && `${absent} absent`, other && `${other} other`, open && `${open} not marked`].filter(Boolean).join(' · ') || 'No students';
}

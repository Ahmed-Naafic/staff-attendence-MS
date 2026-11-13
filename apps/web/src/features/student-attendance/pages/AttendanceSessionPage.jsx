import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { History, UserPlus } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Alert, Badge, Button, Card, Drawer, Input, LinkButton, LoadingState } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { cn } from '../../../lib/cn.js';
import { formatDateTime, formatFullDay } from '../../../lib/format.js';
import { useSession } from '../../auth';
import { LoadFailure } from '../components/FeatureState.jsx';
import { loadAttendanceSession, loadSessionHistory, refreshClassList, saveAttendanceMarks } from '../data/studentAttendanceApi.js';
import { changedMarks, countsText, draftFrom, EFFECTIVE_LABELS, EFFECTIVE_VARIANTS, markProblems, markRemaining, needsReason, STATE_LABELS, STATUS_OPTIONS } from '../utils/attendanceRules.js';

const TONES = {
  present: 'border-success bg-success-soft text-success-fg',
  absent: 'border-error bg-error-soft text-error-fg',
  late: 'border-warning bg-warning-soft text-warning-fg',
  excused: 'border-info bg-info-soft text-info-fg',
};

/** One session: the class list fixed when it opened, each student's mark, and (Managers) marking. */
export default function AttendanceSessionPage() {
  const { sessionId } = useParams();
  const { user } = useSession();
  const owner = user.role === 'OWNER';
  const role = owner ? 'OWNER' : 'MANAGER';
  const loaded = useApiData(() => loadAttendanceSession(role, sessionId), `session|${role}|${sessionId}`);
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState({});
  const [problems, setProblems] = useState({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (!loaded.data) return;
    setData(loaded.data);
    setDraft(draftFrom(loaded.data.students));
    setProblems({});
  }, [loaded.data]);

  const pending = useMemo(() => (data ? changedMarks(data.students, draft) : []), [data, draft]);
  const unmarked = data ? data.students.filter((s) => !draft[s.student.id]?.status).length : 0;

  if (!data) {
    return (
      <PageContainer>
        <PageHeader title="Student Attendance" breadcrumbs={[{ label: 'Student Attendance', to: '/student-attendance' }, { label: 'Session' }]} />
        {loaded.status === 'error' ? <LoadFailure error={loaded.error} onRetry={loaded.retry} owner={owner} what="Attendance session" /> : <LoadingState />}
      </PageContainer>
    );
  }

  const { session, section, students, counts, canMark } = data;
  const edit = (studentId, patch) => {
    setDraft((d) => ({ ...d, [studentId]: { ...d[studentId], ...patch } }));
    setProblems(({ [studentId]: _gone, ...rest }) => rest);
  };
  const apply = (next, text) => {
    setData(next);
    setDraft(draftFrom(next.students));
    setProblems({});
    setMessage(text ? { variant: 'success', text } : null);
  };

  async function save() {
    const found = markProblems(students, draft, data);
    setProblems(found);
    if (Object.keys(found).length) return setMessage({ variant: 'error', text: 'Some marks need a reason.' });
    if (!pending.length) return;
    setSaving(true);
    setMessage(null);
    try {
      apply(await saveAttendanceMarks(session.id, pending), `${pending.length} mark${pending.length === 1 ? '' : 's'} saved.`);
    } catch (error) {
      if (error.code === 'STALE_MARKS') {
        setMessage({ variant: 'warning', text: error.message });
      } else if (error.details) {
        const byStudent = {};
        for (const [key, text] of Object.entries(error.details)) {
          const index = Number(key.split('.')[1]);
          if (pending[index]) byStudent[pending[index].student] = text;
        }
        setProblems(byStudent);
        setMessage({ variant: 'error', text: error.message });
      } else setMessage({ variant: 'error', text: error.message || 'The marks could not be saved. Try again.' });
    } finally {
      setSaving(false);
    }
  }

  async function reload() {
    loaded.retry();
  }

  async function addNewStudents() {
    setSaving(true);
    try {
      const result = await refreshClassList(session.id);
      apply(result, result.added ? `${result.added} newly enrolled student${result.added === 1 ? '' : 's'} added.` : 'No newly enrolled students.');
    } catch (error) {
      setMessage({ variant: 'error', text: error.message || 'The class list could not be updated.' });
    } finally {
      setSaving(false);
    }
  }

  const timeText = session.start ? `${session.start}–${session.end}` : 'No bell times';
  return (
    <PageContainer>
      <PageHeader
        title={`${section.displayName}: ${session.kind === 'lesson' ? session.label : session.label.toLowerCase()}`}
        description={`${formatFullDay(session.date)} · ${timeText}${owner ? ` · ${section.branch.name}` : ''}`}
        breadcrumbs={[{ label: 'Student Attendance', to: `/student-attendance?date=${session.date}` }, { label: section.displayName }]}
        secondaryActions={
          <Button variant="outline" leftIcon={History} onClick={() => setHistoryOpen(true)}>
            History
          </Button>
        }
        primaryAction={<LinkButton to={`/student-attendance?date=${session.date}`} variant="outline">Back to the day</LinkButton>}
      />

      <Card className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4">
        <Badge variant={session.state === 'open' ? 'info' : session.state === 'overdue' ? 'warning' : 'neutral'}>{STATE_LABELS[session.state]}</Badge>
        <span className="text-body-sm text-fg-secondary">Due {formatDateTime(session.deadlineAt)}</span>
        {session.state === 'overdue' && <span className="text-body-sm text-fg-secondary">Late entries and corrections until {formatDateTime(session.editableUntil)}</span>}
        <span className="text-body-sm font-medium">{countsText(counts)}</span>
      </Card>

      {!canMark && (
        <Alert variant="info">
          {owner ? 'Managers take attendance for their branch; you can view it here.' : session.state === 'locked' ? 'The correction period for this day is over: the attendance is kept as it is.' : 'This attendance cannot be changed now.'}
        </Alert>
      )}
      {data.reasonRequiredForChanges && canMark && <Alert variant="info">This attendance is past due: changing a mark needs a reason.</Alert>}
      {message && (
        <Alert
          variant={message.variant}
          onDismiss={() => setMessage(null)}
          action={
            message.variant === 'warning' ? (
              <Button size="sm" variant="outline" onClick={reload}>
                Reload
              </Button>
            ) : undefined
          }
        >
          {message.text}
        </Alert>
      )}

      <Card className="overflow-hidden">
        {canMark && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <Button size="sm" variant="outline" disabled={!unmarked} onClick={() => setDraft((d) => markRemaining(students, d, 'present'))}>
              Mark the rest present{unmarked ? ` (${unmarked})` : ''}
            </Button>
            <Button size="sm" variant="ghost" leftIcon={UserPlus} disabled={saving} onClick={addNewStudents}>
              Add newly enrolled students
            </Button>
          </div>
        )}
        {!students.length && <p className="p-6 text-center text-fg-muted">No students were enrolled in this section when the attendance was opened.</p>}
        <ul aria-label="Students" className="divide-y divide-border">
          {students.map((s, i) => {
            const d = draft[s.student.id] ?? {};
            const changed = pending.some((m) => m.student === s.student.id);
            const showReason = canMark && needsReason(s, d, data);
            return (
              <li key={s.student.id} className={cn('flex flex-col gap-2 p-3 sm:flex-row sm:items-start sm:justify-between', changed && 'bg-interactive-soft/40')}>
                <div className="min-w-0">
                  <span className="mr-2 text-caption tabular-nums text-fg-muted">{i + 1}</span>
                  <span className="font-medium">{s.student.name}</span>
                  <span className="ml-2 text-caption text-fg-muted">{s.student.number}</span>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {!canMark || !changed ? <Badge variant={EFFECTIVE_VARIANTS[s.effective]}>{EFFECTIVE_LABELS[s.effective]}</Badge> : <Badge variant="accent">Not saved</Badge>}
                    {s.excuse && <Badge variant="info">Excused: {s.excuse.reason}</Badge>}
                    {s.addedLate && <Badge variant="neutral">Added later</Badge>}
                    {s.leftSection && <Badge variant="neutral">Left the section</Badge>}
                    {s.afterDeadline && <Badge variant="neutral">Late entry</Badge>}
                  </div>
                  {s.reason && !showReason && <p className="mt-1 text-caption text-fg-secondary">Reason: {s.reason}</p>}
                  {s.note && <p className="text-caption text-fg-secondary">Note: {s.note}</p>}
                  {s.markedBy && <p className="text-caption text-fg-muted">Marked by {s.markedBy}, {formatDateTime(s.markedAt)}</p>}
                </div>
                {canMark && (
                  <div className="flex flex-col gap-2 sm:items-end">
                    <div role="radiogroup" aria-label={`Attendance of ${s.student.name}`} className="flex gap-1">
                      {STATUS_OPTIONS.map((o) => {
                        const on = d.status === o.value;
                        return (
                          <button
                            key={o.value}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            title={o.label}
                            onClick={() => edit(s.student.id, { status: o.value })}
                            className={cn(
                              'min-w-20 rounded-md border px-2 py-1.5 text-body-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
                              on ? TONES[o.value] : 'border-border bg-surface text-fg-secondary hover:bg-muted',
                            )}
                          >
                            {o.label}
                          </button>
                        );
                      })}
                    </div>
                    {showReason && (
                      <Input
                        label={d.status === 'excused' ? 'Reason for the excuse' : 'Reason for the change'}
                        value={d.reason ?? ''}
                        maxLength={200}
                        error={problems[s.student.id]}
                        onChange={(e) => edit(s.student.id, { reason: e.target.value })}
                        fieldClassName="w-full sm:w-80"
                      />
                    )}
                    {!showReason && problems[s.student.id] && <p className="text-caption text-error-fg">{problems[s.student.id]}</p>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {canMark && (
          <div className="sticky bottom-0 flex flex-wrap items-center justify-end gap-3 border-t border-border bg-elevated p-3">
            <span className="text-body-sm text-fg-secondary">{pending.length ? `${pending.length} unsaved change${pending.length === 1 ? '' : 's'}` : 'All changes saved'}</span>
            <Button variant="outline" disabled={!pending.length || saving} onClick={() => setDraft(draftFrom(students))}>
              Undo changes
            </Button>
            <Button loading={saving} disabled={!pending.length} onClick={save}>
              Save attendance
            </Button>
          </div>
        )}
      </Card>
      <HistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} role={role} sessionId={session.id} version={data} />
    </PageContainer>
  );
}

function HistoryDrawer({ open, onClose, role, sessionId, version }) {
  const history = useApiData(() => (open ? loadSessionHistory(role, sessionId) : Promise.resolve(null)), `history|${sessionId}|${open}|${version?.counts?.total}|${JSON.stringify(version?.counts)}`);
  const items = history.data?.items ?? [];
  return (
    <Drawer open={open} onClose={onClose} title="History" description="Every mark and change, newest first.">
      {!history.data && history.status !== 'error' && <LoadingState />}
      {history.status === 'error' && <Alert variant="error">The history could not be loaded.</Alert>}
      {history.data && !items.length && <p className="text-fg-muted">Nothing marked yet.</p>}
      <ol className="flex flex-col gap-3">
        {items.map((h) => (
          <li key={h.id} className="rounded-md border border-border p-3">
            <p className="font-medium">{h.student.name}</p>
            <p className="text-body-sm">
              {h.from ? `${EFFECTIVE_LABELS[h.from]} → ` : ''}
              {EFFECTIVE_LABELS[h.to]}
              {h.afterDeadline && <span className="ml-2 text-caption text-fg-muted">(after the deadline)</span>}
            </p>
            {h.reason && <p className="text-caption text-fg-secondary">Reason: {h.reason}</p>}
            <p className="text-caption text-fg-muted">
              {h.by}, {formatDateTime(h.recordedAt)}
            </p>
          </li>
        ))}
      </ol>
    </Drawer>
  );
}

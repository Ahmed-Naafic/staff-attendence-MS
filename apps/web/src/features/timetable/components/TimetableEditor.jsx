import { useEffect, useId, useState } from 'react';
import { Alert, Badge, Button, Card, ConfirmModal, ErrorState, Input, Select, Skeleton, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { requestFailure } from '../../../hooks/useDialogForm.js';
import { formatFullDay } from '../../../lib/format.js';
import { WEEKDAY_NAMES } from '../../academic-calendar/utils/calendarRules.js';
import { cancelTimetableVersion, loadBellSchedule, loadBellSchedules, loadSectionLessons, loadTimetable, saveTimetable } from '../data/timetableApi.js';
import { cellKey, cellsToLessons, countBySubject, gridOf, HALF_LABELS, lessonsToCells, teachersFor, VERSION_STATES, versionOn } from '../utils/timetableRules.js';

const DAY_REASONS = { holiday: 'Holiday', closure: 'Closed', not_a_school_day: 'No school', no_school_days: 'School days not set', no_academic_year: 'Outside the year' };

/** This week of the section as attendance will see it: school or not, the halves and the lessons. */
function WeekPreview({ role, sectionId, version }) {
  const week = useApiData(() => loadSectionLessons(role, sectionId, {}), `week|${sectionId}|${version}`);
  if (!week.data) return week.status === 'error' ? <ErrorState title="This week could not be loaded" onRetry={week.retry} /> : <Skeleton className="h-24" />;
  return (
    <div role="region" aria-label="This week" tabIndex={0} className="overflow-x-auto">
      <Table caption="This week">
        <TableHead>
          <TableRow interactive={false}>
            <TableHeaderCell>Day</TableHeaderCell>
            <TableHeaderCell>Halves</TableHeaderCell>
            <TableHeaderCell>Lessons</TableHeaderCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {week.data.days.map((d) => (
            <TableRow key={d.date}>
              <TableCell className="whitespace-nowrap">
                {formatFullDay(d.date)}
                {d.extraDay && <span className="block text-caption text-fg-muted">Follows {WEEKDAY_NAMES[d.timetableDay]}’s timetable</span>}
              </TableCell>
              <TableCell className="text-fg-secondary">
                {!d.schoolDay ? (
                  <span>{DAY_REASONS[d.reason] ?? 'No school'}{d.holiday ? `: ${d.holiday.name}` : d.closure ? `: ${d.closure.name}` : ''}</span>
                ) : !d.timetable ? (
                  <span className="text-warning-fg">No timetable</span>
                ) : (
                  d.halves.map((h) => <span key={h.half} className="block whitespace-nowrap">{`${HALF_LABELS[h.half]}: ${h.start}–${h.end}`}</span>)
                )}
              </TableCell>
              <TableCell className="text-fg-secondary">
                {d.periods.filter((p) => p.kind === 'lesson').map((p) => (
                  <span key={p.number} className="mr-3 inline-block whitespace-nowrap">
                    <span className="text-fg-muted">P{p.number}</span> {p.lesson ? p.lesson.subject.name : '—'}
                  </span>
                ))}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * A section's timetable: its versions, and an editor for a new version from a date — its bell
 * schedule (school-wide or the section's branch's) and, for each weekday's periods, the subject and
 * optionally the teacher (the section's teachers of that subject; empty: any of them). Saved as a new
 * version: days already under way keep their timetable.
 */
export function TimetableEditor({ role, sectionId, writable, onNotice }) {
  const formId = useId();
  const [version, setVersion] = useState(0);
  const [viewId, setViewId] = useState('');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [warnings, setWarnings] = useState([]);
  const [cancelling, setCancelling] = useState(null);

  const data = useApiData(() => loadTimetable(role, sectionId, viewId), `tt|${sectionId}|${viewId}|${version}`);
  const tt = data.data?.section.id === sectionId ? data.data : null;
  const bells = useApiData(() => loadBellSchedules(role, { status: 'active' }), `bells|${role}|${version}`);
  const usable = (bells.data?.items ?? []).filter((b) => b.level === 'school' || b.branch?.id === tt?.section.branch.id);
  const bellId = form?.bellSchedule ?? '';
  const bell = useApiData(() => (bellId ? loadBellSchedule(role, bellId) : Promise.resolve(null)), `bell|${bellId}|${version}`);

  // Start the form from the version shown (or empty) whenever it loads.
  useEffect(() => {
    if (!tt) return;
    setForm({ effectiveFrom: tt.firstEditableDate, bellSchedule: tt.selected?.bellSchedule.id ?? '', cells: lessonsToCells(tt.selected?.lessons) });
    setFieldErrors({});
    setError('');
  }, [tt?.selected?.id, tt?.firstEditableDate, sectionId, version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tt) {
    return data.status === 'error' ? (
      <Card>
        <ErrorState title="The timetable could not be loaded" description="Check your connection and try again." onRetry={data.retry} />
      </Card>
    ) : (
      <Skeleton className="h-64" />
    );
  }

  const yearOpen = tt.section.academicYear.status !== 'closed' && tt.section.status === 'active';
  const canEdit = writable && yearOpen;
  const times = bell.data?.bellSchedule.id === bellId && form ? versionOn(bell.data.bellSchedule.versions, form.effectiveFrom) : null;
  const grid = times ? gridOf(times.periods) : [];
  const counts = form ? countBySubject(form.cells) : {};
  const subjectOptions = tt.subjects.filter((s) => s.subject.status === 'active');
  const setCell = (key, patch) => setForm((f) => ({ ...f, cells: { ...f.cells, [key]: { subject: '', teacher: '', room: '', ...f.cells[key], ...patch } } }));
  const lessonErrors = Object.entries(fieldErrors).filter(([k]) => k.startsWith('lessons.'));

  const save = async () => {
    if (saving) return;
    const problems = {};
    if (!form.effectiveFrom) problems.effectiveFrom = 'Choose the date the timetable applies from.';
    else if (form.effectiveFrom < tt.firstEditableDate) problems.effectiveFrom = `Choose ${tt.firstEditableDate} or a later date.`;
    if (!form.bellSchedule) problems.bellSchedule = 'Choose a bell schedule.';
    else if (!times) problems.bellSchedule = 'This bell schedule has no times on that date. Set its times first.';
    setFieldErrors(problems);
    setError('');
    if (Object.keys(problems).length) return;
    const { lessons } = cellsToLessons(form.cells, grid);
    setSaving(true);
    try {
      const res = await saveTimetable(role, sectionId, { effectiveFrom: form.effectiveFrom, bellSchedule: form.bellSchedule, lessons });
      setWarnings(res.warnings ?? []);
      setViewId('');
      setVersion((n) => n + 1);
      onNotice(res.unchanged ? 'Nothing changed.' : `Timetable of ${tt.section.displayName} saved from ${formatFullDay(form.effectiveFrom)}.`);
    } catch (e) {
      if (e.details) {
        // Lesson errors arrive by the index of the lesson sent: map them back to cells.
        const sent = cellsToLessons(form.cells, grid).lessons;
        const mapped = Object.fromEntries(
          Object.entries(e.details).map(([k, msg]) => {
            const m = /^lessons\.(\d+)$/.exec(k);
            return m && sent[Number(m[1])] ? [`lessons.${cellKey(sent[Number(m[1])].weekday, sent[Number(m[1])].period)}`, msg] : [k, msg];
          }),
        );
        setFieldErrors(mapped);
      }
      setError(e.code === 'TEACHER_CLASH' ? e.message : requestFailure(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card as="section" aria-labelledby="tt-versions" className="flex flex-col gap-3 p-5">
        <h2 id="tt-versions" className="text-card-title text-fg">
          Timetable of {tt.section.displayName}
          <span className="ml-2 text-small font-normal text-fg-muted">
            {tt.section.branch.name} · {tt.section.academicYear.name}
          </span>
        </h2>
        {!tt.versions.length && <p className="text-body text-fg-secondary">No timetable yet. Choose a bell schedule and fill in the lessons below.</p>}
        {tt.versions.length > 0 && (
          <ul className="flex flex-col gap-2">
            {[...tt.versions].reverse().map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-3 text-small">
                <Badge variant={VERSION_STATES[v.state].variant}>{VERSION_STATES[v.state].label}</Badge>
                <span className="text-fg">
                  {formatFullDay(v.effectiveFrom)}
                  {v.to && v.state !== 'cancelled' ? ` – ${formatFullDay(v.to)}` : ''}
                </span>
                <span className="text-fg-muted">
                  {v.bellSchedule.name} · {v.lessons} lessons a week
                </span>
                {v.id !== tt.selected?.id && v.state !== 'cancelled' && (
                  <Button size="sm" variant="ghost" onClick={() => setViewId(v.id)}>
                    Open
                  </Button>
                )}
                {v.id === tt.selected?.id && <span className="text-caption text-fg-muted">(shown below)</span>}
                {canEdit && v.state === 'scheduled' && (
                  <Button size="sm" variant="ghost" onClick={() => setCancelling(v)}>
                    Cancel
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {form && (
        <Card as="section" aria-labelledby="tt-edit" className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1">
            <h2 id="tt-edit" className="text-card-title text-fg">
              {canEdit ? 'Lessons' : 'Lessons (read only)'}
            </h2>
            <p className="text-small text-fg-secondary">
              {canEdit
                ? `Saving makes a new timetable from the date chosen; days before ${formatFullDay(tt.firstEditableDate)} keep theirs. A lesson without a teacher can be taken by any of the section’s teachers of that subject.`
                : tt.section.academicYear.status === 'closed'
                  ? 'The year is closed: its timetables are kept as they were.'
                  : 'The timetable cannot be changed now.'}
            </p>
          </div>
          {error && <Alert variant="error">{error}</Alert>}
          {warnings.length > 0 && (
            <Alert variant="warning" onDismiss={() => setWarnings([])}>
              <ul className="list-disc pl-5">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Alert>
          )}
          <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input
                id={`${formId}-from`}
                label="Applies from"
                type="date"
                required
                disabled={!canEdit}
                min={tt.firstEditableDate}
                max={tt.section.academicYear.endDate}
                value={form.effectiveFrom}
                error={fieldErrors.effectiveFrom}
                onChange={(e) => setForm((f) => ({ ...f, effectiveFrom: e.target.value }))}
              />
              <Select
                id={`${formId}-bell`}
                label="Bell schedule"
                required
                disabled={!canEdit}
                options={[{ value: '', label: usable.length ? 'Choose a bell schedule' : 'No active bell schedule yet' }, ...usable.map((b) => ({ value: b.id, label: `${b.name}${b.branch ? ` (${b.branch.name})` : ' (whole school)'}` }))]}
                value={form.bellSchedule}
                error={fieldErrors.bellSchedule}
                hint="Its times on each date decide when the lessons are."
                onChange={(e) => setForm((f) => ({ ...f, bellSchedule: e.target.value }))}
              />
            </div>

            {form.bellSchedule && bell.data && !times && <Alert variant="warning">This bell schedule has no times on {formatFullDay(form.effectiveFrom)}. Set its times on the Bell Schedules page first.</Alert>}

            {grid.map((row) => (
              <fieldset key={row.day} className="flex flex-col gap-2">
                <legend className="text-small font-medium text-fg">{WEEKDAY_NAMES[row.day]}</legend>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {row.items.map((p) => {
                    if (p.kind === 'break') {
                      return (
                        <div key={`b${p.start}`} className={`flex min-w-20 flex-col justify-center rounded-md px-2 py-2 text-center text-caption ${p.mainBreak ? 'bg-warning-soft text-warning-fg' : 'bg-info-soft text-info-fg'}`}>
                          <span>{p.name || 'Break'}</span>
                          <span className="tabular-nums">
                            {p.start}–{p.end}
                          </span>
                        </div>
                      );
                    }
                    const key = cellKey(row.day, p.number);
                    const cell = form.cells[key] ?? { subject: '', teacher: '', room: '' };
                    const cellError = fieldErrors[`lessons.${key}`];
                    const choices = teachersFor(tt.teachers, cell.subject);
                    return (
                      <div key={key} className={`flex min-w-44 flex-col gap-1.5 rounded-md border p-2 ${cellError ? 'border-error-fg bg-error-soft' : 'border-border'}`} title={cellError || undefined}>
                        <span className="text-caption text-fg-muted tabular-nums">
                          P{p.number} · {p.start}–{p.end}
                        </span>
                        <select
                          aria-label={`${WEEKDAY_NAMES[row.day]} period ${p.number} subject`}
                          disabled={!canEdit}
                          className="rounded-md border border-border bg-surface px-2 py-1 text-small"
                          value={cell.subject}
                          onChange={(e) => setCell(key, { subject: e.target.value, teacher: '' })}
                        >
                          <option value="">No lesson</option>
                          {subjectOptions.map((s) => (
                            <option key={s.subject.id} value={s.subject.id}>
                              {s.subject.name}
                            </option>
                          ))}
                          {cell.subject && !subjectOptions.some((s) => s.subject.id === cell.subject) && <option value={cell.subject}>(subject no longer available)</option>}
                        </select>
                        {cell.subject && (
                          <select
                            aria-label={`${WEEKDAY_NAMES[row.day]} period ${p.number} teacher`}
                            disabled={!canEdit}
                            className="rounded-md border border-border bg-surface px-2 py-1 text-small"
                            value={cell.teacher}
                            onChange={(e) => setCell(key, { teacher: e.target.value })}
                          >
                            <option value="">{choices.length ? 'Any of its teachers' : 'No teacher assigned'}</option>
                            {choices.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.name}
                              </option>
                            ))}
                            {cell.teacher && !choices.some((t) => t.id === cell.teacher) && <option value={cell.teacher}>(no longer teaches it)</option>}
                          </select>
                        )}
                        {cellError && <span className="text-caption text-error-fg">{cellError}</span>}
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            ))}
            {lessonErrors.length > 0 && <Alert variant="error">Some lessons need attention (marked in red).</Alert>}

            {tt.subjects.length > 0 && (
              <div className="flex flex-wrap gap-2" aria-label="Lessons per subject">
                {tt.subjects.map((s) => {
                  const n = counts[s.subject.id] ?? 0;
                  const off = s.weeklyLessons != null && n !== s.weeklyLessons;
                  return (
                    <Badge key={s.subject.id} variant={off ? 'warning' : n ? 'success' : 'neutral'}>
                      {s.subject.name}: {n}
                      {s.weeklyLessons != null ? ` of ${s.weeklyLessons}` : ''} a week
                    </Badge>
                  );
                })}
              </div>
            )}
            {canEdit && (
              <div>
                <Button type="submit" loading={saving} disabled={!times}>
                  Save Timetable
                </Button>
              </div>
            )}
          </form>
        </Card>
      )}

      <Card as="section" aria-labelledby="tt-week" className="flex flex-col gap-3 p-5">
        <h2 id="tt-week" className="text-card-title text-fg">
          This week
        </h2>
        <p className="text-small text-fg-secondary">As student attendance will see it: the academic calendar, the bell times and the timetable of each day.</p>
        <WeekPreview role={role} sectionId={sectionId} version={version} />
      </Card>

      <ConfirmModal
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        title="Cancel this timetable change?"
        description={cancelling ? `The timetable from ${formatFullDay(cancelling.effectiveFrom)} is cancelled; the one before it continues. It is kept as cancelled.` : ''}
        confirmLabel="Cancel change"
        run={() => cancelTimetableVersion(role, sectionId, cancelling.id)}
        onDone={() => {
          setCancelling(null);
          setViewId('');
          setVersion((n) => n + 1);
          onNotice('The timetable change was cancelled.');
        }}
      />
    </div>
  );
}

import { useId, useState } from 'react';
import { Link } from 'react-router';
import { CircleAlert, CircleCheck, Plus, Trash2, TriangleAlert } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmModal,
  ErrorState,
  Input,
  Modal,
  Select,
  Skeleton,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { requestFailure, useDialogForm } from '../../../hooks/useDialogForm.js';
import { addFixedLesson, loadBuilderTeachers, loadReadiness, removeFixedLesson, saveSetup, saveTeacherLimits } from '../data/builderApi.js';
import { checkUnavailable, DAY_NAMES, DAY_SHORT, fixLink, limitValue, loadTone, orderDays } from '../utils/builderRules.js';

const failure = (error) => requestFailure(error);

function FixLink({ item, role, onTab }) {
  const link = fixLink(item, role);
  if (!link) return null;
  if (link.tab) {
    return (
      <Button size="sm" variant="ghost" onClick={() => onTab(link.tab)}>
        {link.label}
      </Button>
    );
  }
  return (
    <Link to={link.to} className="text-small font-medium text-interactive underline-offset-2 hover:underline">
      {link.label}
    </Link>
  );
}

/** The checks before generating: blockers (red) stop it, warnings (amber) do not; each with where to fix it. */
export function ReadinessPanel({ role, context, version, onTab }) {
  const r = useApiData(() => loadReadiness(role, context), `ready|${JSON.stringify(context)}|${version}`);
  if (!r.data) return r.status === 'error' ? <ErrorState title="The checks could not be loaded" description={r.error?.message} onRetry={r.retry} /> : <Skeleton className="h-64" />;
  const { ready, blockers, warnings, summary, teachers } = r.data;
  return (
    <div className="flex flex-col gap-4">
      {ready ? (
        <Alert variant="success" title="Ready to generate">
          Everything the generator needs is in place for {summary.classes} class{summary.classes === 1 ? '' : 'es'}: {summary.lessons} lessons a week in {summary.lessonPeriods} lesson periods, {summary.teachers} teachers
          {summary.fixedLessons ? `, ${summary.fixedLessons} fixed lessons` : ''}. Open Draft & publish to generate.
        </Alert>
      ) : (
        <Alert variant="error" title={`${blockers.length} thing${blockers.length === 1 ? '' : 's'} to fix before generating`}>
          Fix each item below; the checks update when you come back.
        </Alert>
      )}
      {blockers.length > 0 && (
        <Card as="section" aria-label="To fix" className="flex flex-col divide-y divide-border">
          {blockers.map((b, i) => (
            <div key={`${b.code}-${i}`} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <span className="flex min-w-0 flex-1 gap-2 text-body text-fg">
                <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-error" />
                {b.message}
              </span>
              <FixLink item={b} role={role} onTab={onTab} />
            </div>
          ))}
        </Card>
      )}
      {warnings.length > 0 && (
        <Card as="section" aria-label="Good to know" className="flex flex-col divide-y divide-border">
          {warnings.map((w, i) => (
            <div key={`${w.code}-${i}`} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <span className="flex min-w-0 flex-1 gap-2 text-body text-fg-secondary">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
                {w.message}
              </span>
              <FixLink item={w} role={role} onTab={onTab} />
            </div>
          ))}
        </Card>
      )}
      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-card-title text-fg">Teachers’ load</h2>
          <p className="text-small text-fg-muted">Lessons a week here against the periods each teacher can teach (their free periods, limits and lessons elsewhere).</p>
        </div>
        <div role="region" aria-label="Teachers’ load" tabIndex={0} className="overflow-x-auto">
          <Table caption="Teachers’ load">
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>Teacher</TableHeaderCell>
                <TableHeaderCell>Lessons / can teach</TableHeaderCell>
                <TableHeaderCell>Limits</TableHeaderCell>
                <TableHeaderCell>Elsewhere</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!teachers.length && <TableEmpty columns={4} title="No teachers yet" description="Teachers come from the Teaching page." />}
              {teachers.map((t) => (
                <TableRow key={t.teacherId}>
                  <TableCell>
                    <span className="font-medium text-fg">{t.name}</span>
                    <span className="block text-caption text-fg-muted">{t.staffId}</span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={loadTone(t)}>
                      {t.lessons} / {t.capacity}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-fg-secondary">
                    {[t.maxPerDay && `${t.maxPerDay} a day`, t.maxPerWeek && `${t.maxPerWeek} a week`, t.unavailable && `${t.unavailable} unavailable time${t.unavailable === 1 ? '' : 's'}`].filter(Boolean).join(', ') || '—'}
                  </TableCell>
                  <TableCell className="text-fg-secondary">{t.busy ? `${t.busy} lesson${t.busy === 1 ? '' : 's'}` : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

/** Generation rules, the default bell schedule, each class's bell schedule and classes left out. */
export function RulesPanel({ role, context, builder, writable, onSaved }) {
  const formId = useId();
  const s = builder.setup;
  const initial = {
    fillAllPeriods: s.fillAllPeriods,
    maxSubjectPerDay: String(s.maxSubjectPerDay),
    teacherMaxPerDay: s.teacherMaxPerDay == null ? '' : String(s.teacherMaxPerDay),
    searchSeconds: String(s.searchSeconds),
    allowDoubleLessons: s.allowDoubleLessons,
    spreadSubjects: s.spreadSubjects,
    avoidTeacherGaps: s.avoidTeacherGaps,
    morningSubjects: s.morningSubjects,
    defaultBellSchedule: s.defaultBellSchedule ?? '',
    sectionBells: { ...s.sectionBells },
    excluded: s.excludedSections,
  };
  const form = useDialogForm(true, initial, failure);
  const v = form.values;
  const usable = builder.bellSchedules.filter((b) => b.status === 'active');
  const toggle = (list, id) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const save = () =>
    form.submit({}, ['maxSubjectPerDay', 'teacherMaxPerDay', 'searchSeconds', 'defaultBellSchedule', 'sectionBells', 'excludedSections', 'morningSubjects'], () =>
      saveSetup(role, context, {
        fillAllPeriods: v.fillAllPeriods,
        maxSubjectPerDay: Number(v.maxSubjectPerDay),
        teacherMaxPerDay: v.teacherMaxPerDay === '' ? null : Number(v.teacherMaxPerDay),
        searchSeconds: Number(v.searchSeconds),
        allowDoubleLessons: v.allowDoubleLessons,
        spreadSubjects: v.spreadSubjects,
        avoidTeacherGaps: v.avoidTeacherGaps,
        morningSubjects: v.morningSubjects,
        defaultBellSchedule: v.defaultBellSchedule || null,
        sectionBells: Object.fromEntries(builder.sections.map((x) => [x.id, v.sectionBells[x.id] || null])),
        excludedSections: v.excluded,
      }),
    onSaved,
  );
  return (
    <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-4">
      {form.formError && <Alert variant="error">{form.formError}</Alert>}
      <Card as="section" aria-labelledby={`${formId}-rules`} className="flex flex-col gap-4 p-5">
        <h2 id={`${formId}-rules`} className="text-card-title text-fg">
          Rules
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Select label="Most lessons of a subject a day" options={range(1, 6).map((n) => ({ value: String(n), label: String(n) }))} value={v.maxSubjectPerDay} error={form.errors.maxSubjectPerDay} onChange={(e) => form.set('maxSubjectPerDay', e.target.value)} disabled={!writable} />
          <Select
            label="Most lessons a teacher teaches a day"
            hint="A teacher’s own limit (Teachers tab) wins."
            options={[{ value: '', label: 'No limit' }, ...range(1, 12).map((n) => ({ value: String(n), label: String(n) }))]}
            value={v.teacherMaxPerDay}
            error={form.errors.teacherMaxPerDay}
            onChange={(e) => form.set('teacherMaxPerDay', e.target.value)}
            disabled={!writable}
          />
          <Select
            label="Search time"
            hint="Longer can find a better timetable."
            options={[5, 10, 20, 30, 60].map((n) => ({ value: String(n), label: `${n} seconds` }))}
            value={v.searchSeconds}
            error={form.errors.searchSeconds}
            onChange={(e) => form.set('searchSeconds', e.target.value)}
            disabled={!writable}
          />
        </div>
        <Switch
          label="Every period has a lesson"
          description="Each class’s lessons a week must equal its lesson periods, so no class ever has an empty period (teachers can still have free periods). Turn off only if classes may leave early on some days."
          checked={v.fillAllPeriods}
          onChange={(next) => form.set('fillAllPeriods', next)}
          disabled={!writable}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Switch label="Double lessons" description="Two lessons of a subject may follow each other." checked={v.allowDoubleLessons} onChange={(next) => form.set('allowDoubleLessons', next)} disabled={!writable} />
          <Switch label="Spread subjects" description="Each subject on as many days as it has lessons." checked={v.spreadSubjects} onChange={(next) => form.set('spreadSubjects', next)} disabled={!writable} />
          <Switch label="Few free periods for teachers" description="Keep a teacher’s lessons of a day together." checked={v.avoidTeacherGaps} onChange={(next) => form.set('avoidTeacherGaps', next)} disabled={!writable} />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-small font-medium text-fg">Morning subjects (before the main break where possible)</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {builder.subjects.map((sub) => (
              <Checkbox key={sub.id} label={sub.name} checked={v.morningSubjects.includes(sub.id)} onChange={() => form.set('morningSubjects', toggle(v.morningSubjects, sub.id))} disabled={!writable} />
            ))}
          </div>
        </fieldset>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h2 className="text-card-title text-fg">Classes and bell schedules</h2>
            <p className="text-small text-fg-muted">Automatic: the class’s current timetable’s bell schedule, else the default, else the branch’s only one.</p>
          </div>
          <Select
            label="Default bell schedule"
            fieldClassName="w-full sm:w-64"
            options={[{ value: '', label: 'None' }, ...usable.map((b) => ({ value: b.id, label: `${b.name}${b.level === 'school' ? ' (school)' : ''}` }))]}
            value={v.defaultBellSchedule}
            error={form.errors.defaultBellSchedule}
            onChange={(e) => form.set('defaultBellSchedule', e.target.value)}
            disabled={!writable}
          />
        </div>
        <div role="region" aria-label="Classes and bell schedules" tabIndex={0} className="overflow-x-auto">
          <Table caption="Classes and bell schedules">
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>Class</TableHeaderCell>
                <TableHeaderCell>Bell schedule</TableHeaderCell>
                <TableHeaderCell>Lessons / periods</TableHeaderCell>
                <TableHeaderCell>Generate</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!builder.sections.length && <TableEmpty columns={4} title="No classes" description="Create the branch’s classes for this year first." />}
              {builder.sections.map((x) => (
                <TableRow key={x.id}>
                  <TableCell className="font-medium">{x.displayName}</TableCell>
                  <TableCell>
                    <Select
                      label={`Bell schedule of ${x.displayName}`}
                      hideLabel
                      options={[{ value: '', label: `Automatic${x.bell && !v.sectionBells[x.id] ? ` (${x.bell.name})` : ''}` }, ...usable.map((b) => ({ value: b.id, label: b.name }))]}
                      value={v.sectionBells[x.id] ?? ''}
                      onChange={(e) => form.set('sectionBells', { ...v.sectionBells, [x.id]: e.target.value })}
                      disabled={!writable}
                    />
                  </TableCell>
                  <TableCell className="tabular-nums text-fg-secondary">{x.excluded ? '—' : `${x.lessonsNeeded} / ${x.lessonPeriods}`}</TableCell>
                  <TableCell>
                    <Checkbox label="Include" checked={!v.excluded.includes(x.id)} onChange={() => form.set('excluded', toggle(v.excluded, x.id))} disabled={!writable} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
      {writable && (
        <div className="flex justify-end">
          <Button type="submit" loading={form.saving}>
            Save Rules
          </Button>
        </div>
      )}
    </form>
  );
}

/** A teacher's limits and unavailable times for the year. */
function TeacherLimitsModal({ role, academicYear, teacher, days, open, onClose, onSaved }) {
  const formId = useId();
  const initial = teacher ? { maxPerDay: teacher.maxPerDay == null ? '' : String(teacher.maxPerDay), maxPerWeek: teacher.maxPerWeek == null ? '' : String(teacher.maxPerWeek), unavailable: teacher.unavailable } : { maxPerDay: '', maxPerWeek: '', unavailable: [] };
  const form = useDialogForm(open, initial, failure);
  const v = form.values;
  const setRow = (i, patch) => form.set('unavailable', v.unavailable.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const save = () => {
    const problems = {};
    const maxPerDay = limitValue(v.maxPerDay, { min: 1, max: 20 });
    const maxPerWeek = limitValue(v.maxPerWeek, { min: 1, max: 140 });
    if (Number.isNaN(maxPerDay)) problems.maxPerDay = 'A whole number from 1 to 20, or empty.';
    if (Number.isNaN(maxPerWeek)) problems.maxPerWeek = 'A whole number from 1 to 140, or empty.';
    const checked = checkUnavailable(v.unavailable);
    for (const [i, m] of Object.entries(checked.errors)) problems[`unavailable.${i}`] = m;
    return form.submit(problems, ['maxPerDay', 'maxPerWeek'], () => saveTeacherLimits(role, teacher.id, { academicYear, maxPerDay, maxPerWeek, unavailable: checked.rows }), onSaved);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Limits of ${teacher?.name ?? ''}`}
      description="For this academic year, in every branch they teach. Unavailable times are clock times, so they apply to any bell schedule."
      size="lg"
      loading={form.saving}
      error={form.formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={form.saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={form.saving}>
            Save Limits
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Most lessons a day" inputMode="numeric" hint="Empty: the branch’s rule." value={v.maxPerDay} error={form.errors.maxPerDay} onChange={(e) => form.set('maxPerDay', e.target.value)} />
          <Input label="Most lessons a week" inputMode="numeric" hint="Empty: no limit." value={v.maxPerWeek} error={form.errors.maxPerWeek} onChange={(e) => form.set('maxPerWeek', e.target.value)} />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-small font-medium text-fg">Cannot teach</legend>
          {!v.unavailable.length && <p className="text-small text-fg-muted">Available at every lesson time.</p>}
          {v.unavailable.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-start gap-2">
              <Select label={`Day ${i + 1}`} hideLabel options={[{ value: '', label: 'Day' }, ...days.map((d) => ({ value: d, label: DAY_NAMES[d] }))]} value={r.weekday} error={form.errors[`unavailable.${i}`]} onChange={(e) => setRow(i, { weekday: e.target.value })} />
              <Input label={`From ${i + 1}`} hideLabel type="time" value={r.start} onChange={(e) => setRow(i, { start: e.target.value })} />
              <Input label={`Until ${i + 1}`} hideLabel type="time" value={r.end} onChange={(e) => setRow(i, { end: e.target.value })} />
              <Button variant="ghost" iconOnly leftIcon={Trash2} aria-label={`Remove time ${i + 1}`} onClick={() => form.set('unavailable', v.unavailable.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div>
            <Button size="sm" variant="outline" leftIcon={Plus} onClick={() => form.set('unavailable', [...v.unavailable, { weekday: days[0] ?? 'MON', start: '07:00', end: '12:00' }])}>
              Add a time
            </Button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

/** The branch's teachers: load, limits, unavailable times and lessons elsewhere. */
export function TeachersPanel({ role, context, days, academicYear, writable, version, onChanged }) {
  const [editing, setEditing] = useState(null);
  const list = useApiData(() => loadBuilderTeachers(role, context), `tteachers|${JSON.stringify(context)}|${version}`);
  if (!list.data) return list.status === 'error' ? <ErrorState title="Teachers could not be loaded" description={list.error?.message} onRetry={list.retry} /> : <Skeleton className="h-64" />;
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-card-title text-fg">Teachers</h2>
        <p className="text-small text-fg-muted">
          Everyone teaching this branch’s classes. Their lessons in other classes and branches are kept free automatically. {role === 'MANAGER' ? 'You set limits for your own staff; teachers from other branches are set by your School Owner.' : ''}
        </p>
      </div>
      <div role="region" aria-label="Teachers" tabIndex={0} className="overflow-x-auto">
        <Table caption="Teachers and their limits">
          <TableHead>
            <TableRow interactive={false}>
              <TableHeaderCell>Teacher</TableHeaderCell>
              <TableHeaderCell>Lessons / can teach</TableHeaderCell>
              <TableHeaderCell>Most a day / week</TableHeaderCell>
              <TableHeaderCell>Cannot teach</TableHeaderCell>
              <TableHeaderCell>Elsewhere</TableHeaderCell>
              <TableHeaderCell align="right">Limits</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!list.data.items.length && <TableEmpty columns={6} title="No teachers yet" description="Assign teaching on the Teaching page first." />}
            {list.data.items.map((t) => (
              <TableRow key={t.id}>
                <TableCell>
                  <span className="font-medium text-fg">{t.name}</span>
                  <span className="block text-caption text-fg-muted">
                    {t.staffId}
                    {t.homeBranch && t.homeBranch.id !== list.data.branch.id ? ` · home branch ${t.homeBranch.name}` : ''}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge variant={loadTone(t)}>
                    {t.lessons} / {t.capacity}
                  </Badge>
                </TableCell>
                <TableCell className="text-fg-secondary">
                  {t.maxPerDay ?? (list.data.defaultMaxPerDay ? `${list.data.defaultMaxPerDay} (rule)` : '—')} / {t.maxPerWeek ?? '—'}
                </TableCell>
                <TableCell className="text-fg-secondary">{t.unavailable.length ? t.unavailable.map((u) => `${DAY_SHORT[u.weekday]} ${u.start}–${u.end}`).join(', ') : '—'}</TableCell>
                <TableCell className="text-fg-secondary">{t.busyElsewhere.length ? `${t.busyElsewhere.length} lesson${t.busyElsewhere.length === 1 ? '' : 's'}` : '—'}</TableCell>
                <TableCell align="right">
                  {t.canEdit && writable ? (
                    <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                      Edit
                    </Button>
                  ) : (
                    <span className="text-small text-fg-muted">{t.canEdit ? '' : 'Another branch'}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <TeacherLimitsModal
        role={role}
        academicYear={academicYear}
        teacher={editing}
        days={orderDays(days)}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          onChanged(`${editing.name}’s limits were saved.`);
        }}
      />
    </Card>
  );
}

function FixedLessonModal({ role, context, builder, open, onClose, onSaved }) {
  const formId = useId();
  const form = useDialogForm(open, { section: '', weekday: '', period: '', subject: '' }, failure);
  const v = form.values;
  const section = builder.sections.find((s) => s.id === v.section);
  const days = section ? orderDays(Object.keys(section.periods)) : [];
  const periods = section && v.weekday ? section.periods[v.weekday] ?? [] : [];
  const save = () => {
    const problems = {};
    if (!v.section) problems.section = 'Choose a class.';
    if (!v.weekday) problems.weekday = 'Choose a day.';
    if (!v.period) problems.period = 'Choose a period.';
    if (!v.subject) problems.subject = 'Choose a subject.';
    return form.submit(problems, ['section', 'weekday', 'period', 'subject', 'teacher'], () => addFixedLesson(role, context, { section: v.section, weekday: v.weekday, period: Number(v.period), subject: v.subject }), onSaved);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Fixed Lesson"
      description="The generator places this lesson exactly here and never moves it. It counts as one of the subject’s lessons a week."
      loading={form.saving}
      error={form.formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={form.saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={form.saving}>
            Add Fixed Lesson
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select label="Class" required fieldClassName="sm:col-span-2" options={[{ value: '', label: 'Choose a class' }, ...builder.sections.filter((s) => !s.excluded).map((s) => ({ value: s.id, label: s.displayName }))]} value={v.section} error={form.errors.section} onChange={(e) => form.set('section', e.target.value)} />
        <Select label="Day" required options={[{ value: '', label: 'Choose a day' }, ...days.map((d) => ({ value: d, label: DAY_NAMES[d] }))]} value={v.weekday} error={form.errors.weekday} onChange={(e) => form.set('weekday', e.target.value)} />
        <Select label="Period" required options={[{ value: '', label: 'Choose a period' }, ...periods.map((p) => ({ value: String(p.number), label: `Period ${p.number} (${p.start}–${p.end})` }))]} value={v.period} error={form.errors.period} onChange={(e) => form.set('period', e.target.value)} />
        <Select label="Subject" required fieldClassName="sm:col-span-2" hint="The class’s teacher of the subject teaches it." options={[{ value: '', label: 'Choose a subject' }, ...builder.subjects.map((s) => ({ value: s.id, label: s.name }))]} value={v.subject} error={form.errors.subject} onChange={(e) => form.set('subject', e.target.value)} />
      </form>
    </Modal>
  );
}

/** Lessons the generator must place exactly where they are set. */
export function FixedLessonsPanel({ role, context, builder, writable, onChanged }) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(null);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-card-title text-fg">Fixed lessons</h2>
          <p className="text-small text-fg-muted">For lessons that must be at a set time, e.g. PE when the field is free. Everything else is placed by the generator.</p>
        </div>
        {writable && (
          <Button size="sm" leftIcon={Plus} onClick={() => setAdding(true)}>
            Add Fixed Lesson
          </Button>
        )}
      </div>
      <div role="region" aria-label="Fixed lessons" tabIndex={0} className="overflow-x-auto">
        <Table caption="Fixed lessons">
          <TableHead>
            <TableRow interactive={false}>
              <TableHeaderCell>Class</TableHeaderCell>
              <TableHeaderCell>When</TableHeaderCell>
              <TableHeaderCell>Subject</TableHeaderCell>
              <TableHeaderCell>Teacher</TableHeaderCell>
              <TableHeaderCell align="right">Remove</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!builder.fixedLessons.length && <TableEmpty columns={5} icon={CircleCheck} title="No fixed lessons" description="Optional: the generator places every lesson by itself." />}
            {builder.fixedLessons.map((f) => (
              <TableRow key={f.id}>
                <TableCell className="font-medium">{f.section.displayName}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {DAY_NAMES[f.weekday]}, period {f.period}
                </TableCell>
                <TableCell>{f.subject.name}</TableCell>
                <TableCell className="text-fg-secondary">{f.teacher?.name ?? 'The class’s teacher'}</TableCell>
                <TableCell align="right">
                  {writable && (
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(f)}>
                      Remove
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <FixedLessonModal
        role={role}
        context={context}
        builder={builder}
        open={adding}
        onClose={() => setAdding(false)}
        onSaved={() => {
          setAdding(false);
          onChanged('The fixed lesson was added.');
        }}
      />
      <ConfirmModal
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        title="Remove this fixed lesson?"
        description={removing ? `${removing.subject.name} in ${removing.section.displayName}, ${DAY_NAMES[removing.weekday]} period ${removing.period}. The generator will place it freely.` : ''}
        confirmLabel="Remove"
        run={() => removeFixedLesson(role, removing.id)}
        onDone={() => {
          setRemoving(null);
          onChanged('The fixed lesson was removed.');
        }}
      />
    </Card>
  );
}

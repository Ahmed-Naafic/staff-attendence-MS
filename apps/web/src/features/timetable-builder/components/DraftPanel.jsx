import { useId, useState } from 'react';
import { CalendarCheck, Lock, LockOpen, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { Alert, Badge, Button, Card, ConfirmModal, ErrorState, Input, KpiCard, Modal, Select, Skeleton, Switch, Tabs } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { requestFailure, useDialogForm } from '../../../hooks/useDialogForm.js';
import { discardDraft, editDraft, generateTimetable, loadDraft, publishDraft } from '../data/builderApi.js';
import { DAY_NAMES, orderDays, subjectHues, unplacedTotal } from '../utils/builderRules.js';
import { ClassGrid, MasterGrid } from './TimetableGrids.jsx';

const failure = (error) => requestFailure(error);

function PublishModal({ role, draft, today, open, onClose, onDone }) {
  const formId = useId();
  const earliest = draft.planDate > today ? draft.planDate : today;
  const form = useDialogForm(open, { effectiveFrom: draft.planDate }, failure);
  const save = () => {
    const problems = {};
    if (!form.values.effectiveFrom) problems.effectiveFrom = 'Choose the first day.';
    return form.submit(problems, ['effectiveFrom'], () => publishDraft(role, draft.id, { revision: draft.revision, effectiveFrom: form.values.effectiveFrom }), onDone);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Publish Timetable"
      description={`Every class of ${draft.branch.name} gets this timetable from the day you choose. Earlier days, their timetables and attendance stay as they were. All classes are published together, or none.`}
      loading={form.saving}
      loadingLabel="Publishing…"
      error={form.formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={form.saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={form.saving}>
            Publish
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-3">
        <Input label="First day" type="date" required min={earliest} max={draft.academicYear.endDate} value={form.values.effectiveFrom} error={form.errors.effectiveFrom} onChange={(e) => form.set('effectiveFrom', e.target.value)} hint={`Planned for ${draft.planDate}. Teachers’ assignments and bell times are checked again for this day.`} />
        {draft.fillAllPeriods && draft.emptyPeriods.length > 0 && (
          <Alert variant="error" title="Every period needs a lesson">
            {draft.emptyPeriods.map((e) => `${e.name}: ${e.count} empty`).join(', ')}. Place the lessons left out first; publishing is refused until every period has a lesson.
          </Alert>
        )}
        {!draft.fillAllPeriods && unplacedTotal(draft) > 0 && <Alert variant="warning">{unplacedTotal(draft)} lesson{unplacedTotal(draft) === 1 ? ' is' : 's are'} still left out. You can publish now and add them later in the Timetables page, or place them first.</Alert>}
      </form>
    </Modal>
  );
}

/**
 * Generate, review, edit and publish the branch's draft. Edits: click a lesson, then another period
 * of the same class to move it there (swapping with the lesson there); lock it, remove it, or give it
 * another of the subject's teachers. Lessons left out: choose one, then a free period of its class.
 * Every edit is checked by the server against all the rules and refused if it would break one.
 */
export function DraftPanel({ role, context, builder, writable, version, onChanged }) {
  const tabsId = useId();
  const [mode, setMode] = useState('master');
  const [day, setDay] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [selected, setSelected] = useState(null);
  const [placing, setPlacing] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState('');
  const [keepLocked, setKeepLocked] = useState(true);
  const [dialog, setDialog] = useState(null);
  const [local, setLocal] = useState(null);
  const data = useApiData(() => loadDraft(role, context), `draft|${JSON.stringify(context)}|${version}`);
  const draft = local && data.data?.draft && local.id === data.data.draft.id && local.revision >= data.data.draft.revision ? local : data.data?.draft ?? null;

  async function run(label, fn) {
    setBusy(label);
    setError(null);
    try {
      const res = await fn();
      if (res?.draft !== undefined) setLocal(res.draft);
      return res;
    } catch (e) {
      setError({ message: e.message, list: e.details?.conflicts ?? e.details?.blockers?.map((b) => b.message) ?? [] });
      if (e.code === 'STALE_DRAFT') data.retry();
      return null;
    } finally {
      setBusy('');
    }
  }
  const generate = async () => {
    const res = await run('generate', () => generateTimetable(role, context, { keepLocked }));
    if (res) {
      setSelected(null);
      setPlacing(null);
      onChanged(`A new draft was generated: ${res.draft.lessons.length} lessons placed${unplacedTotal(res.draft) ? `, ${unplacedTotal(res.draft)} left out` : ''}.`);
    }
  };
  const edit = (body) => run('edit', () => editDraft(role, draft.id, { revision: draft.revision, ...body }));

  if (!data.data) return data.status === 'error' ? <ErrorState title="The draft could not be loaded" description={data.error?.message} onRetry={data.retry} /> : <Skeleton className="h-64" />;

  const ready = builder.readiness.ready;
  const header = (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-card-title text-fg">{draft ? 'Draft timetable' : 'Generate a timetable'}</h2>
          <p className="text-small text-fg-muted">
            {draft
              ? `Planned for ${draft.planDate}; ${draft.edited ? 'edited by hand since it was generated' : `generated ${new Date(draft.createdAt).toLocaleString()}`}. Only you and other managers of the branch see it until it is published.`
              : 'The generator places every class’s lessons with no conflicts, following the rules. Nothing changes for anyone until you publish.'}
          </p>
        </div>
        {writable && (
          <div className="flex flex-wrap items-center gap-3">
            {draft?.lessons.some((l) => l.locked && !l.fixed) && <Switch label="Keep locked lessons" checked={keepLocked} onChange={setKeepLocked} />}
            <Button leftIcon={draft ? Wand2 : Sparkles} onClick={generate} loading={busy === 'generate'} unavailableReason={ready ? undefined : 'Fix the items on the Readiness tab first.'}>
              {draft ? 'Generate Again' : 'Generate Timetable'}
            </Button>
            {draft && (
              <>
                <Button variant="secondary" leftIcon={CalendarCheck} onClick={() => setDialog('publish')} disabled={Boolean(busy)}>
                  Publish
                </Button>
                <Button variant="ghost" leftIcon={Trash2} onClick={() => setDialog('discard')} disabled={Boolean(busy)}>
                  Discard
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {busy === 'generate' && <Alert variant="info">Generating… this takes up to {builder.setup.searchSeconds} seconds.</Alert>}
      {error && (
        <Alert variant="error" title={error.message} onDismiss={() => setError(null)}>
          {error.list.length > 1 && (
            <ul className="list-disc pl-5">
              {error.list.slice(0, 6).map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
    </Card>
  );
  if (!draft) return header;

  const days = orderDays([...new Set(draft.sections.flatMap((s) => Object.keys(s.periods)))]);
  const activeDay = days.includes(day) ? day : days[0];
  const hues = subjectHues(draft.lessons);
  const sectionsWithLessons = draft.sections.map((s) => ({ ...s, lessons: draft.lessons.filter((l) => l.sectionId === s.id) }));
  const activeSection = sectionsWithLessons.find((s) => s.id === sectionId) ?? sectionsWithLessons[0];
  const selectedLesson = selected && draft.lessons.find((l) => l.sectionId === selected.sectionId && l.weekday === selected.weekday && l.period === selected.period);
  const teachersOfSubject = selectedLesson
    ? [...new Map(draft.lessons.filter((l) => l.sectionId === selectedLesson.sectionId && l.subject.id === selectedLesson.subject.id && l.teacher).map((l) => [l.teacher.id, l.teacher])).values()]
    : [];

  async function onCell(cell) {
    if (!writable || busy) return;
    const secId = cell.sectionId ?? activeSection.id;
    if (placing) {
      if (placing.sectionId !== secId || cell.lesson) {
        setError({ message: 'Choose a free period of that class.', list: [] });
        return;
      }
      const res = await edit({ action: 'place', section: secId, subject: placing.subjectId, ...(placing.teacherId && { teacher: placing.teacherId }), to: { weekday: cell.weekday, period: cell.period } });
      if (res) setPlacing(null);
      return;
    }
    if (!selected) {
      if (cell.lesson) setSelected({ sectionId: secId, weekday: cell.weekday, period: cell.period });
      return;
    }
    if (selected.sectionId === secId && selected.weekday === cell.weekday && selected.period === cell.period) {
      setSelected(null);
      return;
    }
    if (selected.sectionId !== secId) {
      setSelected(cell.lesson ? { sectionId: secId, weekday: cell.weekday, period: cell.period } : null);
      return;
    }
    const res = await edit({ action: 'move', section: secId, from: { weekday: selected.weekday, period: selected.period }, to: { weekday: cell.weekday, period: cell.period } });
    if (res) setSelected(null);
  }

  const total = unplacedTotal(draft);
  return (
    <div className="flex flex-col gap-4">
      {header}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Lessons placed" value={draft.lessons.length} icon={CalendarCheck} tone="success" />
        <KpiCard label="Left out" value={total} icon={Sparkles} tone={total ? 'warning' : 'success'} note={total ? 'See below' : 'Every lesson placed'} />
        <KpiCard label="Classes" value={draft.sections.length} icon={Wand2} tone="info" />
        <KpiCard label="Teachers" value={draft.teachers.length} icon={Lock} tone="info" />
      </div>
      {draft.fillAllPeriods && draft.emptyPeriods.length > 0 && (
        <Alert variant="warning" title="Some classes have empty periods">
          {draft.emptyPeriods.map((e) => `${e.name}: ${e.count}`).join(', ')}. Every period needs a lesson before publishing: place the lessons left out (below).
        </Alert>
      )}
      {draft.problems?.length > 0 && (
        <Alert variant="warning" title="Fixed or locked lessons that could not be kept">
          <ul className="list-disc pl-5">
            {draft.problems.map((p, i) => (
              <li key={i}>{`${DAY_NAMES[p.weekday] ?? p.weekday} period ${p.period}: ${p.message}`}</li>
            ))}
          </ul>
        </Alert>
      )}
      {total > 0 && (
        <Card as="section" aria-label="Lessons left out" className="flex flex-col gap-2 p-4">
          <h3 className="text-card-title text-fg">Lessons left out</h3>
          <p className="text-small text-fg-muted">The generator never breaks a rule to fit a lesson. Change a limit and generate again, or place one by hand: choose it, then a free period of its class.</p>
          <ul className="flex flex-col divide-y divide-border">
            {draft.unplaced.map((u) => (
              <li key={`${u.section.id}-${u.subject.id}`} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span className="text-body">
                  <span className="font-medium">{u.section.displayName}</span>: {u.count} × {u.subject.name}
                  {u.teacher ? ` (${u.teacher.name})` : ''} — <span className="text-fg-secondary">{u.reason}</span>
                </span>
                {writable && (
                  <Button
                    size="sm"
                    variant={placing?.sectionId === u.section.id && placing.subjectId === u.subject.id ? 'secondary' : 'outline'}
                    onClick={() => {
                      setSelected(null);
                      setPlacing(placing?.sectionId === u.section.id && placing.subjectId === u.subject.id ? null : { sectionId: u.section.id, subjectId: u.subject.id, teacherId: u.teacher?.id });
                      setSectionId(u.section.id);
                    }}
                  >
                    {placing?.sectionId === u.section.id && placing.subjectId === u.subject.id ? 'Choosing a period…' : 'Place'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <Tabs
            id={tabsId}
            label="Draft views"
            tabs={[
              { value: 'master', label: 'Master' },
              { value: 'class', label: 'Class' },
            ]}
            value={mode}
            onChange={setMode}
          />
          {mode === 'master' ? (
            <Select label="Day" fieldClassName="w-48" options={days.map((d) => ({ value: d, label: DAY_NAMES[d] }))} value={activeDay} onChange={(e) => setDay(e.target.value)} />
          ) : (
            <Select label="Class" fieldClassName="w-56" options={draft.sections.map((s) => ({ value: s.id, label: s.displayName }))} value={activeSection.id} onChange={(e) => setSectionId(e.target.value)} />
          )}
        </div>
        {writable && (
          <p className="text-small text-fg-muted">
            {placing ? 'Choose a free period of the class (dashed).' : selected ? 'Choose another period of the same class to move it there (it swaps with the lesson there), or use the buttons below.' : 'Choose a lesson to move, lock or change it.'}
          </p>
        )}
        {selectedLesson && writable && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-3">
            <span className="mr-2 text-body">
              <span className="font-medium">{selectedLesson.subject.name}</span>
              {selectedLesson.teacher ? `, ${selectedLesson.teacher.name}` : ''} · {DAY_NAMES[selectedLesson.weekday]} period {selectedLesson.period}
              {selectedLesson.fixed && <Badge variant="accent" className="ml-2">Fixed</Badge>}
            </span>
            {!selectedLesson.fixed && (
              <>
                <Button size="sm" variant="outline" leftIcon={selectedLesson.locked ? LockOpen : Lock} onClick={() => edit({ action: selectedLesson.locked ? 'unlock' : 'lock', lesson: selectedLesson.id })} loading={busy === 'edit'}>
                  {selectedLesson.locked ? 'Unlock' : 'Lock'}
                </Button>
                {teachersOfSubject.length > 1 && (
                  <Select
                    label="Teacher"
                    hideLabel
                    size="sm"
                    fieldClassName="w-48"
                    options={teachersOfSubject.map((t) => ({ value: t.id, label: t.name }))}
                    value={selectedLesson.teacher?.id ?? ''}
                    onChange={(e) => edit({ action: 'teacher', lesson: selectedLesson.id, teacher: e.target.value })}
                  />
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  leftIcon={Trash2}
                  onClick={async () => {
                    const res = await edit({ action: 'remove', lesson: selectedLesson.id });
                    if (res) setSelected(null);
                  }}
                >
                  Take out
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
              Done
            </Button>
          </div>
        )}
        {mode === 'master' ? (
          <MasterGrid hues={hues} sections={sectionsWithLessons} day={activeDay} selected={selected} placing={placing} onCell={writable ? onCell : undefined} />
        ) : (
          <ClassGrid
            hues={hues}
            caption={`Draft timetable of ${activeSection.displayName}`}
            days={orderDays(Object.keys(activeSection.periods))}
            periods={activeSection.periods}
            lessons={activeSection.lessons}
            selected={selected && selected.sectionId === activeSection.id ? selected : null}
            targetable={placing?.sectionId === activeSection.id}
            onCell={writable ? (cell) => onCell({ ...cell, sectionId: activeSection.id }) : undefined}
          />
        )}
        <p className="text-caption text-fg-muted">Each teacher’s week of this draft: Timetable Views → Teacher, with “Draft”.</p>
      </Card>

      <PublishModal
        role={role}
        draft={draft}
        today={builder.today}
        open={dialog === 'publish'}
        onClose={() => setDialog(null)}
        onDone={(res) => {
          setDialog(null);
          setLocal(null);
          onChanged(`Published from ${res.effectiveFrom}: ${res.changed} class${res.changed === 1 ? '' : 'es'} changed.${res.warnings?.length ? ` ${res.warnings[0]}` : ''}`);
        }}
      />
      <ConfirmModal
        open={dialog === 'discard'}
        onClose={() => setDialog(null)}
        title="Discard this draft?"
        description="Its lessons are thrown away. Published timetables do not change."
        confirmLabel="Discard"
        run={() => discardDraft(role, draft.id, draft.revision)}
        onDone={() => {
          setDialog(null);
          setLocal(null);
          onChanged('The draft was discarded.');
        }}
      />
    </div>
  );
}

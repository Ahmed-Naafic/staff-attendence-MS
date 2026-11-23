import { useId } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Alert, Button, Checkbox, Input, Modal, RadioGroup, Select, Switch } from '../../../components/ui';
import { requestFailure, useDialogForm } from '../../../hooks/useDialogForm.js';
import { generateTimetable, moveSitting, setInvigilators } from '../data/examApi.js';
import { validateGenerate } from '../utils/examRules.js';

const failure = (error) => requestFailure(error);

function Footer({ formId, saving, onClose, label }) {
  return (
    <>
      <Button variant="outline" onClick={onClose} disabled={saving}>
        Cancel
      </Button>
      <Button type="submit" form={formId} loading={saving}>
        {label}
      </Button>
    </>
  );
}

/**
 * Generate (or regenerate) a branch's timetable: shifts and their sessions, the gap between sessions,
 * the rooms (with this examination's seats), staff left out, the order students are seated in and the
 * most papers a class sits a day. `options` from loadTimetableOptions.
 */
export function GenerateModal({ role, examId, branchId, options, regenerate, open, onClose, onDone }) {
  const formId = useId();
  const d = options?.defaults;
  const initial = {
    shifts: d?.shifts.map((s) => ({ ...s })) ?? [{ name: 'Morning', start: '08:00', sessions: 2 }],
    gapMinutes: String(d?.gapMinutes ?? 30),
    rooms: Object.fromEntries((options?.rooms ?? []).map((r) => {
      const chosen = d?.rooms.find((x) => x.roomId === r.id);
      return [r.id, { on: Boolean(chosen), capacity: chosen?.capacity ? String(chosen.capacity) : '' }];
    })),
    useAllRooms: d?.useAllRooms ?? false,
    excludedStaff: d?.excludedStaff ?? [],
    distribution: d?.distribution ?? 'alphabetical',
    maxPapersPerDay: String(d?.maxPapersPerDay ?? 2),
  };
  const form = useDialogForm(open, initial, failure);
  const v = form.values;
  const setShift = (i, key, value) => form.set('shifts', v.shifts.map((s, j) => (j === i ? { ...s, [key]: value } : s)));
  const chosenRooms = (options?.rooms ?? []).filter((r) => v.rooms[r.id]?.on);
  const seats = chosenRooms.reduce((n, r) => n + (Number(v.rooms[r.id].capacity) || r.capacity), 0);
  const days = options?.days.filter((x) => x.schoolDay).length ?? 0;

  const save = () => {
    const rooms = chosenRooms.map((r) => ({ room: r.id, capacity: v.rooms[r.id].capacity }));
    const problems = validateGenerate({ shifts: v.shifts.map((s) => ({ ...s, sessions: Number(s.sessions) })), gapMinutes: v.gapMinutes, rooms });
    const perDay = Number(v.maxPapersPerDay);
    if (!Number.isInteger(perDay) || perDay < 1 || perDay > 6) problems.maxPapersPerDay = 'A whole number from 1 to 6.';
    const body = {
      shifts: v.shifts.map((s) => ({ name: s.name.trim(), start: s.start, sessions: Number(s.sessions) })),
      gapMinutes: Number(v.gapMinutes),
      rooms: rooms.map((r) => ({ room: r.room, ...(r.capacity !== '' && { capacity: Number(r.capacity) }) })),
      useAllRooms: v.useAllRooms,
      excludedStaff: v.excludedStaff,
      distribution: v.distribution,
      maxPapersPerDay: perDay,
    };
    return form.submit(problems, ['shifts', 'gapMinutes', 'rooms', 'maxPapersPerDay', 'excludedStaff'], () => generateTimetable(role, examId, branchId, body), onDone);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={regenerate ? 'Generate Timetable Again' : 'Generate Timetable'}
      description={options ? `${options.branch.name}: ${options.students} students, ${days} examination day${days === 1 ? '' : 's'} (school days from today).` : undefined}
      loading={form.saving}
      error={form.formError}
      footer={<Footer formId={formId} saving={form.saving} onClose={onClose} label="Generate" />}
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-5">
        {regenerate && <Alert variant="warning">The current timetable of this branch is replaced, including changes made by hand, and must be published again.</Alert>}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-small font-medium text-fg">Shifts of each day</legend>
          <p className="text-caption text-fg-muted">Each shift runs its sessions one after another; a session lasts as long as its longest paper.</p>
          {v.shifts.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_7rem_6rem_auto] items-end gap-2">
              <Input label="Shift" hideLabel={i > 0} value={s.name} maxLength={30} onChange={(e) => setShift(i, 'name', e.target.value)} />
              <Input label="Starts" hideLabel={i > 0} type="time" value={s.start} onChange={(e) => setShift(i, 'start', e.target.value)} />
              <Select label="Sessions" hideLabel={i > 0} options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: String(n) }))} value={String(s.sessions)} onChange={(e) => setShift(i, 'sessions', Number(e.target.value))} />
              <Button variant="ghost" iconOnly leftIcon={Trash2} aria-label={`Remove the ${s.name || 'shift'}`} disabled={v.shifts.length === 1} onClick={() => form.set('shifts', v.shifts.filter((_, j) => j !== i))} />
            </div>
          ))}
          {form.errors.shifts && <p className="text-small text-error-fg">{form.errors.shifts}</p>}
          {v.shifts.length < 4 && (
            <Button size="sm" variant="outline" leftIcon={Plus} className="w-fit" onClick={() => form.set('shifts', [...v.shifts, { name: v.shifts.length === 1 ? 'Afternoon' : `Shift ${v.shifts.length + 1}`, start: '13:00', sessions: 1 }])}>
              Add Shift
            </Button>
          )}
        </fieldset>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input type="number" label="Gap between sessions (minutes)" min={0} max={180} value={v.gapMinutes} error={form.errors.gapMinutes} onChange={(e) => form.set('gapMinutes', e.target.value)} />
          <Input type="number" label="Most papers a class sits a day" min={1} max={6} value={v.maxPapersPerDay} error={form.errors.maxPapersPerDay} onChange={(e) => form.set('maxPapersPerDay', e.target.value)} />
          <RadioGroup
            name={`${formId}-distribution`}
            legend="Students seated in"
            options={[{ value: 'alphabetical', label: 'Alphabetical order' }, { value: 'random', label: 'Random order' }]}
            value={v.distribution}
            onChange={(next) => form.set('distribution', next)}
          />
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-small font-medium text-fg">Rooms</legend>
          {options && !options.rooms.length ? (
            <Alert variant="warning">This branch has no active examination rooms. Add them under Rooms first.</Alert>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {(options?.rooms ?? []).map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                  <Checkbox label={r.name} description={`${r.capacity} seats normally`} checked={v.rooms[r.id]?.on ?? false} onChange={(e) => form.set('rooms', { ...v.rooms, [r.id]: { ...v.rooms[r.id], on: e.target.checked } })} />
                  <Input
                    label={`Seats in ${r.name} for this examination`}
                    hideLabel
                    type="number"
                    min={1}
                    max={500}
                    placeholder={String(r.capacity)}
                    className="w-24"
                    disabled={!v.rooms[r.id]?.on}
                    value={v.rooms[r.id]?.capacity ?? ''}
                    onChange={(e) => form.set('rooms', { ...v.rooms, [r.id]: { ...v.rooms[r.id], capacity: e.target.value } })}
                  />
                </div>
              ))}
            </div>
          )}
          {form.errors.rooms && <p className="text-small text-error-fg">{form.errors.rooms}</p>}
          <p className={seats < (options?.largestClass ?? 0) ? 'text-small text-error-fg' : 'text-caption text-fg-muted'}>
            {seats} seats chosen; the largest class has {options?.largestClass ?? 0} students. Papers of one subject sit together when the seats allow.
          </p>
          <Switch label="Use every chosen room in every session" description="Off: each session uses the fewest rooms that seat its students (fewer invigilators)." checked={v.useAllRooms} onChange={(next) => form.set('useAllRooms', next)} />
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-small font-medium text-fg">Invigilators</legend>
          <p className="text-caption text-fg-muted">
            One invigilator per {options?.settings.studentsPerInvigilator} students, {options?.settings.roomsPerInvigilator === 1 ? 'one room each per session' : `up to ${options?.settings.roomsPerInvigilator} rooms each per session`}
            {options?.settings.avoidOwnSubject ? ', never a teacher of a subject being sat in the room' : ''} (Settings). Untick anyone who should not invigilate.
          </p>
          <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto rounded-md border border-border p-3 sm:grid-cols-2">
            {(options?.staff ?? []).map((p) => (
              <Checkbox
                key={p.id}
                label={p.name}
                description={[p.staffId, p.jobTitle].filter(Boolean).join(' · ')}
                checked={!v.excludedStaff.includes(p.id)}
                onChange={(e) => form.set('excludedStaff', e.target.checked ? v.excludedStaff.filter((x) => x !== p.id) : [...v.excludedStaff, p.id])}
              />
            ))}
            {options && !options.staff.length && <p className="text-small text-fg-muted">This branch has no active staff.</p>}
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}

/**
 * Moves one paper of a session to another session, or to a new session at a date and time.
 * `adding` (no `session`): Add Session, the same move into a new session, choosing the paper from every
 * session not yet sat (a session is never empty: it exists through its papers).
 */
export function MoveModal({ role, examId, branchId, timetable, session, adding = false, open, onClose, onDone }) {
  const formId = useId();
  const movable = adding ? (timetable?.sessions ?? []).filter((s) => !s.past) : session ? [session] : [];
  const papers = movable.flatMap((s) => s.papers.map((p) => ({ ...p, from: s })));
  const form = useDialogForm(open, { sitting: adding ? '' : (session?.papers[0]?.sittingId ?? ''), mode: adding ? 'new' : 'existing', session: '', date: session?.date ?? '', start: '' }, failure);
  const v = form.values;
  const paper = papers.find((p) => p.sittingId === v.sitting);
  const fromId = paper?.from.id ?? session?.id;
  const targets = (timetable?.sessions ?? []).filter((s) => s.id !== fromId && !s.past && !s.papers.some((p) => p.class.id === paper?.class.id));
  const save = () => {
    const problems = {};
    if (!v.sitting) problems.sitting = 'Choose the paper.';
    if (v.mode === 'existing' && !v.session) problems.session = 'Choose a session.';
    if (v.mode === 'new') {
      if (!v.date) problems.date = 'Choose the date.';
      if (!v.start) problems.start = 'Choose the start time.';
    }
    const body = v.mode === 'existing' ? { session: v.session } : { date: v.date, start: v.start };
    return form.submit(problems, ['session', 'date', 'start'], () => moveSitting(role, examId, branchId, v.sitting, body), onDone);
  };
  const exam = timetable?.examination;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={adding ? 'Add a Session' : 'Move a Paper'}
      description={
        adding
          ? 'Choose a paper and when its new session starts. The shift follows the start time; the session lasts as long as the paper, and both sessions are seated and given invigilators again.'
          : 'Both sessions are seated and given invigilators again.'
      }
      loading={form.saving}
      error={form.formError}
      footer={<Footer formId={formId} saving={form.saving} onClose={onClose} label={adding ? 'Add Session' : 'Move Paper'} />}
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-4">
        <Select
          label="Paper"
          placeholder={adding ? (papers.length ? 'Choose a paper' : 'No paper left to move') : undefined}
          options={papers.map((p) => ({ value: p.sittingId, label: adding ? `${p.subject.name} · ${p.class.name} (now ${p.from.date} ${p.from.start})` : `${p.class.name} · ${p.subject.name}` }))}
          value={v.sitting}
          error={form.errors.sitting}
          onChange={(e) => form.set('sitting', e.target.value)}
        />
        {!adding && (
          <RadioGroup
            name={`${formId}-mode`}
            legend="Move it to"
            options={[{ value: 'existing', label: 'Another session' }, { value: 'new', label: 'A new session' }]}
            value={v.mode}
            onChange={(next) => form.set('mode', next)}
          />
        )}
        {v.mode === 'existing' ? (
          <Select
            label="Session"
            placeholder={targets.length ? 'Choose a session' : 'No session without this class'}
            options={targets.map((s) => ({ value: s.id, label: `${s.date} ${s.start}–${s.end} · ${s.papers.map((p) => p.subject.name).join(', ')}` }))}
            value={v.session}
            error={form.errors.session}
            onChange={(e) => form.set('session', e.target.value)}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input type="date" label="Date" min={timetable?.today > exam?.startDate ? timetable?.today : exam?.startDate} max={exam?.endDate} value={v.date} error={form.errors.date} onChange={(e) => form.set('date', e.target.value)} />
            <Input type="time" label="Starts" value={v.start} error={form.errors.start} onChange={(e) => form.set('start', e.target.value)} />
          </div>
        )}
      </form>
    </Modal>
  );
}

/** Replaces a room's invigilators in a session. `staff`: the branch's staff (options). */
export function InvigilatorModal({ role, examId, branchId, session, room, staff, busyIds, open, onClose, onDone }) {
  const formId = useId();
  const form = useDialogForm(open, { chosen: room?.invigilators.map((i) => i.id) ?? [] }, failure);
  const chosen = form.values.chosen;
  const save = () => {
    const problems = chosen.length > 10 ? { staff: 'At most 10.' } : {};
    return form.submit(problems, ['staff'], () => setInvigilators(role, examId, branchId, session.id, { room: room.room.id, staff: chosen }), onDone);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Invigilators of ${room?.room.name ?? ''}`}
      description={session ? `${session.date} ${session.start}–${session.end}: ${room?.students} students (${room?.need} invigilator${room?.need === 1 ? '' : 's'} needed).` : undefined}
      loading={form.saving}
      error={form.formError}
      footer={<Footer formId={formId} saving={form.saving} onClose={onClose} label="Save Invigilators" />}
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-2">
        <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
          {(staff ?? []).map((p) => {
            const elsewhere = busyIds?.has(p.id) && !room?.invigilators.some((i) => i.id === p.id);
            return (
              <Checkbox
                key={p.id}
                label={p.name}
                description={elsewhere ? 'In another room this session' : [p.staffId, p.jobTitle].filter(Boolean).join(' · ')}
                disabled={elsewhere}
                checked={chosen.includes(p.id)}
                onChange={(e) => form.set('chosen', e.target.checked ? [...chosen, p.id] : chosen.filter((x) => x !== p.id))}
              />
            );
          })}
        </div>
        {form.errors.staff && <p className="text-small text-error-fg">{form.errors.staff}</p>}
      </form>
    </Modal>
  );
}

import { useId, useState } from 'react';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { Alert, Button, Checkbox, Input, Modal, Select, Textarea } from '../../../components/ui';
import { requestFailure, useDialogForm } from '../../../hooks/useDialogForm.js';
import { formatFullDay } from '../../../lib/format.js';
import { clean, WEEK, WEEKDAY_SHORT } from '../../academic-calendar/utils/calendarRules.js';
import { createBellSchedule, saveBellTimes, updateBellSchedule } from '../data/timetableApi.js';
import { BELL_NAME_MAX, generatePeriods, MAX_PERIOD_NUMBER, periodsBody, validatePeriodRows } from '../utils/timetableRules.js';

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
 * Create (bell null) or rename a bell schedule. The Owner chooses, when creating, the whole school or
 * one branch; a Manager's is their branch's.
 */
export function BellScheduleModal({ role, bell, branches, open, onClose, onSaved }) {
  const formId = useId();
  const owner = role === 'OWNER';
  const form = useDialogForm(open, { name: bell?.name ?? '', description: bell?.description ?? '', branch: '' }, failure);
  const v = form.values;
  const save = () => {
    const name = clean(v.name);
    const problems = {};
    if (!name) problems.name = 'Name is required, e.g. Morning.';
    else if (name.length > BELL_NAME_MAX) problems.name = `At most ${BELL_NAME_MAX} characters.`;
    const description = clean(v.description) || null;
    if (bell) {
      const body = Object.fromEntries(Object.entries({ name, description }).filter(([k, value]) => value !== (bell[k] || null)));
      if (!Object.keys(body).length) return onSaved(bell);
      return form.submit(problems, ['name', 'description'], () => updateBellSchedule(role, bell.id, body), onSaved);
    }
    return form.submit(problems, ['name', 'description', 'branch'], () => createBellSchedule(role, { name, description, ...(owner && v.branch && { branch: v.branch }) }), onSaved);
  };
  const field = (name) => ({ id: `${formId}-${name}`, value: v[name], error: form.errors[name], onChange: (e) => form.set(name, e.target.value) });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={bell ? 'Edit Bell Schedule' : 'Add Bell Schedule'}
      description="A bell schedule gives the times of a school day’s lessons and breaks. Sections follow it through their timetable."
      loading={form.saving}
      error={form.formError}
      footer={<Footer formId={formId} saving={form.saving} onClose={onClose} label={bell ? 'Save Changes' : 'Add Bell Schedule'} />}
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-4">
        <Input label="Name" required autoComplete="off" placeholder="Morning" {...field('name')} />
        {!bell && owner && (
          <Select
            label="For"
            options={[{ value: '', label: 'The whole school (every branch can use it)' }, ...(branches ?? []).map((b) => ({ value: b.id, label: `${b.name} only` }))]}
            hint="A branch’s own schedule can also be managed by its Manager."
            {...field('branch')}
          />
        )}
        <Textarea label="Description" rows={2} hint="Optional." {...field('description')} />
      </form>
    </Modal>
  );
}

const DEFAULT_DAYS = ['SAT', 'SUN', 'MON', 'TUE', 'WED', 'THU'];
const toRows = (periods) => (periods ?? []).map((p) => ({ kind: p.kind, number: p.number, name: p.name ?? '', days: [...p.days], start: p.start, end: p.end, mainBreak: Boolean(p.mainBreak) }));

/** Quick fill: lessons of equal length with a main break. Replaces the rows. */
function QuickFill({ onFill }) {
  const id = useId();
  const [s, setS] = useState({ start: '07:30', lessonMinutes: '45', lessons: '7', breakAfter: '4', breakMinutes: '30' });
  const set = (k) => (e) => setS((c) => ({ ...c, [k]: e.target.value }));
  return (
    <fieldset className="grid grid-cols-2 gap-3 rounded-md border border-border p-3 sm:grid-cols-6">
      <legend className="px-1 text-small font-medium text-fg">Quick fill</legend>
      <Input id={`${id}-s`} label="First lesson" type="time" value={s.start} onChange={set('start')} />
      <Input id={`${id}-l`} label="Lesson (min)" type="number" min={5} max={240} value={s.lessonMinutes} onChange={set('lessonMinutes')} />
      <Input id={`${id}-n`} label="Lessons" type="number" min={1} max={MAX_PERIOD_NUMBER} value={s.lessons} onChange={set('lessons')} />
      <Input id={`${id}-a`} label="Break after" type="number" min={0} max={MAX_PERIOD_NUMBER} value={s.breakAfter} onChange={set('breakAfter')} hint="0: none" />
      <Input id={`${id}-b`} label="Break (min)" type="number" min={0} max={240} value={s.breakMinutes} onChange={set('breakMinutes')} />
      <div className="flex items-end">
        <Button
          variant="outline"
          leftIcon={Wand2}
          onClick={() =>
            onFill(
              generatePeriods({
                start: s.start,
                lessonMinutes: Number(s.lessonMinutes),
                lessons: Number(s.lessons),
                breakAfter: Number(s.breakAfter),
                breakMinutes: Number(s.breakMinutes),
                days: DEFAULT_DAYS,
              }),
            )
          }
        >
          Fill
        </Button>
      </div>
    </fieldset>
  );
}

/**
 * New times for a bell schedule from a date: lessons (numbered periods) and breaks, each on chosen
 * weekdays (different days may differ, e.g. a short Thursday). The main break splits the day into
 * the two halves Managers take attendance for. `start`: the version to start from (current times).
 */
export function BellTimesModal({ role, bell, start, earliest, open, onClose, onSaved }) {
  const formId = useId();
  const form = useDialogForm(open, { effectiveFrom: earliest, rows: toRows(start?.periods) }, failure);
  const rows = form.values.rows;
  const setRows = (next) => form.set('rows', next);
  const update = (i, patch) => setRows(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const nextNumber = () => Math.min(MAX_PERIOD_NUMBER, Math.max(0, ...rows.filter((r) => r.kind === 'lesson').map((r) => r.number || 0)) + 1);
  const lastEnd = rows.length ? rows[rows.length - 1].end : '07:30';
  const add = (kind) => setRows([...rows, { kind, number: kind === 'lesson' ? nextNumber() : null, name: kind === 'break' ? 'Break' : '', days: rows.length ? [...rows[rows.length - 1].days] : [...DEFAULT_DAYS], start: lastEnd, end: '', mainBreak: false }]);
  const rowError = (i) => form.errors[`periods.${i}`];

  const save = () => {
    const problems = validatePeriodRows(rows);
    if (!form.values.effectiveFrom) problems.effectiveFrom = 'Choose the date the times apply from.';
    else if (form.values.effectiveFrom < earliest) problems.effectiveFrom = `Choose ${earliest} or a later date.`;
    const fields = ['effectiveFrom', 'periods', ...rows.map((_, i) => `periods.${i}`)];
    return form.submit(problems, fields, () => saveBellTimes(role, bell.id, { effectiveFrom: form.values.effectiveFrom, periods: periodsBody(rows) }), onSaved);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Times of ${bell?.name ?? 'the bell schedule'}`}
      description={`Applies from the date you choose until the next change. Days before ${formatFullDay(earliest)} keep their times.`}
      loading={form.saving}
      error={form.formError}
      footer={<Footer formId={formId} saving={form.saving} onClose={onClose} label="Save Times" />}
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-4">
        <Input
          id={`${formId}-from`}
          label="Applies from"
          type="date"
          required
          min={earliest}
          value={form.values.effectiveFrom}
          error={form.errors.effectiveFrom}
          onChange={(e) => form.set('effectiveFrom', e.target.value)}
          fieldClassName="max-w-xs"
        />
        <QuickFill onFill={setRows} />
        {form.errors.periods && <Alert variant="error">{form.errors.periods}</Alert>}
        <div role="region" aria-label="Lessons and breaks" tabIndex={0} className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-small">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="py-2 pr-2 font-medium">Type</th>
                <th className="py-2 pr-2 font-medium">Period</th>
                <th className="py-2 pr-2 font-medium">Name</th>
                <th className="py-2 pr-2 font-medium">Days</th>
                <th className="py-2 pr-2 font-medium">Start</th>
                <th className="py-2 pr-2 font-medium">End</th>
                <th className="py-2 pr-2 font-medium">Main break</th>
                <th className="py-2 font-medium">
                  <span className="sr-only">Remove</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={`border-t border-border align-top ${rowError(i) ? 'bg-error-soft' : ''}`} title={rowError(i) || undefined}>
                  <td className="py-2 pr-2">
                    <select
                      aria-label={`Row ${i + 1} type`}
                      className="rounded-md border border-border bg-surface px-2 py-1.5"
                      value={r.kind}
                      onChange={(e) => update(i, e.target.value === 'lesson' ? { kind: 'lesson', number: nextNumber(), mainBreak: false, name: '' } : { kind: 'break', number: null, name: 'Break' })}
                    >
                      <option value="lesson">Lesson</option>
                      <option value="break">Break</option>
                    </select>
                  </td>
                  <td className="py-2 pr-2">
                    {r.kind === 'lesson' ? (
                      <input
                        aria-label={`Row ${i + 1} period number`}
                        type="number"
                        min={1}
                        max={MAX_PERIOD_NUMBER}
                        className="w-16 rounded-md border border-border bg-surface px-2 py-1.5"
                        value={r.number ?? ''}
                        onChange={(e) => update(i, { number: e.target.value === '' ? null : Number(e.target.value) })}
                      />
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      aria-label={`Row ${i + 1} name`}
                      className="w-28 rounded-md border border-border bg-surface px-2 py-1.5"
                      placeholder={r.kind === 'break' ? 'Break' : 'Optional'}
                      value={r.name}
                      maxLength={40}
                      onChange={(e) => update(i, { name: e.target.value })}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <div className="flex flex-wrap gap-1" role="group" aria-label={`Row ${i + 1} days`}>
                      {WEEK.map((d) => (
                        <label key={d} className="flex items-center gap-1 rounded border border-border px-1.5 py-1">
                          <input type="checkbox" checked={r.days.includes(d)} onChange={() => update(i, { days: r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d] })} />
                          <span>{WEEKDAY_SHORT[d]}</span>
                        </label>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 pr-2">
                    <input aria-label={`Row ${i + 1} start`} type="time" className="rounded-md border border-border bg-surface px-2 py-1.5" value={r.start} onChange={(e) => update(i, { start: e.target.value })} />
                  </td>
                  <td className="py-2 pr-2">
                    <input aria-label={`Row ${i + 1} end`} type="time" className="rounded-md border border-border bg-surface px-2 py-1.5" value={r.end} onChange={(e) => update(i, { end: e.target.value })} />
                  </td>
                  <td className="py-2 pr-2">
                    {r.kind === 'break' && <Checkbox label="Main" checked={r.mainBreak} onChange={(e) => update(i, { mainBreak: e.target.checked })} />}
                  </td>
                  <td className="py-2">
                    <Button size="sm" variant="ghost" aria-label={`Remove row ${i + 1}`} onClick={() => setRows(rows.filter((_, k) => k !== i))}>
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.some((_, i) => rowError(i)) && (
          <Alert variant="error" title="Some rows need attention">
            <ul className="list-disc pl-5">
              {rows.map((_, i) => rowError(i) && <li key={i}>{`Row ${i + 1}: ${rowError(i)}`}</li>)}
            </ul>
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" leftIcon={Plus} onClick={() => add('lesson')}>
            Add Lesson
          </Button>
          <Button variant="outline" size="sm" leftIcon={Plus} onClick={() => add('break')}>
            Add Break
          </Button>
        </div>
        <p className="text-small text-fg-muted">
          Mark one break per day as the main break to split the day into two halves (Managers then take attendance before and after it). Lessons on different days can have different times: add a row
          for those days.
        </p>
      </form>
    </Modal>
  );
}

import { useId } from 'react';
import { Button, Checkbox, Input, Modal, RadioGroup, Select, Switch, Textarea } from '../../../components/ui';
import { requestFailure, useDialogForm } from '../../../hooks/useDialogForm.js';
import { formatFullDay } from '../../../lib/format.js';
import { cancelEntry, cancelWeekdays, createEntry, saveWeekdays, setBranchWeekdaysAllowed, updateEntry } from '../data/calendarApi.js';
import { clean, daysText, ENTRY_TYPES, validateEntry, validateWeekdays, WEEK, WEEKDAY_NAMES } from '../utils/calendarRules.js';

const failure = (error) => requestFailure(error);

function Footer({ formId, saving, onClose, label, variant }) {
  return (
    <>
      <Button variant="outline" onClick={onClose} disabled={saving}>
        Cancel
      </Button>
      <Button type="submit" form={formId} loading={saving} variant={variant}>
        {label}
      </Button>
    </>
  );
}

/**
 * Change weekly school days from a date. Owner: the school's days. Manager: their branch's own days,
 * or back to the school's. `limits`: { earliest, yearStart, yearEnd }; `current`: the days in effect.
 */
export function WeekdaysModal({ role, year, branchName, current, schoolDays, limits, open, onClose, onSaved }) {
  const formId = useId();
  const manager = role === 'MANAGER';
  const form = useDialogForm(open, { mode: 'own', days: current ?? [], effectiveFrom: limits.earliest }, failure);
  const follows = manager && form.values.mode === 'school';
  const toggle = (day) => form.set('days', form.values.days.includes(day) ? form.values.days.filter((d) => d !== day) : [...form.values.days, day]);

  const save = () => {
    const body = follows ? { followsSchool: true, effectiveFrom: form.values.effectiveFrom } : { days: form.values.days, effectiveFrom: form.values.effectiveFrom };
    return form.submit(validateWeekdays({ ...form.values, followsSchool: follows }, limits), ['days', 'effectiveFrom'], () => saveWeekdays(role, year.id, body), onSaved);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={manager ? `School days at ${branchName}` : 'Change school days'}
      description={`${year.name}. New days apply from the chosen date; days before it stay as they were.`}
      loading={form.saving}
      error={form.formError}
      footer={<Footer formId={formId} saving={form.saving} onClose={onClose} label="Save school days" />}
    >
      <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); save(); }} className="flex flex-col gap-5">
        {manager && (
          <RadioGroup
            legend="Your branch"
            value={form.values.mode}
            onChange={(value) => form.set('mode', value)}
            options={[
              { value: 'own', label: 'Use our own school days' },
              { value: 'school', label: 'Follow the school’s days', description: `Currently: ${daysText(schoolDays)}` },
            ]}
          />
        )}
        {!follows && (
          <fieldset className="flex flex-col gap-2" aria-describedby={form.errors.days ? `${formId}-days-error` : undefined}>
            <legend className="mb-1 text-label text-fg">School days</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {WEEK.map((day) => (
                <Checkbox key={day} label={WEEKDAY_NAMES[day]} checked={form.values.days.includes(day)} onChange={() => toggle(day)} />
              ))}
            </div>
            {form.errors.days && (
              <p id={`${formId}-days-error`} className="text-small text-error-fg">
                {form.errors.days}
              </p>
            )}
          </fieldset>
        )}
        <Input
          id={`${formId}-effectiveFrom`}
          label="Apply from"
          type="date"
          required
          min={limits.earliest}
          max={limits.yearEnd}
          value={form.values.effectiveFrom}
          onChange={(event) => form.set('effectiveFrom', event.target.value)}
          error={form.errors.effectiveFrom}
          hint={`Earliest: ${formatFullDay(limits.earliest)}. Student attendance follows these days.`}
        />
      </form>
    </Modal>
  );
}

/**
 * Add (entry null) or edit a calendar entry. Owner: holidays, and closures and reopenings of any
 * branch. Manager: closures and reopenings of their branch. `context`: { firstEditable, yearStart,
 * yearEnd, branches (Owner), holidays (reopenable holidays of the year) }.
 */
export function EntryModal({ role, year, entry, defaultType, context, open, onClose, onSaved }) {
  const formId = useId();
  const owner = role === 'OWNER';
  const creating = !entry;
  const typeOptions = owner ? ['holiday', 'closure', 'reopening', 'school_day'] : ['closure', 'reopening', 'school_day'];
  const initial = entry
    ? { type: entry.type, name: entry.name, note: entry.note, startDate: entry.startDate, endDate: entry.endDate, allowBranchReopening: entry.allowBranchReopening, branch: entry.branch?.id ?? '', holiday: entry.holiday?.id ?? '', timetableDay: entry.timetableDay ?? '' }
    : { type: defaultType ?? typeOptions[0], name: '', note: '', startDate: '', endDate: '', allowBranchReopening: false, branch: '', holiday: '', timetableDay: '' };
  const form = useDialogForm(open, initial, failure);
  const v = form.values;
  const holiday = (context.holidays ?? []).find((h) => h.id === (entry?.holiday?.id ?? v.holiday));
  const startLocked = !creating && entry.startDate < context.firstEditable;
  const datesLocked = !creating && entry.endDate < context.firstEditable;
  const fields = ['type', 'name', 'note', 'startDate', 'endDate', 'branch', 'holiday', 'allowBranchReopening', 'timetableDay'];

  const save = () => {
    const problems = validateEntry(v, {
      creating,
      needsBranch: owner && v.type !== 'school_day',
      firstEditable: context.firstEditable,
      yearStart: context.yearStart,
      yearEnd: context.yearEnd,
      holidayRange: v.type === 'reopening' && holiday ? { start: holiday.startDate, end: holiday.endDate } : null,
    });
    const name = clean(v.name);
    const note = v.note.trim() || null;
    let request;
    if (creating) {
      const body = {
        type: v.type,
        ...(name && { name }),
        ...(note && { note }),
        startDate: v.startDate,
        endDate: v.endDate,
        ...(owner && v.type !== 'holiday' && v.branch && { branch: v.branch }),
        ...(v.type === 'school_day' && { timetableDay: v.timetableDay }),
        ...(v.type === 'reopening' && { holiday: v.holiday }),
        ...(v.type === 'holiday' && { allowBranchReopening: v.allowBranchReopening }),
      };
      request = () => createEntry(role, year.id, body);
    } else {
      const next = { name, note, startDate: v.startDate, endDate: v.endDate, ...(entry.type === 'holiday' && { allowBranchReopening: v.allowBranchReopening }), ...(entry.type === 'school_day' && { timetableDay: v.timetableDay }) };
      const was = { name: entry.name, note: entry.note || null, startDate: entry.startDate, endDate: entry.endDate, allowBranchReopening: entry.allowBranchReopening, timetableDay: entry.timetableDay };
      const body = Object.fromEntries(Object.entries(next).filter(([key, value]) => value !== was[key]));
      if (!Object.keys(body).length) return onSaved(entry);
      request = () => updateEntry(role, entry.id, body);
    }
    return form.submit(problems, fields, request, onSaved);
  };
  const field = (name) => ({ id: `${formId}-${name}`, value: v[name], error: form.errors[name], onChange: (event) => form.set(name, event.target.value) });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={creating ? 'Add to calendar' : `Edit ${ENTRY_TYPES[entry.type].label.toLowerCase()}`}
      description={`${year.name}. Days before ${formatFullDay(context.firstEditable)} are fixed and cannot be changed.`}
      loading={form.saving}
      error={form.formError}
      footer={<Footer formId={formId} saving={form.saving} onClose={onClose} label={creating ? 'Add' : 'Save changes'} />}
    >
      <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); save(); }} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {creating && (
          <Select
            label="Type"
            options={typeOptions.map((t) => ({ value: t, label: ENTRY_TYPES[t].label }))}
            fieldClassName="sm:col-span-2"
            hint={
              v.type === 'holiday'
                ? 'No school at any branch.'
                : v.type === 'closure'
                  ? 'No school at one branch (e.g. flooding, security).'
                  : v.type === 'school_day'
                    ? 'School on these days following one weekday’s timetable: a make-up day, or a timetable swap. Closures and holidays still win.'
                    : 'School at one branch during part of a school holiday that allows it.'
            }
            {...field('type')}
          />
        )}
        {creating && owner && v.type !== 'holiday' && (
          <Select
            label="Branch"
            required={v.type !== 'school_day'}
            options={[{ value: '', label: v.type === 'school_day' ? 'Whole school (every branch)' : 'Choose a branch' }, ...(context.branches ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))]}
            fieldClassName="sm:col-span-2"
            {...field('branch')}
          />
        )}
        {creating && v.type === 'reopening' && (
          <Select
            label="Holiday to reopen"
            required
            options={[
              { value: '', label: (context.holidays ?? []).length ? 'Choose a holiday' : 'No holiday allows reopening' },
              ...(context.holidays ?? []).map((h) => ({ value: h.id, label: `${h.name} (${h.startDate} to ${h.endDate})` })),
            ]}
            fieldClassName="sm:col-span-2"
            hint="Only holidays that allow branches to reopen are listed."
            {...field('holiday')}
          />
        )}
        <Input
          label="Name"
          required={v.type !== 'reopening'}
          autoComplete="off"
          placeholder={v.type === 'holiday' ? 'Eid al-Fitr' : v.type === 'closure' ? 'Closed: road flooding' : v.type === 'school_day' ? 'Make-up day for the flood closure' : holiday ? `School open during ${holiday.name}` : ''}
          hint={v.type === 'reopening' && creating ? 'Optional: named after the holiday when left empty.' : undefined}
          fieldClassName="sm:col-span-2"
          {...field('name')}
        />
        {v.type === 'school_day' && (
          <Select
            label="Follows the timetable of"
            required
            disabled={startLocked}
            options={[{ value: '', label: 'Choose a weekday' }, ...WEEK.map((d) => ({ value: d, label: WEEKDAY_NAMES[d] }))]}
            hint={startLocked ? 'Started: fixed. End it and add a new one to change it.' : 'Its lessons and bell times are those of this weekday.'}
            fieldClassName="sm:col-span-2"
            {...field('timetableDay')}
          />
        )}
        <Input label="First day" type="date" required disabled={startLocked} min={creating ? context.firstEditable : undefined} hint={startLocked ? 'Already passed: fixed.' : undefined} {...field('startDate')} />
        <Input label="Last day" type="date" required disabled={datesLocked} min={v.startDate || undefined} {...field('endDate')} />
        <Textarea label="Note" rows={2} hint="Optional." fieldClassName="sm:col-span-2" {...field('note')} />
        {v.type === 'holiday' && (
          <Switch
            className="sm:col-span-2"
            label="Branches may reopen"
            description="Managers may then open their branch on some of these days. Turning it off cancels the reopenings’ later days."
            checked={v.allowBranchReopening}
            onChange={(next) => form.set('allowBranchReopening', next)}
          />
        )}
      </form>
    </Modal>
  );
}

export const cancelEntryAction = (role, entry) => () => cancelEntry(role, entry.id);
export const cancelWeekdaysAction = (role, yearId, version) => () => cancelWeekdays(role, yearId, version.id);
export const branchWeekdaysAction = (yearId, allowed) => () => setBranchWeekdaysAllowed(yearId, allowed);

import { useId, useState } from 'react';
import { Badge, Button, Checkbox, Input, Modal, RadioGroup, Select, Textarea } from '../../../components/ui';
import { requestFailure, useDialogForm } from '../../../hooks/useDialogForm.js';
import { useApiData } from '../../../hooks/useApiData.js';
import { assignTeaching, createSubject, loadTeachers, saveCurriculum, setAssignmentEnd, updateSubject } from '../data/teachingApi.js';
import { clean, earliestLastDay, validateAssignment, validateSubject, weeklyLessons } from '../utils/teachingRules.js';

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

/** Add (subject null) or edit a subject (School Owner). */
export function SubjectModal({ subject, open, onClose, onSaved }) {
  const formId = useId();
  const form = useDialogForm(open, { name: subject?.name ?? '', code: subject?.code ?? '', description: subject?.description ?? '' }, failure);
  const save = () => {
    const values = { name: clean(form.values.name), code: clean(form.values.code).toUpperCase() || null, description: clean(form.values.description) || null };
    const body = subject ? Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== (subject[k] || null))) : values;
    if (subject && !Object.keys(body).length) return onSaved(subject);
    return form.submit(validateSubject(form.values), ['name', 'code', 'description'], () => (subject ? updateSubject(subject.id, body) : createSubject(body)), onSaved);
  };
  const field = (name) => ({ id: `${formId}-${name}`, value: form.values[name], error: form.errors[name], onChange: (e) => form.set(name, e.target.value) });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={subject ? 'Edit Subject' : 'Add Subject'}
      description="Subjects are created once and used every academic year, in every branch."
      loading={form.saving}
      error={form.formError}
      footer={<Footer formId={formId} saving={form.saving} onClose={onClose} label={subject ? 'Save Changes' : 'Add Subject'} />}
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Input label="Subject name" required autoComplete="off" placeholder="Mathematics" fieldClassName="sm:col-span-2" {...field('name')} />
        <Input label="Code" autoComplete="off" placeholder="MATH" hint="Optional, unique." {...field('code')} />
        <Textarea label="Description" rows={2} hint="Optional." fieldClassName="sm:col-span-3" {...field('description')} />
      </form>
    </Modal>
  );
}

/**
 * The subjects a class studies, with lessons per week (School Owner). No subject chosen: the class is
 * open to every active subject. Subjects still taught in the class cannot be removed (the API says which).
 */
export function CurriculumModal({ cls, curriculum, subjects, open, onClose, onSaved }) {
  const formId = useId();
  const initial = Object.fromEntries((curriculum?.items ?? []).map((i) => [i.subject.id, i.weeklyLessons == null ? '' : String(i.weeklyLessons)]));
  const form = useDialogForm(open, initial, failure);
  const chosen = Object.keys(form.values).filter((id) => form.values[id] !== undefined);
  const options = subjects.filter((s) => s.status === 'active' || chosen.includes(s.id));
  const toggle = (id) => form.set(id, form.values[id] === undefined ? '' : undefined);
  const present = Object.entries(form.values).filter(([, v]) => v !== undefined);
  const save = () => {
    const problems = {};
    const items = present.map(([subject, lessons]) => {
      const n = weeklyLessons(lessons);
      if (Number.isNaN(n)) problems[subject] = 'Lessons per week: a whole number from 1 to 40, or empty.';
      return { subject, weeklyLessons: Number.isNaN(n) ? null : n };
    });
    return form.submit(problems, [], () => saveCurriculum(cls.id, items), onSaved);
  };
  const total = present.reduce((sum, [, v]) => sum + (weeklyLessons(v) || 0), 0);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Subjects of ${cls?.name ?? 'the class'}`}
      description="Used every academic year. Leave everything unticked to allow every active subject."
      size="lg"
      loading={form.saving}
      error={form.formError}
      footer={<Footer formId={formId} saving={form.saving} onClose={onClose} label="Save Subjects" />}
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-3">
        {!options.length && <p className="text-body text-fg-secondary">Your school has no active subjects yet. Add them under Subjects.</p>}
        <ul className="flex flex-col divide-y divide-border">
          {options.map((s) => {
            const on = form.values[s.id] !== undefined;
            return (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <Checkbox label={`${s.name}${s.code ? ` (${s.code})` : ''}`} checked={on} onChange={() => toggle(s.id)} />
                {on && (
                  <Input
                    label={`Lessons per week, ${s.name}`}
                    hideLabel
                    inputMode="numeric"
                    placeholder="Lessons / week"
                    className="w-36"
                    value={form.values[s.id]}
                    error={form.errors[s.id]}
                    onChange={(e) => form.set(s.id, e.target.value)}
                  />
                )}
              </li>
            );
          })}
        </ul>
        <p className="text-small text-fg-muted">
          {present.length ? `${present.length} subject${present.length === 1 ? '' : 's'}, ${total} lesson${total === 1 ? '' : 's'} per week planned.` : 'Open: every active subject can be taught.'}
        </p>
      </form>
    </Modal>
  );
}

/**
 * Give a staff member teaching in a section: a subject (subject teacher) or the whole section (class
 * teacher). `context`: { role (account), section, subjects: [{ id, name }], fixedRole?, fixedSubject?,
 * earliest, yearEnd }. The teacher list puts suggested teachers (by job title) first.
 */
export function AssignModal({ context, open, onClose, onSaved }) {
  const formId = useId();
  const [q, setQ] = useState('');
  const initial = { role: context.fixedRole ?? 'subject', subject: context.fixedSubject ?? '', teacher: '', startDate: context.earliest, endDate: '' };
  const form = useDialogForm(open, initial, failure);
  const teachers = useApiData(() => (open ? loadTeachers(context.role, { q, academicYear: context.section.academicYear.id }) : Promise.resolve(null)), `teachers|${open}|${q}`, { delayMs: 250 });
  const v = form.values;
  const save = () => {
    const body = { role: v.role, teacher: v.teacher, section: context.section.id, ...(v.role === 'subject' && { subject: v.subject }), startDate: v.startDate, ...(v.endDate && { endDate: v.endDate }) };
    return form.submit(validateAssignment(v, { earliest: context.earliest, yearEnd: context.yearEnd }), ['teacher', 'subject', 'startDate', 'endDate', 'role'], () => assignTeaching(context.role, body), onSaved);
  };
  const list = teachers.data?.items ?? [];
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Assign teaching in ${context.section.displayName}`}
      description={`${context.section.academicYear.name} · ${context.section.branch.name}. A job title grants nothing: teaching permissions come from this assignment.`}
      size="lg"
      loading={form.saving}
      error={form.formError}
      footer={<Footer formId={formId} saving={form.saving} onClose={onClose} label="Assign" />}
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {!context.fixedRole && (
          <RadioGroup
            legend="Role"
            orientation="horizontal"
            className="sm:col-span-2"
            value={v.role}
            onChange={(value) => form.set('role', value)}
            options={[
              { value: 'subject', label: 'Subject teacher', description: 'Teaches one subject; takes its lesson attendance.' },
              { value: 'class', label: 'Class teacher', description: 'Responsible for the section as a whole.' },
            ]}
          />
        )}
        {v.role === 'subject' && (
          <Select
            id={`${formId}-subject`}
            label="Subject"
            required
            disabled={Boolean(context.fixedSubject)}
            fieldClassName="sm:col-span-2"
            options={[{ value: '', label: 'Choose a subject' }, ...context.subjects.map((s) => ({ value: s.id, label: s.name }))]}
            value={v.subject}
            error={form.errors.subject}
            onChange={(e) => form.set('subject', e.target.value)}
          />
        )}
        <Input type="search" label="Find a teacher" placeholder="Name, Staff ID or phone" value={q} onChange={(e) => setQ(e.target.value)} fieldClassName="sm:col-span-2" />
        <Select
          id={`${formId}-teacher`}
          label="Teacher"
          required
          fieldClassName="sm:col-span-2"
          options={[
            { value: '', label: teachers.status === 'loading' && !list.length ? 'Loading…' : list.length ? 'Choose a teacher' : 'No staff found' },
            ...list.map((t) => ({
              value: t.id,
              label: `${t.name} (${t.staffId})${t.jobTitle ? ` · ${t.jobTitle}` : ''}${context.role === 'OWNER' && t.homeBranch ? ` · ${t.homeBranch.name}` : ''} · ${t.liveAssignments} assignment${t.liveAssignments === 1 ? '' : 's'}`,
            })),
          ]}
          value={v.teacher}
          error={form.errors.teacher}
          hint={context.role === 'OWNER' ? 'Any active staff member of the school; their home branch does not change.' : 'Active staff of your branch. Teachers from other branches are assigned by your School Owner.'}
          onChange={(e) => form.set('teacher', e.target.value)}
        />
        <Input id={`${formId}-startDate`} label="First day" type="date" required min={context.earliest} max={context.yearEnd} value={v.startDate} error={form.errors.startDate} onChange={(e) => form.set('startDate', e.target.value)} />
        <Input id={`${formId}-endDate`} label="Last day" type="date" min={v.startDate || undefined} max={context.yearEnd} value={v.endDate} error={form.errors.endDate} hint="Optional: empty means until the year ends." onChange={(e) => form.set('endDate', e.target.value)} />
      </form>
    </Modal>
  );
}

/** Set an assignment's last day (end it early, or extend it); days before today are fixed. */
export function EndAssignmentModal({ role, assignment, firstEditable, yearEnd, open, onClose, onSaved }) {
  const formId = useId();
  const earliest = assignment ? earliestLastDay(assignment, firstEditable) : '';
  const form = useDialogForm(open, { lastDay: assignment?.endDate ?? earliest, untilYearEnd: false }, failure);
  if (!assignment) return null;
  const save = () => {
    const lastDay = form.values.untilYearEnd ? null : form.values.lastDay;
    const problems = !lastDay && !form.values.untilYearEnd ? { lastDay: 'Choose the last day.' } : lastDay && lastDay < earliest ? { lastDay: `Choose ${earliest} or later.` } : {};
    return form.submit(problems, ['lastDay'], () => setAssignmentEnd(role, assignment.id, lastDay), onSaved);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change the last day"
      description={`${assignment.teacher.name}: ${assignment.subject ? assignment.subject.name : 'class teacher'} in ${assignment.section.displayName}. Days that have passed stay as they were.`}
      loading={form.saving}
      error={form.formError}
      footer={<Footer formId={formId} saving={form.saving} onClose={onClose} label="Save" />}
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="flex flex-col gap-4">
        <Input
          id={`${formId}-lastDay`}
          label="Last day of teaching"
          type="date"
          disabled={form.values.untilYearEnd}
          min={earliest}
          max={yearEnd}
          value={form.values.lastDay ?? ''}
          error={form.errors.lastDay}
          hint={`${earliest} at the earliest. Choosing yesterday ends it today.`}
          onChange={(e) => form.set('lastDay', e.target.value)}
        />
        <Checkbox label="Until the end of the year" checked={form.values.untilYearEnd} onChange={(e) => form.set('untilYearEnd', e.target.checked)} />
      </form>
    </Modal>
  );
}

/** A compact list of live teaching (staff profiles and the transfer warning). */
export function TeachingList({ items, showBranch = true, empty = 'No teaching assigned.' }) {
  if (!items?.length) return <p className="text-small text-fg-muted">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1.5 text-small">
      {items.map((a) => (
        <li key={a.id} className="flex flex-wrap items-center gap-2">
          <Badge variant={a.role === 'class' ? 'info' : 'neutral'}>{a.role === 'class' ? 'Class teacher' : a.subject.name}</Badge>
          <span className="text-fg">{a.section.displayName}</span>
          {showBranch && <span className="text-fg-muted">{a.branch.name}</span>}
          <span className="text-fg-muted">
            {a.academicYear.name} · {a.endDate ? `${a.startDate} → ${a.endDate}` : `from ${a.startDate}`}
            {a.state === 'scheduled' && ' (scheduled)'}
          </span>
        </li>
      ))}
    </ul>
  );
}

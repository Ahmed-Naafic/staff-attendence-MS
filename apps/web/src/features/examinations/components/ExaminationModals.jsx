import { useId } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Select, Switch, Textarea } from '../../../components/ui';
import { requestFailure, useDialogForm } from '../../../hooks/useDialogForm.js';
import { addPaper, cancelExamination, createExamination, endExamination, updateExamination, updatePaper } from '../data/examApi.js';
import { EXAM_NAME_MAX, examDefaultName, validateExamination } from '../utils/examRules.js';

const failure = (error) => requestFailure(error);
const clean = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
const whole = (v, min, max) => {
  const n = Number(String(v).trim());
  return String(v).trim() !== '' && Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

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
 * Create (detail null) or edit an examination. `options`: from loadExaminationOptions (year, periods,
 * types, classes, branches). `detail`: { examination, classes } when editing. Fields fixed because the
 * examination has started are shown but disabled (the API refuses them too).
 */
export function ExaminationModal({ role, options, detail, open, onClose, onSaved }) {
  const formId = useId();
  const exam = detail?.examination ?? null;
  const locked = exam?.actions.locked ?? [];
  const isLocked = (f) => locked.includes(f);
  const initial = {
    name: exam?.name ?? '',
    description: exam?.description ?? '',
    examType: exam?.examType.id ?? '',
    period: exam?.period?.id ?? '',
    branch: exam ? (exam.branch?.id ?? '') : '',
    startDate: exam?.startDate ?? '',
    endDate: exam?.endDate ?? '',
    stopsLessons: exam?.stopsLessons ?? true,
    stopsTouched: Boolean(exam),
    classes: exam?.classes.map((c) => c.id) ?? [],
  };
  const form = useDialogForm(open, initial, failure);
  const v = form.values;
  const year = options?.academicYear ?? null;
  const type = options?.types.find((t) => t.id === v.examType) ?? (exam && { id: exam.examType.id, name: exam.examType.name });
  const period = options?.periods.find((p) => p.id === v.period) ?? null;
  // The type's choice applies until the person changes the switch themselves.
  const chooseType = (id) => {
    form.set('examType', id);
    const t = options?.types.find((x) => x.id === id);
    if (t && !v.stopsTouched) form.set('stopsLessons', t.stopsLessons);
  };
  const toggleClass = (id, on) => form.set('classes', on ? [...v.classes, id] : v.classes.filter((c) => c !== id));
  const typeOptions = [...(options?.types ?? [])];
  if (exam && !typeOptions.some((t) => t.id === exam.examType.id)) typeOptions.push({ id: exam.examType.id, name: `${exam.examType.name} (inactive)` });
  const periodOptions = [...(options?.periods ?? [])];
  if (exam?.period && !periodOptions.some((p) => p.id === exam.period.id)) periodOptions.push({ id: exam.period.id, name: `${exam.period.name} (inactive)` });

  const save = () => {
    const problems = validateExamination(v, { year, period, today: options?.today, locked, creating: !exam });
    const name = clean(v.name);
    const values = {
      name: name || (exam ? '' : undefined),
      description: clean(v.description) || null,
      examType: v.examType,
      period: v.period || null,
      startDate: v.startDate,
      endDate: v.endDate,
      stopsLessons: v.stopsLessons,
      classes: v.classes,
      ...(role === 'OWNER' && { branch: v.branch || null }),
    };
    const fields = ['name', 'description', 'examType', 'period', 'branch', 'startDate', 'endDate', 'stopsLessons', 'classes'];
    if (exam) {
      const before = { ...initial, description: initial.description || null, period: initial.period || null, branch: initial.branch || null };
      const body = {};
      for (const [k, val] of Object.entries(values)) {
        if (isLocked(k)) continue;
        if (k === 'classes' ? !sameSet(val, before.classes) : val !== before[k]) body[k] = val;
      }
      if (!Object.keys(body).length) return onSaved(detail, false);
      return form.submit(problems, fields, () => updateExamination(role, exam.id, body), (r) => onSaved(r, r.changed));
    }
    if (values.name === undefined) delete values.name;
    return form.submit(problems, fields, () => createExamination(role, { academicYear: year?.id, ...values }), (r) => onSaved(r, true));
  };
  const field = (name) => ({ id: `${formId}-${name}`, value: v[name], error: form.errors[name], disabled: isLocked(name), onChange: (e) => form.set(name, e.target.value) });
  const started = locked.length > 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={exam ? 'Edit Examination' : 'New Examination'}
      description={year ? `${year.name}: ${year.startDate} to ${year.endDate}.` : undefined}
      loading={form.saving}
      error={form.formError}
      footer={<Footer formId={formId} saving={form.saving} onClose={onClose} label={exam ? 'Save Changes' : 'Create Draft'} />}
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {started && (
          <Alert variant="info" className="sm:col-span-2">
            {isLocked('endDate') ? 'This examination is over: only its name and description can change.' : 'This examination has started: its type, period, branches, classes, first day and lessons setting stay as they are. Its last day can be moved (yesterday at the earliest).'}
          </Alert>
        )}
        <Select
          label="Examination type"
          required
          placeholder="Choose a type"
          options={typeOptions.map((t) => ({ value: t.id, label: t.name }))}
          {...field('examType')}
          onChange={(e) => chooseType(e.target.value)}
        />
        <Select label="Period" options={[{ value: '', label: 'The whole year' }, ...periodOptions.map((p) => ({ value: p.id, label: p.name }))]} hint={period ? `${period.startDate} to ${period.endDate}` : undefined} {...field('period')} />
        <Input
          label="Name"
          autoComplete="off"
          maxLength={EXAM_NAME_MAX}
          placeholder={examDefaultName(type, period) || 'Mid-Term – Term 1'}
          hint={exam ? undefined : 'Leave empty to use the type and period.'}
          fieldClassName="sm:col-span-2"
          {...field('name')}
        />
        {role === 'OWNER' && (
          <Select
            label="Held in"
            options={[{ value: '', label: 'Every branch (school-wide)' }, ...(options?.branches ?? []).map((b) => ({ value: b.id, label: b.name }))]}
            hint="A branch examination stops lessons only in that branch."
            fieldClassName="sm:col-span-2"
            {...field('branch')}
          />
        )}
        <Input type="date" label="First day" required min={year?.startDate} max={year?.endDate} {...field('startDate')} />
        <Input type="date" label="Last day" required min={v.startDate || year?.startDate} max={year?.endDate} {...field('endDate')} disabled={isLocked('endDate')} />
        <div className="sm:col-span-2">
          <Switch
            label="Stops normal lessons"
            description="On its days, the classes sitting it have no normal lessons (and no lesson attendance) in the branches holding it. Daily attendance goes on."
            checked={v.stopsLessons}
            disabled={isLocked('stopsLessons')}
            onChange={(next) => {
              form.set('stopsLessons', next);
              form.set('stopsTouched', true);
            }}
          />
        </div>
        <fieldset className="sm:col-span-2" disabled={isLocked('classes')}>
          <legend className="mb-2 text-small font-medium text-fg">Classes sitting it</legend>
          {options && !options.classes.length ? (
            <p className="text-small text-fg-muted">Your school has no active classes yet.</p>
          ) : (
            <div className="flex flex-col overflow-hidden rounded-md border border-border">
            {(options?.classes.length ?? 0) > 1 && (() => {
              const ids = options.classes.map((c) => c.id);
              const picked = ids.filter((x) => v.classes.includes(x)).length;
              return (
                <div className="border-b border-border bg-muted px-3 py-2">
                  <Checkbox
                    label={`Select all classes (${picked} of ${ids.length})`}
                    checked={picked === ids.length}
                    indeterminate={picked > 0 && picked < ids.length}
                    onChange={(e) => form.set('classes', e.target.checked ? [...new Set([...v.classes, ...ids])] : v.classes.filter((x) => !ids.includes(x)))}
                  />
                </div>
              );
            })()}
            <div className="grid max-h-56 grid-cols-1 gap-2 overflow-y-auto p-3 sm:grid-cols-2">
              {(options?.classes ?? []).map((c) => (
                <Checkbox
                  key={c.id}
                  label={c.name}
                  description={c.curriculumSubjects ? `${c.curriculumSubjects} subject${c.curriculumSubjects === 1 ? '' : 's'} in its curriculum` : 'No curriculum: add papers yourself'}
                  checked={v.classes.includes(c.id)}
                  onChange={(e) => toggleClass(c.id, e.target.checked)}
                />
              ))}
            </div>
            </div>
          )}
          <p className="mt-1.5 text-caption text-fg-muted">Each class gets a paper for every subject of its curriculum. You can change the papers afterwards.</p>
          {form.errors.classes && <p className="mt-1 text-small text-error-fg">{form.errors.classes}</p>}
        </fieldset>
        <Textarea label="Description" rows={2} maxLength={300} fieldClassName="sm:col-span-2" {...field('description')} />
      </form>
    </Modal>
  );
}

/** Add (paper null) or change a paper. `classes`: the classes sitting the examination; `options`: subjects and limits. */
export function PaperModal({ role, examId, classes, options, paper, classId, open, onClose, onSaved }) {
  const formId = useId();
  const limits = options?.limits ?? { maxMarks: 1000, paperMinutes: 120 };
  const form = useDialogForm(open, { class: classId ?? classes[0]?.id ?? '', subject: '', maxMarks: String(paper?.maxMarks ?? ''), durationMinutes: String(paper?.durationMinutes ?? limits.paperMinutes) }, failure);
  const v = form.values;
  const taken = classes.find((c) => c.id === v.class)?.papers.map((p) => p.subject.id) ?? [];
  const save = () => {
    const problems = {};
    if (!paper && !v.class) problems.class = 'Choose the class.';
    if (!paper && !v.subject) problems.subject = 'Choose the subject.';
    const marks = String(v.maxMarks).trim() === '' && !paper ? undefined : whole(v.maxMarks, 1, limits.maxMarks);
    if (marks === null) problems.maxMarks = `A whole number from 1 to ${limits.maxMarks}.`;
    const minutes = whole(v.durationMinutes, 15, 480);
    if (minutes === null) problems.durationMinutes = 'A whole number of minutes from 15 to 480.';
    const fields = ['class', 'subject', 'maxMarks', 'durationMinutes'];
    if (paper) {
      const body = {};
      if (marks !== paper.maxMarks) body.maxMarks = marks;
      if (minutes !== paper.durationMinutes) body.durationMinutes = minutes;
      if (!Object.keys(problems).length && !Object.keys(body).length) return onClose();
      return form.submit(problems, fields, () => updatePaper(role, examId, paper.id, body), onSaved);
    }
    return form.submit(problems, fields, () => addPaper(role, examId, { class: v.class, subject: v.subject, ...(marks !== undefined && { maxMarks: marks }), durationMinutes: minutes }), onSaved);
  };
  const field = (name) => ({ id: `${formId}-${name}`, value: v[name], error: form.errors[name], onChange: (e) => form.set(name, e.target.value) });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={paper ? `Change Paper: ${paper.subject.name}` : 'Add Paper'}
      description={paper ? undefined : 'A subject the class sits in this examination.'}
      loading={form.saving}
      error={form.formError}
      footer={<Footer formId={formId} saving={form.saving} onClose={onClose} label={paper ? 'Save Changes' : 'Add Paper'} />}
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {!paper && (
          <>
            <Select label="Class" required options={classes.map((c) => ({ value: c.id, label: c.name }))} {...field('class')} />
            <Select
              label="Subject"
              required
              placeholder="Choose a subject"
              options={(options?.subjects ?? []).filter((s) => !taken.includes(s.id)).map((s) => ({ value: s.id, label: s.code ? `${s.name} (${s.code})` : s.name }))}
              {...field('subject')}
            />
          </>
        )}
        <Input type="number" inputMode="numeric" label="Marks out of" min={1} max={limits.maxMarks} placeholder={paper ? undefined : 'From the examination type'} hint={`At most ${limits.maxMarks}.`} {...field('maxMarks')} />
        <Input type="number" inputMode="numeric" label="Length (minutes)" required min={15} max={480} {...field('durationMinutes')} />
      </form>
    </Modal>
  );
}

/** Cancel (not started) or end early (running) an examination, with an optional reason. */
export function ExamStopModal({ role, exam, mode, open, onClose, onDone }) {
  const formId = useId();
  const form = useDialogForm(open, { reason: '' }, failure);
  const ending = mode === 'end';
  const save = () => {
    const reason = clean(form.values.reason);
    const problems = reason.length > 300 ? { reason: 'At most 300 characters.' } : {};
    return form.submit(problems, ['reason'], () => (ending ? endExamination(role, exam.id, reason) : cancelExamination(role, exam.id, reason)), onDone);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={ending ? `End ${exam?.name ?? ''} Early` : `Cancel ${exam?.name ?? ''}`}
      description={
        ending
          ? 'Its last day becomes yesterday: from today its classes have their normal lessons again. Past examination days stay as they were.'
          : 'It comes off the calendar and its classes keep their normal lessons. It is kept, marked cancelled; this cannot be undone.'
      }
      loading={form.saving}
      error={form.formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={form.saving}>
            Keep It
          </Button>
          <Button type="submit" form={formId} loading={form.saving} variant="danger">
            {ending ? 'End Early' : 'Cancel Examination'}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Textarea label="Reason (optional)" rows={2} maxLength={300} id={`${formId}-reason`} value={form.values.reason} error={form.errors.reason} onChange={(e) => form.set('reason', e.target.value)} />
      </form>
    </Modal>
  );
}

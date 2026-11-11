import { useEffect, useId, useState } from 'react';
import { Badge, Button, Input, Modal, Select, Textarea } from '../../../components/ui';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { createClass, createSection, setClassActive, setSectionActive, updateClass, updateSection } from '../data/classesApi.js';
import { clean, sectionDisplayName, validateClass, validateSection, wholeNumber } from '../utils/classRules.js';

const MESSAGE_CODES = [
  'NAME_TAKEN',
  'SEQUENCE_TAKEN',
  'CLASS_IN_USE',
  'CLASS_INACTIVE',
  'YEAR_CLOSED',
  'INVALID_STATUS',
  'SCHOOL_SUSPENDED',
  'BRANCH_NOT_OPERATING',
];

/** The message a failed save shows above the form (field problems are shown on the fields). */
function failureMessage(error, what) {
  if (MESSAGE_CODES.includes(error.code) || error.status === 0) return error.message;
  if (error.status === 404) return `This ${what} no longer exists, or is not part of your school.`;
  return `The ${what} could not be saved. Try again.`;
}

export function StatusBadge({ status }) {
  return <Badge variant={status === 'active' ? 'success' : 'neutral'}>{status === 'active' ? 'Active' : 'Inactive'}</Badge>;
}

/** Shared form state: values, field errors, a form-level error, saving, and one save at a time. */
function useForm(open, initial) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveOnce] = useState(createSingleFlight);
  useEffect(() => {
    if (!open) return;
    setValues(initial);
    setErrors({});
    setFormError('');
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    setErrors(({ [field]: _removed, ...rest }) => rest);
  };
  return { values, set, errors, setErrors, formError, setFormError, saving, setSaving, saveOnce };
}

async function runSave(form, { problems, formId, fields, request, onSaved, what }) {
  form.setFormError('');
  form.setErrors(problems);
  const first = fields.find((f) => problems[f]);
  if (first) {
    document.getElementById(`${formId}-${first}`)?.focus();
    return;
  }
  form.setSaving(true);
  try {
    const saved = await request();
    form.setSaving(false);
    onSaved(saved);
  } catch (error) {
    form.setSaving(false);
    const fieldProblems = error.details && Object.fromEntries(Object.entries(error.details).filter(([key]) => fields.includes(key)));
    if (fieldProblems && Object.keys(fieldProblems).length) form.setErrors(fieldProblems);
    form.setFormError(failureMessage(error, what));
  }
}

/** Add (mode "create") or edit a class (School Owner). `onSaved(class)` runs after success. */
export function ClassFormModal({ mode, cls, nextSequence, open, onClose, onSaved }) {
  const formId = useId();
  const isCreate = mode === 'create';
  const initial = isCreate ? { name: '', description: '', sequence: String(nextSequence ?? '') } : { name: cls?.name ?? '', description: cls?.description ?? '', sequence: String(cls?.sequence ?? '') };
  const form = useForm(open, initial);
  const fields = ['name', 'sequence', 'description'];

  const save = () => {
    const v = { name: clean(form.values.name), description: clean(form.values.description) || null, sequence: wholeNumber(form.values.sequence) };
    // An edit sends only what changed.
    const body = isCreate ? v : Object.fromEntries(Object.entries(v).filter(([k, value]) => value !== (k === 'description' ? cls.description || null : cls[k])));
    if (!isCreate && !Object.keys(body).length) return onSaved(cls);
    return runSave(form, {
      problems: validateClass(form.values),
      formId,
      fields,
      request: () => (isCreate ? createClass(body) : updateClass(cls.id, body)),
      onSaved,
      what: 'class',
    });
  };
  const field = (name) => ({ id: `${formId}-${name}`, value: form.values[name], onChange: form.set(name), error: form.errors[name] });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isCreate ? 'Add Class' : 'Edit Class'}
      description={isCreate ? 'Classes are created once and used every academic year.' : 'Changes apply to every academic year and branch.'}
      loading={form.saving}
      loadingLabel="Saving…"
      error={form.formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={form.saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={form.saving}>
            {isCreate ? 'Add Class' : 'Save Changes'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => { event.preventDefault(); form.saveOnce(save); }} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Input label="Class name" required autoComplete="off" placeholder="Grade 7" hint="Unique in your school." {...field('name')} fieldClassName="sm:col-span-2" />
        <Input label="Order" required inputMode="numeric" hint="1 = first class." {...field('sequence')} />
        <Textarea label="Description" rows={3} hint="Optional." {...field('description')} fieldClassName="sm:col-span-3" />
      </form>
    </Modal>
  );
}

/**
 * Add a section (mode "create": class, academic year and — Owner only — branch are chosen; a
 * Manager's branch is their own) or edit one (name, capacity, room). `onSaved(section)` after success.
 */
export function SectionFormModal({ role, mode, section, cls, years, defaultYearId, branches, defaultBranchId, open, onClose, onSaved }) {
  const formId = useId();
  const isCreate = mode === 'create';
  const owner = role === 'OWNER';
  const writableYears = (years ?? []).filter((y) => y.status !== 'closed');
  const initial = isCreate
    ? {
        name: '',
        capacity: '',
        room: '',
        classId: cls?.id ?? '',
        academicYearId: writableYears.some((y) => y.id === defaultYearId) ? defaultYearId : (writableYears[0]?.id ?? ''),
        branchId: defaultBranchId ?? '',
      }
    : { name: section?.name ?? '', capacity: section?.capacity == null ? '' : String(section.capacity), room: section?.room ?? '' };
  const form = useForm(open, initial);
  const fields = ['academicYearId', 'branchId', 'name', 'capacity', 'room'];

  const save = () => {
    const v = { name: clean(form.values.name), capacity: wholeNumber(form.values.capacity), room: clean(form.values.room) || null };
    let body;
    if (isCreate) body = { classId: cls.id, academicYearId: form.values.academicYearId, ...(owner && { branchId: form.values.branchId }), ...v };
    else {
      body = Object.fromEntries(Object.entries(v).filter(([k, value]) => value !== (k === 'room' ? section.room || null : section[k])));
      if (!Object.keys(body).length) return onSaved(section);
    }
    return runSave(form, {
      problems: validateSection({ ...form.values, classId: cls?.id ?? section?.class.id }, { creating: isCreate, needsBranch: owner }),
      formId,
      fields,
      request: () => (isCreate ? createSection(role, body) : updateSection(role, section.id, body)),
      onSaved,
      what: 'section',
    });
  };
  const field = (name) => ({ id: `${formId}-${name}`, value: form.values[name], onChange: form.set(name), error: form.errors[name] });
  const className = cls?.name ?? section?.class.name ?? '';
  const preview = clean(form.values.name) ? sectionDisplayName(className, clean(form.values.name)) : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isCreate ? `Add Section to ${className}` : `Edit ${section?.displayName ?? 'Section'}`}
      description={
        isCreate
          ? 'A section belongs to one academic year and one branch. Next year’s sections are created anew; this year’s stay as they are.'
          : `${section?.academicYear.name} · ${section?.branch.name} (${section?.branch.code}). The class, year and branch cannot be changed.`
      }
      loading={form.saving}
      loadingLabel="Saving…"
      error={form.formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={form.saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={form.saving}>
            {isCreate ? 'Add Section' : 'Save Changes'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => { event.preventDefault(); form.saveOnce(save); }} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {isCreate && (
          <Select
            label="Academic year"
            required
            options={[{ value: '', label: writableYears.length ? 'Choose a year' : 'No planned or current year' }, ...writableYears.map((y) => ({ value: y.id, label: `${y.name}${y.status === 'current' ? ' (current)' : ' (planned)'}` }))]}
            hint="Closed years cannot get new sections."
            {...field('academicYearId')}
          />
        )}
        {isCreate && owner && (
          <Select
            label="Branch"
            required
            options={[{ value: '', label: 'Choose a branch' }, ...(branches ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))]}
            {...field('branchId')}
          />
        )}
        <Input label="Section name" required autoComplete="off" placeholder="A" hint={preview ? `Shown as ${preview}.` : 'Unique in this class, year and branch.'} {...field('name')} />
        <Input label="Capacity" inputMode="numeric" placeholder="35" hint="Optional." {...field('capacity')} />
        <Input label="Room" autoComplete="off" placeholder="Room 12" hint="Optional." {...field('room')} fieldClassName="sm:col-span-2" />
      </form>
    </Modal>
  );
}

/** Confirm deactivating or reactivating a class (Owner) or a section. `onDone(updated)` after success. */
export function StatusModal({ role, kind, target, open, onClose, onDone }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [runOnce] = useState(createSingleFlight);
  useEffect(() => {
    if (!open) return;
    setError('');
    setSaving(false);
  }, [open]);

  const activating = target?.status === 'inactive';
  const name = kind === 'class' ? target?.name : target?.displayName;
  const run = () =>
    runOnce(async () => {
      setSaving(true);
      setError('');
      try {
        const updated = kind === 'class' ? await setClassActive(target.id, activating) : await setSectionActive(role, target.id, activating);
        setSaving(false);
        onDone(updated);
      } catch (failed) {
        setSaving(false);
        setError(failureMessage(failed, kind));
      }
    });

  const explanation =
    kind === 'class'
      ? activating
        ? 'Sections can be added to it again.'
        : 'No new sections can be added to it. Its sections and history are kept. A class with active sections in a planned or current year must have those sections deactivated first.'
      : activating
        ? 'The section can be chosen again.'
        : 'The section is kept with its history but can no longer be chosen.';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${activating ? 'Reactivate' : 'Deactivate'} ${kind === 'class' ? 'Class' : 'Section'}`}
      description={name}
      loading={saving}
      loadingLabel={activating ? 'Reactivating…' : 'Deactivating…'}
      error={error}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant={activating ? 'primary' : 'danger'} onClick={run} loading={saving}>
            {activating ? 'Reactivate' : 'Deactivate'}
          </Button>
        </>
      }
    >
      <p className="text-body text-fg-secondary">
        <strong className="text-fg">{name}</strong> will become {activating ? 'active' : 'inactive'}. {explanation}
      </p>
    </Modal>
  );
}

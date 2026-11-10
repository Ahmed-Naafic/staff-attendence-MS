import { useEffect, useId, useState } from 'react';
import { Button, Input, Modal } from '../../../components/ui';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { createAcademicYear, updateAcademicYear } from '../data/academicYears.js';
import { cleanName, daysBetween, suggestName, validateAcademicYear } from '../utils/academicYearRules.js';

const FIELDS = ['name', 'startDate', 'endDate'];
const EMPTY = { name: '', startDate: '', endDate: '' };
const MESSAGE_CODES = ['DATES_OVERLAP', 'NAME_TAKEN', 'SCHOOL_SUSPENDED', 'YEAR_CLOSED'];

/**
 * Plan a new academic year (mode "create") or edit a planned or current one (mode "edit"). Until the
 * owner types a name, the name follows the dates (e.g. 2026/2027). `onSaved(year)` runs after success.
 */
export function AcademicYearFormModal({ mode, year, open, onClose, onSaved }) {
  const formId = useId();
  const isCreate = mode === 'create';
  const [values, setValues] = useState(EMPTY);
  const [nameTouched, setNameTouched] = useState(false);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  // One save at a time: Enter or a click during a save sends nothing more.
  const [saveOnce] = useState(createSingleFlight);

  // Fresh form each time it opens.
  useEffect(() => {
    if (!open) return;
    setValues(isCreate || !year ? EMPTY : { name: year.name, startDate: year.startDate, endDate: year.endDate });
    setNameTouched(!isCreate);
    setErrors({});
    setFormError('');
    setSaving(false);
  }, [open, isCreate, year]);

  const set = (field) => (event) => {
    const value = event.target.value;
    setValues((current) => {
      const next = { ...current, [field]: value };
      if (field !== 'name' && !nameTouched) next.name = suggestName(next.startDate, next.endDate);
      return next;
    });
    if (field === 'name') setNameTouched(true);
    setErrors(({ [field]: _removed, ...rest }) => rest);
  };

  function focusFirst(problems) {
    const first = FIELDS.find((field) => problems[field]);
    if (first) document.getElementById(`${formId}-${first}`)?.focus();
  }

  function submit(event) {
    event.preventDefault();
    return saveOnce(save);
  }

  async function save() {
    setFormError('');
    const problems = validateAcademicYear(values);
    setErrors(problems);
    if (Object.keys(problems).length) {
      focusFirst(problems);
      return;
    }
    const cleaned = { ...values, name: cleanName(values.name) };
    // An edit sends only what changed.
    const body = isCreate ? cleaned : Object.fromEntries(FIELDS.filter((f) => cleaned[f] !== year[f]).map((f) => [f, cleaned[f]]));
    if (!isCreate && !Object.keys(body).length) {
      onSaved(year);
      return;
    }
    setSaving(true);
    try {
      const saved = isCreate ? await createAcademicYear(body) : await updateAcademicYear(year.id, body);
      setSaving(false);
      onSaved(saved);
    } catch (error) {
      setSaving(false);
      const fieldDetails = error.details && FIELDS.some((f) => error.details[f]);
      if (fieldDetails) {
        setErrors(error.details);
        focusFirst(error.details);
      }
      if (MESSAGE_CODES.includes(error.code)) setFormError(error.message);
      else if (error.status === 404) setFormError('This academic year no longer exists.');
      else if (!fieldDetails) setFormError(error.status === 0 ? error.message : 'The academic year could not be saved. Try again.');
    }
  }

  const field = (name, props = {}) => ({ id: `${formId}-${name}`, value: values[name], onChange: set(name), error: errors[name], ...props });
  const rangeValid = values.startDate && values.endDate && !validateAcademicYear({ ...values, name: 'x' }).endDate;
  const length = rangeValid ? daysBetween(values.startDate, values.endDate) : null;
  const description = isCreate
    ? 'The year applies to every branch of your school. It stays planned until you start it.'
    : year?.status === 'current'
      ? 'This is your school’s current year. Changes apply to every branch at once.'
      : 'Change the name or dates before the year starts.';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isCreate ? 'Plan Academic Year' : 'Edit Academic Year'}
      description={description}
      loading={saving}
      loadingLabel={isCreate ? 'Planning…' : 'Saving…'}
      error={formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            {isCreate ? 'Plan Year' : 'Save Changes'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Start date" type="date" required {...field('startDate')} />
        <Input label="End date" type="date" required min={values.startDate || undefined} {...field('endDate')} />
        <Input
          label="Name"
          required
          autoComplete="off"
          placeholder="2026/2027"
          hint={length ? `${length} days, both dates included. Unique in your school.` : 'Filled in from the dates; you can change it. Unique in your school.'}
          {...field('name')}
          fieldClassName="sm:col-span-2"
        />
      </form>
    </Modal>
  );
}

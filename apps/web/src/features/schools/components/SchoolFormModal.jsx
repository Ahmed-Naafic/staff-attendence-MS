import { useEffect, useId, useState } from 'react';
import { Button, Input, Modal, Textarea } from '../../../components/ui';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { registerSchool, suggestSchoolCode, updateSchool } from '../data/schoolActions.js';
import { cleanSchoolValues, validateSchool } from '../utils/schoolValidation.js';

const CREATE_FIELDS = ['name', 'code', 'phone', 'email', 'address', 'city', 'website', 'description'];
const EDIT_FIELDS = ['name', 'phone', 'email', 'address', 'city', 'website', 'description'];
const EMPTY = { name: '', code: '', phone: '', email: '', address: '', city: '', website: '', description: '' };

const fromSchool = (school) => ({
  name: school.name,
  code: school.code,
  phone: school.phone,
  email: school.email,
  address: school.address,
  city: school.location,
  website: school.website,
  description: school.description,
});

/**
 * Register a school (mode "create") or edit one (mode "edit"). Required: name, code, phone,
 * address, city. The code is suggested from the name and can be changed before registering;
 * afterwards it is shown read-only. Problems are shown next to each field, from the form's own
 * checks and from the API (e.g. a code already in use). `onSaved(school)` runs after success.
 */
export function SchoolFormModal({ mode, school, open, onClose, onSaved, cities = [] }) {
  const formId = useId();
  const citiesId = useId();
  const isCreate = mode === 'create';
  const fields = isCreate ? CREATE_FIELDS : EDIT_FIELDS;
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  // One save at a time: Enter or a click during a save sends nothing more.
  const [saveOnce] = useState(createSingleFlight);
  const [codeTouched, setCodeTouched] = useState(false);

  // Fresh form each time it opens.
  useEffect(() => {
    if (!open) return;
    setValues(isCreate || !school ? EMPTY : fromSchool(school));
    setErrors({});
    setFormError('');
    setSaving(false);
    setCodeTouched(false);
  }, [open, isCreate, school]);

  const set = (field) => (event) => {
    const value = field === 'code' ? event.target.value.toUpperCase() : event.target.value;
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors(({ [field]: _removed, ...rest }) => rest);
    if (field === 'code') setCodeTouched(true);
  };

  // Suggest a code from the name until the admin types one.
  async function suggest() {
    if (!isCreate || codeTouched || !values.name.trim()) return;
    try {
      const code = await suggestSchoolCode(values.name.trim());
      setValues((current) => (codeTouched || current.code ? current : { ...current, code }));
    } catch {
      // No suggestion: the admin types the code.
    }
  }

  function focusFirst(problems) {
    const first = fields.find((field) => problems[field]);
    if (first) document.getElementById(`${formId}-${first}`)?.focus();
  }

  function submit(event) {
    event.preventDefault();
    return saveOnce(save);
  }

  async function save() {
    setFormError('');
    const cleaned = cleanSchoolValues(values, fields);
    const problems = validateSchool(cleaned, fields);
    setErrors(problems);
    if (Object.keys(problems).length) {
      focusFirst(problems);
      return;
    }
    setSaving(true);
    try {
      const saved = isCreate ? await registerSchool(cleaned) : await updateSchool(school.id, cleaned);
      setSaving(false);
      onSaved(saved);
    } catch (error) {
      setSaving(false);
      if (error.details) {
        setErrors(error.details);
        focusFirst(error.details);
      } else if (error.status === 404) {
        setFormError('This school no longer exists.');
      } else {
        setFormError(error.status === 0 ? error.message : 'The school could not be saved. Try again.');
      }
    }
  }

  const field = (name, props = {}) => ({
    id: `${formId}-${name}`,
    value: values[name],
    onChange: set(name),
    error: errors[name],
    ...props,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isCreate ? 'Register New School' : 'Edit School'}
      description={isCreate ? 'The school is active as soon as it is registered.' : `School code ${school?.code ?? ''} cannot be changed.`}
      loading={saving}
      loadingLabel={isCreate ? 'Registering…' : 'Saving…'}
      error={formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            {isCreate ? 'Register School' : 'Save Changes'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="School name" required autoComplete="off" {...field('name', { onBlur: suggest })} fieldClassName={isCreate ? undefined : 'sm:col-span-2'} />
        {isCreate && (
          <Input
            label="School code"
            required
            autoComplete="off"
            hint="Suggested from the name; you can change it. It cannot be changed later."
            {...field('code')}
          />
        )}
        <Input label="Phone" type="tel" required autoComplete="off" placeholder="+252 61 2345678" {...field('phone')} />
        <Input label="Email" type="email" autoComplete="off" {...field('email')} />
        <Input label="Address" required autoComplete="off" {...field('address')} fieldClassName="sm:col-span-2" />
        <Input label="City" required autoComplete="off" list={citiesId} {...field('city')} />
        <datalist id={citiesId}>
          {cities.map((city) => (
            <option key={city} value={city} />
          ))}
        </datalist>
        <Input label="Website" type="url" autoComplete="off" placeholder="https://" {...field('website')} />
        <Textarea label="Description" rows={3} {...field('description')} fieldClassName="sm:col-span-2" />
      </form>
    </Modal>
  );
}

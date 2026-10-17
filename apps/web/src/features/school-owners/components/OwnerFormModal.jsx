import { useEffect, useId, useState } from 'react';
import { Button, Input, Modal, Select } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { addOwner, loadSchoolsWithoutOwner, updateOwner } from '../data/ownerActions.js';
import { cleanOwnerValues, MIN_PASSWORD_LENGTH, validateOwner } from '../utils/ownerValidation.js';

const CREATE_FIELDS = ['name', 'email', 'phone', 'schoolId', 'password'];
const EDIT_FIELDS = ['name', 'email', 'phone'];
const EMPTY = { name: '', email: '', phone: '', schoolId: '', password: '' };

const fromOwner = (owner) => ({ ...EMPTY, name: owner.name, email: owner.email, phone: owner.phone });

function SchoolChoice({ id, value, onChange, error, choices }) {
  if (choices.status === 'error') {
    return (
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Select id={id} label="School" required disabled options={[]} placeholder="Schools could not be loaded" error={error} />
        <Button variant="outline" size="sm" className="self-start" onClick={choices.retry}>
          Load schools again
        </Button>
      </div>
    );
  }
  const schools = choices.data?.schools ?? [];
  const loading = choices.status === 'loading' && !choices.data;
  const none = !loading && schools.length === 0;
  const more = (choices.data?.total ?? 0) - schools.length;
  return (
    <Select
      id={id}
      label="School"
      required
      disabled={loading || none}
      placeholder={loading ? 'Loading schools…' : none ? 'Every school already has an owner' : 'Choose a school'}
      options={schools.map((s) => ({ value: s.id, label: `${s.name} (${s.code}) · ${s.location}` }))}
      value={value}
      onChange={onChange}
      error={error}
      hint={
        none
          ? 'Register a school first: each school can have one owner.'
          : `Only schools without an owner are listed. The school cannot be changed later.${more > 0 ? ` Showing ${schools.length} of ${schools.length + more}.` : ''}`
      }
      fieldClassName="sm:col-span-2"
    />
  );
}

/**
 * Add a school owner (mode "create") or edit one (mode "edit"). Adding needs the full name,
 * email, phone, a school without an owner and an initial password (sent once; never shown
 * again). Editing changes the name, email and phone only: the school and role stay as they are.
 * Problems are shown next to each field, from the form's own checks and from the API (an email
 * in use, a school that has just got an owner). `onSaved(owner)` runs after success.
 */
export function OwnerFormModal({ mode, owner, open, onClose, onSaved }) {
  const formId = useId();
  const isCreate = mode === 'create';
  const fields = isCreate ? CREATE_FIELDS : EDIT_FIELDS;
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const choices = useApiData(
    () => (open && isCreate ? loadSchoolsWithoutOwner() : Promise.resolve(null)),
    `${open}|${isCreate}|${attempt}`,
  );

  // Fresh form each time it opens or closes (the password never outlives the dialog).
  useEffect(() => {
    setValues(open && !isCreate && owner ? fromOwner(owner) : EMPTY);
    setErrors({});
    setFormError('');
    setSaving(false);
  }, [open, isCreate, owner]);

  const set = (field) => (event) => {
    const { value } = event.target;
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field]) setErrors(({ [field]: _removed, ...rest }) => rest);
  };

  function focusFirst(problems) {
    const first = fields.find((field) => problems[field]);
    if (first) document.getElementById(`${formId}-${first}`)?.focus();
  }

  async function submit(event) {
    event.preventDefault();
    setFormError('');
    const cleaned = cleanOwnerValues(values, fields);
    const problems = validateOwner(cleaned, fields);
    setErrors(problems);
    if (Object.keys(problems).length) {
      focusFirst(problems);
      return;
    }
    setSaving(true);
    try {
      const saved = isCreate ? await addOwner(cleaned) : await updateOwner(owner.id, cleaned);
      setSaving(false);
      setValues(EMPTY);
      onSaved(saved);
    } catch (error) {
      setSaving(false);
      if (error.details) {
        setErrors(error.details);
        focusFirst(error.details);
        // The school list is out of date when the chosen school has just got an owner.
        if (error.code === 'SCHOOL_HAS_OWNER' || error.details.schoolId) {
          setValues((current) => ({ ...current, schoolId: '' }));
          setAttempt((n) => n + 1);
        }
      } else if (error.status === 404) {
        setFormError('This school owner no longer exists.');
      } else {
        setFormError(error.status === 0 ? error.message : 'The school owner could not be saved. Try again.');
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
      title={isCreate ? 'Add School Owner' : 'Edit Owner'}
      description={
        isCreate
          ? 'The owner account is active once it is added, and the owner signs in with the initial password.'
          : `Owner of ${owner?.school ? `${owner.school.name} (${owner.school.code})` : 'no school'}. The school cannot be changed.`
      }
      loading={saving}
      loadingLabel={isCreate ? 'Adding owner…' : 'Saving…'}
      error={formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId}>
            {isCreate ? 'Add Owner' : 'Save Changes'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Full name" required autoComplete="off" {...field('name')} fieldClassName="sm:col-span-2" />
        <Input label="Email" type="email" required autoComplete="off" hint="The owner signs in with this email." {...field('email')} />
        <Input label="Phone" type="tel" required autoComplete="off" placeholder="+252 61 2345678" {...field('phone')} />
        {isCreate && (
          <>
            <SchoolChoice
              id={`${formId}-schoolId`}
              value={values.schoolId}
              onChange={set('schoolId')}
              error={errors.schoolId}
              choices={{ ...choices, retry: () => setAttempt((n) => n + 1) }}
            />
            <Input
              label="Initial password"
              type="password"
              required
              autoComplete="new-password"
              hint={`At least ${MIN_PASSWORD_LENGTH} characters. Give it to the owner securely; it is not shown again.`}
              {...field('password')}
              fieldClassName="sm:col-span-2"
            />
          </>
        )}
      </form>
    </Modal>
  );
}

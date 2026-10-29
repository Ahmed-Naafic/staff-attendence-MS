import { useEffect, useId, useState } from 'react';
import { Button, Input, Modal, Select } from '../../../components/ui';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { createManager, updateManager } from '../data/managerActions.js';
import { branchLabel, cleanManagerValues, passwordProblem, validateManager } from '../utils/managerRules.js';

const DETAILS = ['name', 'email', 'phone'];
const EMPTY = { name: '', email: '', phone: '', branchId: '', password: '' };
const fromManager = (m) => ({ name: m.name, email: m.email, phone: m.phone, branchId: m.branch.id, password: '' });

/**
 * Add a Manager (mode "create": details, branch and a temporary password) or edit one (mode "edit":
 * details only; the branch has Transfer and the password has Reset Password). `branches` are the
 * school's branches. `onSaved(manager)` runs after success.
 */
export function ManagerFormModal({ mode, manager, branches, open, onClose, onSaved }) {
  const formId = useId();
  const isCreate = mode === 'create';
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  // One save at a time: Enter or a click during a save sends nothing more.
  const [saveOnce] = useState(createSingleFlight);

  // Fresh form each time it opens (the temporary password is never kept).
  useEffect(() => {
    if (!open) return;
    setValues(isCreate || !manager ? EMPTY : fromManager(manager));
    setErrors({});
    setFormError('');
    setSaving(false);
  }, [open, isCreate, manager]);

  const set = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    if (errors[field]) setErrors(({ [field]: _removed, ...rest }) => rest);
  };

  function focusFirst(problems) {
    const first = [...DETAILS, 'branchId', 'password'].find((field) => problems[field]);
    if (first) document.getElementById(`${formId}-${first}`)?.focus();
  }

  function submit(event) {
    event.preventDefault();
    return saveOnce(save);
  }

  async function save() {
    setFormError('');
    const cleaned = cleanManagerValues(values, DETAILS);
    const problems = validateManager(cleaned, DETAILS);
    if (isCreate) {
      if (!values.branchId) problems.branchId = 'Choose a branch.';
      const problem = passwordProblem(values.password, { label: 'a temporary password' });
      if (problem) problems.password = problem;
    }
    setErrors(problems);
    if (Object.keys(problems).length) {
      focusFirst(problems);
      return;
    }
    setSaving(true);
    try {
      const saved = isCreate
        ? await createManager({ ...cleaned, branchId: values.branchId, password: values.password })
        : await updateManager(manager.id, cleaned);
      setSaving(false);
      setValues(EMPTY);
      onSaved(saved);
    } catch (error) {
      setSaving(false);
      if (error.details) {
        setErrors(error.details);
        focusFirst(error.details);
      } else if (error.status === 404) setFormError('This Manager no longer exists in your school.');
      else if (error.code === 'SCHOOL_SUSPENDED') setFormError(error.message);
      else setFormError(error.status === 0 ? error.message : 'The Manager could not be saved. Try again.');
    }
  }

  const field = (name, props = {}) => ({ id: `${formId}-${name}`, value: values[name], onChange: set(name), error: errors[name], ...props });
  const branchOptions = branches.map((b) => ({ value: b.id, label: `${branchLabel(b)}${b.status === 'suspended' ? ' · suspended' : ''}` }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isCreate ? 'Add Manager' : 'Edit Manager'}
      description={
        isCreate ? 'The Manager is active once added and must change the temporary password at first sign-in.' : `${manager?.name ?? ''} · ${manager?.email ?? ''}`
      }
      loading={saving}
      loadingLabel={isCreate ? 'Adding…' : 'Saving…'}
      error={formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            {isCreate ? 'Add Manager' : 'Save Changes'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Full name" required autoComplete="off" {...field('name')} fieldClassName="sm:col-span-2" />
        <Input label="Email" type="email" required autoComplete="off" hint="The Manager signs in with this email." {...field('email')} />
        <Input label="Phone" type="tel" required autoComplete="off" placeholder="+252 61 2345678" {...field('phone')} />
        {isCreate && (
          <>
            <Select
              label="Branch"
              required
              placeholder={branches.length ? 'Choose a branch' : 'Your school has no branches yet'}
              options={branchOptions}
              {...field('branchId')}
              fieldClassName="sm:col-span-2"
            />
            <Input
              label="Temporary password"
              type="password"
              required
              autoComplete="new-password"
              hint="At least 12 characters. Give it to the Manager yourself; it is not shown again. They must change it at first sign-in."
              {...field('password')}
              fieldClassName="sm:col-span-2"
            />
          </>
        )}
      </form>
    </Modal>
  );
}

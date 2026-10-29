import { useEffect, useId, useState } from 'react';
import { Button, Input, Modal, Select } from '../../../components/ui';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { passwordProblem } from '../../auth/passwordRules.js';
import { createStaff, updateStaff } from '../data/staffApi.js';
import { cleanStaffValues, JOB_TITLES, jobTitleFields, jobTitleFrom, OTHER_JOB_TITLE, validateStaff } from '../utils/staffRules.js';

const DETAILS = ['name', 'phone', 'jobTitle', 'email'];
const EMPTY = { name: '', phone: '', jobTitleChoice: '', jobTitleOther: '', email: '', password: '' };
const fromStaff = (s) => ({ name: s.name, phone: s.phone, ...jobTitleFields(s.jobTitle), email: s.email, password: '' });
const JOB_TITLE_OPTIONS = [...JOB_TITLES.map((t) => ({ value: t, label: t })), { value: OTHER_JOB_TITLE, label: 'Other' }];

/**
 * Add a staff member (mode "create": details and a temporary password; the account is active at
 * once and its Staff ID is generated) or edit one (mode "edit": details only). `onSaved(staff)` runs
 * after success.
 */
export function StaffFormModal({ mode, staff, open, onClose, onSaved }) {
  const formId = useId();
  const isCreate = mode === 'create';
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveOnce] = useState(createSingleFlight);

  useEffect(() => {
    if (!open) return;
    setValues(isCreate || !staff ? EMPTY : fromStaff(staff));
    setErrors({});
    setFormError('');
    setSaving(false);
  }, [open, isCreate, staff]);

  const isOther = values.jobTitleChoice === OTHER_JOB_TITLE;
  // The job title fields share the jobTitle error (the API reports it under that name).
  const errorKey = (field) => (field === 'jobTitleChoice' || field === 'jobTitleOther' ? 'jobTitle' : field);
  const set = (field) => (event) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
    const key = errorKey(field);
    if (errors[key]) setErrors(({ [key]: _removed, ...rest }) => rest);
  };
  const focusFirst = (problems) => {
    const first = [...DETAILS, 'password'].find((field) => problems[field]);
    const target = first === 'jobTitle' ? (isOther ? 'jobTitleOther' : 'jobTitleChoice') : first;
    if (target) document.getElementById(`${formId}-${target}`)?.focus();
  };

  async function save() {
    setFormError('');
    const cleaned = cleanStaffValues({ ...values, jobTitle: jobTitleFrom(values) }, DETAILS);
    const problems = validateStaff(cleaned, DETAILS);
    if (problems.jobTitle && !cleaned.jobTitle) problems.jobTitle = isOther ? 'Enter the job title.' : 'Choose a job title.';
    if (isCreate) {
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
      const body = { ...cleaned, email: cleaned.email || (isCreate ? undefined : '') };
      const saved = isCreate ? await createStaff({ ...body, password: values.password }) : await updateStaff(staff.id, body);
      setSaving(false);
      setValues(EMPTY);
      onSaved(saved);
    } catch (error) {
      setSaving(false);
      if (error.details) {
        setErrors(error.details);
        focusFirst(error.details);
      } else if (error.status === 404) setFormError('This staff member no longer exists in your branch.');
      else if (error.code === 'BRANCH_NOT_OPERATING' || error.status === 0) setFormError(error.message);
      else setFormError('The staff member could not be saved. Try again.');
    }
  }

  const field = (name, props = {}) => ({ id: `${formId}-${name}`, value: values[name], onChange: set(name), error: errors[errorKey(name)], ...props });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isCreate ? 'Add Staff' : 'Edit Staff'}
      description={isCreate ? 'The account is active at once. Its Staff ID is generated automatically.' : `Staff ID ${staff?.staffId ?? ''} cannot be changed.`}
      loading={saving}
      loadingLabel={isCreate ? 'Adding…' : 'Saving…'}
      error={formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            {isCreate ? 'Add Staff' : 'Save Changes'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          return saveOnce(save);
        }}
      >
        <Input label="Full name" required autoComplete="off" {...field('name')} fieldClassName="sm:col-span-2" />
        <Input label="Phone" type="tel" required autoComplete="off" placeholder="+252 61 2345678" hint="Staff sign in with this number; it must be unique." {...field('phone')} />
        <Select label="Job title" required placeholder="Choose a job title" options={JOB_TITLE_OPTIONS} {...field('jobTitleChoice', { error: isOther ? undefined : errors.jobTitle })} />
        {isOther && <Input label="Other job title" required autoComplete="off" placeholder="e.g. Guard" {...field('jobTitleOther')} fieldClassName="sm:col-span-2" />}
        <Input label="Email" type="email" autoComplete="off" hint="Optional." {...field('email')} fieldClassName="sm:col-span-2" />
        {isCreate && (
          <Input
            label="Temporary password"
            type="password"
            required
            autoComplete="new-password"
            hint="At least 12 characters. Give it to the staff member yourself; it is not shown again. They must change it at first sign-in."
            {...field('password')}
            fieldClassName="sm:col-span-2"
          />
        )}
      </form>
    </Modal>
  );
}

import { useEffect, useId, useState } from 'react';
import { Button, Input, Modal, Textarea } from '../../../components/ui';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { PASSWORD_MIN, passwordProblem } from '../../auth/passwordRules.js';
import { addSampleStaff, reactivateStaff, resetStaffPassword, suspendStaff } from '../data/staffApi.js';
import { validateReason } from '../utils/staffRules.js';

const failure = (error, verb) =>
  ['INVALID_STATUS', 'BRANCH_NOT_OPERATING'].includes(error.code) || error.status === 404 || error.status === 0
    ? error.message
    : `The staff member could not be ${verb}. Try again.`;
const subtitle = (staff) => staff && `${staff.name} · ${staff.staffId}`;

/** Value, field error, form error and saving state for a one-field dialog; reset when it opens. */
function useDialogState(open) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveOnce] = useState(createSingleFlight);
  useEffect(() => {
    if (!open) return;
    setValue('');
    setError('');
    setFormError('');
    setSaving(false);
  }, [open]);
  return { value, setValue, error, setError, formError, setFormError, saving, setSaving, saveOnce };
}

/** Confirm suspension: the reason is required. The staff member is signed out at once. */
export function SuspendStaffModal({ staff, open, onClose, onDone }) {
  const formId = useId();
  const state = useDialogState(open);
  async function save() {
    state.setFormError('');
    const problem = validateReason(state.value);
    state.setError(problem ?? '');
    if (problem) return document.getElementById(`${formId}-reason`)?.focus();
    state.setSaving(true);
    try {
      const updated = await suspendStaff(staff.id, state.value.trim());
      state.setSaving(false);
      onDone(updated);
    } catch (failed) {
      state.setSaving(false);
      if (failed.details?.reason) state.setError(failed.details.reason);
      else state.setFormError(failure(failed, 'suspended'));
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Suspend Staff"
      description={subtitle(staff)}
      loading={state.saving}
      loadingLabel="Suspending…"
      error={state.formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={state.saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="danger" loading={state.saving}>
            Suspend Staff
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          return state.saveOnce(save);
        }}
      >
        <p className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-small text-warning-fg">
          <strong>{staff?.name}</strong> will be signed out at once and cannot sign in until reactivated. The account, Staff ID and assignments are kept.
        </p>
        <Textarea
          id={`${formId}-reason`}
          label="Reason for suspension"
          required
          rows={3}
          value={state.value}
          onChange={(event) => {
            state.setValue(event.target.value);
            if (state.error) state.setError('');
          }}
          error={state.error}
          hint="Recorded with the account and in the audit log."
        />
      </form>
    </Modal>
  );
}

/** Confirm reactivation: the staff member signs in again with their password. */
export function ReactivateStaffModal({ staff, open, onClose, onDone }) {
  const state = useDialogState(open);
  async function run() {
    state.setFormError('');
    state.setSaving(true);
    try {
      const updated = await reactivateStaff(staff.id);
      state.setSaving(false);
      onDone(updated);
    } catch (failed) {
      state.setSaving(false);
      state.setFormError(failure(failed, 'reactivated'));
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Reactivate Staff"
      description={subtitle(staff)}
      loading={state.saving}
      loadingLabel="Reactivating…"
      error={state.formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={state.saving}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => state.saveOnce(run)} loading={state.saving}>
            Reactivate Staff
          </Button>
        </>
      }
    >
      <p className="text-body text-fg-secondary">
        <strong className="text-fg">{staff?.name}</strong> will be able to sign in again with their password.
      </p>
      {staff?.suspensionReason && <p className="mt-3 text-small text-fg-muted">Suspended because: {staff.suspensionReason}</p>}
    </Modal>
  );
}

/** A new temporary password: the staff member is signed out and must change it at the next sign-in. */
export function ResetStaffPasswordModal({ staff, open, onClose, onDone }) {
  const formId = useId();
  const state = useDialogState(open);
  async function save() {
    state.setFormError('');
    const problem = passwordProblem(state.value, { label: 'a temporary password' });
    state.setError(problem ?? '');
    if (problem) return document.getElementById(`${formId}-password`)?.focus();
    state.setSaving(true);
    try {
      const updated = await resetStaffPassword(staff.id, state.value);
      state.setSaving(false);
      state.setValue('');
      onDone(updated);
    } catch (failed) {
      state.setSaving(false);
      if (failed.details?.password) state.setError(failed.details.password);
      else state.setFormError(failure(failed, 'given a new password'));
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reset Password"
      description={subtitle(staff)}
      loading={state.saving}
      loadingLabel="Saving…"
      error={state.formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={state.saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={state.saving}>
            Set Temporary Password
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          return state.saveOnce(save);
        }}
      >
        <p className="text-body text-fg-secondary">
          <strong className="text-fg">{staff?.name}</strong> will be signed out and must choose a new password at the next sign-in.
        </p>
        <Input
          id={`${formId}-password`}
          label="New temporary password"
          type="password"
          required
          autoComplete="new-password"
          value={state.value}
          onChange={(event) => {
            state.setValue(event.target.value);
            if (state.error) state.setError('');
          }}
          error={state.error}
          hint={`At least ${PASSWORD_MIN} characters. Give it to the staff member yourself; it is not shown again.`}
        />
      </form>
    </Modal>
  );
}

/**
 * Add the sample staff (test systems only): 20 staff of the branch, `sample.teachers` of them
 * teachers, all with the temporary password chosen here. Only the missing ones are added.
 */
export function SampleStaffModal({ sample, open, onClose, onDone }) {
  const formId = useId();
  const state = useDialogState(open);
  const missing = sample ? sample.total - sample.existing : 0;
  async function save() {
    state.setFormError('');
    const problem = passwordProblem(state.value, { label: 'a temporary password' });
    state.setError(problem ?? '');
    if (problem) return document.getElementById(`${formId}-password`)?.focus();
    state.setSaving(true);
    try {
      const result = await addSampleStaff(state.value);
      state.setSaving(false);
      state.setValue('');
      onDone(result);
    } catch (failed) {
      state.setSaving(false);
      if (failed.details?.password) state.setError(failed.details.password);
      else state.setFormError(['BRANCH_NOT_OPERATING', 'FORBIDDEN'].includes(failed.code) || failed.status === 0 ? failed.message : 'The sample staff could not be added. Try again; staff already added are kept.');
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Sample Staff"
      description="For trying the system on a test system."
      loading={state.saving}
      loadingLabel="Adding staff… this can take a minute."
      error={state.formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={state.saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={state.saving} disabled={!missing}>
            {missing ? `Add ${missing} Staff` : 'All Added'}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          return state.saveOnce(save);
        }}
      >
        <p className="text-body text-fg-secondary">
          {sample?.total} staff members: <strong className="text-fg">{sample?.teachers} teachers</strong> and {sample ? sample.total - sample.teachers : 0} others (Accountant, Secretary, Librarian, Security Guard, Cleaner). Each gets the next Staff ID, is active at once and signs in with their phone number and the temporary password below.
        </p>
        {sample?.existing > 0 && (
          <p className="text-small text-fg-muted">
            {sample.existing} of them {sample.existing === 1 ? 'is' : 'are'} already here; {missing ? `only the other ${missing} will be added` : 'nothing is left to add'}.
          </p>
        )}
        <Input
          id={`${formId}-password`}
          label="Temporary password for all of them"
          type="password"
          required
          autoComplete="new-password"
          value={state.value}
          disabled={!missing}
          onChange={(event) => {
            state.setValue(event.target.value);
            state.setError('');
          }}
          error={state.error}
          hint="They must choose their own password at the first sign-in."
        />
      </form>
    </Modal>
  );
}

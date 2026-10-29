import { useEffect, useId, useState } from 'react';
import { Button, Input, Modal, Select, Textarea } from '../../../components/ui';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { reactivateManager, resetManagerPassword, suspendManager, transferManager } from '../data/managerActions.js';
import { branchLabel, passwordProblem, validateReason } from '../utils/managerRules.js';

const failure = (error, verb) =>
  ['INVALID_STATUS', 'SCHOOL_SUSPENDED'].includes(error.code) || error.status === 404 || error.status === 0
    ? error.message
    : `The Manager could not be ${verb}. Try again.`;

/**
 * Shared state for a dialog with one field: value, field error, form error, saving, and a
 * single-flight `submit` (Enter or a click during a save sends nothing more). Reset on open.
 */
function useOneFieldDialog(open) {
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

const subtitle = (manager) => manager && `${manager.name} · ${manager.email}`;

/** Move to another branch of the same school (the current branch is not offered). */
export function TransferManagerModal({ manager, branches, open, onClose, onDone }) {
  const formId = useId();
  const state = useOneFieldDialog(open);
  const options = branches
    .filter((b) => b.id !== manager?.branch.id)
    .map((b) => ({ value: b.id, label: `${branchLabel(b)}${b.status === 'suspended' ? ' · suspended' : ''}` }));

  async function save() {
    state.setFormError('');
    if (!state.value) {
      state.setError('Choose the branch to move this Manager to.');
      document.getElementById(`${formId}-branch`)?.focus();
      return;
    }
    state.setSaving(true);
    try {
      const updated = await transferManager(manager.id, state.value);
      state.setSaving(false);
      onDone(updated);
    } catch (failed) {
      state.setSaving(false);
      if (failed.details?.branchId) state.setError(failed.details.branchId);
      else state.setFormError(failure(failed, 'transferred'));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Transfer Manager"
      description={subtitle(manager)}
      loading={state.saving}
      loadingLabel="Transferring…"
      error={state.formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={state.saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={state.saving} disabled={!options.length}>
            Transfer Manager
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
          Currently at <strong className="text-fg">{manager && branchLabel(manager.branch)}</strong>. After the transfer the Manager works only in the new
          branch, from their next action. The earlier assignment is kept in the history.
        </p>
        {options.length ? (
          <Select
            id={`${formId}-branch`}
            label="New branch"
            required
            placeholder="Choose a branch"
            options={options}
            value={state.value}
            onChange={(event) => {
              state.setValue(event.target.value);
              state.setError('');
            }}
            error={state.error}
          />
        ) : (
          <p className="text-small text-fg-muted">Your school has no other branch to transfer to.</p>
        )}
      </form>
    </Modal>
  );
}

/** Confirm suspension: the reason is required. ACTIVE → SUSPENDED; the Manager is signed out at once. */
export function SuspendManagerModal({ manager, open, onClose, onDone }) {
  const formId = useId();
  const state = useOneFieldDialog(open);

  async function save() {
    state.setFormError('');
    const problem = validateReason(state.value);
    state.setError(problem ?? '');
    if (problem) {
      document.getElementById(`${formId}-reason`)?.focus();
      return;
    }
    state.setSaving(true);
    try {
      const updated = await suspendManager(manager.id, state.value.trim());
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
      title="Suspend Manager"
      description={subtitle(manager)}
      loading={state.saving}
      loadingLabel="Suspending…"
      error={state.formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={state.saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="danger" loading={state.saving}>
            Suspend Manager
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
          <strong>{manager?.name}</strong> will be signed out at once and cannot sign in until reactivated. The account, branch assignment and
          history are kept.
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

/** Confirm reactivation. SUSPENDED → ACTIVE; the Manager signs in again with their password. */
export function ReactivateManagerModal({ manager, open, onClose, onDone }) {
  const state = useOneFieldDialog(open);

  async function run() {
    state.setFormError('');
    state.setSaving(true);
    try {
      const updated = await reactivateManager(manager.id);
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
      title="Reactivate Manager"
      description={subtitle(manager)}
      loading={state.saving}
      loadingLabel="Reactivating…"
      error={state.formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={state.saving}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => state.saveOnce(run)} loading={state.saving}>
            Reactivate Manager
          </Button>
        </>
      }
    >
      <p className="text-body text-fg-secondary">
        <strong className="text-fg">{manager?.name}</strong> will be able to sign in again with their password.
      </p>
      {manager?.suspensionReason && <p className="mt-3 text-small text-fg-muted">Suspended because: {manager.suspensionReason}</p>}
    </Modal>
  );
}

/** A new temporary password: the Manager is signed out and must change it at the next sign-in. */
export function ResetPasswordModal({ manager, open, onClose, onDone }) {
  const formId = useId();
  const state = useOneFieldDialog(open);

  async function save() {
    state.setFormError('');
    const problem = passwordProblem(state.value, { label: 'a temporary password' });
    state.setError(problem ?? '');
    if (problem) {
      document.getElementById(`${formId}-password`)?.focus();
      return;
    }
    state.setSaving(true);
    try {
      const updated = await resetManagerPassword(manager.id, state.value);
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
      description={subtitle(manager)}
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
          <strong className="text-fg">{manager?.name}</strong> will be signed out and must choose a new password at the next sign-in. Their status
          does not change.
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
          hint="At least 12 characters. Give it to the Manager yourself; it is not shown again."
        />
      </form>
    </Modal>
  );
}

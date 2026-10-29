import { useEffect, useId, useState } from 'react';
import { Button, Modal, Textarea } from '../../../components/ui';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { reactivateSchool, suspendSchool } from '../data/schoolActions.js';
import { validateReason } from '../utils/schoolValidation.js';

const failure = (error, verb) =>
  error.code === 'INVALID_STATUS' || error.status === 404
    ? error.message
    : error.status === 0
      ? error.message
      : `The school could not be ${verb}. Try again.`;

/** Confirm suspension: the reason is required. ACTIVE → SUSPENDED. */
export function SuspendSchoolModal({ school, open, onClose, onDone }) {
  const formId = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  // One save at a time: Enter or a click during a save sends nothing more.
  const [saveOnce] = useState(createSingleFlight);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setError('');
    setFormError('');
    setSaving(false);
  }, [open]);

  function submit(event) {
    event.preventDefault();
    return saveOnce(save);
  }

  async function save() {
    setFormError('');
    const problem = validateReason(reason);
    setError(problem ?? '');
    if (problem) {
      document.getElementById(`${formId}-reason`)?.focus();
      return;
    }
    setSaving(true);
    try {
      const updated = await suspendSchool(school.id, reason.trim());
      setSaving(false);
      onDone(updated);
    } catch (failed) {
      setSaving(false);
      if (failed.details?.reason) setError(failed.details.reason);
      else setFormError(failure(failed, 'suspended'));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Suspend School"
      description={school?.name}
      loading={saving}
      loadingLabel="Suspending…"
      error={formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="danger" loading={saving}>
            Suspend School
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <p className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-small text-warning-fg">
          <strong>{school?.name}</strong> will become suspended. Its data is kept, and you can reactivate it later.
        </p>
        <Textarea
          id={`${formId}-reason`}
          label="Reason for suspension"
          required
          rows={3}
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
            if (error) setError('');
          }}
          error={error}
          hint="Recorded with the school and in the audit log."
        />
      </form>
    </Modal>
  );
}

/** Confirm reactivation. SUSPENDED → ACTIVE. */
export function ReactivateSchoolModal({ school, open, onClose, onDone }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // One save at a time: Enter or a click during a save sends nothing more.
  const [saveOnce] = useState(createSingleFlight);

  useEffect(() => {
    if (!open) return;
    setError('');
    setSaving(false);
  }, [open]);

  function confirm() {
    return saveOnce(runConfirm);
  }

  async function runConfirm() {
    setError('');
    setSaving(true);
    try {
      const updated = await reactivateSchool(school.id);
      setSaving(false);
      onDone(updated);
    } catch (failed) {
      setSaving(false);
      setError(failure(failed, 'reactivated'));
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Reactivate School"
      description={school?.name}
      loading={saving}
      loadingLabel="Reactivating…"
      error={error}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={confirm} loading={saving}>
            Reactivate School
          </Button>
        </>
      }
    >
      <p className="text-body text-fg-secondary">
        <strong className="text-fg">{school?.name}</strong> will become active again.
      </p>
      {school?.suspensionReason && <p className="mt-3 text-small text-fg-muted">Suspended because: {school.suspensionReason}</p>}
    </Modal>
  );
}

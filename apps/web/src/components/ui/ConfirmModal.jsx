import { useId } from 'react';
import { requestFailure, useDialogForm } from '../../hooks/useDialogForm.js';
import { Button } from './Button.jsx';
import { Modal } from './Modal.jsx';

/**
 * A confirmation dialog for one action: `run()` performs it (a promise); `onDone(result)` after it
 * succeeds. A failure is shown in the dialog. `children`: extra explanation.
 */
export function ConfirmModal({ open, onClose, title, description, children, confirmLabel, variant = 'danger', run, onDone }) {
  const formId = useId();
  const form = useDialogForm(open, {}, (error) => requestFailure(error));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      loading={form.saving}
      error={form.formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={form.saving}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={form.saving} variant={variant}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(event) => { event.preventDefault(); form.submit({}, [], run, onDone); }}>
        {children}
      </form>
    </Modal>
  );
}

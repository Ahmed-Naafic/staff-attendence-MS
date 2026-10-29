import { Save } from 'lucide-react';
import { Alert, Button, Card, Modal } from '../../../components/ui';

/**
 * Save Changes bar for the General settings form (`form` from useSettingsForm). Save Settings
 * submits the form (one save at a time); success is shown only after the server confirms.
 * Discard Changes asks first, then returns every field to the last saved values.
 */
export function SaveBar({ form }) {
  const { isDirty, changedCount, notice, formError, saving } = form;
  const status = isDirty
    ? `${changedCount} unsaved ${changedCount === 1 ? 'change' : 'changes'}.`
    : notice?.variant === 'info'
      ? notice.text
      : 'No unsaved changes.';

  return (
    <Card as="section" aria-labelledby="settings-save" className="flex-col gap-4 px-5 py-4">
      {formError && <Alert variant="error">{formError}</Alert>}
      {notice?.variant === 'success' && !formError && <Alert variant="success">{notice.text}</Alert>}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id="settings-save" className="text-card-title text-fg">
            Save Changes
          </h2>
          <p role="status" className="text-small text-fg-muted">
            {status}
          </p>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:shrink-0">
          <Button variant="outline" onClick={form.requestDiscard} disabled={!isDirty || saving}>
            Discard Changes
          </Button>
          <Button type="submit" form="general-settings" leftIcon={Save} loading={saving}>
            Save Settings
          </Button>
        </div>
      </div>

      <Modal
        open={form.confirmingDiscard}
        onClose={form.cancelDiscard}
        size="sm"
        title="Discard changes?"
        footer={
          <>
            <Button variant="outline" onClick={form.cancelDiscard}>
              Keep Editing
            </Button>
            <Button variant="danger" onClick={form.confirmDiscard}>
              Discard Changes
            </Button>
          </>
        }
      >
        <p className="text-body text-fg-secondary">
          {changedCount === 1 ? 'Your unsaved change' : `Your ${changedCount} unsaved changes`} will be lost. The settings return to their last saved
          values.
        </p>
      </Modal>
    </Card>
  );
}

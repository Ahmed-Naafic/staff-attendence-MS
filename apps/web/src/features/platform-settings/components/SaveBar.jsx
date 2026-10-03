import { Save } from 'lucide-react';
import { Button, Card } from '../../../components/ui';
import { UNAVAILABLE } from '../utils/settingsOptions.js';

/**
 * Save Changes bar. Discard returns the form to its loaded values (page-only state);
 * Save is unavailable because nothing can be persisted yet — no success message is ever faked.
 */
export function SaveBar({ isDirty, changedCount, notice, onDiscard }) {
  const status = isDirty
    ? `${changedCount} unsaved ${changedCount === 1 ? 'change' : 'changes'} in this page. They are lost when you leave the page.`
    : notice || 'No unsaved changes.';

  return (
    <Card as="section" aria-labelledby="settings-save" className="flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 id="settings-save" className="text-card-title text-fg">
          Save Changes
        </h2>
        <p role="status" className="text-small text-fg-muted">
          {status}
        </p>
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:shrink-0">
        <Button variant="outline" onClick={onDiscard} disabled={!isDirty}>
          Discard Changes
        </Button>
        <Button leftIcon={Save} unavailableReason={UNAVAILABLE.persistence}>
          Save Settings
        </Button>
      </div>
    </Card>
  );
}

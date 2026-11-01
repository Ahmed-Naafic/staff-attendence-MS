import { useState } from 'react';
import { DatabaseBackup } from 'lucide-react';
import { Button, Modal } from '../../../components/ui';
import { createBackup } from '../data/backupApi.js';

/**
 * "Create Backup Now": confirmation, then a Neon snapshot of the database now. The page shows its
 * progress (Running → Completed) from the overview, which reloads while it runs.
 */
export function CreateBackupButton({ disabledReason, manualRetentionDays, onStarted, onMessage }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      const result = await createBackup();
      setOpen(false);
      onMessage?.({ variant: 'success', text: result.status === 'COMPLETED' ? 'Backup created.' : 'Backup started. Neon is creating the snapshot; its status updates here.' });
      onStarted?.();
    } catch (failure) {
      if (failure.status === 401) return;
      setError(failure.code === 'BACKUP_IN_PROGRESS' ? 'A backup operation is already running. Wait until it finishes.' : failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button leftIcon={DatabaseBackup} unavailableReason={disabledReason} onClick={() => setOpen(true)}>
        Create Backup Now
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Create a backup now?"
        description="A Neon snapshot of the whole platform database is taken now."
        loading={busy}
        loadingLabel="Starting backup…"
        error={error}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={confirm} loading={busy}>
              Create backup
            </Button>
          </>
        }
      >
        <ul className="list-disc space-y-1 pl-5 text-small text-fg-secondary">
          <li>Users can keep working: the snapshot does not stop or slow the platform noticeably.</li>
          <li>It is kept {manualRetentionDays} days, then Neon deletes it, unless you protect it in Backup History.</li>
          <li>It stays inside the Neon project (not an off-site copy) and cannot be downloaded.</li>
        </ul>
      </Modal>
    </>
  );
}

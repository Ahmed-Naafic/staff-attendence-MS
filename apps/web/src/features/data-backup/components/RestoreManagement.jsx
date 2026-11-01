import { useEffect, useState } from 'react';
import { ArchiveRestore, History, ShieldAlert, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  Input,
  Modal,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../../components/ui';
import { formatDateTime } from '../../../lib/format.js';
import { discardRestore, finalizeRestore, loadRestore, startRestore } from '../data/backupApi.js';
import { confirmationOk, formatBytes, KIND_LABELS, PRODUCTION_CONFIRMATION, restoreStatusOf } from '../utils/backupRules.js';

const STEPS = [
  ['Stage', 'Neon restores the backup onto a new, separate branch. Production is not touched.'],
  ['Check', 'EduTrack reads the staged database: it opens, has the application’s tables and migrations, and an active Super Admin. Row counts are shown next to production’s.'],
  ['Decide', 'Discard the staged branch, or replace production with it after typing a confirmation. The current database is kept as a Neon branch (recovery point) so the switch can be undone.'],
];

function VerificationResult({ verification }) {
  if (!verification) return null;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1.5">
        {verification.checks.map((c) => (
          <li key={c.key} className="flex items-start gap-2 text-small">
            <Badge variant={c.ok ? 'success' : c.warning ? 'warning' : 'error'}>{c.ok ? 'Passed' : c.warning ? 'Warning' : 'Failed'}</Badge>
            <span className="text-fg-secondary">
              {c.label}: {c.detail}
            </span>
          </li>
        ))}
      </ul>
      <TableContainer label="Row counts">
        <Table>
          <TableHead>
            <TableRow interactive={false}>
              <TableHeaderCell>Table</TableHeaderCell>
              <TableHeaderCell align="right">In the backup</TableHeaderCell>
              <TableHeaderCell align="right">In production now</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {Object.entries(verification.counts).map(([table, c]) => (
              <TableRow key={table} interactive={false}>
                <TableCell>{table}</TableCell>
                <TableCell align="right">{c.backup ?? '—'}</TableCell>
                <TableCell align="right">{c.current ?? '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}

/**
 * Restore Management: stage a restore of a chosen backup on a separate branch, check it, then
 * discard it or replace production (typed confirmation, recovery point kept). Production changes
 * only from the final confirmation; loading this page never restores anything.
 */
export function RestoreManagement({ overview, restores, selected, onSelectedUsed, onChanged, onOpen }) {
  const [active, setActive] = useState(null);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [ackGap, setAckGap] = useState(false);
  const [modalError, setModalError] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);

  const activeId = overview.activeRestore?.id;
  useEffect(() => {
    if (!activeId) return setActive(null);
    let alive = true;
    loadRestore(activeId)
      .then((r) => alive && setActive(r.restore))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [activeId, overview]);

  const configured = overview.provider.configured;
  const gap = active?.verification?.missingMigrations ?? [];

  async function stage() {
    setBusy(true);
    setMessage(null);
    try {
      const { restore } = await startRestore(selected.id);
      setActive(restore);
      setUnderstood(false);
      onSelectedUsed();
      setMessage({ variant: 'success', text: 'Restore staged on a separate branch. Production is unchanged. The check runs next; this page updates by itself.' });
      onChanged();
    } catch (failure) {
      if (failure.status !== 401) setMessage({ variant: 'error', text: failure.code === 'RESTORE_IN_PROGRESS' ? 'A restore is already in progress. Finish or discard it first.' : failure.message });
    } finally {
      setBusy(false);
    }
  }

  async function discard() {
    setBusy(true);
    try {
      await discardRestore(active.id);
      setDiscardOpen(false);
      setActive(null);
      setMessage({ variant: 'success', text: 'Staged restore discarded. The staged branch was deleted; production was not changed.' });
      onChanged();
    } catch (failure) {
      if (failure.status !== 401) setMessage({ variant: 'error', text: failure.message });
    } finally {
      setBusy(false);
    }
  }

  async function finalize() {
    setModalError('');
    setBusy(true);
    try {
      const { restore } = await finalizeRestore(active.id, { confirmation: typed, snapshotId: active.snapshotId, acknowledgeSchemaGap: gap.length ? ackGap : undefined });
      setFinalizeOpen(false);
      setActive(null);
      setMessage({
        variant: restore.status === 'COMPLETED' ? 'success' : 'error',
        text:
          restore.status === 'COMPLETED'
            ? `Production was restored. The previous database is kept as the Neon branch ${restore.recoveryPoint}.${gap.length ? ' Apply the missing migrations now (see the recovery procedure).' : ''} You may be signed out if your session is newer than the backup.`
            : `The restore did not complete: ${restore.error ?? 'see the audit log'}.`,
      });
      onChanged();
    } catch (failure) {
      if (failure.status === 401) return;
      setModalError(failure.details ? Object.values(failure.details).join(' ') : failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {message && (
        <Alert variant={message.variant} onDismiss={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <Card as="section" aria-labelledby="restore-how">
        <CardHeader titleAs="h2" title={<span id="restore-how">How a restore works</span>} description="Production is never overwritten without a separate check and an explicit confirmation." />
        <CardContent>
          <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {STEPS.map(([title, text], i) => (
              <li key={title} className="rounded-md border border-border p-3">
                <p className="text-card-title text-fg">
                  {i + 1}. {title}
                </p>
                <p className="text-small text-fg-secondary">{text}</p>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {active && (
        <Card as="section" aria-labelledby="restore-active">
          <CardHeader
            titleAs="h2"
            title={<span id="restore-active">Restore in progress</span>}
            description={`Backup ${active.snapshotId} · staged branch ${active.stagedBranch ?? '—'} · started ${formatDateTime(active.startedAt)} by ${active.requestedBy ?? '—'}`}
          />
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={restoreStatusOf(active.status).variant} dot>
                {restoreStatusOf(active.status).label}
              </Badge>
              {active.status === 'RUNNING' && <span className="text-small text-fg-muted">Step: {active.phase ?? 'staging'}…</span>}
            </div>
            {gap.length > 0 && (
              <Alert variant="warning" title="The backup is older than the application's database schema">
                {gap.length} migration(s) are missing in the backup ({gap.join(', ')}). After a production restore they must be applied at once (prisma migrate deploy), or the application will fail.
              </Alert>
            )}
            <VerificationResult verification={active.verification} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" leftIcon={Trash2} onClick={() => setDiscardOpen(true)} disabled={busy}>
                Discard staged restore
              </Button>
              <Button
                variant="danger"
                leftIcon={ShieldAlert}
                unavailableReason={active.status !== 'VERIFIED' ? 'Available once the staged database has passed its check.' : undefined}
                onClick={() => {
                  setTyped('');
                  setAckGap(false);
                  setModalError('');
                  setFinalizeOpen(true);
                }}
              >
                Restore production…
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!active && selected && (
        <Card as="section" aria-labelledby="restore-new">
          <CardHeader titleAs="h2" title={<span id="restore-new">Stage a restore</span>} description="The backup is restored onto a separate branch first. Production is not changed in this step." />
          <CardContent className="flex flex-col gap-4">
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <dt className="text-caption text-fg-muted">Backup date</dt>
                <dd className="text-body text-fg">{formatDateTime(selected.pointInTime ?? selected.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-caption text-fg-muted">Type</dt>
                <dd className="text-body text-fg">{KIND_LABELS[selected.kind] ?? selected.kind} · full database</dd>
              </div>
              <div>
                <dt className="text-caption text-fg-muted">Size</dt>
                <dd className="text-body text-fg">{formatBytes(selected.sizeBytes)}</dd>
              </div>
            </dl>
            <Alert variant="info" title="What staging does">
              Neon creates a new branch with the data as it was at that time, and EduTrack checks it. It uses Neon resources (a branch and briefly a compute) until you discard it or restore production from it.
            </Alert>
            <Checkbox label="I understand that staging does not change production, and that restoring production later replaces all data with this backup's." checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onSelectedUsed} disabled={busy}>
                Cancel
              </Button>
              <Button leftIcon={ArchiveRestore} loading={busy} disabled={!understood || !configured} onClick={stage}>
                Stage restore
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!active && !selected && (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 pt-5">
            <p className="text-body text-fg-secondary">No restore is in progress. To restore, open Backup History and choose Restore in a backup’s actions menu.</p>
            <Button variant="secondary" leftIcon={History} onClick={() => onOpen('history')}>
              Open Backup History
            </Button>
          </CardContent>
        </Card>
      )}

      <Card as="section" aria-labelledby="restore-recent">
        <CardHeader titleAs="h2" title={<span id="restore-recent">Recent restores</span>} />
        <CardContent>
          {restores.length ? (
            <TableContainer label="Recent restores">
              <Table>
                <TableHead>
                  <TableRow interactive={false}>
                    <TableHeaderCell>Started</TableHeaderCell>
                    <TableHeaderCell>Backup</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>By</TableHeaderCell>
                    <TableHeaderCell>Recovery point / error</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {restores.map((r) => (
                    <TableRow key={r.id} interactive={false}>
                      <TableCell>{formatDateTime(r.startedAt)}</TableCell>
                      <TableCell>{r.snapshotId}</TableCell>
                      <TableCell>
                        <Badge variant={restoreStatusOf(r.status).variant} dot>
                          {restoreStatusOf(r.status).label}
                        </Badge>
                      </TableCell>
                      <TableCell>{r.requestedBy ?? '—'}</TableCell>
                      <TableCell>{r.recoveryPoint ?? r.error ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <p className="text-small text-fg-muted">No restores yet.</p>
          )}
        </CardContent>
      </Card>

      <Modal
        open={discardOpen}
        onClose={() => setDiscardOpen(false)}
        title="Discard the staged restore?"
        description="The staged branch is deleted. Production is not changed."
        loading={busy}
        loadingLabel="Discarding…"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDiscardOpen(false)} disabled={busy}>
              Keep it
            </Button>
            <Button variant="danger" onClick={discard} loading={busy}>
              Discard
            </Button>
          </>
        }
      >
        <p className="text-body text-fg-secondary">You can stage the same backup again later.</p>
      </Modal>

      <Modal
        open={finalizeOpen}
        onClose={() => setFinalizeOpen(false)}
        size="lg"
        title="Replace production with this backup?"
        description={active ? `Backup ${active.snapshotId}` : ''}
        loading={busy}
        loadingLabel="Restoring production… this can take up to two minutes"
        error={modalError}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFinalizeOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" leftIcon={ShieldAlert} loading={busy} disabled={!confirmationOk(typed) || (gap.length > 0 && !ackGap)} onClick={finalize}>
              Restore production
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <Alert variant="error" title="This replaces all production data">
            <ul className="list-disc space-y-1 pl-5">
              <li>Every school, account, schedule, attendance record and setting returns to the backup's state. Everything recorded after the backup disappears from production.</li>
              <li>Users and devices signed in after the backup are signed out; the Staff app uploads its waiting attendance again.</li>
              <li>The platform is unavailable for a few seconds while Neon switches the database.</li>
              <li>The current database is kept as a Neon branch (recovery point) so this can be undone with the recovery procedure.</li>
            </ul>
          </Alert>
          {gap.length > 0 && (
            <Checkbox label={`I will apply the ${gap.length} missing migration(s) immediately after the restore.`} checked={ackGap} onChange={(e) => setAckGap(e.target.checked)} />
          )}
          <Input label={`Type ${PRODUCTION_CONFIRMATION} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
        </div>
      </Modal>
    </>
  );
}

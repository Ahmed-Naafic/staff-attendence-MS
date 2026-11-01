import { useCallback, useEffect, useState } from 'react';
import { ArchiveRestore, Eye, Lock, LockOpen, ShieldCheck, Trash2 } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Drawer,
  DropdownMenu,
  Modal,
  Pagination,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableEmpty,
  TableError,
  TableHead,
  TableHeaderCell,
  TableLoading,
  TableRow,
} from '../../../components/ui';
import { formatDateTime } from '../../../lib/format.js';
import { deleteBackup, loadBackups, setProtection, verifyBackup } from '../data/backupApi.js';
import { canDelete, canProtect, canRestore, canVerify, formatBytes, KIND_FILTERS, KIND_LABELS, STATUS_FILTERS, statusOf } from '../utils/backupRules.js';

const PAGE_SIZE = 10;
const COLUMNS = 9;

function Detail({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border-subtle py-2.5 last:border-b-0">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="break-words text-body text-fg">{children}</dd>
    </div>
  );
}

function Checks({ verification }) {
  if (!verification) return <p className="text-small text-fg-muted">Not checked yet.</p>;
  return (
    <ul className="flex flex-col gap-1.5">
      {verification.checks.map((c) => (
        <li key={c.key} className="flex items-start gap-2 text-small">
          <Badge variant={c.ok ? 'success' : c.warning ? 'warning' : 'error'}>{c.ok ? 'Passed' : c.warning ? 'Warning' : 'Failed'}</Badge>
          <span className="text-fg-secondary">
            {c.label}
            {c.detail ? `: ${c.detail}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Backup History: every backup with filters, pagination, details and actions (check, protect, restore, delete). */
export function BackupHistory({ configured, onChanged, onRestore, activeRestore }) {
  const [filters, setFilters] = useState({ status: '', kind: '' });
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ status: 'loading', items: [], total: 0 });
  const [details, setDetails] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [modalError, setModalError] = useState('');

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    try {
      const data = await loadBackups({ status: filters.status || undefined, kind: filters.kind || undefined, page, pageSize: PAGE_SIZE });
      setState({ status: 'ready', items: data.items, total: data.total, providerError: data.providerError });
    } catch (error) {
      if (error.status !== 401) setState({ status: 'error', items: [], total: 0, error });
    }
  }, [filters, page]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = async () => {
    await load();
    onChanged?.();
  };

  async function run(action, success) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      setMessage({ variant: 'success', text: typeof success === 'function' ? success(result) : success });
      await refresh();
      return result;
    } catch (failure) {
      if (failure.status !== 401) setMessage({ variant: 'error', text: failure.message });
      return null;
    } finally {
      setBusy(false);
    }
  }

  const verify = (b) =>
    run(
      () => verifyBackup(b.id),
      (r) => (r.verification.ok ? `Backup ${b.name} checked at Neon: complete and available.` : `Backup ${b.name} did not pass the check. See its details.`),
    ).then((r) => r && details?.id === b.id && setDetails({ ...b, verification: r.verification, verifiedAt: r.verification.checkedAt }));

  const protect = (b, value) => run(() => setProtection(b.id, value), value ? `Backup ${b.name} protected: it no longer expires and cannot be deleted.` : `Protection removed from ${b.name}.`);

  async function confirmDelete() {
    setModalError('');
    setBusy(true);
    try {
      await deleteBackup(toDelete.id);
      setMessage({ variant: 'success', text: `Backup ${toDelete.name} deleted.` });
      setToDelete(null);
      await refresh();
    } catch (failure) {
      if (failure.status !== 401) setModalError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  const actionsFor = (b) => [
    { label: 'View details', icon: Eye, onSelect: () => setDetails(b) },
    { label: 'Verify integrity', icon: ShieldCheck, onSelect: () => verify(b), disabled: !configured || busy || !canVerify(b) },
    ...(canProtect(b) ? [b.protected ? { label: 'Remove protection', icon: LockOpen, onSelect: () => protect(b, false), disabled: busy } : { label: 'Protect from deletion', icon: Lock, onSelect: () => protect(b, true), disabled: busy }] : []),
    { label: 'Restore…', icon: ArchiveRestore, onSelect: () => onRestore(b), disabled: !configured || !canRestore(b) || Boolean(activeRestore) },
    { type: 'separator' },
    { label: 'Delete', icon: Trash2, destructive: true, onSelect: () => setToDelete(b), disabled: !configured || !canDelete(b) },
  ];

  return (
    <Card as="section" aria-labelledby="backup-history">
      <CardHeader titleAs="h2" title={<span id="backup-history">Backup History</span>} description="Backups are Neon snapshots. They cannot be downloaded; restore one to a separate branch to read it." />
      <CardContent className="flex flex-col gap-4">
        {message && (
          <Alert variant={message.variant} onDismiss={() => setMessage(null)}>
            {message.text}
          </Alert>
        )}
        {state.providerError && <Alert variant="error">Neon could not be read: {state.providerError.message}</Alert>}
        <div className="flex flex-col gap-3 sm:flex-row">
          <Select label="Status" hideLabel options={STATUS_FILTERS} value={filters.status} onChange={(e) => (setPage(1), setFilters((f) => ({ ...f, status: e.target.value })))} fieldClassName="sm:w-48" />
          <Select label="Type" hideLabel options={KIND_FILTERS} value={filters.kind} onChange={(e) => (setPage(1), setFilters((f) => ({ ...f, kind: e.target.value })))} fieldClassName="sm:w-48" />
        </div>
        <TableContainer label="Backups">
          <Table>
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>Backup</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Created</TableHeaderCell>
                <TableHeaderCell align="right">Size</TableHeaderCell>
                <TableHeaderCell>Stored at</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Expires</TableHeaderCell>
                <TableHeaderCell>Created by</TableHeaderCell>
                <TableHeaderCell align="right">
                  <span className="sr-only">Actions</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {state.status === 'loading' && <TableLoading columns={COLUMNS} />}
              {state.status === 'error' && <TableError columns={COLUMNS} title="Backups could not be loaded" onRetry={load} />}
              {state.status === 'ready' && !state.items.length && (
                <TableEmpty columns={COLUMNS} title="No backups" description={filters.status || filters.kind ? 'No backup matches these filters.' : 'Create one with Create Backup Now, or set a schedule.'} />
              )}
              {state.status === 'ready' &&
                state.items.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-fg">{b.name}</span>
                        <span className="text-caption text-fg-muted">{b.id}</span>
                      </div>
                    </TableCell>
                    <TableCell>{KIND_LABELS[b.kind] ?? b.kind}</TableCell>
                    <TableCell>{b.createdAt ? formatDateTime(b.createdAt) : '—'}</TableCell>
                    <TableCell align="right">
                      {formatBytes(b.sizeBytes)}
                      {b.sizeKind === 'incremental' && <span className="block text-caption text-fg-muted">changes only</span>}
                    </TableCell>
                    <TableCell>{b.provider}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5">
                        <Badge variant={statusOf(b.status).variant} dot>
                          {statusOf(b.status).label}
                        </Badge>
                        {b.protected && <Lock className="size-3.5 text-fg-muted" aria-label="Protected" />}
                      </span>
                    </TableCell>
                    <TableCell>{b.protected ? 'Never (protected)' : b.expiresAt ? formatDateTime(b.expiresAt) : '—'}</TableCell>
                    <TableCell>{b.createdBy}</TableCell>
                    <TableCell align="right">
                      <DropdownMenu label={`Actions for ${b.name}`} items={actionsFor(b)} />
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={state.total} onPageChange={setPage} itemLabel="backups" />
        </TableContainer>
      </CardContent>

      <Drawer open={Boolean(details)} onClose={() => setDetails(null)} title={details?.name ?? 'Backup'} description="Backup details">
        {details && (
          <div className="flex flex-col gap-5">
            <dl>
              <Detail label="Backup ID">{details.id}</Detail>
              <Detail label="Status">
                <Badge variant={statusOf(details.status).variant} dot>
                  {statusOf(details.status).label}
                </Badge>
              </Detail>
              <Detail label="Type">{KIND_LABELS[details.kind] ?? details.kind} · full database snapshot</Detail>
              <Detail label="Created">{details.createdAt ? formatDateTime(details.createdAt) : '—'}</Detail>
              <Detail label="Data as of">{details.pointInTime ? formatDateTime(details.pointInTime) : '—'}</Detail>
              <Detail label="Size">
                {formatBytes(details.sizeBytes)}
                {details.sizeKind === 'incremental' ? ' (changes since the previous snapshot)' : ''}
              </Detail>
              <Detail label="Stored at">{details.provider} (inside the Neon project)</Detail>
              <Detail label="Expires">{details.protected ? 'Never (protected)' : details.expiresAt ? formatDateTime(details.expiresAt) : '—'}</Detail>
              <Detail label="Created by">{details.createdBy}</Detail>
              {details.deletedAt && <Detail label="Deleted">{`${formatDateTime(details.deletedAt)} by ${details.deletedBy ?? '—'}`}</Detail>}
              {details.error && <Detail label="Error">{details.error}</Detail>}
              <Detail label="Download">Not available: Neon snapshots cannot be exported as files.</Detail>
            </dl>
            <section className="flex flex-col gap-2">
              <h3 className="text-card-title text-fg">Integrity check</h3>
              {details.verifiedAt && <p className="text-caption text-fg-muted">Last checked {formatDateTime(details.verifiedAt)}</p>}
              <Checks verification={details.verification} />
              <p className="text-caption text-fg-muted">This checks the backup at Neon. To check the data itself, stage a restore (Restore Management).</p>
              <div>
                <Button variant="secondary" size="sm" leftIcon={ShieldCheck} loading={busy} disabled={!configured || !canVerify(details)} onClick={() => verify(details)}>
                  Verify integrity
                </Button>
              </div>
            </section>
          </div>
        )}
      </Drawer>

      <Modal
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        title="Delete this backup?"
        description={toDelete ? `${toDelete.name}, created ${toDelete.createdAt ? formatDateTime(toDelete.createdAt) : ''}` : ''}
        loading={busy}
        loadingLabel="Deleting…"
        error={modalError}
        footer={
          <>
            <Button variant="ghost" onClick={() => setToDelete(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" leftIcon={Trash2} onClick={confirmDelete} loading={busy}>
              Delete backup
            </Button>
          </>
        }
      >
        <p className="text-body text-fg-secondary">Neon deletes the snapshot permanently. You will not be able to restore the database to this point again.</p>
      </Modal>
    </Card>
  );
}

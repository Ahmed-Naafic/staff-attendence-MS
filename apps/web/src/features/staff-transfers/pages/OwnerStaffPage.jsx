import { useEffect, useState } from 'react';
import { ArrowLeftRight, ArrowRight, SearchX, Users } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import {
  Alert,
  Badge,
  Button,
  Card,
  Drawer,
  Input,
  Modal,
  Pagination,
  Select,
  Spinner,
  Table,
  TableActions,
  TableBody,
  TableCell,
  TableEmpty,
  TableError,
  TableHead,
  TableHeaderCell,
  TableLoading,
  TableRow,
} from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { formatUtc } from '../../branches';
import { dayList } from '../../schedules/utils/scheduleRules.js';
import { StaffStatusBadge } from '../../staff/components/StaffTable.jsx';
import { TransferModal } from '../components/TransferModal.jsx';
import { cancelTransfer, loadSchoolBranches, loadSchoolStaff, loadSchoolStaffMember, PAGE_SIZE } from '../data/transfersApi.js';
import { TRANSFER_STATES } from '../utils/transferRules.js';

const COLUMNS = 6;
const STATUS = [
  { value: '', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

/** One staff member for the Owner: current branch, scheduled transfer (with cancel), transfer history. */
function StaffDetails({ id, onClose, onTransfer, onChanged, version }) {
  const { status, data: staff, retry } = useApiData(() => loadSchoolStaffMember(id), `${id}|${version}`);
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scheduled = staff?.transfers.find((t) => t.status === 'scheduled');

  async function cancel() {
    setBusy(true);
    setError('');
    try {
      await cancelTransfer(id);
      setCancelling(false);
      onChanged('The scheduled transfer was cancelled.');
    } catch (failure) {
      if (failure.status !== 401) setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      size="lg"
      title={staff?.name ?? 'Staff member'}
      description={staff ? `Staff ID ${staff.staffId}` : undefined}
      footer={
        staff && (
          <div className="flex justify-end">
            <Button leftIcon={ArrowLeftRight} onClick={() => onTransfer(staff)} unavailableReason={scheduled ? 'A transfer is already scheduled. Cancel it first.' : undefined}>
              Transfer to Another Branch
            </Button>
          </div>
        )
      }
    >
      {!staff && status === 'loading' && <Spinner label="Loading the staff member" />}
      {!staff && status === 'error' && (
        <Alert variant="error" action={<Button size="sm" variant="outline" onClick={retry}>Try again</Button>}>
          The staff member could not be loaded.
        </Alert>
      )}
      {staff && (
        <div className="flex flex-col gap-6">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-caption text-fg-muted">Current branch</dt>
              <dd className="text-body text-fg">
                {staff.branch.name} ({staff.branch.code})
              </dd>
            </div>
            <div>
              <dt className="text-caption text-fg-muted">Job title</dt>
              <dd className="text-body text-fg">{staff.jobTitle}</dd>
            </div>
            <div>
              <dt className="text-caption text-fg-muted">Status</dt>
              <dd>
                <StaffStatusBadge status={staff.status} />
              </dd>
            </div>
          </dl>
          {error && <Alert variant="error">{error}</Alert>}
          {scheduled && (
            <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-warning-fg">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-small font-medium">
                  Moves to {scheduled.toBranch.name} ({scheduled.toBranch.code}) on {scheduled.effectiveFrom}
                </p>
                <Button size="sm" variant="outline" onClick={() => setCancelling(true)}>
                  Cancel Transfer
                </Button>
              </div>
              <p className="text-small">
                {scheduled.shifts.length ? scheduled.shifts.map((s) => `${s.name} ${s.start}–${s.end} (${dayList(s.days)})`).join('; ') : 'No shifts chosen at the new branch.'}
              </p>
            </div>
          )}
          <section aria-labelledby="transfer-history" className="flex flex-col gap-3">
            <h3 id="transfer-history" className="text-card-title text-fg">
              Transfer history
            </h3>
            {!staff.transfers.length && <p className="text-small text-fg-muted">This staff member has never been transferred.</p>}
            <ol className="flex flex-col gap-2">
              {staff.transfers.map((t) => (
                <li key={t.id} className="flex flex-col gap-1 rounded-md border border-border px-4 py-3 text-small">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-fg">{t.fromBranch.name}</span>
                    <ArrowRight aria-label="to" className="size-3.5 text-fg-muted" />
                    <span className="font-medium text-fg">{t.toBranch.name}</span>
                    <Badge variant={TRANSFER_STATES[t.status].variant}>{TRANSFER_STATES[t.status].label}</Badge>
                  </div>
                  <span className="text-fg-secondary">
                    From {t.effectiveFrom} ({t.timeZone}) · scheduled {formatUtc(t.createdAt)}
                    {t.cancelledAt && ` · cancelled ${formatUtc(t.cancelledAt)}`}
                  </span>
                </li>
              ))}
            </ol>
            <p className="text-small text-fg-muted">Attendance stays with the branch where it was recorded; the Staff ID never changes.</p>
          </section>
        </div>
      )}
      {cancelling && scheduled && (
        <Modal
          open
          size="sm"
          onClose={() => setCancelling(false)}
          loading={busy}
          loadingLabel="Cancelling…"
          title="Cancel the scheduled transfer?"
          description={`${staff.name} stays at ${staff.branch.name}. The shifts chosen at ${scheduled.toBranch.name} are cancelled too.`}
          footer={
            <>
              <Button variant="outline" onClick={() => setCancelling(false)} disabled={busy}>
                Keep Transfer
              </Button>
              <Button variant="danger" onClick={cancel} loading={busy}>
                Cancel Transfer
              </Button>
            </>
          }
        />
      )}
    </Drawer>
  );
}

/**
 * School Owner: the school's staff and their transfers between branches (docs/business-rules.md →
 * Staff transfers). Staff accounts are managed by each branch's Manager; here the Owner sees who
 * works where and moves staff between the school's branches.
 */
export default function OwnerStaffPage() {
  const [filters, setFilters] = useState({ query: '', branch: '', status: '' });
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState(null);
  const [transferring, setTransferring] = useState(null);
  const [notice, setNotice] = useState('');
  const { status, data, retry } = useApiData(() => loadSchoolStaff(filters, page), `${JSON.stringify(filters)}|${page}|${version}`, { delayMs: filters.query ? 250 : 0 });
  const branches = useApiData(() => loadSchoolBranches(), 'branches');
  const branchOptions = [{ value: '', label: 'All branches' }, ...(branches.data ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))];
  const filtered = Boolean(filters.query || filters.branch || filters.status);
  const update = (change) => {
    setFilters((f) => ({ ...f, ...change }));
    setPage(1);
  };
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(''), 8000);
    return () => clearTimeout(t);
  }, [notice]);

  return (
    <PageContainer>
      <PageHeader title="Staff" description="Who works at each branch of your school. Move staff between branches here; each branch’s Manager manages their accounts." />
      {notice && (
        <Alert variant="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}
      <Card className="overflow-hidden p-0">
        <div className="flex flex-col gap-3 border-b border-border-subtle p-4 sm:flex-row sm:items-end">
          <Input label="Search" type="search" placeholder="Name, Staff ID or job title" value={filters.query} onChange={(e) => update({ query: e.target.value })} fieldClassName="sm:w-72" />
          <Select label="Branch" options={branchOptions} value={filters.branch} onChange={(e) => update({ branch: e.target.value })} fieldClassName="sm:w-64" />
          <Select label="Status" options={STATUS} value={filters.status} onChange={(e) => update({ status: e.target.value })} fieldClassName="sm:w-44" />
        </div>
        <div role="region" aria-label="Staff" tabIndex={0} className="overflow-x-auto">
          <Table caption="Staff of your school">
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>Staff ID</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Job title</TableHeaderCell>
                <TableHeaderCell>Branch</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell align="right">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!data && status === 'loading' && <TableLoading columns={COLUMNS} />}
              {status === 'error' && <TableError columns={COLUMNS} title="Staff could not be loaded" onRetry={retry} />}
              {data && status !== 'error' && data.items.length === 0 && (
                <TableEmpty
                  columns={COLUMNS}
                  icon={filtered ? SearchX : Users}
                  title={filtered ? 'No staff found' : 'No staff yet'}
                  description={filtered ? 'No staff match your search and filters.' : 'Staff are created by each branch’s Manager.'}
                />
              )}
              {data &&
                status !== 'error' &&
                data.items.map((s) => (
                  <TableRow key={s.id} interactive={false}>
                    <TableCell className="tabular-nums">{s.staffId}</TableCell>
                    <TableCell>
                      <button type="button" onClick={() => setSelected(s.id)} className="text-left font-medium text-fg underline-offset-2 hover:underline">
                        {s.name}
                      </button>
                    </TableCell>
                    <TableCell>{s.jobTitle}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span>
                          {s.branch.name} ({s.branch.code})
                        </span>
                        {s.scheduledTransfer && (
                          <span className="text-caption text-warning-fg">
                            Moves to {s.scheduledTransfer.toBranch.name} on {s.scheduledTransfer.effectiveFrom}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StaffStatusBadge status={s.status} />
                    </TableCell>
                    <TableCell align="right">
                      <TableActions>
                        <Button size="sm" variant="outline" onClick={() => setSelected(s.id)}>
                          View
                        </Button>
                      </TableActions>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
        {data && data.total > 0 && <Pagination page={data.page} pageSize={PAGE_SIZE} total={data.total} onPageChange={setPage} itemLabel="staff" />}
      </Card>

      {selected && (
        <StaffDetails
          id={selected}
          version={version}
          onClose={() => setSelected(null)}
          onTransfer={(staff) => setTransferring(staff)}
          onChanged={(text) => {
            setNotice(text);
            setVersion((v) => v + 1);
          }}
        />
      )}
      {transferring && (
        <TransferModal
          staff={transferring}
          branches={branches.data ?? []}
          onClose={() => setTransferring(null)}
          onDone={(transfer) => {
            setTransferring(null);
            setNotice(`Transfer scheduled: ${transferring.name} moves to ${transfer.toBranch.name} on ${transfer.effectiveFrom}. The staff member and the branch’s Managers were notified.`);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </PageContainer>
  );
}

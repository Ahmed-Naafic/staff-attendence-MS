import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CircleOff, Plus, Power, UserCog } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Alert, Button, Card, ErrorState, Input, KpiCard, Select, Skeleton } from '../../../components/ui';
import { useOwnerSchool } from '../../branches';
import { ManagerDrawer } from '../components/ManagerDrawer.jsx';
import { ManagerFormModal } from '../components/ManagerFormModal.jsx';
import { ManagersTable } from '../components/ManagersTable.jsx';
import { managerStatuses } from '../components/ManagerStatusBadge.jsx';
import { ReactivateManagerModal, ResetPasswordModal, SuspendManagerModal, TransferManagerModal } from '../components/ManagerActionModals.jsx';
import { useManagerDetails, useManagerFilters, useManagers } from '../hooks/useManagers.js';
import { branchLabel } from '../utils/managerRules.js';

const SUMMARY = [
  { key: 'total', label: 'Total Managers', icon: UserCog, tone: 'info' },
  { key: 'active', label: 'Active Managers', icon: Power, tone: 'success' },
  { key: 'suspended', label: 'Suspended Managers', icon: CircleOff, tone: 'error' },
];
const STATUS_OPTIONS = [{ value: '', label: 'All statuses' }, ...Object.entries(managerStatuses).map(([value, s]) => ({ value, label: s.label }))];

/**
 * School Owner Managers: the Manager accounts of the owner's own school (the server decides which
 * school), with search, status and branch filters and pagination, a details panel
 * (/managers/:managerId), and Manager account management — add (with a temporary password), edit,
 * transfer within the school, reset the password, suspend and reactivate. While the school is
 * suspended everything is read-only.
 */
export default function ManagersPage() {
  const { managerId } = useParams();
  const navigate = useNavigate();
  const { filters, page, isFiltered, setFilter, setPage, reset, search } = useManagerFilters();
  const [version, setVersion] = useState(0);
  const school = useOwnerSchool(version);
  const { status, data, retry } = useManagers(filters, page, version);
  const details = useManagerDetails(managerId, version);
  const branches = data?.branches ?? [];
  const readOnly = school.data?.status === 'suspended';
  const addUnavailable = readOnly
    ? 'Your school is suspended: Managers cannot be added until it is reactivated.'
    : data && !branches.length
      ? 'Add a branch first: every Manager is assigned to a branch.'
      : undefined;
  const closeDetails = () => navigate({ pathname: '/managers', search });

  // { type: 'create' | 'edit' | 'transfer' | 'password' | 'suspend' | 'reactivate', manager? }
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const open = (type) => (manager) => {
    setNotice('');
    setDialog({ type, manager });
  };
  const closeDialog = () => setDialog(null);
  const done = (message) => (manager) => {
    setDialog(null);
    setNotice(message(manager));
    setVersion((n) => n + 1);
  };
  const created = (manager) => {
    done((m) => `${m.name} was added to ${branchLabel(m.branch)}. Give them the temporary password; they must change it at first sign-in.`)(manager);
    navigate({ pathname: `/managers/${manager.id}`, search });
  };
  const branchOptions = [{ value: '', label: 'All branches' }, ...branches.map((b) => ({ value: b.id, label: branchLabel(b) }))];

  return (
    <PageContainer>
      <PageHeader
        title="Managers"
        description={school.data ? `Managers of ${school.data.name} (${school.data.code}).` : 'Managers of your school.'}
        primaryAction={
          <Button leftIcon={Plus} onClick={() => open('create')()} unavailableReason={addUnavailable}>
            Add Manager
          </Button>
        }
      />

      {readOnly && (
        <Alert variant="warning" title="Your school is suspended">
          You can view your Managers and their history, but not change them until the school is reactivated.
        </Alert>
      )}
      {notice && (
        <Alert variant="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}

      {status === 'error' && (
        <Card>
          <ErrorState title="Managers could not be loaded" description="The Manager list is unavailable right now. Check your connection and try again." onRetry={retry} />
        </Card>
      )}

      {status === 'loading' && !data && (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading Managers">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      )}

      {data && status !== 'error' && (
        <>
          {details.notFound && (
            <Alert variant="warning" title="Manager not found">
              That Manager does not exist in your school.{' '}
              <Link to={{ pathname: '/managers', search }} className="font-medium underline">
                Back to all Managers
              </Link>
            </Alert>
          )}
          {details.error && (
            <Alert variant="error" title="Manager could not be loaded" action={<Button size="sm" variant="outline" onClick={details.retry}>Try again</Button>}>
              The Manager details are unavailable right now.
            </Alert>
          )}

          <section aria-labelledby="managers-summary">
            <h2 id="managers-summary" className="sr-only">
              Summary
            </h2>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {SUMMARY.map((card) => (
                <KpiCard key={card.key} label={card.label} icon={card.icon} tone={card.tone} value={data.summary[card.key]} />
              ))}
            </ul>
          </section>

          <Card as="section" aria-label="Search and filter Managers" className="p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <Input
                type="search"
                label="Search Managers"
                hideLabel
                placeholder="Search by name, email, phone or branch…"
                value={filters.query}
                onChange={(event) => setFilter('query', event.target.value)}
              />
              <Select label="Status" hideLabel options={STATUS_OPTIONS} value={filters.status} onChange={(event) => setFilter('status', event.target.value)} />
              <Select label="Branch" hideLabel options={branchOptions} value={filters.branch} onChange={(event) => setFilter('branch', event.target.value)} />
              <Button variant="outline" onClick={reset} disabled={!isFiltered}>
                Reset
              </Button>
            </div>
          </Card>

          <p aria-live="polite" className="sr-only">
            {isFiltered && status === 'success' ? `${data.total} ${data.total === 1 ? 'Manager' : 'Managers'} found` : ''}
          </p>

          <ManagersTable
            rows={data.items}
            total={data.total}
            page={data.page}
            onPageChange={setPage}
            selectedId={details.manager?.id}
            search={search}
            isFiltered={isFiltered}
            onReset={reset}
            onAdd={() => open('create')()}
            addUnavailable={addUnavailable}
          />

          <ManagerDrawer
            manager={details.manager}
            open={Boolean(details.manager)}
            onClose={closeDetails}
            readOnly={readOnly}
            version={version}
            onEdit={open('edit')}
            onTransfer={open('transfer')}
            onResetPassword={open('password')}
            onSuspend={open('suspend')}
            onReactivate={open('reactivate')}
          />
        </>
      )}

      {/* Dialogs sit outside the panel so Escape closes only the top one. */}
      <ManagerFormModal
        mode={dialog?.type === 'edit' ? 'edit' : 'create'}
        manager={dialog?.type === 'edit' ? dialog.manager : null}
        branches={branches}
        open={dialog?.type === 'create' || dialog?.type === 'edit'}
        onClose={closeDialog}
        onSaved={dialog?.type === 'edit' ? done((m) => `${m.name} was updated.`) : created}
      />
      <TransferManagerModal
        manager={dialog?.manager}
        branches={branches}
        open={dialog?.type === 'transfer'}
        onClose={closeDialog}
        onDone={done((m) => `${m.name} was transferred to ${branchLabel(m.branch)}.`)}
      />
      <ResetPasswordModal
        manager={dialog?.manager}
        open={dialog?.type === 'password'}
        onClose={closeDialog}
        onDone={done((m) => `A new temporary password was set for ${m.name}. They were signed out and must change it at the next sign-in.`)}
      />
      <SuspendManagerModal manager={dialog?.manager} open={dialog?.type === 'suspend'} onClose={closeDialog} onDone={done((m) => `${m.name} was suspended and signed out.`)} />
      <ReactivateManagerModal
        manager={dialog?.manager}
        open={dialog?.type === 'reactivate'}
        onClose={closeDialog}
        onDone={done((m) => `${m.name} was reactivated and can sign in again.`)}
      />
    </PageContainer>
  );
}

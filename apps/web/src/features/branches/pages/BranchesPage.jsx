import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Building2, CircleOff, Plus, Power } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Alert, Button, Card, ErrorState, Input, KpiCard, Select, Skeleton } from '../../../components/ui';
import { BranchDrawer } from '../components/BranchDrawer.jsx';
import { BranchFormModal } from '../components/BranchFormModal.jsx';
import { BranchesTable } from '../components/BranchesTable.jsx';
import { branchStatuses } from '../components/BranchStatusBadge.jsx';
import { ReactivateBranchModal, SuspendBranchModal } from '../components/BranchStatusModals.jsx';
import { CancelScheduledLocationModal, ChangeLocationModal } from '../components/LocationModals.jsx';
import { useBranchDetails, useBranchFilters, useBranches, useOwnerSchool } from '../hooks/useBranches.js';

const SUMMARY = [
  { key: 'total', label: 'Total Branches', icon: Building2, tone: 'info' },
  { key: 'active', label: 'Active Branches', icon: Power, tone: 'success' },
  { key: 'suspended', label: 'Suspended Branches', icon: CircleOff, tone: 'error' },
];
const STATUS_OPTIONS = [{ value: '', label: 'All statuses' }, ...Object.entries(branchStatuses).map(([value, s]) => ({ value, label: s.label }))];

/**
 * School Owner Branches: the branches of the owner's own school (the server decides which school),
 * with search, status filter and pagination, a details panel (/branches/:branchId), and Branch
 * Management — add (with GPS capture), edit, change location (now or scheduled), cancel a
 * scheduled change, suspend and reactivate. While the school is suspended everything is read-only.
 */
export default function BranchesPage() {
  const { branchId } = useParams();
  const navigate = useNavigate();
  const { filters, page, isFiltered, setFilter, setPage, reset, search } = useBranchFilters();
  const [version, setVersion] = useState(0);
  const school = useOwnerSchool(version);
  const { status, data, retry } = useBranches(filters, page, version);
  const details = useBranchDetails(branchId, version);
  const readOnly = school.data?.status === 'suspended';
  const closeDetails = () => navigate({ pathname: '/branches', search });

  // { type: 'create' | 'edit' | 'location' | 'cancel-location' | 'suspend' | 'reactivate', branch? }
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const open = (type) => (branch) => {
    setNotice('');
    setDialog({ type, branch });
  };
  const closeDialog = () => setDialog(null);
  const done = (message) => (branch) => {
    setDialog(null);
    setNotice(message(branch));
    setVersion((n) => n + 1);
  };
  const created = (branch) => {
    done((b) => `${b.name} was added with code ${b.code} and is active.`)(branch);
    navigate({ pathname: `/branches/${branch.id}`, search });
  };

  return (
    <PageContainer>
      <PageHeader
        title="Branches"
        description={school.data ? `Branches of ${school.data.name} (${school.data.code}).` : 'Branches of your school.'}
        primaryAction={
          <Button
            leftIcon={Plus}
            onClick={() => open('create')()}
            unavailableReason={readOnly ? 'Your school is suspended: branches cannot be added until it is reactivated.' : undefined}
          >
            Add Branch
          </Button>
        }
      />

      {readOnly && (
        <Alert variant="warning" title="Your school is suspended">
          You can view your branches, their locations and history, but not change them until the school is reactivated. No branch operates while the
          school is suspended; each branch keeps its own status.
        </Alert>
      )}
      {notice && (
        <Alert variant="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}

      {status === 'error' && (
        <Card>
          <ErrorState title="Branches could not be loaded" description="The branch list is unavailable right now. Check your connection and try again." onRetry={retry} />
        </Card>
      )}

      {status === 'loading' && !data && (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading branches">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      )}

      {data && status !== 'error' && (
        <>
          {details.notFound && (
            <Alert variant="warning" title="Branch not found">
              That branch does not exist in your school.{' '}
              <Link to={{ pathname: '/branches', search }} className="font-medium underline">
                Back to all branches
              </Link>
            </Alert>
          )}
          {details.error && (
            <Alert variant="error" title="Branch could not be loaded" action={<Button size="sm" variant="outline" onClick={details.retry}>Try again</Button>}>
              The branch details are unavailable right now.
            </Alert>
          )}

          <section aria-labelledby="branches-summary">
            <h2 id="branches-summary" className="sr-only">
              Summary
            </h2>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {SUMMARY.map((card) => (
                <KpiCard key={card.key} label={card.label} icon={card.icon} tone={card.tone} value={data.summary[card.key]} />
              ))}
            </ul>
          </section>

          <Card as="section" aria-label="Search and filter branches" className="p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
              <Input
                type="search"
                label="Search branches"
                hideLabel
                placeholder="Search branches by name, code, or city…"
                value={filters.query}
                onChange={(event) => setFilter('query', event.target.value)}
              />
              <Select label="Status" hideLabel options={STATUS_OPTIONS} value={filters.status} onChange={(event) => setFilter('status', event.target.value)} />
              <Button variant="outline" onClick={reset} disabled={!isFiltered}>
                Reset
              </Button>
            </div>
          </Card>

          <p aria-live="polite" className="sr-only">
            {isFiltered && status === 'success' ? `${data.total} ${data.total === 1 ? 'branch' : 'branches'} found` : ''}
          </p>

          <BranchesTable
            rows={data.items}
            total={data.total}
            page={data.page}
            onPageChange={setPage}
            selectedId={details.branch?.id}
            search={search}
            isFiltered={isFiltered}
            onReset={reset}
            onAdd={() => open('create')()}
            readOnly={readOnly}
          />

          <BranchDrawer
            branch={details.branch}
            open={Boolean(details.branch)}
            onClose={closeDetails}
            readOnly={readOnly}
            version={version}
            onEdit={open('edit')}
            onChangeLocation={open('location')}
            onCancelScheduled={open('cancel-location')}
            onSuspend={open('suspend')}
            onReactivate={open('reactivate')}
          />
        </>
      )}

      {/* Dialogs sit outside the panel so Escape closes only the top one. */}
      <BranchFormModal
        mode={dialog?.type === 'edit' ? 'edit' : 'create'}
        branch={dialog?.type === 'edit' ? dialog.branch : null}
        open={dialog?.type === 'create' || dialog?.type === 'edit'}
        cities={data?.cities ?? []}
        onClose={closeDialog}
        onSaved={dialog?.type === 'edit' ? done((b) => `${b.name} was updated.`) : created}
      />
      <ChangeLocationModal
        branch={dialog?.branch}
        open={dialog?.type === 'location'}
        onClose={closeDialog}
        onDone={done((b) => (b.scheduledLocation ? `The location change for ${b.name} is scheduled.` : `The location of ${b.name} was saved.`))}
      />
      <CancelScheduledLocationModal
        branch={dialog?.branch}
        open={dialog?.type === 'cancel-location'}
        onClose={closeDialog}
        onDone={done((b) => `The scheduled location change for ${b.name} was cancelled.`)}
      />
      <SuspendBranchModal branch={dialog?.branch} open={dialog?.type === 'suspend'} onClose={closeDialog} onDone={done((b) => `${b.name} was suspended.`)} />
      <ReactivateBranchModal
        branch={dialog?.branch}
        open={dialog?.type === 'reactivate'}
        onClose={closeDialog}
        onDone={done((b) => `${b.name} was reactivated and is active.`)}
      />
    </PageContainer>
  );
}

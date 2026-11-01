import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CircleOff, Plus, Power, Users } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Alert, Button, Card, ErrorState, Input, KpiCard, Select, Skeleton } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { loadMyBranch } from '../../my-branch/data/loadMyBranch.js';
import { AssignmentEditorModal } from '../components/AssignmentEditorModal.jsx';
import { ReactivateStaffModal, ResetStaffPasswordModal, SuspendStaffModal } from '../components/StaffActionModals.jsx';
import { StaffDrawer } from '../components/StaffDrawer.jsx';
import { StaffFormModal } from '../components/StaffFormModal.jsx';
import { staffStatuses, StaffTable } from '../components/StaffTable.jsx';
import { useStaffDetails, useStaffFilters, useStaffList } from '../hooks/useStaff.js';
import { whenText } from '../../schedules/utils/scheduleRules.js';

const SUMMARY = [
  { key: 'total', label: 'Total Staff', icon: Users, tone: 'info' },
  { key: 'active', label: 'Active Staff', icon: Power, tone: 'success' },
  { key: 'suspended', label: 'Suspended Staff', icon: CircleOff, tone: 'error' },
];
const STATUS_OPTIONS = [{ value: '', label: 'All statuses' }, ...Object.entries(staffStatuses).map(([value, s]) => ({ value, label: s.label }))];
const NOT_OPERATING = { branch_suspended: 'Your branch is suspended.', school_suspended: 'Your school is suspended.' };

/**
 * Manager Staff: the staff of the Manager's own branch (decided by the server), with search, status
 * filter and pagination, a details panel (/staff/:staffId), and staff management — add (active at
 * once, Staff ID generated, temporary password), edit, shift assignments, reset password, suspend
 * and reactivate. Read only while the branch or school is suspended.
 */
export default function StaffPage() {
  const { staffId } = useParams();
  const navigate = useNavigate();
  const { filters, page, isFiltered, setFilter, setPage, reset, search } = useStaffFilters();
  const [version, setVersion] = useState(0);
  const branch = useApiData(loadMyBranch, `branch|${version}`);
  const { status, data, retry } = useStaffList(filters, page, version);
  const details = useStaffDetails(staffId, version);
  const readOnly = branch.data ? !branch.data.branch.operating : false;
  const blocked = readOnly ? 'Your branch or school is suspended: staff cannot be added until it is reactivated.' : undefined;
  const closeDetails = () => navigate({ pathname: '/staff', search });

  // { type: 'create' | 'edit' | 'assign' | 'password' | 'suspend' | 'reactivate', staff? }
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const open = (type) => (staff) => {
    setNotice('');
    setDialog({ type, staff });
  };
  const closeDialog = () => setDialog(null);
  const done = (message) => (staff) => {
    setDialog(null);
    setNotice(message(staff));
    setVersion((n) => n + 1);
  };
  const created = (staff) => {
    done((s) => `${s.name} was added with Staff ID ${s.staffId} and is active. Give them the temporary password; they sign in with their phone number.`)(staff);
    navigate({ pathname: `/staff/${staff.id}`, search });
  };

  return (
    <PageContainer>
      <PageHeader
        title="Staff"
        description={branch.data ? `Staff of ${branch.data.branch.name} (${branch.data.branch.code}).` : 'Staff of your branch.'}
        primaryAction={
          <Button leftIcon={Plus} onClick={() => open('create')()} unavailableReason={blocked}>
            Add Staff
          </Button>
        }
      />

      {readOnly && (
        <Alert variant="warning" title="Read only">
          {branch.data.branch.notOperatingReasons.map((r) => NOT_OPERATING[r] ?? r).join(' ')} You can view staff and their assignments, but not change them until
          it is reactivated.
        </Alert>
      )}
      {notice && (
        <Alert variant="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}

      {status === 'error' && (
        <Card>
          <ErrorState title="Staff could not be loaded" description="The staff list is unavailable right now. Check your connection and try again." onRetry={retry} />
        </Card>
      )}
      {status === 'loading' && !data && (
        <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading staff">
          <Skeleton className="h-24" />
          <Skeleton className="h-64" />
        </div>
      )}

      {data && status !== 'error' && (
        <>
          {details.notFound && (
            <Alert variant="warning" title="Staff member not found">
              That staff member does not exist in your branch.{' '}
              <Link to={{ pathname: '/staff', search }} className="font-medium underline">
                Back to all staff
              </Link>
            </Alert>
          )}
          {details.error && (
            <Alert variant="error" title="Staff member could not be loaded" action={<Button size="sm" variant="outline" onClick={details.retry}>Try again</Button>}>
              The details are unavailable right now.
            </Alert>
          )}

          <section aria-labelledby="staff-summary">
            <h2 id="staff-summary" className="sr-only">
              Summary
            </h2>
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {SUMMARY.map((card) => (
                <KpiCard key={card.key} label={card.label} icon={card.icon} tone={card.tone} value={data.summary[card.key]} />
              ))}
            </ul>
          </section>

          <Card as="section" aria-label="Search and filter staff" className="p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_auto]">
              <Input
                type="search"
                label="Search staff"
                hideLabel
                placeholder="Search by name, Staff ID, phone or job title…"
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
            {isFiltered && status === 'success' ? `${data.total} staff found` : ''}
          </p>

          <StaffTable
            rows={data.items}
            total={data.total}
            page={data.page}
            onPageChange={setPage}
            selectedId={details.staff?.id}
            search={search}
            isFiltered={isFiltered}
            onReset={reset}
            onAdd={() => open('create')()}
            addUnavailable={blocked}
          />

          <StaffDrawer
            staff={details.staff}
            open={Boolean(details.staff)}
            onClose={closeDetails}
            readOnly={readOnly}
            version={version}
            onEdit={open('edit')}
            onAssign={open('assign')}
            onResetPassword={open('password')}
            onSuspend={open('suspend')}
            onReactivate={open('reactivate')}
            onCancelled={done((s) => `The scheduled assignment change for ${s.name} was cancelled.`)}
          />
        </>
      )}

      {/* Dialogs sit outside the panel so Escape closes only the top one. */}
      <StaffFormModal
        mode={dialog?.type === 'edit' ? 'edit' : 'create'}
        staff={dialog?.type === 'edit' ? dialog.staff : null}
        open={dialog?.type === 'create' || dialog?.type === 'edit'}
        onClose={closeDialog}
        onSaved={dialog?.type === 'edit' ? done((s) => `${s.name} was updated.`) : created}
      />
      <AssignmentEditorModal
        staff={dialog?.type === 'assign' ? dialog.staff : null}
        open={dialog?.type === 'assign'}
        onClose={closeDialog}
        onSaved={done((s) =>
          s.assignments.scheduled ? `The shift assignments of ${s.name} change from ${whenText(s.assignments.scheduled)}.` : `The shift assignments of ${s.name} were saved.`,
        )}
      />
      <ResetStaffPasswordModal
        staff={dialog?.staff}
        open={dialog?.type === 'password'}
        onClose={closeDialog}
        onDone={done((s) => `A new temporary password was set for ${s.name}. They were signed out and must change it at the next sign-in.`)}
      />
      <SuspendStaffModal staff={dialog?.staff} open={dialog?.type === 'suspend'} onClose={closeDialog} onDone={done((s) => `${s.name} was suspended and signed out.`)} />
      <ReactivateStaffModal staff={dialog?.staff} open={dialog?.type === 'reactivate'} onClose={closeDialog} onDone={done((s) => `${s.name} was reactivated and can sign in again.`)} />
    </PageContainer>
  );
}

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Plus } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Alert, Badge, Button, Card, ErrorState } from '../../../components/ui';
import { OwnerDrawer } from '../components/OwnerDrawer.jsx';
import { OwnerFormModal } from '../components/OwnerFormModal.jsx';
import { OwnersFilters } from '../components/OwnersFilters.jsx';
import { OwnersSkeleton } from '../components/OwnersSkeleton.jsx';
import { OwnersSummary } from '../components/OwnersSummary.jsx';
import { ReactivateOwnerModal, SuspendOwnerModal } from '../components/OwnerStatusModals.jsx';
import { OwnersTable } from '../components/OwnersTable.jsx';
import { useOwnerFilters } from '../hooks/useOwnerFilters.js';
import { useOwnerDetails, useOwners } from '../hooks/useOwners.js';
import { PAGE_SIZE } from '../utils/filterOwners.js';

/**
 * Super Admin School Owners: platform-wide list with search, filters and pagination, a details
 * panel (/school-owners/:ownerId), and Owner Management — add (to a school without an owner),
 * edit, suspend (with a reason) and reactivate. Each action opens its own dialog; afterwards the
 * list and panel reload.
 */
export default function SchoolOwnersPage() {
  const { ownerId } = useParams();
  const navigate = useNavigate();
  const { filters, page, isFiltered, setFilter, setPage, reset, search } = useOwnerFilters();
  const [version, setVersion] = useState(0);
  // Search, filters and pagination run on the server; `data` is the current page.
  const { status, data, retry } = useOwners(filters, page, version);
  const { owner: selected, notFound } = useOwnerDetails(ownerId, data?.items, version);
  const closeDetails = () => navigate({ pathname: '/school-owners', search });

  // { type: 'create' | 'edit' | 'suspend' | 'reactivate', owner? }
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const open = (type) => (owner) => {
    setNotice('');
    setDialog({ type, owner });
  };
  const closeDialog = () => setDialog(null);
  const done = (message) => (owner) => {
    setDialog(null);
    setNotice(message(owner));
    setVersion((n) => n + 1);
  };
  // A new owner is newest, so first in the unfiltered list; their panel opens.
  const added = (owner) => {
    done((o) => `${o.name} was added as the owner of ${o.school?.name ?? 'the school'} and is active.`)(owner);
    navigate({ pathname: `/school-owners/${owner.id}` });
  };

  return (
    <PageContainer>
      <PageHeader
        title="School Owners"
        description="Manage school owners on the platform."
        secondaryActions={
          data?.isDemo && (
            <Badge variant="warning" dot>
              Demo data<span className="sr-only">: sample school owners, not connected to platform data yet</span>
            </Badge>
          )
        }
        primaryAction={
          <Button leftIcon={Plus} onClick={() => open('create')()}>
            Add School Owner
          </Button>
        }
      />

      {notice && (
        <Alert variant="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}

      {status === 'error' && (
        <Card>
          <ErrorState
            title="School owners could not be loaded"
            description="The owner list is unavailable right now. Check your connection and try again."
            onRetry={retry}
          />
        </Card>
      )}

      {status === 'loading' && !data && <OwnersSkeleton />}

      {data && status !== 'error' && (
        <>
          {notFound && (
            <Alert variant="warning" title="School owner not found">
              That school owner does not exist or is no longer available.{' '}
              <Link to={{ pathname: '/school-owners', search }} className="font-medium underline">
                Back to all school owners
              </Link>
            </Alert>
          )}

          <OwnersSummary counts={data.summary} />

          <OwnersFilters
            filters={filters}
            locations={data.locations}
            onChange={setFilter}
            onReset={reset}
            isFiltered={isFiltered}
          />

          {/* Announces the result count after searching or filtering. */}
          <p aria-live="polite" className="sr-only">
            {isFiltered && status === 'success' ? `${data.total} ${data.total === 1 ? 'school owner' : 'school owners'} found` : ''}
          </p>

          <OwnersTable
            rows={data.items}
            total={data.total}
            page={data.page}
            offset={(data.page - 1) * PAGE_SIZE}
            onPageChange={setPage}
            selectedId={selected?.id}
            search={search}
            isFiltered={isFiltered}
            onReset={reset}
            onEdit={open('edit')}
            onSuspend={open('suspend')}
            onReactivate={open('reactivate')}
          />

          <OwnerDrawer
            owner={selected}
            open={Boolean(selected)}
            onClose={closeDetails}
            onEdit={open('edit')}
            onSuspend={open('suspend')}
            onReactivate={open('reactivate')}
          />
        </>
      )}

      {/* Dialogs sit outside the panel so Escape closes only the top one. */}
      <OwnerFormModal
        mode={dialog?.type === 'edit' ? 'edit' : 'create'}
        owner={dialog?.type === 'edit' ? dialog.owner : null}
        open={dialog?.type === 'create' || dialog?.type === 'edit'}
        onClose={closeDialog}
        onSaved={dialog?.type === 'edit' ? done((o) => `${o.name} was updated.`) : added}
      />
      <SuspendOwnerModal
        owner={dialog?.owner}
        open={dialog?.type === 'suspend'}
        onClose={closeDialog}
        onDone={done((o) => `${o.name} was suspended and signed out.`)}
      />
      <ReactivateOwnerModal
        owner={dialog?.owner}
        open={dialog?.type === 'reactivate'}
        onClose={closeDialog}
        onDone={done((o) => `${o.name} was reactivated and can sign in again.`)}
      />
    </PageContainer>
  );
}

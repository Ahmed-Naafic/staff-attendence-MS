import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Plus } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Alert, Badge, Button, Card, ErrorState } from '../../../components/ui';
import { SchoolDrawer } from '../components/SchoolDrawer.jsx';
import { SchoolFormModal } from '../components/SchoolFormModal.jsx';
import { SchoolsFilters } from '../components/SchoolsFilters.jsx';
import { SchoolsSkeleton } from '../components/SchoolsSkeleton.jsx';
import { SchoolsSummary } from '../components/SchoolsSummary.jsx';
import { ReactivateSchoolModal, SuspendSchoolModal } from '../components/SchoolStatusModals.jsx';
import { SchoolsTable } from '../components/SchoolsTable.jsx';
import { useSchoolFilters } from '../hooks/useSchoolFilters.js';
import { useSchoolDetails, useSchools } from '../hooks/useSchools.js';
import { PAGE_SIZE } from '../utils/filterSchools.js';

/**
 * Super Admin Schools: platform-wide list with search, filters and pagination, a details panel
 * (/schools/:schoolId), and School Management — register, edit, suspend (with a reason) and
 * reactivate. Each action opens its own dialog; afterwards the list and panel reload.
 */
export default function SchoolsPage() {
  const { schoolId } = useParams();
  const navigate = useNavigate();
  const { filters, page, isFiltered, setFilter, setPage, reset, search } = useSchoolFilters();
  const [version, setVersion] = useState(0);
  // Search, filters and pagination run on the server; `data` is the current page.
  const { status, data, retry } = useSchools(filters, page, version);
  const { school: selected, notFound } = useSchoolDetails(schoolId, data?.items, version);
  const closeDetails = () => navigate({ pathname: '/schools', search });

  // { type: 'create' | 'edit' | 'suspend' | 'reactivate', school? }
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const open = (type) => (school) => {
    setNotice('');
    setDialog({ type, school });
  };
  const closeDialog = () => setDialog(null);
  const done = (message) => (school) => {
    setDialog(null);
    setNotice(message(school));
    setVersion((n) => n + 1);
  };
  // A new school is newest, so it is first in the unfiltered list; its panel opens.
  const registered = (school) => {
    done((s) => `${s.name} was registered and is active.`)(school);
    navigate({ pathname: `/schools/${school.id}` });
  };

  return (
    <PageContainer>
      <PageHeader
        title="Schools"
        description="Manage all schools on the platform."
        secondaryActions={
          data?.isDemo && (
            <Badge variant="warning" dot>
              Demo data<span className="sr-only">: sample schools, not connected to platform data yet</span>
            </Badge>
          )
        }
        primaryAction={
          <Button leftIcon={Plus} onClick={() => open('create')()}>
            Register New School
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
            title="Schools could not be loaded"
            description="The school list is unavailable right now. Check your connection and try again."
            onRetry={retry}
          />
        </Card>
      )}

      {status === 'loading' && !data && <SchoolsSkeleton />}

      {data && status !== 'error' && (
        <>
          {notFound && (
            <Alert variant="warning" title="School not found">
              That school does not exist or is no longer available.{' '}
              <Link to={{ pathname: '/schools', search }} className="font-medium underline">
                Back to all schools
              </Link>
            </Alert>
          )}

          <SchoolsSummary counts={data.summary} />

          <SchoolsFilters
            filters={filters}
            locations={data.locations}
            onChange={setFilter}
            onReset={reset}
            isFiltered={isFiltered}
          />

          {/* Announces the result count after searching or filtering. */}
          <p aria-live="polite" className="sr-only">
            {isFiltered && status === 'success' ? `${data.total} ${data.total === 1 ? 'school' : 'schools'} found` : ''}
          </p>

          <SchoolsTable
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

          <SchoolDrawer
            school={selected}
            open={Boolean(selected)}
            onClose={closeDetails}
            onEdit={open('edit')}
            onSuspend={open('suspend')}
            onReactivate={open('reactivate')}
          />
        </>
      )}

      {/* Dialogs sit outside the panel so Escape closes only the top one. */}
      <SchoolFormModal
        mode={dialog?.type === 'edit' ? 'edit' : 'create'}
        school={dialog?.type === 'edit' ? dialog.school : null}
        open={dialog?.type === 'create' || dialog?.type === 'edit'}
        cities={data?.locations ?? []}
        onClose={closeDialog}
        onSaved={dialog?.type === 'edit' ? done((s) => `${s.name} was updated.`) : registered}
      />
      <SuspendSchoolModal
        school={dialog?.school}
        open={dialog?.type === 'suspend'}
        onClose={closeDialog}
        onDone={done((s) => `${s.name} was suspended.`)}
      />
      <ReactivateSchoolModal
        school={dialog?.school}
        open={dialog?.type === 'reactivate'}
        onClose={closeDialog}
        onDone={done((s) => `${s.name} was reactivated and is active.`)}
      />
    </PageContainer>
  );
}

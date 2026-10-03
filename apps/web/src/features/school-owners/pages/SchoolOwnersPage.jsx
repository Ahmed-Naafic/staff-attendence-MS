import { Link, useNavigate, useParams } from 'react-router';
import { Plus } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Alert, Badge, Button, Card, ErrorState } from '../../../components/ui';
import { OwnerDrawer, UNAVAILABLE_REASON } from '../components/OwnerDrawer.jsx';
import { OwnersFilters } from '../components/OwnersFilters.jsx';
import { OwnersSkeleton } from '../components/OwnersSkeleton.jsx';
import { OwnersSummary } from '../components/OwnersSummary.jsx';
import { OwnersTable } from '../components/OwnersTable.jsx';
import { useOwnerFilters } from '../hooks/useOwnerFilters.js';
import { useOwnerDetails, useOwners } from '../hooks/useOwners.js';
import { PAGE_SIZE } from '../utils/filterOwners.js';

/**
 * Super Admin School Owners: platform-wide list with search, filters, pagination and a
 * read-only details panel. /school-owners/:ownerId opens the panel for that owner.
 */
export default function SchoolOwnersPage() {
  const { ownerId } = useParams();
  const navigate = useNavigate();
  const { filters, page, isFiltered, setFilter, setPage, reset, search } = useOwnerFilters();
  // Search, filters and pagination run on the server; `data` is the current page.
  const { status, data, retry } = useOwners(filters, page);
  const { owner: selected, notFound } = useOwnerDetails(ownerId, data?.items);
  const closeDetails = () => navigate({ pathname: '/school-owners', search });

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
          <Button leftIcon={Plus} unavailableReason={UNAVAILABLE_REASON}>
            Add School Owner
          </Button>
        }
      />

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
          />

          <OwnerDrawer owner={selected} open={Boolean(selected)} onClose={closeDetails} />
        </>
      )}
    </PageContainer>
  );
}

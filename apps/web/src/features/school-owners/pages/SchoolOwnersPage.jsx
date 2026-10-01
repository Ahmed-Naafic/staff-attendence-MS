import { useMemo } from 'react';
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
import { useOwners } from '../hooks/useOwners.js';
import { filterOwners, locationsOf, paginate } from '../utils/filterOwners.js';

/**
 * Super Admin School Owners: platform-wide list with search, filters, pagination and a
 * read-only details panel. /school-owners/:ownerId opens the panel for that owner.
 */
export default function SchoolOwnersPage() {
  const { ownerId } = useParams();
  const navigate = useNavigate();
  const { status, data, retry } = useOwners();
  const { filters, page, isFiltered, setFilter, setPage, reset, search } = useOwnerFilters();

  const owners = useMemo(() => data?.owners ?? [], [data]);
  const filtered = useMemo(() => filterOwners(owners, filters), [owners, filters]);
  const current = paginate(filtered, page);
  const selected = ownerId ? owners.find((o) => o.id === ownerId) : null;
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
          {ownerId && !selected && (
            <Alert variant="warning" title="School owner not found">
              That school owner does not exist or is no longer available.{' '}
              <Link to={{ pathname: '/school-owners', search }} className="font-medium underline">
                Back to all school owners
              </Link>
            </Alert>
          )}

          <OwnersSummary owners={owners} summary={data.summary} />

          <OwnersFilters
            filters={filters}
            locations={locationsOf(owners)}
            onChange={setFilter}
            onReset={reset}
            isFiltered={isFiltered}
          />

          {/* Announces the result count after searching or filtering. */}
          <p aria-live="polite" className="sr-only">
            {isFiltered ? `${filtered.length} ${filtered.length === 1 ? 'school owner' : 'school owners'} found` : ''}
          </p>

          <OwnersTable
            rows={current.rows}
            total={filtered.length}
            page={current.page}
            offset={current.offset}
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

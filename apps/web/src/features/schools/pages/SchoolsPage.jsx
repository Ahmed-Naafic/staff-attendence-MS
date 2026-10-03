import { Link, useNavigate, useParams } from 'react-router';
import { Plus } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Alert, Badge, Button, Card, ErrorState } from '../../../components/ui';
import { SchoolDrawer, UNAVAILABLE_REASON } from '../components/SchoolDrawer.jsx';
import { SchoolsFilters } from '../components/SchoolsFilters.jsx';
import { SchoolsSkeleton } from '../components/SchoolsSkeleton.jsx';
import { SchoolsSummary } from '../components/SchoolsSummary.jsx';
import { SchoolsTable } from '../components/SchoolsTable.jsx';
import { useSchoolFilters } from '../hooks/useSchoolFilters.js';
import { useSchoolDetails, useSchools } from '../hooks/useSchools.js';
import { PAGE_SIZE } from '../utils/filterSchools.js';

/**
 * Super Admin Schools: platform-wide list with search, filters, pagination and a details panel.
 * /schools/:schoolId opens the panel for that school over the list.
 */
export default function SchoolsPage() {
  const { schoolId } = useParams();
  const navigate = useNavigate();
  const { filters, page, isFiltered, setFilter, setPage, reset, search } = useSchoolFilters();
  // Search, filters and pagination run on the server; `data` is the current page.
  const { status, data, retry } = useSchools(filters, page);
  const { school: selected, notFound } = useSchoolDetails(schoolId, data?.items);
  const closeDetails = () => navigate({ pathname: '/schools', search });

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
          <Button leftIcon={Plus} unavailableReason={UNAVAILABLE_REASON}>
            Register New School
          </Button>
        }
      />

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
          />

          <SchoolDrawer school={selected} open={Boolean(selected)} onClose={closeDetails} />
        </>
      )}
    </PageContainer>
  );
}

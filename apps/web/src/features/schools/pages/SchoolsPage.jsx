import { useMemo } from 'react';
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
import { useSchools } from '../hooks/useSchools.js';
import { filterSchools, locationsOf, paginate } from '../utils/filterSchools.js';

/**
 * Super Admin Schools: platform-wide list with search, filters, pagination and a details panel.
 * /schools/:schoolId opens the panel for that school over the list.
 */
export default function SchoolsPage() {
  const { schoolId } = useParams();
  const navigate = useNavigate();
  const { status, data, retry } = useSchools();
  const { filters, page, isFiltered, setFilter, setPage, reset, search } = useSchoolFilters();

  const schools = useMemo(() => data?.schools ?? [], [data]);
  const filtered = useMemo(() => filterSchools(schools, filters), [schools, filters]);
  const current = paginate(filtered, page);
  const selected = schoolId ? schools.find((s) => s.id === schoolId) : null;
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
          {schoolId && !selected && (
            <Alert variant="warning" title="School not found">
              That school does not exist or is no longer available.{' '}
              <Link to={{ pathname: '/schools', search }} className="font-medium underline">
                Back to all schools
              </Link>
            </Alert>
          )}

          <SchoolsSummary schools={schools} summary={data.summary} />

          <SchoolsFilters
            filters={filters}
            locations={locationsOf(schools)}
            onChange={setFilter}
            onReset={reset}
            isFiltered={isFiltered}
          />

          {/* Announces the result count after searching or filtering. */}
          <p aria-live="polite" className="sr-only">
            {isFiltered ? `${filtered.length} ${filtered.length === 1 ? 'school' : 'schools'} found` : ''}
          </p>

          <SchoolsTable
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

          <SchoolDrawer school={selected} open={Boolean(selected)} onClose={closeDetails} />
        </>
      )}
    </PageContainer>
  );
}

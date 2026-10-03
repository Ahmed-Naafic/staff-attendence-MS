import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Alert, Badge, Card, ErrorState } from '../../../components/ui';
import { AuditEventDrawer } from '../components/AuditEventDrawer.jsx';
import { AuditFilters } from '../components/AuditFilters.jsx';
import { AuditSkeleton } from '../components/AuditSkeleton.jsx';
import { AuditSummary } from '../components/AuditSummary.jsx';
import { AuditTable } from '../components/AuditTable.jsx';
import { useAuditFilters } from '../hooks/useAuditFilters.js';
import { useAuditLogs } from '../hooks/useAuditLogs.js';
import { dateBounds, filterAuditLogs, paginate, schoolsOf, usersOf } from '../utils/filterAuditLogs.js';

/**
 * Super Admin Audit Logs: read-only history of platform actions with search, filters, a date
 * range, pagination and a details panel. /audit-logs/:logId opens the panel for that event.
 */
export default function AuditLogsPage() {
  const { logId } = useParams();
  const navigate = useNavigate();
  const { status, data, retry } = useAuditLogs();
  const { filters, page, pageSize, isFiltered, setFilter, setPage, setPageSize, reset, search } = useAuditFilters();

  const events = useMemo(() => data?.events ?? [], [data]);
  const filtered = useMemo(() => filterAuditLogs(events, filters), [events, filters]);
  const current = paginate(filtered, page, pageSize);
  const selected = logId ? events.find((e) => e.id === logId) : null;
  const dateError = dateBounds(filters).invalid ? 'The end date must be on or after the start date.' : undefined;
  const closeDetails = () => navigate({ pathname: '/audit-logs', search });

  return (
    <PageContainer>
      <PageHeader
        title="Audit Logs"
        description="Track and monitor all important actions performed on the platform."
        secondaryActions={
          data?.isDemo && (
            <Badge variant="warning" dot>
              Demo data<span className="sr-only">: sample audit events, not recorded from the platform yet</span>
            </Badge>
          )
        }
      />

      {status === 'error' && (
        <Card>
          <ErrorState
            title="Audit logs could not be loaded"
            description="The audit log is unavailable right now. Check your connection and try again."
            onRetry={retry}
          />
        </Card>
      )}

      {status === 'loading' && !data && <AuditSkeleton />}

      {data && status !== 'error' && (
        <>
          {logId && !selected && (
            <Alert variant="warning" title="Audit event not found">
              That audit event does not exist or is no longer available.{' '}
              <Link to={{ pathname: '/audit-logs', search }} className="font-medium underline">
                Back to all audit logs
              </Link>
            </Alert>
          )}

          <AuditSummary events={events} />

          <AuditFilters
            filters={filters}
            users={usersOf(events)}
            schools={schoolsOf(events)}
            dateError={dateError}
            onChange={setFilter}
            onReset={reset}
            isFiltered={isFiltered}
          />

          {/* Announces the result count after searching or filtering. */}
          <p aria-live="polite" className="sr-only">
            {isFiltered ? `${filtered.length} ${filtered.length === 1 ? 'audit event' : 'audit events'} found` : ''}
          </p>

          <AuditTable
            rows={current.rows}
            total={filtered.length}
            page={current.page}
            pageSize={pageSize}
            offset={current.offset}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            selectedId={selected?.id}
            search={search}
            isFiltered={isFiltered}
            onReset={reset}
          />

          <AuditEventDrawer event={selected} open={Boolean(selected)} onClose={closeDetails} />
        </>
      )}
    </PageContainer>
  );
}

import { PageContainer, PageHeader } from '../../../components/layout';
import { Card, ErrorState } from '../../../components/ui';
import { formatDateTime } from '../../../lib/format.js';
import { CreationTrendCard, SchoolsByCityCard, StatusDistributionCard, SummaryCards } from '../components/ReportCards.jsx';
import { ReportFilters } from '../components/ReportFilters.jsx';
import { ReportSkeleton } from '../components/ReportSkeleton.jsx';
import { schoolStatusOptions } from '../data/reportOptions.js';
import { useReport } from '../hooks/useReport.js';
import { useReportView } from '../hooks/useReportView.js';

/**
 * Super Admin Platform Reports: read-only figures computed by the API from platform data —
 * school and owner summaries, schools by city, creation trends and status distribution.
 * Filters live in the URL (?period=&status=&city=); Reset returns to the default report.
 */
export default function PlatformReportsPage() {
  const { filters, isFiltered, setFilter, reset } = useReportView();
  const { status, data, retry } = useReport(filters);
  const schoolFilter = [schoolStatusOptions.find((o) => o.value === filters.status && o.value)?.label, filters.city].filter(Boolean);

  return (
    <PageContainer>
      <PageHeader title="Platform Reports" description="Detailed analysis of schools and school owners on the platform." />

      <ReportFilters filters={filters} cities={data?.cities ?? []} onChange={setFilter} onReset={reset} isFiltered={isFiltered} />

      {/* Announces when new figures have arrived after a filter change. */}
      <p aria-live="polite" className="sr-only">
        {status === 'success' ? 'Report updated.' : ''}
      </p>

      {status === 'error' && (
        <Card>
          <ErrorState
            title="The report could not be loaded"
            description="Report figures are unavailable right now. Check your connection and try again."
            onRetry={retry}
          />
        </Card>
      )}

      {status === 'loading' && !data && <ReportSkeleton />}

      {data && status !== 'error' && (
        <div aria-busy={status === 'loading' || undefined} className="flex flex-col gap-8 transition-opacity aria-busy:opacity-60 motion-reduce:transition-none">
          <p className="-mb-4 text-small text-fg-muted">
            Summaries, cities and statuses are current. Trends use calendar {data.period.unit === 'day' ? 'days' : 'months'} in your time zone (
            {data.timeZone}). Generated {formatDateTime(data.generatedAt)}.
          </p>

          <section aria-labelledby="report-schools" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="report-schools" className="text-section-title text-fg">
                Schools
              </h2>
              {schoolFilter.length > 0 && <p className="text-small text-fg-secondary">Filtered: {schoolFilter.join(' · ')}</p>}
            </div>
            <SummaryCards kind="schools" summary={data.schools.summary} />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <SchoolsByCityCard cities={data.schools.byCity} isFiltered={schoolFilter.length > 0} />
              <StatusDistributionCard
                title="School Status Distribution"
                summary={data.schools.summary}
                unit="schools"
                emptyTitle={schoolFilter.length > 0 ? 'No schools match these filters' : 'No schools yet'}
                emptyDescription="Statuses appear once schools are registered."
              />
            </div>
            <CreationTrendCard
              title="School Creation Trend"
              trend={data.schools.trend}
              unit={data.period.unit}
              noun="Schools"
              emptyTitle={schoolFilter.length > 0 ? 'No matching schools created in this period' : 'No schools created in this period'}
              color="var(--color-chart-1)"
            />
          </section>

          <section aria-labelledby="report-owners" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 id="report-owners" className="text-section-title text-fg">
                School Owners
              </h2>
              {schoolFilter.length > 0 && <p className="text-small text-fg-muted">School filters do not apply to owners</p>}
            </div>
            <SummaryCards kind="owners" summary={data.owners.summary} />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <StatusDistributionCard
                title="Owner Status Distribution"
                summary={data.owners.summary}
                unit="owners"
                emptyTitle="No owners yet"
                emptyDescription="Statuses appear once school owners are added."
              />
              <CreationTrendCard
                title="Owner Creation Trend"
                trend={data.owners.trend}
                unit={data.period.unit}
                noun="Owners"
                emptyTitle="No owners created in this period"
                color="var(--color-chart-2)"
              />
            </div>
          </section>
        </div>
      )}
    </PageContainer>
  );
}

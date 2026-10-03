import { useId } from 'react';
import { Download, FileText, LayoutGrid, Users } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Badge, Button, Card, ErrorState, Select, TabPanel, Tabs } from '../../../components/ui';
import { formatDate } from '../../../lib/format.js';
import { SchoolsByLocationCard } from '../../dashboard';
import { ownerStatuses } from '../../school-owners';
import { schoolStatuses } from '../../schools';
import {
  EXPORT_UNAVAILABLE,
  GrowthCard,
  QuickReportsCard,
  RegistrationTrendCard,
  ReportSummary,
  StatusBreakdownCard,
} from '../components/ReportCards.jsx';
import { ReportSkeleton } from '../components/ReportSkeleton.jsx';
import { OwnersReportTable, SchoolsReportTable } from '../components/ReportTables.jsx';
import { periods } from '../data/mockReport.js';
import { useReport } from '../hooks/useReport.js';
import { useReportView } from '../hooks/useReportView.js';

const tabs = [
  { value: 'overview', label: 'Overview', icon: LayoutGrid },
  { value: 'schools', label: 'Schools', icon: FileText },
  { value: 'owners', label: 'School Owners', icon: Users },
];

/**
 * Super Admin Platform Reports: read-only, platform-level figures for a period.
 * Tabs and period live in the URL (?tab=&period=).
 */
export default function PlatformReportsPage() {
  const tabsId = useId();
  const { tab, period, setTab, setPeriod } = useReportView();
  const { status, data, retry } = useReport(period);
  const periodLabel = periods.find((p) => p.value === period).label;

  return (
    <PageContainer>
      <PageHeader
        title="Platform Reports"
        description="Insights across all schools on the platform."
        secondaryActions={
          <>
            {data?.isDemo && (
              <Badge variant="warning" dot>
                Demo data<span className="sr-only">: figures computed from sample schools, not platform data</span>
              </Badge>
            )}
            <Select
              label="Report period"
              hideLabel
              size="sm"
              options={periods}
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
              fieldClassName="w-44"
            />
          </>
        }
        primaryAction={
          <Button leftIcon={Download} unavailableReason={EXPORT_UNAVAILABLE}>
            Export Report
          </Button>
        }
      />

      <Tabs id={tabsId} label="Report sections" tabs={tabs} value={tab} onChange={setTab} />

      <TabPanel tabsId={tabsId} value={tab} className="flex flex-col gap-6">
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
          <div aria-busy={status === 'loading' || undefined} className="flex flex-col gap-6 transition-opacity aria-busy:opacity-60">
            <p className="text-small text-fg-muted">
              Report period: {periodLabel} ({formatDate(data.periodStart)} – {formatDate(data.periodEnd)}). Status and location
              figures are current.
            </p>

            {tab === 'overview' && (
              <>
                <ReportSummary summary={data.summary} />
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-[1.5fr_1fr_1fr_0.9fr]">
                  <div className="md:col-span-2 2xl:col-span-1">
                    <GrowthCard growth={data.schoolGrowth} />
                  </div>
                  <StatusBreakdownCard title="Schools by Status" counts={data.schoolStatus} statuses={schoolStatuses} unit="schools" />
                  <SchoolsByLocationCard locations={data.schoolsByLocation} />
                  <div className="md:col-span-2 2xl:col-span-1">
                    <QuickReportsCard onOpen={setTab} />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
                  <RegistrationTrendCard registrations={data.registrations} />
                  <SchoolsReportTable key={period} schools={data.schools} title="Latest Registrations" description="Newest schools in this period" limit={5} />
                </div>
              </>
            )}

            {tab === 'schools' && (
              <>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <StatusBreakdownCard title="Schools by Status" counts={data.schoolStatus} statuses={schoolStatuses} unit="schools" />
                  <SchoolsByLocationCard locations={data.schoolsByLocation} />
                </div>
                <SchoolsReportTable key={period} schools={data.schools} title="Schools registered in this period" />
              </>
            )}

            {tab === 'owners' && (
              <>
                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <StatusBreakdownCard title="School Owners by Status" counts={data.ownerStatus} statuses={ownerStatuses} unit="owners" />
                </div>
                <OwnersReportTable key={period} owners={data.owners} />
              </>
            )}
          </div>
        )}
      </TabPanel>
    </PageContainer>
  );
}

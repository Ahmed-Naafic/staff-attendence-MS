import { useId, useState } from 'react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Alert, Button, Card, ErrorState, Skeleton, TabPanel, Tabs } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { useSession } from '../../auth';
import { BranchesPanel } from '../components/BranchesPanel.jsx';
import { OverviewPanel } from '../components/OverviewPanel.jsx';
import { RecordDrawer, RecordsPanel } from '../components/RecordsPanel.jsx';
import { ReportFilterBar } from '../components/ReportFilterBar.jsx';
import { loadOptions, loadRecords, loadSummary } from '../data/attendanceApi.js';
import { useReportView } from '../hooks/useReportView.js';
import { viewRange } from '../utils/reportRules.js';

const TABS = {
  OWNER: [
    { value: 'overview', label: 'Overview' },
    { value: 'records', label: 'Records' },
    { value: 'branches', label: 'Branches' },
  ],
  MANAGER: [
    { value: 'overview', label: 'Overview' },
    { value: 'records', label: 'Records' },
  ],
};

const skip = () => Promise.resolve(null);

/** A load error as the page shows it: a field message (400), an item outside the scope (404), or unavailable. */
function LoadProblem({ error, retry, onClear }) {
  if (error?.status === 400) {
    return (
      <Alert variant="warning" title="Check the filters">
        {Object.values(error.details ?? {})[0] ?? error.message}
      </Alert>
    );
  }
  if (error?.status === 404) {
    return (
      <Alert variant="warning" title="Not available" action={<Button size="sm" variant="outline" onClick={onClear}>Clear branch and staff</Button>}>
        The selected branch or staff member is not part of your reports.
      </Alert>
    );
  }
  return (
    <Card>
      <ErrorState title="The report could not be loaded" description="Attendance figures are unavailable right now. Check your connection and try again." onRetry={retry} />
    </Card>
  );
}

/**
 * Attendance reports (read only, Phase 1: docs/reports/). A School Owner sees every branch of their
 * school (combined, or one branch) with Overview, Records and Branches; a Manager sees their current
 * branch with Overview and Records. The scope is decided by the server; filters live in the URL.
 * Rows are accepted check-ins with their check-out; absence is not calculated.
 */
export default function AttendanceReportsPage() {
  const { user } = useSession();
  const role = user.role === 'OWNER' ? 'OWNER' : 'MANAGER';
  const tabsId = useId();
  const { view, filtered, update, reset } = useReportView(role);
  const [staffQuery, setStaffQuery] = useState('');
  const [selected, setSelected] = useState(null);

  // "Today" is the server's date (platform time zone), which the date presets need; then the
  // filter choices (branches, the shifts of the dates, staff) for the chosen range.
  const day = useApiData(() => loadOptions(role), `today|${role}`);
  const today = day.data?.today ?? null;
  const range = viewRange(view, today);
  const ready = Boolean(range.from);
  const options = useApiData(
    () => (ready ? loadOptions(role, { from: range.from, to: range.to, branch: view.branch, staffQuery }) : Promise.resolve(day.data)),
    JSON.stringify([role, range.from, range.to, view.branch, staffQuery]),
    { delayMs: 250 },
  );

  const summaryKey = JSON.stringify(['summary', range.from, range.to, view.branch, view.staff, view.shift]);
  const summary = useApiData(() => (ready && view.tab !== 'records' ? loadSummary(role, view, range) : skip()), `${summaryKey}|${view.tab !== 'records'}`);
  const recordsKey = JSON.stringify(['records', range.from, range.to, view.branch, view.staff, view.shift, view.status, view.checkOut, view.q, view.sort, view.page]);
  const records = useApiData(() => (ready && view.tab === 'records' ? loadRecords(role, view, range) : skip()), `${recordsKey}|${view.tab === 'records'}`, { delayMs: 200 });

  const current = view.tab === 'records' ? records : summary;
  const zones = summary.data?.timeZones ?? [];
  const clearScope = () => update({ branch: '', staff: '' });
  const onReset = () => {
    setStaffQuery('');
    reset();
  };

  return (
    <PageContainer>
      <PageHeader
        title="Attendance"
        description={`${role === 'OWNER' ? 'Recorded attendance for the branches of your school.' : 'Recorded attendance for your branch.'} Absence is not calculated yet.`}
      />

      <ReportFilterBar
        role={role}
        view={view}
        update={update}
        reset={onReset}
        filtered={filtered}
        today={today}
        options={options.data}
        rangeErrors={range.errors}
        staffQuery={staffQuery}
        onStaffQuery={setStaffQuery}
      />
      {ready && (
        <p className="text-small text-fg-muted">
          {range.from === range.to ? `Work date ${range.from}` : `Work dates ${range.from} to ${range.to} (both included)`}
          {zones.length > 0 && ` · Times in ${zones.join(', ')} (branch time)`}
        </p>
      )}

      <Tabs id={tabsId} label="Attendance report sections" tabs={TABS[role]} value={view.tab} onChange={(tab) => update({ tab: tab === 'overview' ? '' : tab })} />
      <TabPanel tabsId={tabsId} value={view.tab} className="flex flex-col gap-4">
        <p aria-live="polite" className="sr-only">
          {current.status === 'success' && current.data ? 'Report updated.' : ''}
        </p>
        {day.status === 'error' && <LoadProblem error={day.error} retry={day.retry} onClear={clearScope} />}
        {options.status === 'error' && ready && <LoadProblem error={options.error} retry={options.retry} onClear={clearScope} />}
        {current.status === 'error' && <LoadProblem error={current.error} retry={current.retry} onClear={clearScope} />}
        {current.status !== 'error' && !current.data && Object.keys(range.errors).length === 0 && day.status !== 'error' && (
          <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading the report">
            <Skeleton className="h-24" />
            <Skeleton className="h-64" />
          </div>
        )}
        {current.data && current.status !== 'error' && (
          <>
            {view.tab === 'overview' && <OverviewPanel summary={current.data} />}
            {view.tab === 'records' && <RecordsPanel role={role} view={view} update={update} data={current.data} range={range} filtered={filtered} onOpen={setSelected} selectedId={selected?.id} />}
            {view.tab === 'branches' && role === 'OWNER' && <BranchesPanel summary={current.data} view={view} update={update} />}
          </>
        )}
      </TabPanel>
      <RecordDrawer record={selected} role={role} onClose={() => setSelected(null)} />
    </PageContainer>
  );
}

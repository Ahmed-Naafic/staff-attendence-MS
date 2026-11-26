import { useState } from 'react';
import { Backpack, CalendarRange } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Card, EmptyState, ErrorState } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { apiRequest } from '../../../lib/api.js';
import { useSession } from '../../auth';
import { FeeCollectionCard, AttendanceTodayCard, RecentPaymentsCard, TodayActivitiesCard, DailySummaryCard } from '../components/school/ManagerCards.jsx';
import {
  AlertsCard,
  BRANCH_COLORS,
  BranchPerformanceCard,
  DashboardFilters,
  DistributionCard,
  EnrollmentTrendCard,
  ExaminationsCard,
  FeeTrendCard,
  KpiRow,
  QuickActionsCard,
  RecentActivityCard,
  SchoolDashboardSkeleton,
} from '../components/school/SchoolCards.jsx';
import { dashboardRequest, quickActions, STUDENT_STATUS } from '../utils/schoolDashboard.js';

/**
 * The School Owner's dashboard (the school, or one branch of it) and the Manager's (their branch).
 * Every figure comes from GET /owner/dashboard or /manager/dashboard; the API decides the scope, so
 * a Manager's request never names a branch.
 */
export default function SchoolDashboardPage() {
  const { user } = useSession();
  const role = user.role;
  const [filters, setFilters] = useState({ academicYear: '', branch: '', from: '', to: '' });
  const request = dashboardRequest(role, filters);
  const { status, data, error, retry } = useApiData(() => apiRequest(request.path, { query: request.query }), `${role}|${JSON.stringify(request.query)}`, { delayMs: 150 });
  const owner = role === 'OWNER';

  return (
    <PageContainer>
      <PageHeader
        title={owner ? 'Owner Dashboard' : 'Manager Dashboard'}
        description={owner ? (data?.branch ? `${data.branch.name}: branch overview and performance.` : 'School-wide overview and performance.') : 'Branch overview and daily operations.'}
        secondaryActions={<DashboardFilters role={role} data={data} filters={filters} onChange={setFilters} />}
      />

      {status === 'error' && (
        <Card>
          <ErrorState title="The dashboard could not be loaded" description={error?.message ?? 'Check your connection and try again.'} onRetry={retry} />
        </Card>
      )}
      {status === 'loading' && !data && <SchoolDashboardSkeleton />}
      {data && status !== 'error' && (
        <div aria-busy={status === 'loading' || undefined} className="flex flex-col gap-4 transition-opacity aria-busy:opacity-60">
          {!data.kpis ? (
            <Card>
              <EmptyState icon={CalendarRange} title="No academic year yet" description="Start the school’s academic year to see its figures here." />
            </Card>
          ) : owner ? (
            <OwnerDashboard data={data} />
          ) : (
            <ManagerDashboard data={data} />
          )}
        </div>
      )}
    </PageContainer>
  );
}

function OwnerDashboard({ data }) {
  const currency = data.kpis.fees?.currency ?? 'USD';
  const byBranch = data.studentsByBranch ?? [];
  return (
    <>
      <KpiRow role="OWNER" kpis={data.kpis} modules={data.modules} />
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-5">
          <FeeTrendCard trend={data.feeTrend} currency={currency} feesEnabled={data.modules.fees} />
        </div>
        <div className="xl:col-span-4">
          <DistributionCard
            title="Students by Branch"
            description={data.academicYear?.name}
            total={byBranch.reduce((n, b) => n + b.students, 0)}
            centerLabel="Students"
            items={byBranch.map((b, i) => ({ key: b.id, label: b.name, value: b.students, percent: b.percent, color: BRANCH_COLORS[i % BRANCH_COLORS.length] }))}
            empty={<EmptyState compact icon={Backpack} title="No students enrolled" description="Enrolled students appear here by branch." />}
          />
        </div>
        <div className="xl:col-span-3">
          <QuickActionsCard actions={quickActions('OWNER', data.modules)} />
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-5">
          <BranchPerformanceCard performance={data.branchPerformance} feesEnabled={data.modules.fees} />
        </div>
        <div className="xl:col-span-4">
          <RecentActivityCard items={data.recentActivity} currency={currency} />
        </div>
        <div className="xl:col-span-3">
          <AlertsCard alerts={data.alerts} />
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <EnrollmentTrendCard trend={data.enrollmentTrend} />
        </div>
        <div className="xl:col-span-5">
          <ExaminationsCard exams={data.examinations} enabled={data.modules.examinations} />
        </div>
      </div>
    </>
  );
}

function ManagerDashboard({ data }) {
  const currency = data.kpis.fees?.currency ?? 'USD';
  const statuses = data.studentStatus;
  return (
    <>
      <KpiRow role="MANAGER" kpis={data.kpis} modules={data.modules} />
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-12">
        <div className="xl:col-span-4">
          <FeeCollectionCard branchName={data.branch?.name} fees={data.kpis.fees} enabled={data.modules.fees} />
        </div>
        <div className="xl:col-span-4">
          <AttendanceTodayCard attendance={data.attendanceToday} enabled={data.modules.studentAttendance} />
        </div>
        <div className="lg:col-span-2 xl:col-span-4">
          <ExaminationsCard exams={data.examinations} enabled={data.modules.examinations} />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-12">
        <div className="lg:col-span-2 xl:col-span-5">
          <RecentPaymentsCard payments={data.recentPayments ?? []} currency={currency} enabled={data.modules.fees} />
        </div>
        <div className="xl:col-span-4">
          <TodayActivitiesCard today={data.todayActivities} />
        </div>
        <div className="xl:col-span-3">
          <QuickActionsCard actions={quickActions('MANAGER', data.modules)} />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-12">
        <div className="xl:col-span-4">
          <FeeTrendCard title="Branch Fee Collection Trend" trend={data.feeTrend} currency={currency} feesEnabled={data.modules.fees} />
        </div>
        <div className="xl:col-span-4">
          <DistributionCard
            title="Student Status"
            description="Students of the branch by where they are in their school life"
            total={statuses.total}
            centerLabel="Students"
            items={statuses.items.map((s) => ({ key: s.status, label: STUDENT_STATUS[s.status]?.label ?? s.status, value: s.count, percent: s.percent, color: STUDENT_STATUS[s.status]?.color ?? 'var(--color-brand-steel)' }))}
            empty={<EmptyState compact icon={Backpack} title="No students yet" description="Registered students appear here by status." />}
          />
        </div>
        <div className="flex flex-col gap-4 lg:col-span-2 xl:col-span-4">
          <AlertsCard title="Upcoming & Pending Tasks" alerts={data.alerts} />
          <DailySummaryCard summary={data.dailySummary} enabled={data.modules.fees} />
        </div>
      </div>
    </>
  );
}

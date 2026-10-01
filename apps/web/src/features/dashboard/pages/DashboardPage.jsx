import { useState } from 'react';
import { Building2, CircleOff, Clock, Landmark, Users } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Badge, Card, ErrorState, KpiCard, Select } from '../../../components/ui';
import { NewSchoolsCard, SchoolsGrowthCard, StatusDistributionCard } from '../components/ChartCards.jsx';
import { DashboardLayout } from '../components/DashboardLayout.jsx';
import { DashboardSkeleton } from '../components/DashboardSkeleton.jsx';
import { QuickActionsCard, RecentActivityCard, SchoolsByLocationCard } from '../components/RailCards.jsx';
import { RecentSchoolsCard } from '../components/RecentSchoolsCard.jsx';
import { useDashboardData } from '../hooks/useDashboardData.js';

const ranges = [
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '12m', label: 'Last 12 months' },
];

// Key figure cards, in reference order. `key` points into data.summary.
const kpiCards = [
  { key: 'totalSchools', label: 'Total Schools', icon: Landmark, tone: 'info' },
  { key: 'activeSchools', label: 'Active Schools', icon: Building2, tone: 'success' },
  { key: 'pendingSchools', label: 'Pending Approval', icon: Clock, tone: 'warning' },
  { key: 'suspendedSchools', label: 'Suspended Schools', icon: CircleOff, tone: 'error' },
  { key: 'totalOwners', label: 'Total School Owners', icon: Users, tone: 'info' },
];

/** Super Admin platform dashboard: a platform-wide overview (not a school or branch dashboard). */
export default function DashboardPage() {
  const [range, setRange] = useState('30d');
  const { status, data, retry } = useDashboardData(range);

  return (
    <PageContainer>
      <PageHeader
        title="Platform Overview"
        description="Monitor and manage all schools on the platform."
        secondaryActions={
          <>
            {data?.isDemo && (
              <Badge variant="warning" dot>
                Demo data<span className="sr-only">: sample figures, not connected to platform data yet</span>
              </Badge>
            )}
            <Select
              label="Time period"
              hideLabel
              size="sm"
              value={range}
              onChange={(event) => setRange(event.target.value)}
              options={ranges}
              fieldClassName="w-40"
            />
          </>
        }
      />

      {status === 'error' && (
        <Card>
          <ErrorState
            title="The dashboard could not be loaded"
            description="Platform figures are unavailable right now. Check your connection and try again."
            onRetry={retry}
          />
        </Card>
      )}

      {status === 'loading' && !data && <DashboardSkeleton />}

      {data && status !== 'error' && (
        <div aria-busy={status === 'loading' || undefined} className="transition-opacity aria-busy:opacity-60">
          <DashboardLayout
            kpis={kpiCards.map((card) => {
              const figure = data.summary[card.key];
              return (
                <KpiCard
                  key={card.key}
                  label={card.label}
                  icon={card.icon}
                  tone={card.tone}
                  value={figure.value}
                  changePercent={figure.changePercent}
                  note={figure.newInPeriod ? `+${figure.newInPeriod} new` : undefined}
                  trend={figure.trend}
                />
              );
            })}
            growth={<SchoolsGrowthCard growth={data.schoolsGrowth} />}
            status={<StatusDistributionCard distribution={data.statusDistribution} />}
            newSchools={<NewSchoolsCard newSchools={data.newSchools} />}
            recentSchools={<RecentSchoolsCard schools={data.recentSchools} />}
            activity={<RecentActivityCard activity={data.recentActivity} />}
            quickActions={<QuickActionsCard />}
            locations={<SchoolsByLocationCard locations={data.schoolsByLocation} />}
          />
        </div>
      )}
    </PageContainer>
  );
}

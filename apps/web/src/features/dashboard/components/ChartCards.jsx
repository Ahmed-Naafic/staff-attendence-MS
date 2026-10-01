import { ChartColumn, ChartPie } from 'lucide-react';
import { BarChart, DonutChart } from '../../../components/charts';
import { Card, CardContent, CardHeader, EmptyState } from '../../../components/ui';
import { formatMonth, formatMonthYear } from '../utils/format.js';
import { schoolStatuses } from './SchoolStatusBadge.jsx';
import { ViewAllLink } from './ViewAllLink.jsx';

const toBars = (points, key) => points.map((p) => ({ label: formatMonth(p.month), value: p[key], month: p.month }));

/** Cumulative number of schools over the last 12 months. */
export function SchoolsGrowthCard({ growth }) {
  const latest = growth.at(-1)?.total ?? 0;
  const hasData = growth.some((p) => p.total > 0);
  return (
    <Card className="h-full">
      <CardHeader
        titleAs="h2"
        title="Schools Growth"
        action={<span className="text-small text-fg-muted">Total schools: {latest.toLocaleString()}</span>}
      />
      <CardContent className="pt-5">
        {hasData ? (
          <BarChart
            label={`Total schools at the end of each month, ${formatMonthYear(growth[0].month)} to ${formatMonthYear(growth.at(-1).month)}`}
            data={toBars(growth, 'total')}
            color="var(--color-chart-1)"
          />
        ) : (
          <EmptyState compact icon={ChartColumn} title="No schools yet" description="Growth appears once schools join the platform." />
        )}
      </CardContent>
    </Card>
  );
}

/** Schools by status: donut plus a legend that states every value (the accessible summary). */
export function StatusDistributionCard({ distribution }) {
  const total = Object.values(distribution).reduce((sum, n) => sum + n, 0);
  const rows = Object.entries(schoolStatuses).map(([key, status]) => ({
    key,
    label: status.label,
    color: status.color,
    value: distribution[key] ?? 0,
    percent: total ? Math.round(((distribution[key] ?? 0) / total) * 100) : 0,
  }));

  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title="School Status Distribution" />
      <CardContent className="flex flex-1 flex-col pt-5">
        {total > 0 ? (
          <>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
              <DonutChart segments={rows} centerValue={total} centerLabel="Total schools" size={124} thickness={18} />
              <ul aria-label={`School status, ${total} schools in total`} className="flex min-w-36 flex-1 flex-col gap-2.5">
                {rows.map((row) => (
                  <li key={row.key} className="flex items-center gap-2.5 text-small">
                    <span aria-hidden="true" className="size-2.5 shrink-0 rounded-pill" style={{ backgroundColor: row.color }} />
                    <span className="flex-1 text-fg-secondary">{row.label}</span>
                    <span className="w-8 text-right font-semibold text-fg tabular-nums">{row.value}</span>
                    <span className="w-10 text-right text-fg-muted tabular-nums">
                      {row.percent}%<span className="sr-only"> of schools</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mt-auto flex justify-end pt-4">
              <ViewAllLink to="/schools" context="about school statuses" withArrow>
                View details
              </ViewAllLink>
            </div>
          </>
        ) : (
          <EmptyState compact icon={ChartPie} title="No schools yet" description="Status breakdown appears once schools join." />
        )}
      </CardContent>
    </Card>
  );
}

/** Schools registered per month, last 6 months. */
export function NewSchoolsCard({ newSchools }) {
  const hasData = newSchools.some((p) => p.count > 0);
  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title="New Schools" description="Last 6 months" />
      <CardContent className="pt-5">
        {hasData ? (
          <BarChart
            label={`New schools per month, ${formatMonthYear(newSchools[0].month)} to ${formatMonthYear(newSchools.at(-1).month)}`}
            data={toBars(newSchools, 'count')}
            color="var(--color-chart-2)"
            showValues
            showAxis={false}
          />
        ) : (
          <EmptyState compact icon={ChartColumn} title="No new schools" description="No schools registered in the last 6 months." />
        )}
      </CardContent>
    </Card>
  );
}

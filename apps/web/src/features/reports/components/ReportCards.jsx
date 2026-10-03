import { Building2, ChartColumn, ChartLine, ChartPie, Clock, Download, FileText, Landmark, Users } from 'lucide-react';
import { BarChart, DonutChart, LineChart } from '../../../components/charts';
import { Button, Card, CardContent, CardHeader, EmptyState, KpiCard } from '../../../components/ui';
import { formatMonth, formatMonthYear } from '../../../lib/format.js';

export const EXPORT_UNAVAILABLE = 'Not available yet: reporting export rules are not implemented.';

const toPoints = (points, key) => points.map((p) => ({ label: formatMonth(p.month), value: p[key] }));
const rangeText = (points) => `${formatMonthYear(points[0].month)} to ${formatMonthYear(points.at(-1).month)}`;

// Colors per status, shared by the school and owner breakdowns.
export const statusColors = {
  active: 'var(--color-interactive)',
  pending: 'var(--color-accent)',
  suspended: 'var(--color-error)',
};

/** Summary figures. "New" counts depend on the period; the others are current totals. */
/** The period is stated above the cards, so the note stays short. */
export function ReportSummary({ summary }) {
  const note = (n) => `+${n} new`;
  return (
    <section aria-labelledby="report-summary">
      <h2 id="report-summary" className="sr-only">
        Summary
      </h2>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Total Schools" icon={Landmark} tone="info" value={summary.totalSchools.value} note={note(summary.totalSchools.newInPeriod)} trend={summary.totalSchools.trend} />
        <KpiCard label="Total School Owners" icon={Users} tone="success" value={summary.totalOwners.value} note={note(summary.totalOwners.newInPeriod)} trend={summary.totalOwners.trend} />
        <KpiCard label="Active Schools" icon={Building2} tone="success" value={summary.activeSchools.value} />
        <KpiCard label="Pending Approval" icon={Clock} tone="warning" value={summary.pendingSchools.value} />
      </ul>
    </section>
  );
}

/** Schools on the platform at the end of each month in the period. */
export function GrowthCard({ growth }) {
  const hasData = growth.some((p) => p.total > 0);
  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title="Platform Growth" description="Schools on the platform at the end of each month" />
      <CardContent className="pt-5">
        {hasData ? (
          <BarChart label={`Schools on the platform at the end of each month, ${rangeText(growth)}`} data={toPoints(growth, 'total')} />
        ) : (
          <EmptyState compact icon={ChartColumn} title="No report data available" description="No schools on the platform in this period." />
        )}
      </CardContent>
    </Card>
  );
}

/** Status breakdown: donut plus a legend that states every value (the accessible summary). */
export function StatusBreakdownCard({ title, counts, statuses, unit }) {
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const rows = Object.entries(statuses).map(([key, status]) => ({
    key,
    label: status.label,
    color: statusColors[key],
    value: counts[key] ?? 0,
    percent: total ? Math.round(((counts[key] ?? 0) / total) * 100) : 0,
  }));

  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title={title} description="Current" />
      <CardContent className="pt-5">
        {total > 0 ? (
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-4">
            <DonutChart segments={rows} centerValue={total} centerLabel={`Total ${unit}`} size={124} thickness={18} />
            <ul aria-label={`${title}, ${total} ${unit} in total`} className="flex min-w-36 flex-1 flex-col gap-2.5">
              {rows.map((row) => (
                <li key={row.key} className="flex items-center gap-2.5 text-small">
                  <span aria-hidden="true" className="size-2.5 shrink-0 rounded-pill" style={{ backgroundColor: row.color }} />
                  <span className="flex-1 text-fg-secondary">{row.label}</span>
                  <span className="w-8 text-right font-semibold text-fg tabular-nums">{row.value}</span>
                  <span className="w-10 text-right text-fg-muted tabular-nums">
                    {row.percent}%<span className="sr-only"> of {unit}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <EmptyState compact icon={ChartPie} title="No report data available" description={`No ${unit} to break down yet.`} />
        )}
      </CardContent>
    </Card>
  );
}

/** New schools registered per month in the period. */
export function RegistrationTrendCard({ registrations }) {
  const hasData = registrations.some((p) => p.count > 0);
  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title="New Schools Registration Trend" description="Schools registered per month" />
      <CardContent className="pt-5">
        {hasData ? (
          <LineChart label={`New schools registered per month, ${rangeText(registrations)}`} data={toPoints(registrations, 'count')} />
        ) : (
          <EmptyState compact icon={ChartLine} title="No report data available" description="No schools registered in this period." />
        )}
      </CardContent>
    </Card>
  );
}

/** Shortcuts to the summary tabs. Export is unavailable until its rules exist. */
export function QuickReportsCard({ onOpen }) {
  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title="Quick Reports" />
      <CardContent>
        {/* Stacked in the narrow 4-column layout (2xl) and on phones; in a row in between. */}
        <ul className="flex flex-col gap-2 md:flex-row md:flex-wrap 2xl:flex-col">
          <li>
            <Button variant="outline" size="sm" leftIcon={FileText} onClick={() => onOpen('schools')} className="w-full justify-start md:w-auto 2xl:w-full">
              Schools Summary
            </Button>
          </li>
          <li>
            <Button variant="outline" size="sm" leftIcon={Users} onClick={() => onOpen('owners')} className="w-full justify-start md:w-auto 2xl:w-full">
              Owners Summary
            </Button>
          </li>
          <li className="flex flex-col">
            <Button variant="outline" size="sm" leftIcon={Download} unavailableReason={EXPORT_UNAVAILABLE} className="w-full justify-start md:w-auto 2xl:w-full">
              Export Full Report
            </Button>
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

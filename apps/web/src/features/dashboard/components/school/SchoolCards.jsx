import { Link } from 'react-router';
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  Award,
  Backpack,
  Banknote,
  BellRing,
  Building2,
  ChartColumn,
  CircleAlert,
  ClipboardList,
  FileText,
  GraduationCap,
  Info,
  Landmark,
  Layers,
  NotebookPen,
  Receipt,
  ShieldCheck,
  UserPlus,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';
import { DonutChart, LineChart, MultiLineChart } from '../../../../components/charts';
import { Badge, Card, CardContent, CardHeader, EmptyState, KpiCard, Select, Input, Skeleton } from '../../../../components/ui';
import { cn } from '../../../../lib/cn.js';
import { formatDay, formatRelative } from '../../../../lib/format.js';
import { money } from '../../../fees/utils/feeFormat.js';
import { compactMoney, EXAM_STATE, percentText } from '../../utils/schoolDashboard.js';
import { ViewAllLink } from '../ViewAllLink.jsx';

/*
 * Cards shared by the School Owner's and the Managers' dashboards (navy, gold and steel). Each card
 * shows its own empty state; a module the school has not switched on says so instead of zeros.
 */

export function ModuleOff({ name }) {
  return <EmptyState compact icon={Info} title={`${name} is not switched on`} description={`Your school does not use ${name} yet. Contact EduTrack support to switch it on.`} />;
}

// ---- Filters --------------------------------------------------------------------------------------------

/** Branch (School Owner), academic year and an optional date range. */
export function DashboardFilters({ role, data, filters, onChange }) {
  const years = data?.filters.academicYears ?? [];
  const branches = data?.filters.branches ?? [];
  const set = (key) => (event) => onChange({ ...filters, [key]: event.target.value });
  return (
    <div className="flex flex-wrap items-end gap-2">
      {role === 'OWNER' ? (
        <Select label="Branch" hideLabel size="sm" value={filters.branch} onChange={set('branch')} options={[{ value: '', label: 'All Branches' }, ...branches.map((b) => ({ value: b.id, label: b.status === 'active' ? b.name : `${b.name} (${b.status})` }))]} fieldClassName="w-44" />
      ) : (
        data?.branch && (
          <span className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-small font-medium text-fg">
            <Building2 aria-hidden="true" className="size-4 text-tile-gold-fg" />
            {data.branch.name}
          </span>
        )
      )}
      <Select label="Academic year" hideLabel size="sm" value={filters.academicYear} onChange={set('academicYear')} options={[{ value: '', label: 'Current year' }, ...years.map((y) => ({ value: y.id, label: `${y.name}${y.status === 'current' ? ' (current)' : ''}` }))]} fieldClassName="w-44" />
      <Input label="From" hideLabel type="date" size="sm" value={filters.from} max={filters.to || undefined} onChange={set('from')} fieldClassName="w-38" aria-label="From date" />
      <Input label="To" hideLabel type="date" size="sm" value={filters.to} min={filters.from || undefined} onChange={set('to')} fieldClassName="w-38" aria-label="To date" />
      {(filters.from || filters.to) && (
        <button type="button" onClick={() => onChange({ ...filters, from: '', to: '' })} className="h-9 rounded-md px-2 text-small font-medium text-interactive hover:underline">
          Clear dates
        </button>
      )}
    </div>
  );
}

// ---- KPI cards ------------------------------------------------------------------------------------------

/** The key figures: people and structure first, then money (Fee Management's figures). */
export function KpiRow({ role, kpis, modules }) {
  const fees = kpis.fees;
  const currency = fees?.currency ?? 'USD';
  const students = kpis.students;
  const cards = [
    { key: 'students', label: 'Students', value: students.value, icon: Users, tone: 'navy', changePercent: students.changePercent ?? undefined, note: students.changePercent !== null && students.changePercent !== undefined ? 'vs last year' : undefined },
    { key: 'staff', label: 'Staff', value: kpis.staff.value, icon: UserRound, tone: 'navy' },
    { key: 'classes', label: 'Classes', value: kpis.classes.value, icon: GraduationCap, tone: 'steel' },
    role === 'OWNER' ? { key: 'branches', label: 'Branches', value: kpis.branches?.value ?? 0, icon: Landmark, tone: 'gold' } : { key: 'sections', label: 'Sections', value: kpis.sections.value, icon: Layers, tone: 'gold' },
  ];
  if (modules.fees) {
    cards.push(
      { key: 'expected', label: 'Expected Fees', value: fees ? money(fees.expected, currency) : '—', icon: Receipt, tone: 'steel' },
      { key: 'collected', label: `Collected${fees ? ` (${percentText(fees.rate)})` : ''}`, value: fees ? money(fees.collected, currency) : '—', icon: Wallet, tone: 'gold' },
      { key: 'outstanding', label: `Outstanding${fees && fees.expected ? ` (${percentText(100 - fees.rate)})` : ''}`, value: fees ? money(fees.outstanding, currency) : '—', icon: AlertTriangle, tone: 'warning' },
    );
  }
  return (
    <ul aria-label="Key figures" className={cn('grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-4', modules.fees ? '2xl:grid-cols-7' : '')}>
      {cards.map(({ key, ...card }) => (
        <KpiCard key={key} {...card} />
      ))}
    </ul>
  );
}

// ---- Charts -----------------------------------------------------------------------------------------------

/** Expected and collected fees per month of the year (Fee Management's own figures). */
export function FeeTrendCard({ title = 'Fee Collection Trend', trend, currency, feesEnabled }) {
  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title={title} description="Expected and collected fees by month" action={feesEnabled && <ViewAllLink to="/fees/reports" context="fee reports">Reports</ViewAllLink>} />
      <CardContent className="flex-1">
        {!feesEnabled ? (
          <ModuleOff name="Fee Management" />
        ) : !trend.some((m) => m.expected || m.collected) ? (
          <EmptyState compact icon={ChartColumn} title="No fees charged yet" description="Monthly fees appear here once they are generated." />
        ) : (
          <MultiLineChart
            label="Fee collection by month"
            labels={trend.map((m) => m.label)}
            series={[
              { key: 'expected', label: 'Expected', values: trend.map((m) => m.expected), color: 'var(--color-brand-steel)', fill: false },
              { key: 'collected', label: 'Collected', values: trend.map((m) => m.collected), color: 'var(--color-brand-gold)' },
            ]}
            formatValue={(v) => compactMoney(v, currency)}
            formatFull={(v) => money(v, currency)}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** Students enrolled at each month end of the year, and how many joined that month. */
export function EnrollmentTrendCard({ trend }) {
  const joined = trend.reduce((n, m) => n + m.joined, 0);
  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title="Student Enrollment Trend" description={`Students enrolled at each month’s end · ${joined.toLocaleString()} new this year`} action={<ViewAllLink to="/students" context="students">Students</ViewAllLink>} />
      <CardContent className="flex-1">
        {trend.length === 0 ? (
          <EmptyState compact icon={Backpack} title="No enrollments yet" description="Enrolled students appear here month by month." />
        ) : (
          <LineChart label="Students enrolled by month" data={trend.map((m) => ({ label: m.label, value: m.enrolled }))} color="var(--color-brand-navy)" height="h-44" />
        )}
      </CardContent>
    </Card>
  );
}

/** A donut with its legend (the legend states every value; the donut is decorative). */
export function DistributionCard({ title, description, total, centerLabel, items, empty, action }) {
  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title={title} description={description} action={action} />
      <CardContent className="flex flex-1 flex-col items-center gap-5 sm:flex-row">
        {total === 0 ? (
          <div className="w-full">{empty}</div>
        ) : (
          <>
            <DonutChart size={136} thickness={18} centerValue={total.toLocaleString()} centerLabel={centerLabel} segments={items.map((i) => ({ key: i.key, value: i.value, color: i.color }))} />
            <ul className="flex w-full min-w-0 flex-col gap-2.5">
              {items.map((i) => (
                <li key={i.key} className="flex items-center gap-2 text-small">
                  <span aria-hidden="true" className="size-2.5 shrink-0 rounded-pill" style={{ backgroundColor: i.color }} />
                  <span className="min-w-0 flex-1 truncate text-fg-secondary">{i.label}</span>
                  <span className="font-semibold text-fg tabular-nums">{i.value.toLocaleString()}</span>
                  <span className="w-12 text-right text-fg-muted tabular-nums">{percentText(i.percent)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export const BRANCH_COLORS = ['var(--color-brand-navy)', 'var(--color-brand-gold)', 'var(--color-brand-steel)', 'var(--color-info)', 'var(--color-success)', 'var(--color-warning)'];

// ---- Tables and lists -------------------------------------------------------------------------------------

const rateVariant = (rate) => (rate >= 75 ? 'success' : rate >= 50 ? 'warning' : 'error');

/** Fee collection per branch (the School Owner). The chosen branch is highlighted. */
export function BranchPerformanceCard({ performance, feesEnabled }) {
  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title="Branch Performance" description="Fee collection by branch" action={feesEnabled && <ViewAllLink to="/fees/reports" context="branch comparison report" />} />
      <CardContent className="flex-1">
        {!feesEnabled ? (
          <ModuleOff name="Fee Management" />
        ) : !performance?.rows.length ? (
          <EmptyState compact icon={Building2} title="No branch figures yet" description="Branches appear here once fees are charged." />
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[34rem] text-left text-small">
              <caption className="sr-only">Fee collection by branch</caption>
              <thead>
                <tr className="border-b border-border text-caption font-semibold text-fg-secondary">
                  <th scope="col" className="py-2 pr-2">Branch</th>
                  <th scope="col" className="py-2 px-2 text-right">Students</th>
                  <th scope="col" className="py-2 px-2 text-right">Expected</th>
                  <th scope="col" className="py-2 px-2 text-right">Collected</th>
                  <th scope="col" className="py-2 px-2 text-right">Outstanding</th>
                  <th scope="col" className="py-2 pl-2 text-right">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {performance.rows.map((r) => (
                  <tr key={r.id ?? r.name} className={cn(r.selected && 'bg-tile-gold')}>
                    <th scope="row" className="py-2.5 pr-2 font-medium text-fg">{r.name}</th>
                    <td className="py-2.5 px-2 text-right tabular-nums">{r.students.toLocaleString()}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{money(r.expected, performance.currency)}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{money(r.collected, performance.currency)}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{money(r.outstanding, performance.currency)}</td>
                    <td className="py-2.5 pl-2 text-right">
                      <Badge variant={rateVariant(r.rate)}>{percentText(r.rate)}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
              {performance.totals && performance.rows.length > 1 && (
                <tfoot>
                  <tr className="border-t border-border font-semibold text-fg">
                    <th scope="row" className="py-2.5 pr-2">Total</th>
                    <td className="py-2.5 px-2 text-right tabular-nums">{performance.totals.students.toLocaleString()}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{money(performance.totals.expected, performance.currency)}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{money(performance.totals.collected, performance.currency)}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{money(performance.totals.outstanding, performance.currency)}</td>
                    <td className="py-2.5 pl-2 text-right">{percentText(performance.totals.rate)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const ACTIVITY = {
  enrollment: { icon: UserPlus, tile: 'bg-tile-navy text-tile-navy-fg' },
  payment: { icon: Banknote, tile: 'bg-tile-gold text-tile-gold-fg' },
  invoice: { icon: FileText, tile: 'bg-tile-steel text-tile-steel-fg' },
  'fee-structure': { icon: Receipt, tile: 'bg-tile-steel text-tile-steel-fg' },
  promotion: { icon: ArrowRightLeft, tile: 'bg-tile-navy text-tile-navy-fg' },
  examination: { icon: NotebookPen, tile: 'bg-tile-gold text-tile-gold-fg' },
  results: { icon: Award, tile: 'bg-success-soft text-success-fg' },
};

/** The latest events of the school (or the chosen branch). */
export function RecentActivityCard({ items, currency }) {
  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title="Recent Activities" />
      <CardContent className="flex-1">
        {items.length === 0 ? (
          <EmptyState compact icon={Activity} title="No activity yet" description="Enrollments, payments, invoices and examinations appear here." />
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {items.map((item, index) => {
              const type = ACTIVITY[item.type] ?? { icon: Activity, tile: 'bg-muted text-fg-secondary' };
              const Icon = type.icon;
              return (
                <li key={`${item.type}-${item.at}-${index}`} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className={cn('grid size-8 shrink-0 place-items-center rounded-md', type.tile)}>
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <Link to={item.link} className="truncate text-small font-medium text-fg hover:text-interactive hover:underline">
                      {item.title}
                      {item.amount !== undefined && ` – ${money(item.amount, currency)}`}
                    </Link>
                    {item.detail && <span className="truncate text-caption text-fg-muted">{item.detail}</span>}
                  </div>
                  <time dateTime={item.at} className="shrink-0 text-caption text-fg-muted">
                    {formatRelative(item.at)}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const ALERT_TONE = {
  error: { icon: CircleAlert, tile: 'text-error-fg', badge: 'error' },
  warning: { icon: AlertTriangle, tile: 'text-warning-fg', badge: 'warning' },
  info: { icon: BellRing, tile: 'text-info-fg', badge: 'accent' },
};

/** What needs attention, each with its count and the page that deals with it. */
export function AlertsCard({ title = 'Alerts & Pending Tasks', alerts }) {
  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title={title} />
      <CardContent className="flex-1">
        {alerts.length === 0 ? (
          <EmptyState compact icon={ShieldCheck} title="Nothing needs attention" description="Overdue fees, unclosed cash, pending marks and similar tasks appear here." />
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {alerts.map((a) => {
              const tone = ALERT_TONE[a.tone] ?? ALERT_TONE.info;
              const Icon = tone.icon;
              return (
                <li key={a.key}>
                  <Link to={a.link} className="group flex items-center gap-3 rounded-sm py-2.5 hover:bg-muted/60">
                    <Icon aria-hidden="true" className={cn('size-4 shrink-0', tone.tile)} />
                    <span className="min-w-0 flex-1 text-small text-fg group-hover:underline">{a.title}</span>
                    <Badge variant={tone.badge}>{a.count.toLocaleString()}</Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const ACTION_ICONS = { building: Building2, student: UserPlus, exam: ClipboardList, structures: Layers, invoice: FileText, clearance: ShieldCheck, reports: ChartColumn, payment: Banknote };

/** Shortcuts as tiles (navy icons, gold on hover). */
export function QuickActionsCard({ actions }) {
  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title="Quick Actions" />
      <CardContent className="flex-1">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
          {actions.map((a) => {
            const Icon = ACTION_ICONS[a.icon] ?? ChartColumn;
            return (
              <li key={a.key}>
                <Link
                  to={a.to}
                  className="flex h-full min-h-20 flex-col items-center justify-center gap-1.5 rounded-md border border-border bg-surface p-2 text-center text-caption font-medium text-fg transition-colors hover:border-brand-gold hover:bg-tile-gold"
                >
                  <Icon aria-hidden="true" className="size-5 text-tile-navy-fg" />
                  {a.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

// ---- Examinations -----------------------------------------------------------------------------------------

/** Running, upcoming and recent examinations with their progress, and the examination work waiting. */
export function ExaminationsCard({ exams, enabled }) {
  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title="Examinations" action={enabled && <ViewAllLink to="/examinations/list" context="examinations" />} />
      <CardContent className="flex flex-1 flex-col gap-4">
        {!enabled ? (
          <ModuleOff name="Examinations" />
        ) : !exams.items.length ? (
          <EmptyState compact icon={NotebookPen} title="No examinations this year" description="Examinations appear here once they are created." />
        ) : (
          <ul className="flex flex-col gap-4">
            {exams.items.map((e) => {
              const state = EXAM_STATE[e.state] ?? EXAM_STATE.draft;
              return (
                <li key={e.id} className="flex flex-col gap-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <Link to={`/examinations/list/${e.id}`} className="min-w-0 truncate text-small font-semibold text-fg hover:text-interactive hover:underline">
                      {e.name}
                    </Link>
                    <Badge variant={state.variant}>{state.label}</Badge>
                  </div>
                  <p className="text-caption text-fg-muted">
                    {formatDay(e.startDate)} – {formatDay(e.endDate)} · {e.type}
                    {e.level === 'branch' ? ' · branch' : ''}
                  </p>
                  {e.progress !== null && (
                    <div className="flex items-center gap-3">
                      <div className="h-2 flex-1 overflow-hidden rounded-pill bg-muted" role="progressbar" aria-valuenow={Math.round(e.progress)} aria-valuemin={0} aria-valuemax={100} aria-label={`${e.name}: ${e.progressLabel}`}>
                        <div className="h-full rounded-pill bg-brand-gold" style={{ width: `${Math.min(100, e.progress)}%` }} />
                      </div>
                      <span className="w-12 text-right text-caption font-semibold text-fg tabular-nums">{percentText(e.progress)}</span>
                    </div>
                  )}
                  {e.progressLabel && <p className="text-caption text-fg-secondary">{e.progressLabel}{e.state === 'completed' && e.results.sections ? ` · results ${e.results.published}/${e.results.sections} published` : ''}</p>}
                </li>
              );
            })}
          </ul>
        )}
        {enabled && (exams.pending.marksToApprove > 0 || exams.pending.resultsToPublish > 0 || exams.setupMissing.length > 0) && (
          <ul className="mt-auto flex flex-wrap gap-2 border-t border-border-subtle pt-3">
            {exams.pending.marksToApprove > 0 && <li><Badge variant="warning">{exams.pending.marksToApprove} mark sheets to approve</Badge></li>}
            {exams.pending.resultsToPublish > 0 && <li><Badge variant="accent">{exams.pending.resultsToPublish} class results to publish</Badge></li>}
            {exams.setupMissing.length > 0 && <li><Badge variant="warning">{exams.setupMissing.length} setup steps left</Badge></li>}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ---- Loading ----------------------------------------------------------------------------------------------

export function SchoolDashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading the dashboard" className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <Skeleton className="h-72 xl:col-span-5" />
        <Skeleton className="h-72 xl:col-span-4" />
        <Skeleton className="h-72 xl:col-span-3" />
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <Skeleton className="h-64 xl:col-span-5" />
        <Skeleton className="h-64 xl:col-span-4" />
        <Skeleton className="h-64 xl:col-span-3" />
      </div>
    </div>
  );
}

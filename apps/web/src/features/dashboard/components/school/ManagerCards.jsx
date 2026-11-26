import { Link } from 'react-router';
import { CalendarClock, CalendarOff, ClipboardCheck, Lock, Receipt, Wallet } from 'lucide-react';
import { DonutChart } from '../../../../components/charts';
import { Badge, Card, CardContent, CardHeader, EmptyState } from '../../../../components/ui';
import { cn } from '../../../../lib/cn.js';
import { formatDay, formatFullDay } from '../../../../lib/format.js';
import { money } from '../../../fees/utils/feeFormat.js';
import { clockText, percentText } from '../../utils/schoolDashboard.js';
import { ViewAllLink } from '../ViewAllLink.jsx';
import { ModuleOff } from './SchoolCards.jsx';

/*
 * Cards of the Manager's dashboard (their branch only; the API decides what the branch is).
 */

/** The branch's fees of the year: collected against outstanding, with the expected total. */
export function FeeCollectionCard({ branchName, fees, enabled }) {
  const currency = fees?.currency ?? 'USD';
  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title={`Fee Collection${branchName ? ` (${branchName})` : ''}`} action={enabled && <ViewAllLink to="/fees" context="fee overview">Overview</ViewAllLink>} />
      <CardContent className="flex flex-1 flex-col items-center gap-5 sm:flex-row">
        {!enabled ? (
          <ModuleOff name="Fee Management" />
        ) : !fees || !fees.expected ? (
          <EmptyState compact icon={Wallet} title="No fees charged yet" description="The branch’s fees appear here once they are generated." className="w-full" />
        ) : (
          <>
            <DonutChart
              size={136}
              thickness={18}
              centerValue={percentText(fees.rate)}
              centerLabel="Collected"
              segments={[
                { key: 'collected', value: fees.collected, color: 'var(--color-brand-gold)' },
                { key: 'outstanding', value: Math.max(0, fees.outstanding), color: 'var(--color-brand-navy)' },
              ]}
            />
            <dl className="flex w-full flex-col gap-2.5 text-small">
              {[
                ['Collected', fees.collected, 'var(--color-brand-gold)'],
                ['Outstanding', fees.outstanding, 'var(--color-brand-navy)'],
                ['Expected', fees.expected, 'var(--color-brand-steel)'],
                ['Overdue', fees.overdue, 'var(--color-error)'],
              ].map(([label, value, color]) => (
                <div key={label} className="flex items-center gap-2">
                  <span aria-hidden="true" className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: color }} />
                  <dt className="flex-1 text-fg-secondary">{label}</dt>
                  <dd className="font-semibold text-fg tabular-nums">{money(value, currency)}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Today's student attendance (each section's latest session counts once). */
export function AttendanceTodayCard({ attendance, enabled }) {
  const tiles = attendance
    ? [
        { key: 'present', label: 'Present', value: attendance.present, className: 'bg-success-soft text-success-fg' },
        { key: 'absent', label: 'Absent', value: attendance.absent, className: 'bg-error-soft text-error-fg' },
        { key: 'late', label: 'Late', value: attendance.late, className: 'bg-tile-gold text-tile-gold-fg' },
      ]
    : [];
  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title="Attendance Today" description={attendance ? formatFullDay(attendance.date) : undefined} action={enabled && <ViewAllLink to="/student-attendance" context="student attendance" />} />
      <CardContent className="flex flex-1 flex-col gap-3">
        {!enabled ? (
          <ModuleOff name="Student Attendance" />
        ) : !attendance.schoolDay ? (
          <EmptyState compact icon={CalendarOff} title="No school today" description={attendance.reason ?? 'Attendance is taken on school days.'} />
        ) : attendance.marked === 0 ? (
          <EmptyState compact icon={ClipboardCheck} title="No attendance taken yet" description={`${attendance.sections} section${attendance.sections === 1 ? '' : 's'} have school today.`} action={<Link to="/student-attendance" className="text-small font-medium text-interactive hover:underline">Take attendance</Link>} />
        ) : (
          <>
            <div className="flex flex-col items-center gap-4 sm:flex-row">
              <DonutChart
                size={120}
                thickness={16}
                centerValue={percentText(attendance.rate)}
                centerLabel="Overall"
                segments={[
                  { key: 'present', value: attendance.present + attendance.late, color: 'var(--color-brand-gold)' },
                  { key: 'absent', value: attendance.absent + attendance.excused, color: 'var(--color-brand-navy)' },
                ]}
              />
              <ul className="grid w-full grid-cols-3 gap-2">
                {tiles.map((t) => (
                  <li key={t.key} className={cn('flex flex-col items-center rounded-md px-2 py-3', t.className)}>
                    <span className="text-section-title tabular-nums">{t.value.toLocaleString()}</span>
                    <span className="text-caption font-medium">{t.label}</span>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-caption text-fg-muted">
              {attendance.sectionsTaken} of {attendance.sections} sections taken
              {attendance.excused ? ` · ${attendance.excused} excused` : ''}
              {attendance.sessionsMissing ? ` · ${attendance.sessionsMissing} sessions missing` : ''}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The branch's latest payments, each linking to the payment. */
export function RecentPaymentsCard({ payments, currency, enabled }) {
  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title="Recent Payments" action={enabled && <ViewAllLink to="/fees/payments" context="payments" withArrow />} />
      <CardContent className="flex-1">
        {!enabled ? (
          <ModuleOff name="Fee Management" />
        ) : !payments.length ? (
          <EmptyState compact icon={Receipt} title="No payments yet" description="Payments recorded in the branch appear here." />
        ) : (
          <div className="-mx-5 overflow-x-auto px-5">
            <table className="w-full min-w-[28rem] text-left text-small">
              <caption className="sr-only">Recent payments</caption>
              <thead>
                <tr className="border-b border-border text-caption font-semibold text-fg-secondary">
                  <th scope="col" className="py-2 pr-2">Student</th>
                  <th scope="col" className="py-2 px-2">Class</th>
                  <th scope="col" className="py-2 px-2 text-right">Amount</th>
                  <th scope="col" className="py-2 pl-2 text-right">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <th scope="row" className="py-2.5 pr-2 font-medium">
                      <Link to={`/fees/students/${p.student.id}`} className="text-fg hover:text-interactive hover:underline">
                        {p.student.name}
                      </Link>
                      {p.status === 'reversed' && <Badge variant="error" className="ml-2">Reversed</Badge>}
                    </th>
                    <td className="py-2.5 px-2 text-fg-secondary">{p.class ?? '—'}</td>
                    <td className="py-2.5 px-2 text-right tabular-nums">{money(p.amount, currency)}</td>
                    <td className="py-2.5 pl-2 text-right whitespace-nowrap text-fg-secondary">{formatDay(p.receivedAt.slice(0, 10))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Today in the branch: bell times most sections follow, examination sessions. */
export function TodayActivitiesCard({ today }) {
  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title="Today’s Activities" description={formatFullDay(today.date)} />
      <CardContent className="flex-1">
        {!today.items.length ? (
          <EmptyState compact icon={CalendarClock} title={today.note ?? 'Nothing scheduled today'} description="The day’s bell times and examination sessions appear here." />
        ) : (
          <>
            {today.note && <p className="mb-3 text-caption font-medium text-tile-gold-fg">{today.note}</p>}
            <ol className="relative flex flex-col gap-3 border-l-2 border-tile-gold pl-4">
              {today.items.map((item, index) => (
                <li key={`${item.time}-${index}`} className="relative flex gap-3 text-small">
                  <span aria-hidden="true" className="absolute top-1.5 -left-[1.3rem] size-2.5 rounded-pill bg-brand-gold" />
                  <span className="w-16 shrink-0 font-medium text-fg-secondary tabular-nums">{clockText(item.time)}</span>
                  <span className="min-w-0 flex-1">
                    {item.link ? (
                      <Link to={item.link} className="font-medium text-fg hover:text-interactive hover:underline">{item.title}</Link>
                    ) : (
                      <span className="font-medium text-fg">{item.title}</span>
                    )}
                    {(item.detail || item.end) && (
                      <span className="block text-caption text-fg-muted">
                        {[item.detail, item.end && `until ${clockText(item.end)}`].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}
      </CardContent>
    </Card>
  );
}

const CLOSING = {
  open: { label: 'Not closed', variant: 'warning' },
  closed: { label: 'Closed', variant: 'success' },
  none: { label: 'Nothing to close', variant: 'neutral' },
};

/** Cash received today, payments, students covered and the cash closing state. */
export function DailySummaryCard({ summary, enabled }) {
  const closing = summary && (CLOSING[summary.closing.state] ?? CLOSING.none);
  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title="Daily Summary" description={summary ? formatFullDay(summary.date) : undefined} action={enabled && <ViewAllLink to="/fees/cash-closing" context="cash closing">Cash closing</ViewAllLink>} />
      <CardContent className="flex-1">
        {!enabled ? (
          <ModuleOff name="Fee Management" />
        ) : (
          <dl className="grid grid-cols-2 gap-3">
            <div className="col-span-2 rounded-md bg-tile-navy px-4 py-3">
              <dt className="text-caption font-medium text-tile-navy-fg">Cash received today</dt>
              <dd className="text-display text-fg tabular-nums">{money(summary.received, summary.currency)}</dd>
            </div>
            <div className="rounded-md border border-border px-3 py-2.5">
              <dt className="text-caption text-fg-muted">Payments</dt>
              <dd className="text-section-title text-fg tabular-nums">{summary.payments.toLocaleString()}</dd>
            </div>
            <div className="rounded-md border border-border px-3 py-2.5">
              <dt className="text-caption text-fg-muted">Students covered</dt>
              <dd className="text-section-title text-fg tabular-nums">{summary.students.toLocaleString()}</dd>
            </div>
            <div className="col-span-2 flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2.5">
              <dt className="inline-flex items-center gap-2 text-small text-fg-secondary">
                <Lock aria-hidden="true" className="size-4" />
                Cash closing
              </dt>
              <dd className="flex items-center gap-2">
                {summary.closing.notClosed > 0 && <span className="text-caption text-fg-muted">{money(summary.closing.notClosedAmount, summary.currency)} open</span>}
                <Badge variant={closing.variant} dot>{closing.label}</Badge>
              </dd>
            </div>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

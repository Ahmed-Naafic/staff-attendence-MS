import { useState } from 'react';
import { AlertTriangle, Banknote, CheckCircle2, CircleDollarSign, Clock, FileText, Lock, Percent, Plus, RefreshCcw, ShieldCheck, Wallet } from 'lucide-react';
import { Link } from 'react-router';
import { Alert, Badge, Button, Card, CardHeader, ErrorState, LinkButton, LoadingState } from '../../../components/ui';
import { DonutChart } from '../../../components/charts';
import { useApiData } from '../../../hooks/useApiData.js';
import { requestFailure } from '../../../hooks/useDialogForm.js';
import { FeeFilters, FeePage, Stat, StatRow, useFeeRole } from '../components/FeeShell.jsx';
import { PaymentDrawer } from '../components/PaymentDrawer.jsx';
import { loadOverview, runGeneration } from '../data/feeApi.js';
import { CLOSING_RESULT, dateTimeText, dayText, money, rate } from '../utils/feeFormat.js';

/** Expected vs collected per month: paired bars, our chart colours. */
function TrendChart({ data, currency }) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.expected, d.collected)));
  return (
    <figure>
      <div className="flex h-48 items-end gap-1.5 border-b border-border-subtle pb-1" aria-hidden="true">
        {data.map((d) => (
          <div key={d.month} className="flex h-full flex-1 flex-col justify-end" title={`${d.label}: expected ${money(d.expected, currency)}, collected ${money(d.collected, currency)}`}>
            <div className="flex h-full items-end justify-center gap-0.5">
              <span className="w-1/2 max-w-3 rounded-t bg-[var(--color-chart-1)] opacity-40" style={{ height: `${(d.expected / max) * 100}%` }} />
              <span className="w-1/2 max-w-3 rounded-t bg-[var(--color-chart-2)]" style={{ height: `${(d.collected / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5 text-center text-caption text-fg-muted" aria-hidden="true">
        {data.map((d) => (
          <span key={d.month} className="flex-1 truncate">{d.label}</span>
        ))}
      </div>
      <figcaption className="mt-2 flex gap-4 text-caption text-fg-muted">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[var(--color-chart-1)] opacity-40" />Expected</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[var(--color-chart-2)]" />Collected</span>
      </figcaption>
      <table className="sr-only">
        <caption>Monthly collection trend</caption>
        <thead><tr><th>Month</th><th>Expected</th><th>Collected</th></tr></thead>
        <tbody>{data.map((d) => <tr key={d.month}><td>{d.label}</td><td>{money(d.expected, currency)}</td><td>{money(d.collected, currency)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

function Overview({ status }) {
  const role = useFeeRole();
  const [filters, setFilters] = useState({ academicYear: '', branch: '', class: '', section: '', from: '', to: '' });
  const [version, setVersion] = useState(0);
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState('');
  const [running, setRunning] = useState(false);
  const data = useApiData(() => loadOverview(role, filters), `fee-overview|${JSON.stringify(filters)}|${version}`);
  const d = data.data;
  const currency = status.currency;
  const p = status.permissions;
  const retry = async () => {
    setRunning(true);
    try {
      const r = await runGeneration(role);
      setNotice(r.run.status === 'succeeded' ? `Monthly fees generated: ${r.run.created} new.` : `Generation failed: ${r.run.error}. EduTrack retries automatically.`);
      setVersion((n) => n + 1);
    } catch (e) {
      setNotice(requestFailure(e));
    } finally {
      setRunning(false);
    }
  };
  if (data.status === 'error' && !d) return <ErrorState title="The overview could not be loaded" onRetry={data.retry} />;
  if (!d) return <LoadingState label="Loading the overview…" />;
  const k = d.kpis;
  const counts = d.statusCounts ?? { cleared: 0, partial: 0, outstanding: 0 };
  const totalStudents = counts.cleared + counts.partial + counts.outstanding;
  const lastMonth = d.generation?.months?.at(-1);
  return (
    <div className="flex flex-col gap-5">
      {notice && <Alert variant="info" onDismiss={() => setNotice('')}>{notice}</Alert>}
      <Card className="p-4">
        <FeeFilters status={status} value={filters} onChange={setFilters} show={['academicYear', 'branch', 'class', 'section', 'dates']} />
      </Card>
      {!d.academicYear ? (
        <Alert variant="warning" title="No current academic year">Fees are charged within an academic year. Start one under Academic Years.</Alert>
      ) : (
        <>
          <StatRow>
            <Stat icon={CircleDollarSign} tone="accent" label="Total expected" value={money(k.expected, currency)} note={`${k.students} students · ${d.academicYear.name}`} />
            <Stat icon={Wallet} tone="success" label="Collected" value={money(k.collected, currency)} note={`${money(k.receivedToday, currency)} received today`} />
            <Stat icon={Clock} tone="warning" label="Outstanding" value={money(k.outstanding, currency)} note={`${money(k.overdue, currency)} overdue`} />
            <Stat icon={Percent} tone="info" label="Collection rate" value={rate(k.rate)} note={`${money(k.discounts, currency)} in discounts`} />
          </StatRow>
          {lastMonth && lastMonth.status !== 'succeeded' && (
            <Alert variant={lastMonth.status === 'failed' ? 'error' : 'warning'} title={`Monthly fees of ${lastMonth.label}: ${lastMonth.status === 'failed' ? 'generation failed' : 'not generated yet'}`} action={p.runGeneration && <Button size="sm" variant="outline" leftIcon={RefreshCcw} loading={running} onClick={retry}>Retry now</Button>}>
              {lastMonth.lastRun?.error ?? 'EduTrack generates monthly fees on the first day of each month and retries automatically.'}
            </Alert>
          )}
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Monthly collection trend" description="What each month charged against what has been collected for it." />
              <div className="px-5 pb-5 pt-3">{d.trend.length ? <TrendChart data={d.trend} currency={currency} /> : <p className="text-small text-fg-muted">No fees yet.</p>}</div>
            </Card>
            <Card>
              <CardHeader title="Fee status (students)" description="Students by what they owe this year." />
              <div className="flex flex-col items-center gap-4 p-5 sm:flex-row xl:flex-col">
                <DonutChart
                  segments={[
                    { key: 'cleared', value: counts.cleared, color: 'var(--color-success)' },
                    { key: 'partial', value: counts.partial, color: 'var(--color-warning)' },
                    { key: 'outstanding', value: counts.outstanding, color: 'var(--color-error)' },
                  ]}
                  centerValue={totalStudents}
                  centerLabel="students"
                />
                <ul className="w-full space-y-2 text-small">
                  {[
                    ['Cleared', counts.cleared, 'text-success', CheckCircle2],
                    ['Partially paid', counts.partial, 'text-warning', Clock],
                    ['Outstanding', counts.outstanding, 'text-error', AlertTriangle],
                  ].map(([label, n, tone, Icon]) => (
                    <li key={label} className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2"><Icon className={`size-4 ${tone}`} aria-hidden="true" />{label}</span>
                      <span className="tabular-nums text-fg-muted">{n} ({totalStudents ? Math.round((n * 100) / totalStudents) : 0}%)</span>
                    </li>
                  ))}
                </ul>
              </div>
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <Card>
              <CardHeader title="Recent payments" action={<LinkButton size="sm" variant="ghost" to="/fees/payments">View all</LinkButton>} />
              <ul className="divide-y divide-border-subtle px-5 pb-3">
                {!d.recentPayments.length && <li className="py-3 text-small text-fg-muted">No payments yet.</li>}
                {d.recentPayments.map((pay) => (
                  <li key={pay.id} className="flex items-center justify-between gap-3 py-2.5 text-small">
                    <span className="min-w-0">
                      <Link to={`/fees/students/${pay.student?.id}`} className="block truncate font-medium text-fg hover:underline">{pay.student?.name}</Link>
                      <span className="block truncate text-caption text-fg-muted">{pay.receipt?.number} · {dateTimeText(pay.receivedAt)}</span>
                    </span>
                    <span className={`tabular-nums font-semibold ${pay.status === 'reversed' ? 'text-fg-muted line-through' : ''}`}>{money(pay.amount, currency)}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Overdue balances" description={`${d.overdueCount} student${d.overdueCount === 1 ? '' : 's'} with overdue fees.`} action={<LinkButton size="sm" variant="ghost" to="/fees/students?status=overdue">View all</LinkButton>} />
              <ul className="divide-y divide-border-subtle px-5 pb-3">
                {!d.overdueStudents.length && <li className="py-3 text-small text-fg-muted">Nobody is overdue.</li>}
                {d.overdueStudents.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-3 py-2.5 text-small">
                    <span className="min-w-0">
                      <Link to={`/fees/students/${s.id}`} className="block truncate font-medium text-fg hover:underline">{s.name}</Link>
                      <span className="block truncate text-caption text-fg-muted">{s.class ?? s.studentNumber} · {s.daysOverdue} days · since {dayText(s.oldestDue)}</span>
                    </span>
                    <span className="tabular-nums font-semibold text-error-fg">{money(s.overdue, currency)}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Cash closing today" description={dayText(d.closing.today)} action={<LinkButton size="sm" variant="ghost" to="/fees/cash-closing">Open</LinkButton>} />
              <ul className="divide-y divide-border-subtle px-5 pb-3 text-small">
                {d.closing.closings.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2 py-2.5">
                    <span className="min-w-0"><span className="block truncate font-medium">{c.user.name}</span><span className="text-caption text-fg-muted">{c.user.roleLabel} · counted {money(c.countedAmount, currency)}</span></span>
                    <Badge variant={CLOSING_RESULT[c.result].variant}><Lock className="mr-1 inline size-3" aria-hidden="true" />{CLOSING_RESULT[c.result].label}</Badge>
                  </li>
                ))}
                {d.closing.notClosed.map((n) => (
                  <li key={n.user.id} className="flex items-center justify-between gap-2 py-2.5">
                    <span className="min-w-0"><span className="block truncate font-medium">{n.user.name}</span><span className="text-caption text-fg-muted">{n.user.roleLabel} · {n.payments} payment{n.payments === 1 ? '' : 's'} not closed</span></span>
                    <Badge variant="warning">{money(n.amount, currency)} open</Badge>
                  </li>
                ))}
                {!d.closing.closings.length && !d.closing.notClosed.length && <li className="py-3 text-fg-muted">No cash taken yet.</li>}
              </ul>
            </Card>
          </div>
          <Card>
            <CardHeader title="Quick actions" />
            <div className="grid grid-cols-2 gap-3 p-5 md:grid-cols-4">
              {p.recordPayments && <Button variant="outline" leftIcon={Banknote} onClick={() => setPaying(true)}>Record Payment</Button>}
              <LinkButton to="/fees/invoices" leftIcon={FileText}>Generate Invoice</LinkButton>
              <LinkButton to="/fees/clearance" leftIcon={ShieldCheck}>Fee Clearance</LinkButton>
              <LinkButton to="/fees/cash-closing" leftIcon={Lock}>Cash Closing</LinkButton>
            </div>
          </Card>
        </>
      )}
      <PaymentDrawer role={role} currency={currency} open={paying} onClose={() => setPaying(false)} onRecorded={() => setVersion((n) => n + 1)} />
    </div>
  );
}

export default function FeeOverviewPage() {
  return (
    <FeePage title="Fee Management · Overview" description="Expected, collected, outstanding and overdue fees, recent payments and today's cash closing." primaryAction={(s) => s.permissions.recordPayments && <PrimaryPay />}>
      {(status) => <Overview status={status} />}
    </FeePage>
  );
}

/** The header's Record Payment button (opens the drawer on the Payments page). */
function PrimaryPay() {
  return <LinkButton to="/fees/payments?record=1" variant="primary" leftIcon={Plus}>Record Payment</LinkButton>;
}

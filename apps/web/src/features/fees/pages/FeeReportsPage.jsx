import { useState } from 'react';
import { CircleDollarSign, Clock, FileSpreadsheet, FileText, Percent, Wallet } from 'lucide-react';
import { Alert, Button, Card, CardHeader, ErrorState, Select, Table, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableLoading, TableRow, Tabs } from '../../../components/ui';
import { DonutChart } from '../../../components/charts';
import { useApiData } from '../../../hooks/useApiData.js';
import { requestFailure } from '../../../hooks/useDialogForm.js';
import { saveFile } from '../../attendance-reports/utils/exportRules.js';
import { FeeFilters, FeePage, Stat, StatRow, useFeeRole } from '../components/FeeShell.jsx';
import { downloadReport, loadReport } from '../data/feeApi.js';
import { dayText, money, rate } from '../utils/feeFormat.js';

const cell = (col, value, currency) => {
  if (value === null || value === undefined || value === '') return '—';
  if (col.kind === 'money') return money(value, currency);
  if (col.kind === 'percent') return rate(value);
  if (col.kind === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(value) ? dayText(value) : value;
  return String(value);
};

/** Bars per row for the series keys of a report's chart (expected / collected, or on time / late / unpaid). */
function ReportChart({ chart, currency }) {
  if (!chart?.series?.length) return null;
  const keys = Object.keys(chart.series[0]).filter((k) => k !== 'label');
  const colors = ['var(--color-chart-1)', 'var(--color-chart-2)', 'var(--color-warning)', 'var(--color-error)'];
  const max = Math.max(1, ...chart.series.flatMap((s) => keys.map((k) => s[k] ?? 0)));
  const isMoney = !keys.includes('onTime');
  return (
    <figure className="px-5 pb-4">
      <div className="flex h-44 items-end gap-2 border-b border-border-subtle" aria-hidden="true">
        {chart.series.map((s) => (
          <div key={s.label} className="flex h-full flex-1 items-end justify-center gap-0.5" title={`${s.label}: ${keys.map((k) => `${k} ${isMoney ? money(s[k], currency) : s[k]}`).join(', ')}`}>
            {keys.map((k, i) => <span key={k} className="w-full max-w-4 rounded-t" style={{ height: `${((s[k] ?? 0) / max) * 100}%`, background: colors[i], opacity: i === 0 && keys.length > 1 && isMoney ? 0.45 : 1 }} />)}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-2 text-center text-caption text-fg-muted" aria-hidden="true">{chart.series.map((s) => <span key={s.label} className="flex-1 truncate">{s.label}</span>)}</div>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-caption text-fg-muted">
        {keys.map((k, i) => <span key={k} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: colors[i], opacity: i === 0 && keys.length > 1 && isMoney ? 0.45 : 1 }} />{k.replace(/([A-Z])/g, ' $1').replace(/^\w/, (c) => c.toUpperCase())}</span>)}
      </figcaption>
    </figure>
  );
}

function Reports({ status }) {
  const role = useFeeRole();
  const reports = status.reports;
  const [group, setGroup] = useState('basic');
  const [name, setName] = useState('collection');
  const [filters, setFilters] = useState({ academicYear: '', branch: '', class: '', section: '', from: '', to: '', status: 'all', kind: 'all' });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const data = useApiData(() => loadReport(role, name, filters), `report|${name}|${JSON.stringify(filters)}`);
  const r = data.data;
  const currency = status.currency;
  const query = { ...filters, class: filters.class, section: filters.section };
  const exportAs = async (format) => {
    setBusy(format);
    setError('');
    try {
      const f = await downloadReport(role, name, format, query);
      saveFile(f.blob, f.filename);
    } catch (e) {
      setError(requestFailure(e));
    } finally {
      setBusy('');
    }
  };
  const list = reports.filter((x) => x.group === group);
  const meta = reports.find((x) => x.key === name);
  const paymentReport = ['daily', 'history'].includes(name);
  return (
    <div className="flex flex-col gap-4">
      <Tabs id="report-groups" label="Report groups" value={group} onChange={(g) => { setGroup(g); setName(reports.find((x) => x.group === g).key); }} tabs={[{ value: 'basic', label: 'Basic reports' }, { value: 'advanced', label: 'Advanced reports' }]} />
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Reports">
        {list.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={name === x.key} onClick={() => setName(x.key)} className={`rounded-full border px-3 py-1.5 text-small font-medium ${name === x.key ? 'border-accent bg-accent-soft text-accent-fg' : 'border-border-subtle text-fg-secondary hover:bg-muted'}`}>
            {x.label}
          </button>
        ))}
      </div>
      <Card className="p-4">
        <FeeFilters status={status} value={filters} onChange={setFilters} show={['academicYear', 'branch', 'class', 'section', 'dates']}>
          {paymentReport ? (
            <Select label="Payment status" size="sm" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} options={[{ value: 'all', label: 'All' }, { value: 'recorded', label: 'Recorded' }, { value: 'reversed', label: 'Reversed' }]} />
          ) : (
            <Select label="Fee kind" size="sm" value={filters.kind} onChange={(e) => setFilters((f) => ({ ...f, kind: e.target.value }))} options={[{ value: 'all', label: 'All fees' }, { value: 'monthly', label: 'Monthly fees' }, { value: 'exam', label: 'Examination fees' }, { value: 'other', label: 'Other charges' }]} />
          )}
        </FeeFilters>
        <p className="mt-2 text-caption text-fg-muted">{paymentReport ? 'Dates are the days payments were received.' : 'Dates filter fees by their due date.'}</p>
      </Card>
      {r?.summary && name === 'collection' && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_16rem]">
          <StatRow>
            <Stat icon={CircleDollarSign} tone="accent" label="Total expected" value={money(r.summary.expected, currency)} />
            <Stat icon={Wallet} tone="success" label="Collected" value={money(r.summary.collected, currency)} />
            <Stat icon={Clock} tone="warning" label="Outstanding" value={money(r.summary.outstanding, currency)} note={`${money(r.summary.overdue, currency)} overdue`} />
            <Stat icon={Percent} tone="info" label="Collection rate" value={rate(r.summary.rate)} />
          </StatRow>
          <Card className="flex items-center justify-center p-4">
            <DonutChart segments={[{ key: 'collected', value: r.summary.collected, color: 'var(--color-chart-2)' }, { key: 'outstanding', value: Math.max(0, r.summary.outstanding), color: 'var(--color-border)' }]} centerValue={rate(r.summary.rate)} centerLabel="Collected" />
          </Card>
        </div>
      )}
      <Card className="overflow-hidden">
        <CardHeader
          title={meta?.label}
          description={meta?.description}
          action={
            <div className="flex gap-2">
              <Button size="sm" variant="outline" leftIcon={FileText} loading={busy === 'pdf'} onClick={() => exportAs('pdf')}>PDF</Button>
              <Button size="sm" variant="outline" leftIcon={FileSpreadsheet} loading={busy === 'xlsx'} onClick={() => exportAs('xlsx')}>Excel</Button>
            </div>
          }
        />
        {error && <Alert variant="error" className="mx-5 mt-3">{error}</Alert>}
        {r?.chart && <div className="mt-4"><ReportChart chart={r.chart} currency={currency} /></div>}
        {data.status === 'error' && !r ? (
          <ErrorState title="The report could not be loaded" description={data.error?.message} onRetry={data.retry} />
        ) : (
          <div className="mt-2 overflow-x-auto" role="region" aria-label={meta?.label} tabIndex={0}>
            <Table caption={meta?.label}>
              <TableHead>
                <TableRow interactive={false}>{(r?.columns ?? []).map((c) => <TableHeaderCell key={c.key} align={c.align}>{c.label}</TableHeaderCell>)}</TableRow>
              </TableHead>
              <TableBody>
                {!r && <TableLoading columns={6} />}
                {r && !r.rows.length && <TableEmpty columns={Math.max(1, r.columns.length)} icon={FileText} title={r.academicYear || paymentReport ? 'No records match these filters' : 'No current academic year'} />}
                {r?.rows.map((row, i) => (
                  <TableRow key={i} interactive={false}>
                    {r.columns.map((c) => <TableCell key={c.key} align={c.align} className={c.bold ? 'font-medium' : c.kind === 'money' || c.kind === 'int' || c.kind === 'percent' ? 'tabular-nums' : ''}>{cell(c, row[c.key], currency)}</TableCell>)}
                  </TableRow>
                ))}
                {r?.totals && r.rows.length > 0 && (
                  <TableRow interactive={false} className="bg-muted font-semibold">
                    {r.columns.map((c) => <TableCell key={c.key} align={c.align} className="tabular-nums">{r.totals[c.key] === undefined ? '' : cell(c, r.totals[c.key], currency)}</TableCell>)}
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
        {r && <p className="px-5 py-3 text-caption text-fg-muted">{r.academicYear?.name ?? ''} · generated {new Date(r.generatedAt).toLocaleString('en-GB')} · from payments, allocations, reversals, discounts and the amounts charged.</p>}
      </Card>
    </div>
  );
}

export default function FeeReportsPage() {
  return (
    <FeePage title="Reports" description="Fee collection, outstanding and overdue fees, payments and cash closing; trends, comparisons and discount analysis.">
      {(status) => <Reports status={status} />}
    </FeePage>
  );
}

import { useState } from 'react';
import { ArrowRightLeft, Banknote, CalendarDays, CheckCircle2, Lock, Scale, Wallet } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, Drawer, ErrorState, Input, LoadingState, Select, Table, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableLoading, TableRow, Tabs, Textarea } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { requestFailure } from '../../../hooks/useDialogForm.js';
import { ReasonModal } from '../components/FeeDialogs.jsx';
import { Facts, FeeFilters, FeePage, Money, Stat, StatRow, StatusBadge, useFeeRole } from '../components/FeeShell.jsx';
import { closeCash, correctClosing, loadClosing, loadClosings, loadMyClosing } from '../data/feeApi.js';
import { CLOSING_RESULT, dateTimeText, dayText, fromCents, money, toCents } from '../utils/feeFormat.js';

/** My closing: the open period (payments since my last closing), count the cash, close. */
function MyClosing({ status, onClosed }) {
  const role = useFeeRole();
  const [version, setVersion] = useState(0);
  const data = useApiData(() => loadMyClosing(role), `my-closing|${version}`);
  const [counted, setCounted] = useState('');
  const [explanation, setExplanation] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const d = data.data;
  const currency = status.currency;
  if (data.status === 'error' && !d) return <ErrorState title="Your cash could not be loaded" onRetry={data.retry} />;
  if (!d) return <LoadingState label="Loading your cash…" />;
  const o = d.open;
  const cents = toCents(counted);
  const difference = cents === null ? null : cents - o.expectedAmount;
  const close = async () => {
    setError('');
    if (cents === null) return setError('Enter the cash you counted.');
    if (difference !== 0 && !explanation.trim()) return setError(`Explain the ${difference < 0 ? 'shortage' : 'surplus'} of ${money(Math.abs(difference), currency)}.`);
    setSaving(true);
    try {
      await closeCash(role, { counted: cents, expected: o.expectedAmount, explanation: explanation.trim() || null });
      setCounted('');
      setExplanation('');
      setVersion((n) => n + 1);
      onClosed();
    } catch (e) {
      setError(requestFailure(e));
      if (e.code === 'EXPECTED_CHANGED') setVersion((n) => n + 1);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <StatRow>
        <Stat icon={CalendarDays} tone="accent" label={o.since ? `Since your last closing (${dateTimeText(o.since)})` : 'Since your first payment'} value={dayText(d.today)} note="Closing date" />
        <Stat icon={Banknote} tone="success" label={`Total collected (${o.paymentsCount} payments)`} value={money(o.recordedAmount, currency)} />
        <Stat icon={ArrowRightLeft} tone="warning" label={`Reversed (${o.reversalsCount})`} value={money(o.reversedAmount, currency)} />
        <Stat icon={Wallet} tone="info" label="Expected cash" value={money(o.expectedAmount, currency)} />
      </StatRow>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Closing details" description="Payments you recorded and reversals that come out of your cash since your last closing." />
          <div className="overflow-x-auto px-2 pb-3">
            <Table caption="Open cash">
              <TableHead>
                <TableRow interactive={false}>
                  <TableHeaderCell>Payment method</TableHeaderCell>
                  <TableHeaderCell align="right">System total</TableHeaderCell>
                  <TableHeaderCell align="right">Physical total</TableHeaderCell>
                  <TableHeaderCell align="right">Difference</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow interactive={false}>
                  <TableCell>Cash</TableCell>
                  <TableCell align="right"><Money value={o.expectedAmount} currency={currency} /></TableCell>
                  <TableCell align="right">{cents === null ? '—' : <Money value={cents} currency={currency} />}</TableCell>
                  <TableCell align="right">{difference === null ? '—' : <Money value={difference} currency={currency} className={difference < 0 ? 'text-error-fg' : difference > 0 ? 'text-warning-fg' : 'text-success-fg'} />}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <details className="mt-3 px-3 text-small">
              <summary className="cursor-pointer font-medium">Payments in this closing ({o.paymentsCount}) and reversals ({o.reversalsCount})</summary>
              <ul className="mt-2 divide-y divide-border-subtle">
                {o.payments.map((p) => <li key={p.id} className="flex justify-between gap-2 py-1.5"><span>{p.receipt} · {p.student} · {dateTimeText(p.receivedAt)}{p.status === 'reversed' ? ' (reversed)' : ''}</span><Money value={p.amount} currency={currency} /></li>)}
                {o.reversals.map((p) => <li key={`r-${p.id}`} className="flex justify-between gap-2 py-1.5 text-error-fg"><span>Reversal of {p.receipt} · {p.reason}</span><span>-{money(p.amount, currency)}</span></li>)}
                {!o.payments.length && !o.reversals.length && <li className="py-1.5 text-fg-muted">Nothing since your last closing.</li>}
              </ul>
            </details>
          </div>
        </Card>
        <Card>
          <CardHeader title="Close my cash" description="Count the cash in your drawer. A shortage or surplus is allowed with an explanation." />
          <div className="flex flex-col gap-3 p-5">
            <Input label={`Physical cash counted (${currency})`} inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} required />
            <button type="button" className="self-start text-caption font-medium text-accent-fg underline" onClick={() => setCounted(fromCents(o.expectedAmount))}>Counted exactly {money(o.expectedAmount, currency)}</button>
            {difference !== null && difference !== 0 && (
              <>
                <Alert variant={difference < 0 ? 'error' : 'warning'} title={`${difference < 0 ? 'Shortage' : 'Surplus'} of ${money(Math.abs(difference), currency)}`}>An explanation is required.</Alert>
                <Textarea label="Explanation" required rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} maxLength={500} />
              </>
            )}
            {error && <Alert variant="error">{error}</Alert>}
            <Button leftIcon={Lock} loading={saving} onClick={close}>Close cash</Button>
            {d.closedToday && <p className="text-caption text-fg-muted">You already closed today; this adds another closing for what came in since.</p>}
          </div>
        </Card>
      </div>
      {d.recent.length > 0 && <ClosingList role={role} currency={currency} items={d.recent} title="My recent closings" onChanged={() => setVersion((n) => n + 1)} canCorrect />}
    </div>
  );
}

/** Closings in a table; a row opens its details (payments, revisions, correction). */
function ClosingList({ role, currency, items, title, onChanged, canCorrect, showPerson }) {
  const [open, setOpen] = useState(null);
  return (
    <Card className="overflow-hidden">
      {title && <CardHeader title={title} />}
      <div className="mt-2 overflow-x-auto">
        <Table caption={title ?? 'Closings'}>
          <TableHead>
            <TableRow interactive={false}>
              <TableHeaderCell>Date</TableHeaderCell>
              {showPerson && <TableHeaderCell>Closed by</TableHeaderCell>}
              <TableHeaderCell>Branch</TableHeaderCell>
              <TableHeaderCell align="right">Recorded</TableHeaderCell>
              <TableHeaderCell align="right">Reversed</TableHeaderCell>
              <TableHeaderCell align="right">Counted</TableHeaderCell>
              <TableHeaderCell align="right">Difference</TableHeaderCell>
              <TableHeaderCell>Result</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!items.length && <TableEmpty columns={showPerson ? 8 : 7} icon={Lock} title="No closings" />}
            {items.map((c) => (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => setOpen(c.id)}>
                <TableCell>{dayText(c.closingDate)}<span className="block text-caption text-fg-muted">{dateTimeText(c.closedAt)}</span></TableCell>
                {showPerson && <TableCell>{c.user.name}<span className="block text-caption text-fg-muted">{c.user.roleLabel}</span></TableCell>}
                <TableCell>{c.branch?.name ?? 'School'}</TableCell>
                <TableCell align="right"><Money value={c.recordedAmount} currency={currency} /></TableCell>
                <TableCell align="right"><Money value={c.reversedAmount} currency={currency} /></TableCell>
                <TableCell align="right"><Money value={c.countedAmount} currency={currency} /></TableCell>
                <TableCell align="right"><Money value={c.difference} currency={currency} className={c.difference < 0 ? 'text-error-fg' : c.difference > 0 ? 'text-warning-fg' : ''} /></TableCell>
                <TableCell><StatusBadge map={CLOSING_RESULT} value={c.result} />{c.correctedAt && <Badge variant="info" className="ml-1">Corrected</Badge>}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ClosingDrawer role={role} currency={currency} id={open} onClose={() => setOpen(null)} onChanged={onChanged} canCorrect={canCorrect} />
    </Card>
  );
}

function ClosingDrawer({ role, currency, id, onClose, onChanged, canCorrect }) {
  const [version, setVersion] = useState(0);
  const [correcting, setCorrecting] = useState(false);
  const data = useApiData(() => (id ? loadClosing(role, id) : Promise.resolve(null)), `closing|${id}|${version}`);
  const c = data.data?.closing;
  return (
    <Drawer open={Boolean(id)} onClose={onClose} size="lg" title="Cash closing" description={c ? `${c.user.name} (${c.user.roleLabel}) · ${dayText(c.closingDate)}` : ''} footer={c && canCorrect && <Button variant="outline" onClick={() => setCorrecting(true)}>Correct the count</Button>}>
      {!c ? (
        <LoadingState label="Loading…" />
      ) : (
        <div className="flex flex-col gap-4 text-small">
          <Facts items={[['Closed at', dateTimeText(c.closedAt)], ['Branch', c.branch?.name ?? 'School'], ['Payments', `${c.paymentsCount} · ${money(c.recordedAmount, currency)}`], ['Reversed', `${c.reversalsCount} · ${money(c.reversedAmount, currency)}`], ['Expected', money(c.expectedAmount, currency)], ['Counted', money(c.countedAmount, currency)], ['Difference', money(c.difference, currency)], ['Result', CLOSING_RESULT[c.result].label]]} />
          {c.explanation && <Alert variant={c.difference < 0 ? 'error' : 'warning'} title="Explanation">{c.explanation}</Alert>}
          <section>
            <h3 className="mb-1 font-semibold">Revisions</h3>
            <ol className="divide-y divide-border-subtle rounded-md border border-border-subtle">
              {c.revisions.map((r, i) => <li key={r.id} className="px-3 py-2">{i === 0 ? 'Closed' : 'Corrected'} by {r.by} · {dateTimeText(r.at)} · counted {money(r.countedAmount, currency)} (difference {money(r.difference, currency)}){r.reason ? ` · ${r.reason}` : ''}</li>)}
            </ol>
          </section>
          <section>
            <h3 className="mb-1 font-semibold">Payments</h3>
            <ul className="divide-y divide-border-subtle">
              {c.payments.map((p) => <li key={p.id} className="flex justify-between gap-2 py-1.5"><span>{p.receipt} · {p.student}{p.status === 'reversed' ? ' (reversed)' : ''}</span><Money value={p.amount} currency={currency} /></li>)}
              {c.reversals.map((p) => <li key={`r-${p.id}`} className="flex justify-between gap-2 py-1.5 text-error-fg"><span>Reversal of {p.receipt}</span><span>-{money(p.amount, currency)}</span></li>)}
              {!c.payments.length && !c.reversals.length && <li className="py-1.5 text-fg-muted">No payments.</li>}
            </ul>
          </section>
        </div>
      )}
      <ReasonModal open={correcting} onClose={() => setCorrecting(false)} variant="primary" title="Correct the cash count" description="The closing keeps its first values as a revision; the correction is in the audit log." amount={c ? fromCents(c.countedAmount) : ''} amountLabel={`Corrected count (${currency})`} confirmLabel="Save correction" run={({ reason, value }) => correctClosing(role, c.id, { counted: toCents(value) ?? -1, reason, explanation: reason })} onDone={() => { setCorrecting(false); setVersion((n) => n + 1); onChanged?.(); }} />
    </Drawer>
  );
}

/** Closings of a role (or everyone), with the combined summary per day; individual closings stay separate. */
function ClosingHistory({ status, role: roleFilter, title }) {
  const role = useFeeRole();
  const [filters, setFilters] = useState({ branch: '', from: '', to: '', result: 'all', role: roleFilter ?? 'all' });
  const [version, setVersion] = useState(0);
  const data = useApiData(() => loadClosings(role, filters), `closings|${JSON.stringify(filters)}|${version}`);
  const d = data.data;
  const currency = status.currency;
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <FeeFilters status={status} value={filters} onChange={setFilters} show={['branch', 'dates']}>
          {!roleFilter && <Select label="Role" size="sm" value={filters.role} onChange={(e) => setFilters((f) => ({ ...f, role: e.target.value }))} options={[{ value: 'all', label: 'Everyone' }, { value: 'ACCOUNTANT', label: 'Accountants' }, { value: 'MANAGER', label: 'Managers' }, { value: 'OWNER', label: 'School Owner' }]} />}
          <Select label="Result" size="sm" value={filters.result} onChange={(e) => setFilters((f) => ({ ...f, result: e.target.value }))} options={[{ value: 'all', label: 'All results' }, ...Object.entries(CLOSING_RESULT).map(([value, r]) => ({ value, label: r.label }))]} />
        </FeeFilters>
      </Card>
      {data.status === 'error' && !d ? (
        <ErrorState title="Closings could not be loaded" onRetry={data.retry} />
      ) : !d ? (
        <Card className="p-4"><TableLoading columns={6} /></Card>
      ) : (
        <>
          <StatRow>
            <Stat icon={Lock} tone="accent" label="Closings" value={d.summary.closings} />
            <Stat icon={Wallet} tone="info" label="Expected" value={money(d.summary.expected, currency)} />
            <Stat icon={CheckCircle2} tone="success" label="Counted" value={money(d.summary.counted, currency)} />
            <Stat icon={Scale} tone={d.summary.difference < 0 ? 'error' : d.summary.difference > 0 ? 'warning' : 'success'} label="Net difference" value={money(d.summary.difference, currency)} note={`Shortages ${money(d.summary.shortages, currency)} · surpluses ${money(d.summary.surpluses, currency)}`} />
          </StatRow>
          <ClosingList role={role} currency={currency} items={d.items} title={title} showPerson onChanged={() => setVersion((n) => n + 1)} canCorrect={status.permissions.correctOthersClosings} />
          {!roleFilter && (
            <Card className="overflow-hidden">
              <CardHeader title="Combined financial summary" description="Totals per day across everyone who closed. It never replaces the individual closings above." />
              <div className="mt-2 overflow-x-auto">
                <Table caption="Combined summary per day">
                  <TableHead><TableRow interactive={false}><TableHeaderCell>Date</TableHeaderCell><TableHeaderCell align="right">Closings</TableHeaderCell><TableHeaderCell align="right">Recorded</TableHeaderCell><TableHeaderCell align="right">Reversed</TableHeaderCell><TableHeaderCell align="right">Expected</TableHeaderCell><TableHeaderCell align="right">Counted</TableHeaderCell><TableHeaderCell align="right">Difference</TableHeaderCell></TableRow></TableHead>
                  <TableBody>
                    {!d.summary.days.length && <TableEmpty columns={7} title="No closings in this period" />}
                    {d.summary.days.map((day) => (
                      <TableRow key={day.date} interactive={false}>
                        <TableCell>{dayText(day.date)}</TableCell>
                        <TableCell align="right">{day.closings}</TableCell>
                        <TableCell align="right"><Money value={day.recorded} currency={currency} /></TableCell>
                        <TableCell align="right"><Money value={day.reversed} currency={currency} /></TableCell>
                        <TableCell align="right"><Money value={day.expected} currency={currency} /></TableCell>
                        <TableCell align="right"><Money value={day.counted} currency={currency} /></TableCell>
                        <TableCell align="right"><Money value={day.difference} currency={currency} className={day.difference < 0 ? 'text-error-fg' : ''} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

export default function CashClosingPage() {
  const [tab, setTab] = useState('mine');
  const [version, setVersion] = useState(0);
  return (
    <FeePage title="Cash Closing" description="Accountants and Managers each close their own cash; a shortage or surplus is kept with its explanation.">
      {(status) => {
        const role = status.role;
        const tabs = [
          { value: 'mine', label: `My Closing (${role === 'ACCOUNTANT' ? 'Accountant' : role === 'MANAGER' ? 'Manager' : 'Owner'})` },
          { value: 'accountants', label: 'Accountant Closing' },
          { value: 'managers', label: 'Manager Closing' },
          { value: 'history', label: 'Closing History & Summary' },
        ];
        return (
          <div className="flex flex-col gap-4">
            <Tabs id="closing-tabs" label="Cash closing" value={tab} onChange={setTab} tabs={tabs} />
            {tab === 'mine' && <MyClosing key={version} status={status} onClosed={() => setVersion((n) => n + 1)} />}
            {tab === 'accountants' && <ClosingHistory status={status} role="ACCOUNTANT" title="Accountant closings" />}
            {tab === 'managers' && <ClosingHistory status={status} role="MANAGER" title="Manager closings" />}
            {tab === 'history' && <ClosingHistory status={status} title="All closings" />}
          </div>
        );
      }}
    </FeePage>
  );
}

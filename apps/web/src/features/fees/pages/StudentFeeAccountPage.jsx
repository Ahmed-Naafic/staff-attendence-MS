import { useState } from 'react';
import { ArrowLeft, ArrowRightLeft, Banknote, Check, Download, FilePlus, Percent, Plus, Printer, ReceiptText, ShieldCheck, SlidersHorizontal, UserRound, Wallet, X } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { Alert, Badge, Button, Card, CardHeader, DropdownMenu, ErrorState, LoadingState, Table, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableRow, Tabs } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { requestFailure } from '../../../hooks/useDialogForm.js';
import { saveFile } from '../../attendance-reports/utils/exportRules.js';
import { InvoicePreview, ReasonModal } from '../components/FeeDialogs.jsx';
import { AdjustmentModal, ChargeModal, GiveDiscountModal, InvoiceCreateModal, MoveBranchModal } from '../components/FeeForms.jsx';
import { Facts, FeePage, Money, printBlob, Stat, StatRow, StatusBadge, useFeeRole } from '../components/FeeShell.jsx';
import { PaymentDrawer } from '../components/PaymentDrawer.jsx';
import { adjustObligation, cancelObligation, downloadReceipt, endAdjustment, loadAccount, markReceiptPrinted, reinstateObligation, revokeDiscount, reversePayment } from '../data/feeApi.js';
import { ACCOUNT_STATUS, CLEARANCE, dateTimeText, dayText, fromCents, INVOICE_STATUS, KIND_LABEL, money, monthName, obligationState, PAYMENT_STATE, percent, toCents } from '../utils/feeFormat.js';

const MONTH_TONE = { paid: 'border-success/40 bg-success-soft text-success-fg', partial: 'border-warning/40 bg-warning-soft text-warning-fg', overdue: 'border-error/40 bg-error-soft text-error-fg', unpaid: 'border-border bg-surface text-fg', cancelled: 'border-border-subtle bg-muted text-fg-muted line-through', not_charged: 'border-dashed border-border-subtle text-fg-muted', upcoming: 'border-dashed border-border-subtle text-fg-muted' };

function Account({ status }) {
  const role = useFeeRole();
  const { studentId } = useParams();
  const navigate = useNavigate();
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState('summary');
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const data = useApiData(() => loadAccount(role, studentId), `account|${studentId}|${version}`);
  const a = data.data;
  const currency = status.currency;
  const refresh = (message) => {
    setDialog(null);
    if (message) setNotice(message);
    setVersion((n) => n + 1);
  };
  const receipt = async (p, kind) => {
    try {
      const f = await downloadReceipt(role, p.receipt.id);
      if (kind === 'print') printBlob(f.blob);
      else saveFile(f.blob, f.filename);
      await markReceiptPrinted(role, p.receipt.id).catch(() => {});
    } catch (e) {
      setNotice(requestFailure(e));
    }
  };
  if (data.status === 'error' && !a) return <ErrorState title="This account could not be loaded" description={data.error?.status === 404 ? 'The student is not in your branch, or does not exist.' : 'Check your connection and try again.'} onRetry={data.retry} />;
  if (!a) return <LoadingState label="Loading the account…" />;
  const p = a.permissions;
  const t = a.totals;
  const current = status.academicYears.find((y) => y.id === a.academicYear?.id) ?? status.academicYears.find((y) => y.status === 'current');
  const student = { id: a.student.id, name: a.student.name, studentNumber: a.student.studentNumber, class: a.enrollment?.section.displayName };
  const standard = a.obligations.filter((o) => o.kind === 'monthly' && o.status !== 'cancelled').at(-1)?.standardAmount;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2 text-small text-fg-muted">
        <Link to="/fees/students" className="inline-flex items-center gap-1 hover:text-fg"><ArrowLeft className="size-4" aria-hidden="true" />Student Fees</Link>
      </div>
      {notice && <Alert variant="info" onDismiss={() => setNotice('')}>{notice}</Alert>}
      <Card className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center">
        <span className="grid size-14 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-fg"><UserRound className="size-7" aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-section-title text-fg">{a.student.name}</h1>
          <p className="text-small text-fg-muted">
            Student ID: {a.student.studentNumber} · {a.enrollment ? `${a.enrollment.section.displayName} · ${a.enrollment.branch.name}` : 'Not enrolled this year'} · {a.academicYear?.name ?? ''}
          </p>
          <p className="text-caption text-fg-muted">Guardian: {a.student.guardianName} · {a.student.guardianPhone}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge map={ACCOUNT_STATUS} value={a.status} />
          <Badge variant={CLEARANCE[a.clearance.status.toLowerCase()]?.variant}>{CLEARANCE[a.clearance.status.toLowerCase()]?.label}</Badge>
          {p.recordPayments && <Button leftIcon={Banknote} onClick={() => setDialog({ type: 'pay' })}>Record Payment</Button>}
          <DropdownMenu
            label="More account actions"
            items={[
              { label: 'New invoice', icon: FilePlus, onSelect: () => setDialog({ type: 'invoice' }) },
              p.adjust && { label: 'Adjust monthly fee', icon: SlidersHorizontal, onSelect: () => setDialog({ type: 'adjust' }) },
              p.charge && { label: 'Add a charge', icon: Plus, onSelect: () => setDialog({ type: 'charge' }) },
              p.assignDiscounts && { label: 'Give a discount', icon: Percent, onSelect: () => setDialog({ type: 'discount' }) },
              { label: 'Clearance details', icon: ShieldCheck, onSelect: () => navigate(`/fees/clearance/${a.student.id}`) },
              p.transferBranch && a.enrollment && { label: 'Move to another branch', icon: ArrowRightLeft, onSelect: () => setDialog({ type: 'move' }) },
            ].filter(Boolean)}
          />
        </div>
      </Card>

      <Tabs
        id="account-tabs"
        label="Account"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'summary', label: 'Summary' },
          { value: 'obligations', label: `Obligations (${a.obligations.length})` },
          { value: 'payments', label: `Payments (${a.payments.length})` },
          { value: 'invoices', label: `Invoices (${a.invoices.length})` },
          { value: 'discounts', label: 'Discounts & adjustments' },
          { value: 'history', label: 'History' },
        ]}
      />

      {tab === 'summary' && (
        <>
          <StatRow>
            <Stat icon={ReceiptText} tone="info" label={`Total obligations (${t.count})`} value={money(t.due, currency)} />
            <Stat icon={Check} tone="success" label="Paid" value={money(t.paid, currency)} />
            <Stat icon={Wallet} tone={t.balance ? 'error' : 'success'} label="Outstanding" value={money(t.balance, currency)} note={t.overdue ? `${money(t.overdue, currency)} overdue` : 'Nothing overdue'} />
            <Stat icon={ShieldCheck} tone={a.clearance.status === 'CLEARED' ? 'success' : 'warning'} label="Clearance" value={CLEARANCE[a.clearance.status.toLowerCase()]?.label} note={a.clearance.reasons[0]} />
          </StatRow>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Fee breakdown" description={a.academicYear?.name} />
              <div className="p-5">
                <Facts
                  className="sm:grid-cols-1"
                  items={[
                    [`Monthly fees (${t.monthly.count})`, money(t.monthly.due, currency)],
                    [`Examination fees (${t.exam.count})`, money(t.exam.due, currency)],
                    t.other.count && [`Other charges (${t.other.count})`, money(t.other.due, currency)],
                    ['Standard fees', money(t.standard, currency)],
                    ['Discounts', `-${money(t.discounts, currency)}`],
                    t.adjustments ? ['Individual adjustments', `-${money(t.adjustments, currency)}`] : null,
                    ['Total', money(t.due, currency)],
                    ['Paid', money(t.paid, currency)],
                    ['Remaining balance', money(t.balance, currency)],
                  ].filter(Boolean)}
                />
                {a.allTotals.balance !== t.balance && <p className="mt-3 text-caption text-fg-muted">All years: {money(a.allTotals.balance, currency)} still owed.</p>}
              </div>
            </Card>
            <Card>
              <CardHeader title="Monthly status" description="Each month's fee this year." />
              <ul className="grid grid-cols-3 gap-2 p-5 sm:grid-cols-4">
                {a.months.map((m) => (
                  <li key={m.month} className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-small ${MONTH_TONE[m.state]}`} title={`${m.fullLabel}: ${PAYMENT_STATE[m.state]?.label}${m.netAmount !== null ? ` · ${money(m.paidAmount, currency)} of ${money(m.netAmount, currency)}` : ''}`}>
                    <span>{m.label}</span>
                    {m.state === 'paid' ? <Check className="size-4" aria-label="Paid" /> : m.state === 'overdue' ? <X className="size-4" aria-label="Overdue" /> : <span className="text-caption">{m.state === 'partial' ? '½' : m.state === 'unpaid' ? '•' : ''}</span>}
                  </li>
                ))}
              </ul>
              <p className="px-5 pb-4 text-caption text-fg-muted">Green: paid · amber: part paid · red: overdue · dashed: not charged.</p>
            </Card>
          </div>
        </>
      )}

      {tab === 'obligations' && (
        <Card className="overflow-x-auto">
          <Table caption="Obligations">
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>Fee</TableHeaderCell>
                <TableHeaderCell>Due</TableHeaderCell>
                <TableHeaderCell align="right">Original</TableHeaderCell>
                <TableHeaderCell align="right">Discounts</TableHeaderCell>
                <TableHeaderCell align="right">Payable</TableHeaderCell>
                <TableHeaderCell align="right">Paid</TableHeaderCell>
                <TableHeaderCell align="right">Balance</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell align="right">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!a.obligations.length && <TableEmpty columns={9} icon={ReceiptText} title="No fees yet" description="Monthly fees appear on the 1st of each month once the class has a fee structure." />}
              {a.obligations.map((o) => (
                <TableRow key={o.id}>
                  <TableCell>
                    <span className="font-medium">{o.kind === 'monthly' ? monthName(o.month) : o.title}</span>
                    <span className="block text-caption text-fg-muted">{KIND_LABEL[o.kind]} · {o.branch.name}{o.cancelReason ? ` · ${o.cancelReason}` : ''}</span>
                  </TableCell>
                  <TableCell>{dayText(o.dueDate)}</TableCell>
                  <TableCell align="right">
                    <Money value={o.standardAmount} currency={currency} />
                    {o.amount !== o.standardAmount && <span className="block text-caption text-fg-muted">adjusted {money(o.amount, currency)}</span>}
                  </TableCell>
                  <TableCell align="right">{o.discountAmount ? <span title={o.discounts.map((d) => `${d.name}: ${money(d.amount, currency)}`).join('\n')}>-{money(o.discountAmount, currency)}<span className="block text-caption text-fg-muted">{o.discounts.map((d) => d.name).join(', ')}</span></span> : '—'}</TableCell>
                  <TableCell align="right"><Money value={o.netAmount} currency={currency} /></TableCell>
                  <TableCell align="right"><Money value={o.paidAmount} currency={currency} /></TableCell>
                  <TableCell align="right"><Money value={o.balance} currency={currency} className={o.balance ? 'font-semibold' : ''} /></TableCell>
                  <TableCell><StatusBadge map={PAYMENT_STATE} value={obligationState(o)} /></TableCell>
                  <TableCell align="right">
                    <DropdownMenu
                      label={`Actions for ${o.title}`}
                      items={[
                        p.adjust && o.status !== 'cancelled' && { label: 'Adjust amount', onSelect: () => setDialog({ type: 'adjustOne', obligation: o }) },
                        p.cancelObligations && o.status !== 'cancelled' && { label: 'Cancel fee', destructive: true, onSelect: () => setDialog({ type: 'cancelOne', obligation: o }) },
                        p.cancelObligations && o.status === 'cancelled' && { label: 'Reinstate fee', onSelect: () => setDialog({ type: 'reinstate', obligation: o }) },
                      ].filter(Boolean).concat([{ type: 'label', label: `Charged ${dayText(o.createdAt.slice(0, 10))}` }])}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {tab === 'payments' && (
        <Card className="overflow-x-auto">
          <Table caption="Payments">
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>Receipt</TableHeaderCell>
                <TableHeaderCell>Date</TableHeaderCell>
                <TableHeaderCell>Covers</TableHeaderCell>
                <TableHeaderCell align="right">Amount</TableHeaderCell>
                <TableHeaderCell>Received by</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell align="right">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!a.payments.length && <TableEmpty columns={7} icon={Banknote} title="No payments yet" />}
              {a.payments.map((pay) => (
                <TableRow key={pay.id}>
                  <TableCell className="font-medium">{pay.receipt?.number}{pay.receipt?.void && <Badge variant="error" className="ml-2">VOID</Badge>}</TableCell>
                  <TableCell>{dateTimeText(pay.receivedAt)}<span className="block text-caption text-fg-muted">{pay.branch.name}</span></TableCell>
                  <TableCell className="text-small">{pay.allocations.map((al) => `${al.obligation.month ? monthName(al.obligation.month) : al.obligation.title} (${money(al.amount, currency)})`).join(', ')}</TableCell>
                  <TableCell align="right"><Money value={pay.amount} currency={currency} className={pay.status === 'reversed' ? 'text-fg-muted line-through' : 'font-semibold'} /></TableCell>
                  <TableCell>{pay.recordedBy.name}</TableCell>
                  <TableCell>{pay.status === 'reversed' ? <Badge variant="error" title={pay.reversalReason}>Reversed</Badge> : <Badge variant="success">Recorded</Badge>}{pay.reversalReason && <span className="block text-caption text-fg-muted">{pay.reversalReason} · {pay.reversedBy}</span>}</TableCell>
                  <TableCell align="right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" leftIcon={Printer} onClick={() => receipt(pay, 'print')} aria-label={`Print receipt ${pay.receipt?.number}`}>Print</Button>
                      <Button size="sm" variant="ghost" leftIcon={Download} onClick={() => receipt(pay, 'download')} aria-label={`Download receipt ${pay.receipt?.number}`} />
                      {p.reversePayments && pay.status === 'recorded' && <Button size="sm" variant="danger" onClick={() => setDialog({ type: 'reverse', payment: pay })}>Reverse</Button>}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {tab === 'invoices' && (
        <Card>
          <CardHeader title="Invoices" action={<Button size="sm" leftIcon={FilePlus} onClick={() => setDialog({ type: 'invoice' })}>New invoice</Button>} />
          <ul className="divide-y divide-border-subtle px-5 pb-3">
            {!a.invoices.length && <li className="py-3 text-small text-fg-muted">No invoices yet.</li>}
            {a.invoices.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between gap-3 py-2.5 text-small">
                <button type="button" className="text-left font-medium hover:underline" onClick={() => setDialog({ type: 'preview', invoiceId: inv.id })}>{inv.number ?? 'Draft invoice'}</button>
                <span className="text-fg-muted">{dayText((inv.issuedAt ?? inv.createdAt).slice(0, 10))}</span>
                <span className="tabular-nums">{money(inv.amount, currency)}</span>
                <StatusBadge map={INVOICE_STATUS} value={inv.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === 'discounts' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Discounts & scholarships" action={p.assignDiscounts && <Button size="sm" leftIcon={Percent} onClick={() => setDialog({ type: 'discount' })}>Give</Button>} />
            <ul className="divide-y divide-border-subtle px-5 pb-3 text-small">
              {!a.discounts.length && <li className="py-3 text-fg-muted">No discounts.</li>}
              {a.discounts.map((d) => (
                <li key={d.id} className="flex items-start justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block font-medium">{d.policy.name} · {d.policy.type === 'percentage' ? percent(d.policy.value) : money(d.policy.value, currency)}</span>
                    <span className="block text-caption text-fg-muted">{monthName(d.startMonth)} – {d.endMonth ? monthName(d.endMonth) : 'until revoked'} · {d.reason} · by {d.assignedBy}</span>
                    <span className="block text-caption text-fg-muted">Taken off so far: {money(d.totalApplied, currency)}{d.revokedAt ? ` · revoked ${dayText(d.revokedAt.slice(0, 10))}: ${d.revokeReason}` : ''}</span>
                  </span>
                  {d.active ? p.assignDiscounts && <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'revokeDiscount', discount: d })}>Revoke</Button> : <Badge variant="neutral">Revoked</Badge>}
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Individual fee adjustments" action={p.adjust && <Button size="sm" leftIcon={SlidersHorizontal} onClick={() => setDialog({ type: 'adjust' })}>Adjust</Button>} />
            <ul className="divide-y divide-border-subtle px-5 pb-3 text-small">
              {!a.adjustments.length && <li className="py-3 text-fg-muted">No adjustments: the class fee applies.</li>}
              {a.adjustments.map((x) => (
                <li key={x.id} className="flex items-start justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block font-medium">{money(x.originalAmount, currency)} → {money(x.amount, currency)} a month</span>
                    <span className="block text-caption text-fg-muted">{monthName(x.fromMonth)} – {x.toMonth ? monthName(x.toMonth) : 'end of year'} · {x.reason}</span>
                    <span className="block text-caption text-fg-muted">By {x.createdBy} ({x.createdByRole?.toLowerCase()}) on {dateTimeText(x.createdAt)}{x.endedAt ? ` · ended: ${x.endReason}` : ''}</span>
                  </span>
                  {x.active ? p.adjust && <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'endAdjustment', adjustment: x })}>End</Button> : <Badge variant="neutral">Ended</Badge>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      {tab === 'history' && (
        <Card>
          <CardHeader title="Financial history" description="Every change to this account, newest first." />
          <ol className="flex flex-col gap-0 px-5 pb-4">
            {a.history.map((h, i) => (
              <li key={`${h.at}-${i}`} className="flex gap-3 border-l-2 border-border-subtle py-2 pl-4 text-small">
                <span className="w-36 shrink-0 text-caption text-fg-muted">{dateTimeText(h.at)}</span>
                <span className="min-w-0">
                  <span className="font-medium">{h.title}</span>
                  {(h.fromAmount !== undefined || h.toAmount !== undefined) && (h.fromAmount !== null || h.toAmount !== null) && <span className="ml-2 tabular-nums text-fg-muted">{h.fromAmount !== undefined && h.fromAmount !== null ? `${money(h.fromAmount, currency)} → ` : ''}{h.toAmount !== undefined && h.toAmount !== null ? money(h.toAmount, currency) : ''}</span>}
                  {h.description && <span className="block text-caption text-fg-muted">{h.description}</span>}
                  {h.by && <span className="block text-caption text-fg-muted">by {h.by}</span>}
                </span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      <PaymentDrawer role={role} currency={currency} open={dialog?.type === 'pay'} student={student} onClose={() => refresh()} onRecorded={() => setVersion((n) => n + 1)} />
      <InvoiceCreateModal role={role} open={dialog?.type === 'invoice'} status={status} student={student} onClose={() => setDialog(null)} onDone={(r) => setDialog({ type: 'preview', invoiceId: r.single.invoice.id })} />
      <InvoicePreview role={role} invoiceId={dialog?.invoiceId} open={dialog?.type === 'preview'} onClose={() => refresh()} onChanged={() => setVersion((n) => n + 1)} />
      <AdjustmentModal role={role} open={dialog?.type === 'adjust'} student={student} year={current} currency={currency} standard={standard} onClose={() => setDialog(null)} onDone={(r) => refresh(`Monthly fee adjusted${r.changed ? `; ${r.changed} unpaid month${r.changed === 1 ? '' : 's'} updated` : ''}.`)} />
      <ChargeModal role={role} open={dialog?.type === 'charge'} student={student} currency={currency} onClose={() => setDialog(null)} onDone={() => refresh('Charge added.')} />
      <GiveDiscountModal role={role} open={dialog?.type === 'discount'} student={student} year={current} currency={currency} onClose={() => setDialog(null)} onDone={(r) => refresh(`Discount given${r.changed ? `; ${r.changed} unpaid fee${r.changed === 1 ? '' : 's'} reduced` : ''}.`)} />
      {p.transferBranch && <MoveBranchModal open={dialog?.type === 'move'} student={student} status={status} currentBranchId={a.student.branch.id} onClose={() => setDialog(null)} onDone={() => refresh(`${student.name} moved. Their account and history came with them.`)} />}
      <ReasonModal open={dialog?.type === 'reverse'} onClose={() => setDialog(null)} title={`Reverse payment ${dialog?.payment?.receipt?.number ?? ''}?`} description={`${money(dialog?.payment?.amount, currency)} goes back onto the fees it paid. The payment stays on record and its receipt is marked VOID.`} confirmLabel="Reverse payment" run={({ reason }) => reversePayment(role, dialog.payment.id, reason)} onDone={() => refresh('Payment reversed; the receipt is void.')} />
      <ReasonModal open={dialog?.type === 'adjustOne'} onClose={() => setDialog(null)} variant="primary" title={`Adjust ${dialog?.obligation?.title ?? ''}`} description={`Original ${money(dialog?.obligation?.standardAmount, currency)}. Discounts stay as they are; the change is recorded with your reason.`} amount={fromCents(dialog?.obligation?.amount)} amountLabel={`New amount before discounts (${currency})`} confirmLabel="Save" run={({ reason, value }) => { const cents = toCents(value); if (cents === null) throw Object.assign(new Error('Enter an amount.'), { status: 409, message: 'Enter an amount.' }); return adjustObligation(role, dialog.obligation.id, { amount: cents, reason }); }} onDone={() => refresh('Fee adjusted.')} />
      <ReasonModal open={dialog?.type === 'cancelOne'} onClose={() => setDialog(null)} title={`Cancel ${dialog?.obligation?.title ?? ''}?`} description="It is no longer owed. It stays on record; anything already paid towards it is kept." confirmLabel="Cancel fee" run={({ reason }) => cancelObligation(role, dialog.obligation.id, reason)} onDone={() => refresh('Fee cancelled.')} />
      <ReasonModal open={dialog?.type === 'reinstate'} onClose={() => setDialog(null)} variant="primary" title={`Reinstate ${dialog?.obligation?.title ?? ''}?`} confirmLabel="Reinstate" run={({ reason }) => reinstateObligation(role, dialog.obligation.id, reason)} onDone={() => refresh('Fee reinstated.')} />
      <ReasonModal open={dialog?.type === 'revokeDiscount'} onClose={() => setDialog(null)} title={`Revoke ${dialog?.discount?.policy.name ?? ''}?`} description="Fees not paid at all from the current month lose it. Fees already paid keep their discount." confirmLabel="Revoke" run={({ reason }) => revokeDiscount(role, dialog.discount.id, { reason })} onDone={() => refresh('Discount revoked.')} />
      <ReasonModal open={dialog?.type === 'endAdjustment'} onClose={() => setDialog(null)} title="End this adjustment?" description="Monthly fees generated from now on use the class fee. Fees already charged keep their amounts." confirmLabel="End adjustment" run={({ reason }) => endAdjustment(role, dialog.adjustment.id, reason)} onDone={() => refresh('Adjustment ended.')} />
    </div>
  );
}

export default function StudentFeeAccountPage() {
  return <FeePage title="Student Fees" description="A student's financial account.">{(status) => <Account status={status} />}</FeePage>;
}


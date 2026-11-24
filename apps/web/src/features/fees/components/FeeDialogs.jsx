import { useEffect, useState } from 'react';
import { Ban, Download, FileText, MessageCircle, Printer, Send } from 'lucide-react';
import { Alert, Badge, Button, Input, Modal, Spinner, Textarea } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { requestFailure } from '../../../hooks/useDialogForm.js';
import { saveFile } from '../../attendance-reports/utils/exportRules.js';
import { cancelInvoice, downloadInvoice, issueInvoice, loadInvoice } from '../data/feeApi.js';
import { dayText, INVOICE_STATUS, money } from '../utils/feeFormat.js';
import { printBlob, StatusBadge } from './FeeShell.jsx';

/**
 * A dialog asking for a reason (and optionally an amount or a month) before running `run(values)`.
 * Used for reversals, cancellations, exceptions, corrections: every one of them needs a reason.
 */
export function ReasonModal({ open, onClose, title, description, confirmLabel = 'Confirm', variant = 'danger', run, onDone, amount, amountLabel = 'Amount', month, monthOptions, extra }) {
  const [reason, setReason] = useState('');
  const [value, setValue] = useState('');
  const [monthValue, setMonthValue] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setReason('');
    setValue(amount ?? '');
    setMonthValue(month ?? '');
    setError('');
  }, [open, amount, month]);
  const submit = async () => {
    if (!reason.trim()) return setError('Give a reason.');
    setSaving(true);
    setError('');
    try {
      const result = await run({ reason: reason.trim(), value, month: monthValue });
      onDone?.(result);
    } catch (e) {
      setError(requestFailure(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      loading={saving}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={variant === 'danger' ? 'danger' : 'primary'} loading={saving} onClick={submit}>{confirmLabel}</Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {amount !== undefined && <Input label={amountLabel} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} required />}
        {monthOptions && (
          <label className="flex flex-col gap-1 text-small">
            <span className="font-medium">From month</span>
            <select className="rounded-md border border-border bg-surface px-3 py-2" value={monthValue} onChange={(e) => setMonthValue(e.target.value)}>
              {monthOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
        )}
        {extra}
        <Textarea label="Reason" required rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        {error && <Alert variant="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

/**
 * Invoice preview (the reference layout): actions on the left (download, print, share by WhatsApp or
 * SMS from the phone, issue a draft, cancel), the invoice on the right. No payment deadline.
 */
export function InvoicePreview({ role, invoiceId, open, onClose, onChanged }) {
  const [version, setVersion] = useState(0);
  const data = useApiData(() => (invoiceId ? loadInvoice(role, invoiceId) : Promise.resolve(null)), `invoice|${invoiceId}|${version}`);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const inv = data.data?.invoice;
  const currency = data.data?.currency;
  const c = inv?.content ?? {};
  const school = c.school ?? {};
  const file = async (kind) => {
    setBusy(kind);
    setError('');
    try {
      const f = await downloadInvoice(role, inv.id);
      if (kind === 'print') printBlob(f.blob);
      else saveFile(f.blob, f.filename);
    } catch (e) {
      setError(requestFailure(e));
    } finally {
      setBusy('');
    }
  };
  const phone = (c.student?.guardianPhone ?? '').replace(/[^\d]/g, '');
  const share = data.data?.share ?? '';
  const issue = async () => {
    setBusy('issue');
    try {
      await issueInvoice(role, inv.id);
      setVersion((n) => n + 1);
      onChanged?.();
    } catch (e) {
      setError(requestFailure(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Invoice (Preview)" size="xl">
      {!inv ? (
        <div className="grid place-items-center p-10">{data.status === 'error' ? <Alert variant="error">The invoice could not be loaded.</Alert> : <Spinner label="Loading invoice…" />}</div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[14rem_1fr]">
          <aside className="flex flex-col gap-2">
            <Button variant="secondary" leftIcon={FileText} className="justify-start" disabled>Invoice</Button>
            <Button variant="ghost" leftIcon={Download} className="justify-start" loading={busy === 'download'} onClick={() => file('download')}>Download PDF</Button>
            <Button variant="ghost" leftIcon={Printer} className="justify-start" loading={busy === 'print'} onClick={() => file('print')}>Print</Button>
            {phone && (
              <>
                <a className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-small font-medium text-fg hover:bg-muted" href={`https://wa.me/${phone}?text=${encodeURIComponent(share)}`} target="_blank" rel="noopener noreferrer">
                  <MessageCircle className="size-4" aria-hidden="true" /> Share on WhatsApp
                </a>
                <a className="inline-flex items-center gap-2 rounded-md px-3 py-2 text-small font-medium text-fg hover:bg-muted" href={`sms:${c.student.guardianPhone}?body=${encodeURIComponent(share)}`}>
                  <Send className="size-4" aria-hidden="true" /> Send by SMS
                </a>
              </>
            )}
            {inv.status === 'draft' && <Button leftIcon={Send} loading={busy === 'issue'} onClick={issue}>Issue invoice</Button>}
            {inv.status !== 'cancelled' && <Button variant="ghost" leftIcon={Ban} className="justify-start text-error-fg" onClick={() => setCancelling(true)}>Cancel invoice</Button>}
            <div className="mt-4 border-t border-border-subtle pt-4 text-small">
              <p className="text-fg-muted">Invoice status</p>
              <div className="mt-1"><StatusBadge map={INVOICE_STATUS} value={inv.status} /></div>
              <p className="mt-3 text-fg-muted">Amount</p>
              <p className="text-section-title tabular-nums">{money(inv.totals.total, currency)}</p>
              <p className="mt-2 text-fg-muted">Paid</p>
              <p className="text-card-title tabular-nums text-success-fg">{money(inv.totals.paid, currency)}</p>
              <p className="mt-2 text-fg-muted">Balance</p>
              <p className="text-card-title tabular-nums text-error-fg">{money(inv.totals.balance, currency)}</p>
            </div>
            {error && <Alert variant="error">{error}</Alert>}
          </aside>
          <article className="rounded-lg border border-border bg-surface p-5 shadow-subtle" aria-label="Invoice">
            <header className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                {inv.branding?.logo && <img src={inv.branding.logo} alt="" className="size-14 rounded object-contain" />}
                <div>
                  <p className="text-section-title text-fg">{school.schoolName}</p>
                  <p className="text-small text-fg-muted">{c.branch?.name}</p>
                  {school.address && <p className="text-caption text-fg-muted">{school.address}</p>}
                </div>
              </div>
              <div className="text-right text-small text-fg-muted">
                {school.phone && <p>{school.phone}</p>}
                {school.email && <p>{school.email}</p>}
              </div>
            </header>
            <p className="mt-4 rounded-md bg-interactive px-3 py-2 text-center font-semibold tracking-wide text-on-interactive">STUDENT INVOICE</p>
            <div className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-border-subtle p-3 text-small sm:grid-cols-2">
              <div className="grid grid-cols-[7rem_1fr] gap-y-1">
                <span className="text-fg-muted">Invoice No.</span><span className="font-semibold">{inv.number ?? 'Draft'}</span>
                <span className="text-fg-muted">Date</span><span>{dayText(inv.issuedAt ?? inv.createdAt)}</span>
                <span className="text-fg-muted">Academic year</span><span>{c.academicYear ?? '—'}</span>
                <span className="text-fg-muted">Period</span><span>{c.periodLabel}</span>
              </div>
              <div className="grid grid-cols-[7rem_1fr] gap-y-1">
                <span className="text-fg-muted">Student</span><span className="font-semibold">{c.student?.name}</span>
                <span className="text-fg-muted">Student ID</span><span>{inv.student.studentNumber}</span>
                <span className="text-fg-muted">Class</span><span>{c.student?.class ?? '—'}</span>
                <span className="text-fg-muted">Guardian</span><span>{c.student?.guardianName ?? '—'}</span>
              </div>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-small">
                <thead>
                  <tr className="border-b border-border text-left text-fg-muted">
                    <th className="py-2 pr-2 font-medium">#</th>
                    <th className="py-2 pr-2 font-medium">Description</th>
                    <th className="py-2 pr-2 font-medium">Period</th>
                    <th className="py-2 pr-2 text-right font-medium">Fee</th>
                    <th className="py-2 pr-2 text-right font-medium">Discount</th>
                    <th className="py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {inv.lines.map((l, i) => (
                    <tr key={l.id} className={`border-b border-border-subtle ${l.cancelled ? 'text-fg-muted line-through' : ''}`}>
                      <td className="py-2 pr-2">{i + 1}</td>
                      <td className="py-2 pr-2">{l.description}</td>
                      <td className="py-2 pr-2">{l.period}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{money(l.standardAmount, currency)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{l.discountAmount ? `-${money(l.discountAmount, currency)}` : '—'}</td>
                      <td className="py-2 text-right tabular-nums">{money(l.amount, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="ml-auto mt-3 grid max-w-xs grid-cols-2 gap-y-1 text-small">
              <dt>Fees</dt><dd className="text-right tabular-nums">{money(inv.totals.subtotal, currency)}</dd>
              <dt>Discounts</dt><dd className="text-right tabular-nums">-{money(inv.totals.discounts, currency)}</dd>
              <dt className="font-semibold">Total invoice</dt><dd className="text-right font-semibold tabular-nums">{money(inv.totals.total, currency)}</dd>
              <dt>Previous payments</dt><dd className="text-right tabular-nums">-{money(inv.totals.paid, currency)}</dd>
              <dt className="mt-1 rounded-l-md bg-accent-soft px-2 py-1.5 font-semibold text-accent-fg">Remaining balance</dt>
              <dd className="mt-1 rounded-r-md bg-accent-soft px-2 py-1.5 text-right font-semibold tabular-nums text-accent-fg">{money(inv.totals.balance, currency)}</dd>
            </dl>
            <div className="mt-4 text-caption text-fg-muted">
              <p className="font-semibold text-fg">Note</p>
              <ul className="list-disc pl-5">
                {c.note && <li>{c.note}</li>}
                <li>No payment deadline. An invoice is not a receipt.</li>
              </ul>
              {inv.status === 'cancelled' && <Badge variant="error" className="mt-2">Cancelled: {inv.cancelReason}</Badge>}
            </div>
          </article>
        </div>
      )}
      <ReasonModal
        open={cancelling}
        onClose={() => setCancelling(false)}
        title={`Cancel invoice ${inv?.number ?? '(draft)'}?`}
        description="The invoice is kept, marked cancelled. The fees it lists and any payments are unchanged."
        confirmLabel="Cancel invoice"
        run={({ reason }) => cancelInvoice(role, inv.id, reason)}
        onDone={() => {
          setCancelling(false);
          setVersion((n) => n + 1);
          onChanged?.();
        }}
      />
    </Modal>
  );
}

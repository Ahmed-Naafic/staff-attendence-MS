import { useEffect, useMemo, useState } from 'react';
import { Banknote, CheckCircle2, Download, Printer, Search, UserRound, X } from 'lucide-react';
import { Alert, Badge, Button, Checkbox, Drawer, Input, Modal, Spinner, Textarea } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { requestFailure } from '../../../hooks/useDialogForm.js';
import { saveFile } from '../../attendance-reports/utils/exportRules.js';
import { downloadReceipt, loadPayable, markReceiptPrinted, recordPayment, searchPayers } from '../data/feeApi.js';
import { checkPayment, dayText, fromCents, money, toCents } from '../utils/feeFormat.js';
import { printBlob } from './FeeShell.jsx';

/** Search students by name or Student ID (the role's scope), showing class and balance. */
export function StudentPicker({ role, currency, onPick, autoFocus = true }) {
  const [text, setText] = useState('');
  const results = useApiData(() => (text.trim().length >= 2 ? searchPayers(role, text) : Promise.resolve({ items: [] })), `payers|${role}|${text}`, { delayMs: 250 });
  return (
    <div className="flex flex-col gap-2">
      <Input label="Student" type="search" placeholder="Search by name or Student ID…" value={text} onChange={(e) => setText(e.target.value)} autoFocus={autoFocus} />
      {text.trim().length >= 2 && (
        <ul className="max-h-64 overflow-y-auto rounded-md border border-border-subtle" aria-label="Matching students">
          {results.status === 'loading' && !results.data && (
            <li className="flex items-center gap-2 p-3 text-small text-fg-muted">
              <Spinner size="sm" /> Searching…
            </li>
          )}
          {results.data?.items.length === 0 && <li className="p-3 text-small text-fg-muted">No student matches.</li>}
          {results.data?.items.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => onPick(s)} className="flex w-full items-center gap-3 border-b border-border-subtle px-3 py-2 text-left last:border-0 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
                <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-accent-fg">
                  <UserRound className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-fg">{s.name}</span>
                  <span className="block truncate text-caption text-fg-muted">
                    {s.studentNumber} · {s.class ?? 'Not enrolled'}
                    {s.branch ? ` · ${s.branch.name}` : ''}
                  </span>
                </span>
                <span className={`text-small tabular-nums ${s.balance ? 'text-error-fg' : 'text-success-fg'}`}>{money(s.balance, currency)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Record Payment (cash only in this version): choose the student, tick the exact fees the money pays
 * (any unpaid month, older ones may stay unpaid), the amount for each (part payments when the school
 * allows), check the total equals the cash received, then record. The receipt follows.
 */
export function PaymentDrawer({ role, currency, open, onClose, student: preset, onRecorded }) {
  const [student, setStudent] = useState(preset ?? null);
  const [received, setReceived] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [requestKey, setRequestKey] = useState(() => crypto.randomUUID());
  const [receipt, setReceipt] = useState(null);
  const payable = useApiData(() => (student ? loadPayable(role, student.id) : Promise.resolve(null)), `payable|${role}|${student?.id ?? ''}|${open}`);

  useEffect(() => {
    if (!open) return;
    setStudent(preset ?? null);
    setReceived('');
    setNote('');
    setError('');
    setRequestKey(crypto.randomUUID());
  }, [open, preset]);

  useEffect(() => {
    setLines((payable.data?.items ?? []).map((o) => ({ ...o, selected: false, amount: fromCents(o.balance), currency })));
  }, [payable.data, currency]);

  const amount = toCents(received);
  const check = useMemo(() => checkPayment(amount, lines, payable.data?.policy ?? { allowPartial: true }), [amount, lines, payable.data]);
  const toggle = (i, selected) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, selected, amount: selected ? l.amount || fromCents(l.balance) : l.amount } : l)));
  const setAmount = (i, value) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, amount: value } : l)));
  /** Fill the amount received from the fees ticked. */
  const useSelectedTotal = () => setReceived(fromCents(check.total));

  const submit = async () => {
    setError('');
    if (amount === null || amount <= 0) return setError('Enter the amount received.');
    if (check.problems.length) return setError(check.problems[0]);
    setSaving(true);
    try {
      const result = await recordPayment(role, { student: student.id, amount, method: 'cash', note: note.trim() || null, requestKey, allocations: lines.filter((l) => l.selected).map((l) => ({ obligation: l.id, amount: toCents(l.amount) })) });
      setReceipt(result.payment);
      onRecorded?.(result.payment);
    } catch (e) {
      setError(requestFailure(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Drawer
        open={open && !receipt}
        onClose={onClose}
        size="lg"
        title="Record Payment"
        description="Cash only. Choose exactly which fees this payment covers."
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button leftIcon={Banknote} loading={saving} disabled={!student || !lines.length} onClick={submit}>Record Payment</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-5">
          {!student ? (
            <StudentPicker role={role} currency={currency} onPick={setStudent} />
          ) : (
            <div className="flex items-center gap-3 rounded-md border border-border-subtle p-3">
              <span className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent-fg">
                <UserRound className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-fg">{student.name}</p>
                <p className="truncate text-caption text-fg-muted">{student.studentNumber}{student.class ? ` · ${student.class}` : ''}</p>
              </div>
              {!preset && (
                <Button size="sm" variant="ghost" leftIcon={X} onClick={() => setStudent(null)} aria-label="Choose another student">
                  Change
                </Button>
              )}
            </div>
          )}

          {student && payable.data && (
            <>
              <div className="grid grid-cols-3 gap-2 rounded-md bg-muted p-3 text-small">
                <div><p className="text-fg-muted">Outstanding</p><p className="font-semibold tabular-nums">{money(payable.data.totals.outstanding, currency)}</p></div>
                <div><p className="text-fg-muted">Overdue</p><p className="font-semibold tabular-nums text-error-fg">{money(payable.data.totals.overdue, currency)}</p></div>
                <div><p className="text-fg-muted">Partly paid</p><p className="font-semibold tabular-nums">{payable.data.totals.partlyPaid}</p></div>
              </div>
              {!lines.length ? (
                <Alert variant="success" title="Nothing to pay">{student.name} has no unpaid fees.</Alert>
              ) : (
                <fieldset className="flex flex-col gap-1">
                  <legend className="mb-2 text-small font-semibold text-fg">Select items to pay</legend>
                  {lines.map((l, i) => (
                    <div key={l.id} className={`grid grid-cols-[auto_1fr_7rem] items-center gap-3 rounded-md border px-3 py-2 ${l.selected ? 'border-accent bg-accent-soft/40' : 'border-border-subtle'}`}>
                      <Checkbox label={<span className="sr-only">Pay {l.period}</span>} checked={l.selected} onChange={(e) => toggle(i, e.target.checked)} />
                      <div className="min-w-0">
                        <p className="truncate text-small font-medium text-fg">
                          {l.kind === 'monthly' ? `Monthly fee · ${l.period}` : l.title}
                          {l.overdue && <Badge variant="error" className="ml-2">Overdue</Badge>}
                          {l.paidAmount > 0 && <Badge variant="warning" className="ml-2">Partly paid</Badge>}
                        </p>
                        <p className="text-caption text-fg-muted">Due {dayText(l.dueDate)} · Fee {money(l.netAmount, currency)} · Balance {money(l.balance, currency)}</p>
                      </div>
                      <Input label={`Amount for ${l.period}`} hideLabel size="sm" inputMode="decimal" value={l.amount} disabled={!l.selected} onChange={(e) => setAmount(i, e.target.value)} />
                    </div>
                  ))}
                </fieldset>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1">
                  <Input label="Amount received (cash)" inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} required />
                  {check.total > 0 && toCents(received) !== check.total && (
                    <button type="button" className="self-start text-caption font-medium text-accent-fg underline" onClick={useSelectedTotal}>
                      Use the total chosen ({money(check.total, currency)})
                    </button>
                  )}
                </div>
                <div className="rounded-md bg-muted p-3 text-small">
                  <p className="flex justify-between"><span className="text-fg-muted">Chosen</span><span className="tabular-nums">{money(check.total, currency)}</span></p>
                  <p className="flex justify-between"><span className="text-fg-muted">Payment method</span><span>Cash</span></p>
                  <p className="mt-1 text-caption text-fg-muted">{payable.data.policy.allowPartial ? 'Part payments are accepted.' : 'Each chosen fee is paid in full.'}</p>
                </div>
              </div>
              <Textarea label="Note (optional)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
              {(error || (amount && check.problems.length > 0)) && <Alert variant="error">{error || check.problems[0]}</Alert>}
            </>
          )}
          {student && payable.status === 'loading' && !payable.data && <Spinner label="Loading fees…" />}
        </div>
      </Drawer>
      <ReceiptDialog role={role} currency={currency} payment={receipt} onClose={() => { setReceipt(null); onClose(); }} />
    </>
  );
}

/** After a payment: its receipt is issued; printing is optional (print, download, or skip). */
export function ReceiptDialog({ role, currency, payment, onClose }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const receipt = payment?.receipt;
  const run = async (kind) => {
    setBusy(kind);
    setError('');
    try {
      const file = await downloadReceipt(role, receipt.id);
      if (kind === 'print') printBlob(file.blob);
      else saveFile(file.blob, file.filename);
      await markReceiptPrinted(role, receipt.id).catch(() => {});
    } catch (e) {
      setError(requestFailure(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <Modal
      open={Boolean(payment)}
      onClose={onClose}
      title="Payment recorded"
      description={receipt ? `Receipt ${receipt.number} was issued.` : undefined}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Skip printing</Button>
          <Button variant="outline" leftIcon={Download} loading={busy === 'download'} onClick={() => run('download')}>Download</Button>
          <Button leftIcon={Printer} loading={busy === 'print'} onClick={() => run('print')}>Print receipt</Button>
        </div>
      }
    >
      {payment && (
        <div className="flex flex-col items-center gap-2 py-2 text-center">
          <CheckCircle2 className="size-10 text-success" aria-hidden="true" />
          <p className="text-section-title tabular-nums">{money(payment.amount, currency)}</p>
          <p className="text-small text-fg-muted">{payment.allocations.map((a) => (a.obligation.month ? a.obligation.title.replace('Monthly fee · ', '') : a.obligation.title)).join(', ')}</p>
          <p className="text-caption text-fg-muted">The receipt can be printed or downloaded again later from the payment.</p>
          {error && <Alert variant="error">{error}</Alert>}
        </div>
      )}
    </Modal>
  );
}

export { Search };

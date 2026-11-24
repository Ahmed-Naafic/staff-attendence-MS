import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Select, Textarea } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { requestFailure } from '../../../hooks/useDialogForm.js';
import { addCharge, assignDiscount, createAdjustment, createBulkInvoices, createInvoice, loadPolicies, transferStudentBranch } from '../data/feeApi.js';
import { money, percent, toCents, yearMonths } from '../utils/feeFormat.js';
import { StudentPicker } from './PaymentDrawer.jsx';

/** A dialog with a form: values, an error, saving, and a submit that maps the values to a request. */
function useForm(open, initial) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setValues(initial);
      setError('');
      setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (k, v) => setValues((x) => ({ ...x, [k]: v }));
  const submit = async (request, onDone) => {
    setSaving(true);
    setError('');
    try {
      onDone(await request());
    } catch (e) {
      setError(e.local ? e.message : requestFailure(e));
    } finally {
      setSaving(false);
    }
  };
  return { values, set, error, setError, saving, submit };
}
const fail = (message) => Object.assign(new Error(message), { local: true });
const Footer = ({ onClose, saving, onSave, label = 'Save' }) => (
  <div className="flex justify-end gap-2">
    <Button variant="ghost" onClick={onClose}>Cancel</Button>
    <Button loading={saving} onClick={onSave}>{label}</Button>
  </div>
);

/** A student's own monthly fee from a month (an individual adjustment; reason required). */
export function AdjustmentModal({ role, open, onClose, onDone, student, year, currency, standard }) {
  const months = yearMonths(year);
  const f = useForm(open, { monthlyFee: '', fromMonth: months.find((m) => m.value >= new Date().toISOString().slice(0, 7))?.value ?? months[0]?.value ?? '', toMonth: '', reason: '', applyToOpen: true });
  const save = () =>
    f.submit(async () => {
      const cents = toCents(f.values.monthlyFee);
      if (cents === null) throw fail('Enter the student’s monthly fee.');
      if (!f.values.reason.trim()) throw fail('Give a reason.');
      return createAdjustment(role, student.id, { monthlyFee: cents, fromMonth: f.values.fromMonth, toMonth: f.values.toMonth || null, reason: f.values.reason.trim(), applyToOpen: f.values.applyToOpen });
    }, onDone);
  return (
    <Modal open={open} onClose={onClose} title={`Adjust monthly fee · ${student?.name ?? ''}`} description={standard !== undefined ? `Class fee: ${money(standard, currency)}. The original amount is kept with every fee changed.` : 'The original amount is kept with every fee changed.'} loading={f.saving} footer={<Footer onClose={onClose} saving={f.saving} onSave={save} />}>
      <div className="flex flex-col gap-3">
        <Input label={`Student's monthly fee (${currency})`} inputMode="decimal" required value={f.values.monthlyFee} onChange={(e) => f.set('monthlyFee', e.target.value)} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="From" value={f.values.fromMonth} onChange={(e) => f.set('fromMonth', e.target.value)} options={months} />
          <Select label="Until" value={f.values.toMonth} onChange={(e) => f.set('toMonth', e.target.value)} options={[{ value: '', label: 'End of the year' }, ...months]} />
        </div>
        <Checkbox label="Also change fees of these months already charged and not paid at all" checked={f.values.applyToOpen} onChange={(e) => f.set('applyToOpen', e.target.checked)} />
        <Textarea label="Reason" required rows={2} value={f.values.reason} onChange={(e) => f.set('reason', e.target.value)} />
        {f.error && <Alert variant="error">{f.error}</Alert>}
      </div>
    </Modal>
  );
}

/** Another charge (uniform, transport, books…) added to a student's account. */
export function ChargeModal({ role, open, onClose, onDone, student, currency }) {
  const f = useForm(open, { title: '', amount: '', dueDate: '', reason: '' });
  const save = () =>
    f.submit(async () => {
      const cents = toCents(f.values.amount);
      if (!f.values.title.trim()) throw fail('Name the charge.');
      if (!cents) throw fail('Enter the amount.');
      if (!f.values.reason.trim()) throw fail('Give a reason.');
      return addCharge(role, student.id, { title: f.values.title.trim(), amount: cents, dueDate: f.values.dueDate || null, reason: f.values.reason.trim() });
    }, onDone);
  return (
    <Modal open={open} onClose={onClose} title={`Add a charge · ${student?.name ?? ''}`} description="A separate obligation on the student's account, shown on invoices as another charge." loading={f.saving} footer={<Footer onClose={onClose} saving={f.saving} onSave={save} label="Add charge" />}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Charge" placeholder="e.g. Uniform" required value={f.values.title} onChange={(e) => f.set('title', e.target.value)} fieldClassName="sm:col-span-2" maxLength={80} />
        <Input label={`Amount (${currency})`} inputMode="decimal" required value={f.values.amount} onChange={(e) => f.set('amount', e.target.value)} />
        <Input label="Due date" type="date" value={f.values.dueDate} onChange={(e) => f.set('dueDate', e.target.value)} hint="Empty: today." />
        <Textarea label="Reason" required rows={2} value={f.values.reason} onChange={(e) => f.set('reason', e.target.value)} fieldClassName="sm:col-span-2" />
        {f.error && <Alert variant="error" className="sm:col-span-2">{f.error}</Alert>}
      </div>
    </Modal>
  );
}

/** Gives a student an existing discount policy (within the Owner's limits). */
export function GiveDiscountModal({ role, open, onClose, onDone, student: preset, year, currency }) {
  const policies = useApiData(() => (open ? loadPolicies(role, 'active') : Promise.resolve(null)), `policies-active|${open}`);
  const months = yearMonths(year);
  const [student, setStudent] = useState(preset ?? null);
  useEffect(() => {
    if (open) setStudent(preset ?? null);
  }, [open, preset]);
  const f = useForm(open, { policy: '', startMonth: months.find((m) => m.value >= new Date().toISOString().slice(0, 7))?.value ?? months[0]?.value ?? '', endMonth: '', reason: '', applyToOpen: true });
  const items = (policies.data?.items ?? []).filter((p) => role === 'OWNER' || p.managersAssign);
  const chosen = items.find((p) => p.id === f.values.policy);
  const save = () =>
    f.submit(async () => {
      if (!student) throw fail('Choose the student.');
      if (!f.values.policy) throw fail('Choose a discount policy.');
      if (!f.values.reason.trim()) throw fail('Give a reason.');
      return assignDiscount(role, { student: student.id, policy: f.values.policy, startMonth: f.values.startMonth, endMonth: f.values.endMonth || null, reason: f.values.reason.trim(), applyToOpen: f.values.applyToOpen });
    }, onDone);
  return (
    <Modal open={open} onClose={onClose} title="Give a discount" description="Choose one of your school's discount or scholarship policies." loading={f.saving} footer={<Footer onClose={onClose} saving={f.saving} onSave={save} label="Give discount" />}>
      <div className="flex flex-col gap-3">
        {!preset && (student ? <p className="rounded-md bg-muted p-2 text-small">{student.name} · {student.studentNumber} <button type="button" className="ml-2 text-accent-fg underline" onClick={() => setStudent(null)}>Change</button></p> : <StudentPicker role={role} currency={currency} onPick={setStudent} autoFocus={false} />)}
        <Select label="Policy" required value={f.values.policy} onChange={(e) => f.set('policy', e.target.value)} placeholder={items.length ? 'Choose a policy' : 'No policy you may give'} options={items.map((p) => ({ value: p.id, label: `${p.name} · ${p.type === 'percentage' ? percent(p.value) : money(p.value, currency)}` }))} />
        {chosen?.eligibility && <Alert variant="info" title="Eligibility">{chosen.eligibility}</Alert>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="From" value={f.values.startMonth} onChange={(e) => f.set('startMonth', e.target.value)} options={months} />
          <Select label="Until" value={f.values.endMonth} onChange={(e) => f.set('endMonth', e.target.value)} options={[{ value: '', label: 'Until revoked' }, ...months]} />
        </div>
        <Checkbox label="Also reduce fees of those months already charged and not paid at all" checked={f.values.applyToOpen} onChange={(e) => f.set('applyToOpen', e.target.checked)} />
        <Textarea label="Reason" required rows={2} value={f.values.reason} onChange={(e) => f.set('reason', e.target.value)} />
        {f.error && <Alert variant="error">{f.error}</Alert>}
      </div>
    </Modal>
  );
}

/** One invoice for a student, or invoices in bulk (a class, a section). Invoices have no deadline. */
export function InvoiceCreateModal({ role, open, onClose, onDone, status, student: preset, mode = 'student' }) {
  const year = status.academicYears.find((y) => y.status === 'current');
  const months = yearMonths(year);
  const [student, setStudent] = useState(preset ?? null);
  useEffect(() => {
    if (open) setStudent(preset ?? null);
  }, [open, preset]);
  const f = useForm(open, { mode: preset ? 'student' : mode, class: '', section: '', from: '', to: '', includeEarlier: true, includeExam: true, includeOther: true, onlyWithBalance: true, issue: true, note: '' });
  const sections = status.sections.filter((s) => !f.values.class || s.classId === f.values.class);
  const save = () =>
    f.submit(async () => {
      const common = { from: f.values.from || null, to: f.values.to || null, includeEarlier: f.values.includeEarlier, includeExam: f.values.includeExam, includeOther: f.values.includeOther, issue: f.values.issue, note: f.values.note.trim() || null };
      if (f.values.mode === 'student') {
        if (!student) throw fail('Choose the student.');
        return { single: await createInvoice(role, { ...common, student: student.id }) };
      }
      if (!f.values.class && !f.values.section) throw fail('Choose a class or a section.');
      return { bulk: await createBulkInvoices(role, { ...common, class: f.values.class || null, section: f.values.section || null, onlyWithBalance: f.values.onlyWithBalance }) };
    }, onDone);
  return (
    <Modal open={open} onClose={onClose} size="lg" title={f.values.mode === 'bulk' ? 'Bulk Invoices' : 'New Invoice'} description="Each student gets their own invoice and number. Making an invoice records no payment." loading={f.saving} footer={<Footer onClose={onClose} saving={f.saving} onSave={save} label={f.values.issue ? 'Create and issue' : 'Create draft'} />}>
      <div className="flex flex-col gap-3">
        {!preset && (
          <Select label="For" value={f.values.mode} onChange={(e) => f.set('mode', e.target.value)} options={[{ value: 'student', label: 'One student' }, { value: 'bulk', label: 'A class or section (bulk)' }]} />
        )}
        {f.values.mode === 'student' ? (
          !preset && (student ? <p className="rounded-md bg-muted p-2 text-small">{student.name} · {student.studentNumber} <button type="button" className="ml-2 text-accent-fg underline" onClick={() => setStudent(null)}>Change</button></p> : <StudentPicker role={role} currency={status.currency} onPick={setStudent} autoFocus={false} />)
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select label="Class" value={f.values.class} onChange={(e) => (f.set('class', e.target.value), f.set('section', ''))} options={[{ value: '', label: 'Choose a class' }, ...status.classes.map((c) => ({ value: c.id, label: c.name }))]} />
            <Select label="Section" value={f.values.section} onChange={(e) => f.set('section', e.target.value)} options={[{ value: '', label: 'Every section' }, ...sections.map((s) => ({ value: s.id, label: `${status.classes.find((c) => c.id === s.classId)?.name ?? ''}${s.name}` }))]} />
            <Checkbox label="Only students who still owe something" checked={f.values.onlyWithBalance} onChange={(e) => f.set('onlyWithBalance', e.target.checked)} />
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="From month" value={f.values.from} onChange={(e) => f.set('from', e.target.value)} options={[{ value: '', label: 'Start of the year' }, ...months]} />
          <Select label="To month" value={f.values.to} onChange={(e) => f.set('to', e.target.value)} options={[{ value: '', label: 'Up to now' }, ...months]} />
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Checkbox label="Include earlier unpaid fees" checked={f.values.includeEarlier} onChange={(e) => f.set('includeEarlier', e.target.checked)} />
          <Checkbox label="Include examination fees" checked={f.values.includeExam} onChange={(e) => f.set('includeExam', e.target.checked)} />
          <Checkbox label="Include other charges" checked={f.values.includeOther} onChange={(e) => f.set('includeOther', e.target.checked)} />
          <Checkbox label="Issue now (gives the number)" checked={f.values.issue} onChange={(e) => f.set('issue', e.target.checked)} />
        </div>
        <Input label="Note on the invoice (optional)" value={f.values.note} onChange={(e) => f.set('note', e.target.value)} maxLength={300} />
        {f.error && <Alert variant="error">{f.error}</Alert>}
      </div>
    </Modal>
  );
}

/** School Owner: move an enrolled student to a section of another branch (their account goes with them). */
export function MoveBranchModal({ open, onClose, onDone, student, status, currentBranchId }) {
  const f = useForm(open, { section: '', reason: '' });
  const options = status.sections.filter((s) => s.branchId !== currentBranchId).map((s) => ({ value: s.id, label: `${status.branches.find((b) => b.id === s.branchId)?.name ?? ''} · ${status.classes.find((c) => c.id === s.classId)?.name ?? ''}${s.name}` }));
  const save = () =>
    f.submit(async () => {
      if (!f.values.section) throw fail('Choose the section in the other branch.');
      if (f.values.reason.trim().length < 3) throw fail('Give a reason.');
      return transferStudentBranch(student.id, { sectionId: f.values.section, reason: f.values.reason.trim() });
    }, onDone);
  return (
    <Modal open={open} onClose={onClose} title={`Move ${student?.name ?? ''} to another branch`} description="Their whole financial account goes with them: balances carry over, payments and receipts keep the branch that received them, and future fees go to the new branch." loading={f.saving} footer={<Footer onClose={onClose} saving={f.saving} onSave={save} label="Move student" />}>
      <div className="flex flex-col gap-3">
        <Select label="New section" required value={f.values.section} onChange={(e) => f.set('section', e.target.value)} placeholder="Choose a section" options={options} />
        <Textarea label="Reason" required rows={2} value={f.values.reason} onChange={(e) => f.set('reason', e.target.value)} />
        {f.error && <Alert variant="error">{f.error}</Alert>}
      </div>
    </Modal>
  );
}

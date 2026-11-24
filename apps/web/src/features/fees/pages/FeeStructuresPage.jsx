import { useEffect, useState } from 'react';
import { History, Pencil, Plus, Receipt } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ErrorState, Input, Modal, Select, Table, TableActions, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableLoading, TableRow, Textarea } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { requestFailure } from '../../../hooks/useDialogForm.js';
import { FeePage, Money, useFeeRole } from '../components/FeeShell.jsx';
import { createStructure, loadExamFees, loadStructures, saveExamFees, updateStructure } from '../data/feeApi.js';
import { dayText, fromCents, money, monthName, toCents } from '../utils/feeFormat.js';

/** Add or change a class's monthly fee (a change starts from a month not charged yet). */
function StructureModal({ role, open, onClose, onSaved, structure, data, currency }) {
  const editing = Boolean(structure);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    const nextMonth = structure?.lastChargedMonth ? data.months.find((m) => `${m.value}-01` > structure.lastChargedMonth)?.value : data.months.find((m) => m.value >= data.today.slice(0, 7))?.value;
    setForm({ class: data.classesWithout[0]?.id ?? '', monthlyFee: fromCents(structure?.monthlyFee ?? null), effectiveMonth: editing ? (nextMonth ?? '') : (data.months[0]?.value ?? ''), excluded: structure?.excludedMonths ?? [], notes: structure?.notes ?? '', reason: '', status: structure?.status ?? 'active' });
    setError('');
  }, [open, structure, data, editing]);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const save = async () => {
    const cents = toCents(form.monthlyFee);
    if (cents === null) return setError('Enter the monthly fee.');
    setSaving(true);
    setError('');
    try {
      if (editing) {
        const body = { excludedMonths: form.excluded, notes: form.notes || null, status: form.status };
        if (cents !== structure.monthlyFee || (structure.upcoming && cents !== structure.upcoming.amount)) Object.assign(body, { monthlyFee: cents, effectiveMonth: form.effectiveMonth, reason: form.reason || null });
        await updateStructure(role, structure.id, body);
      } else {
        await createStructure(role, { class: form.class, monthlyFee: cents, effectiveMonth: form.effectiveMonth, excludedMonths: form.excluded, notes: form.notes || null, academicYear: data.academicYear.id });
      }
      onSaved(editing ? `${structure.class.name}: fee structure saved.` : 'Fee structure added. Monthly fees are generated for its students.');
    } catch (e) {
      setError(requestFailure(e));
    } finally {
      setSaving(false);
    }
  };
  const charged = (m) => structure?.lastChargedMonth && `${m}-01` <= structure.lastChargedMonth;
  return (
    <Modal open={open} onClose={onClose} size="lg" title={editing ? `Edit fee structure · ${structure.class.name}` : 'Add Fee Structure'} description={`${data.academicYear?.name ?? ''}. Fees already generated keep their amounts.`} loading={saving}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Save</Button></div>}>
      <div className="flex flex-col gap-4">
        {!editing && <Select label="Class" required value={form.class} onChange={(e) => set('class', e.target.value)} options={data.classesWithout.map((c) => ({ value: c.id, label: c.name }))} placeholder="Choose a class" />}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label={`Monthly fee (${currency})`} inputMode="decimal" required value={form.monthlyFee ?? ''} onChange={(e) => set('monthlyFee', e.target.value)} />
          <Select label={editing ? 'New amount applies from' : 'Charged from'} value={form.effectiveMonth ?? ''} onChange={(e) => set('effectiveMonth', e.target.value)} options={data.months.filter((m) => !charged(m.value)).map((m) => ({ value: m.value, label: m.label }))} hint={editing ? 'Months already charged keep their amount.' : 'Students are charged from their own enrollment month.'} />
        </div>
        {editing && <Input label="Reason for the change (optional)" value={form.reason ?? ''} onChange={(e) => set('reason', e.target.value)} maxLength={300} />}
        <fieldset>
          <legend className="mb-2 text-small font-medium">Months without a monthly fee</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {data.months.map((m) => (
              <Checkbox key={m.value} label={m.label} disabled={charged(m.value)} checked={form.excluded?.includes(m.value) ?? false} onChange={(e) => set('excluded', e.target.checked ? [...form.excluded, m.value] : form.excluded.filter((x) => x !== m.value))} />
            ))}
          </div>
        </fieldset>
        {editing && <Select label="Status" value={form.status} onChange={(e) => set('status', e.target.value)} options={[{ value: 'active', label: 'Active: monthly fees are generated' }, { value: 'inactive', label: 'Inactive: no new monthly fees' }]} />}
        <Textarea label="Notes" rows={2} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} maxLength={300} />
        {editing && structure.rates.length > 0 && (
          <div>
            <p className="mb-1 inline-flex items-center gap-1.5 text-small font-medium"><History className="size-4" aria-hidden="true" />Amount history</p>
            <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle text-small">
              {structure.rates.map((r) => (
                <li key={r.id} className="flex justify-between gap-2 px-3 py-2">
                  <span>From {monthName(r.effectiveMonth)}{r.reason ? ` · ${r.reason}` : ''}</span>
                  <span className="tabular-nums">{money(r.amount, currency)} <span className="text-caption text-fg-muted">· {r.createdBy}</span></span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <Alert variant="error">{error}</Alert>}
      </div>
    </Modal>
  );
}

/** Examination fees: class × examination type for the year (empty: no fee). */
function ExamFeesCard({ role, currency, onNotice }) {
  const [version, setVersion] = useState(0);
  const data = useApiData(() => loadExamFees(role), `exam-fees|${version}`);
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (data.data) setValues(Object.fromEntries(data.data.rates.map((r) => [`${r.classId}|${r.examTypeId}`, fromCents(r.amount)])));
  }, [data.data]);
  if (data.status === 'error' && !data.data) return <ErrorState title="Examination fees could not be loaded" onRetry={data.retry} />;
  const d = data.data;
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const rates = [];
      for (const c of d.classes) for (const t of d.examTypes) {
        const key = `${c.id}|${t.id}`;
        const v = values[key];
        const had = d.rates.find((r) => r.classId === c.id && r.examTypeId === t.id);
        if ((v ?? '') === '') {
          if (had) rates.push({ class: c.id, examType: t.id, amount: null });
          continue;
        }
        const cents = toCents(v);
        if (cents === null) throw Object.assign(new Error(`${c.name} · ${t.name}: enter an amount.`), { status: 400 });
        if (!had || had.amount !== cents) rates.push({ class: c.id, examType: t.id, amount: cents });
      }
      await saveExamFees(role, { rates });
      onNotice('Examination fees saved. Students assigned to scheduled examinations are charged.');
      setVersion((n) => n + 1);
    } catch (e) {
      setError(e.status === 400 && !e.code ? e.message : requestFailure(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card as="section">
      <CardHeader title="Examination fees" description="Charged to each student when they are assigned to a scheduled examination of the type. Separate from monthly fees." action={d?.canEdit && <Button size="sm" loading={saving} onClick={save}>Save examination fees</Button>} />
      {!d ? (
        <div className="p-5"><TableLoading columns={3} /></div>
      ) : !d.examTypes.length ? (
        <p className="p-5 text-small text-fg-muted">Add examination types under Examinations → Types & Periods first.</p>
      ) : (
        <div className="overflow-x-auto px-5 pb-5 pt-3" role="region" aria-label="Examination fees" tabIndex={0}>
          <table className="w-full text-small">
            <thead>
              <tr className="text-left text-fg-muted">
                <th className="py-2 pr-3 font-medium">Class</th>
                {d.examTypes.map((t) => <th key={t.id} className="py-2 pr-3 font-medium">{t.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {d.classes.map((c) => (
                <tr key={c.id} className="border-t border-border-subtle">
                  <td className="py-2 pr-3 font-medium">{c.name}</td>
                  {d.examTypes.map((t) => {
                    const key = `${c.id}|${t.id}`;
                    return (
                      <td key={t.id} className="py-1.5 pr-3">
                        {d.canEdit ? <Input label={`${c.name} ${t.name} fee`} hideLabel size="sm" inputMode="decimal" placeholder="No fee" value={values[key] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} className="w-28" /> : <span className="tabular-nums">{values[key] ? money(toCents(values[key]), currency) : '—'}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {error && <Alert variant="error" className="mt-3">{error}</Alert>}
        </div>
      )}
    </Card>
  );
}

function Structures({ status }) {
  const role = useFeeRole();
  const [version, setVersion] = useState(0);
  const [year, setYear] = useState('');
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const data = useApiData(() => loadStructures(role, year), `structures|${year}|${version}`);
  const d = data.data;
  const currency = status.currency;
  const done = (message) => {
    setDialog(null);
    setNotice(message);
    setVersion((n) => n + 1);
  };
  return (
    <div className="flex flex-col gap-5">
      {notice && <Alert variant="success" onDismiss={() => setNotice('')}>{notice}</Alert>}
      <Card as="section" className="overflow-hidden">
        <CardHeader
          title="Monthly fees by class"
          description={d?.academicYear ? `${d.academicYear.name} · a change applies from the month you choose; months already charged keep their amounts.` : 'Fee structures belong to an academic year.'}
          action={
            <div className="flex items-center gap-2">
              <Select label="Academic year" hideLabel size="sm" value={year} onChange={(e) => setYear(e.target.value)} options={[{ value: '', label: 'Current year' }, ...status.academicYears.map((y) => ({ value: y.id, label: y.name }))]} />
              {d?.canEdit && <Button size="sm" leftIcon={Plus} disabled={!d.classesWithout.length} onClick={() => setDialog({ type: 'form' })}>Add Fee Structure</Button>}
            </div>
          }
        />
        {data.status === 'error' && !d ? (
          <ErrorState title="Fee structures could not be loaded" onRetry={data.retry} />
        ) : (
          <div className="mt-4 overflow-x-auto" role="region" aria-label="Fee structures" tabIndex={0}>
            <Table caption="Monthly fee per class">
              <TableHead>
                <TableRow interactive={false}>
                  <TableHeaderCell>#</TableHeaderCell>
                  <TableHeaderCell>Class</TableHeaderCell>
                  <TableHeaderCell align="right">Monthly fee</TableHeaderCell>
                  <TableHeaderCell align="right">Examination fee</TableHeaderCell>
                  <TableHeaderCell>Months without fee</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell align="right">Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {!d && <TableLoading columns={7} />}
                {d && !d.items.length && <TableEmpty columns={7} icon={Receipt} title="No fee structures yet" description={d.canEdit ? 'Add the monthly fee of each class. Monthly fees are then generated on the 1st of every month.' : 'Your School Owner has not set the fees yet.'} />}
                {d?.items.map((s, i) => (
                  <TableRow key={s.id}>
                    <TableCell className="tabular-nums text-fg-muted">{i + 1}</TableCell>
                    <TableCell className="font-medium">{s.class.name}</TableCell>
                    <TableCell align="right">
                      <Money value={s.monthlyFee} currency={currency} />
                      {s.upcoming && <span className="block text-caption text-fg-muted">{money(s.upcoming.amount, currency)} from {monthName(s.upcoming.effectiveMonth)}</span>}
                    </TableCell>
                    <TableCell align="right">{s.examFees.length ? s.examFees.map((e) => <span key={e.id} className="block text-small"><Money value={e.amount} currency={currency} /> <span className="text-caption text-fg-muted">{e.examType.name}</span></span>) : '—'}</TableCell>
                    <TableCell className="text-small">{s.excludedMonths.length ? s.excludedMonths.map(monthName).join(', ') : '—'}</TableCell>
                    <TableCell><Badge variant={s.status === 'active' ? 'success' : 'neutral'}>{s.status === 'active' ? 'Active' : 'Inactive'}</Badge></TableCell>
                    <TableCell align="right">
                      <TableActions>
                        {d.canEdit ? <Button size="sm" variant="outline" leftIcon={Pencil} onClick={() => setDialog({ type: 'form', structure: s })}>Edit</Button> : <span className="text-caption text-fg-muted">Charged {s.charged}</span>}
                      </TableActions>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {d && <p className="px-5 pb-4 pt-2 text-caption text-fg-muted">Today {dayText(d.today)} · students are charged from their enrollment month; individual adjustments are made on a student's account.</p>}
      </Card>
      <ExamFeesCard role={role} currency={currency} onNotice={setNotice} />
      {d?.academicYear && <StructureModal role={role} open={dialog?.type === 'form'} structure={dialog?.structure} data={d} currency={currency} onClose={() => setDialog(null)} onSaved={done} />}
    </div>
  );
}

export default function FeeStructuresPage() {
  return (
    <FeePage title="Fee Structures" description="The monthly fee of each class for the academic year, and examination fees by class and examination type.">
      {(status) => <Structures status={status} />}
    </FeePage>
  );
}

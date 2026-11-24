import { useEffect, useState } from 'react';
import { Percent, Plus } from 'lucide-react';
import { Link } from 'react-router';
import { Alert, Badge, Button, Card, Checkbox, ConfirmModal, ErrorState, Input, Modal, Select, Switch, Table, TableActions, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableLoading, TableRow, Tabs, Textarea } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { requestFailure } from '../../../hooks/useDialogForm.js';
import { ReasonModal } from '../components/FeeDialogs.jsx';
import { GiveDiscountModal } from '../components/FeeForms.jsx';
import { FeePage, Money, useFeeRole } from '../components/FeeShell.jsx';
import { createPolicy, loadPolicies, loadStudentDiscounts, revokeDiscount, setPolicyActive, updatePolicy } from '../data/feeApi.js';
import { fromCents, money, monthName, percent, toCents } from '../utils/feeFormat.js';

const KINDS = [
  { value: 'monthly', label: 'Monthly fees' },
  { value: 'exam', label: 'Examination fees' },
  { value: 'other', label: 'Other charges' },
];

/** Create or change a discount policy (School Owner). */
function PolicyModal({ role, open, onClose, onSaved, policy, status }) {
  const editing = Boolean(policy);
  const [f, setF] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF({
      name: policy?.name ?? '',
      description: policy?.description ?? '',
      category: policy?.category ?? 'discount',
      type: policy?.type ?? 'percentage',
      value: policy ? (policy.type === 'percentage' ? String(policy.value / 100) : fromCents(policy.value)) : '',
      appliesTo: policy?.appliesTo ?? ['monthly'],
      classIds: policy?.classIds ?? [],
      branchIds: policy?.branchIds ?? [],
      eligibility: policy?.eligibility ?? '',
      startDate: policy?.startDate ?? '',
      endDate: policy?.endDate ?? '',
      maxAmount: policy?.maxAmount ? fromCents(policy.maxAmount) : '',
      maxStudents: policy?.maxStudents ? String(policy.maxStudents) : '',
      combinable: policy?.combinable ?? true,
      managersAssign: policy?.managersAssign ?? true,
    });
    setError('');
  }, [open, policy]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const toggleList = (k, v, on) => set(k, on ? [...f[k], v] : f[k].filter((x) => x !== v));
  const save = async () => {
    const value = f.type === 'percentage' ? Math.round(Number.parseFloat(f.value) * 100) : toCents(f.value);
    if (!f.name.trim()) return setError('Name the policy.');
    if (!value || value <= 0 || (f.type === 'percentage' && value > 10000)) return setError(f.type === 'percentage' ? 'Enter a percentage from 0.01 to 100.' : 'Enter an amount.');
    if (!f.appliesTo.length) return setError('Choose the fees it reduces.');
    setSaving(true);
    setError('');
    try {
      const body = { name: f.name.trim(), description: f.description || null, category: f.category, type: f.type, value, appliesTo: f.appliesTo, classIds: f.classIds, branchIds: f.branchIds, eligibility: f.eligibility || null, startDate: f.startDate || null, endDate: f.endDate || null, maxAmount: f.maxAmount ? toCents(f.maxAmount) : null, maxStudents: f.maxStudents ? Number(f.maxStudents) : null, combinable: f.combinable, managersAssign: f.managersAssign };
      if (editing) await updatePolicy(role, policy.id, body);
      else await createPolicy(role, body);
      onSaved(`${body.name} was saved.`);
    } catch (e) {
      setError(requestFailure(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} size="lg" title={editing ? `Edit ${policy.name}` : 'Add Policy'} description="Managers give policies to eligible students within these limits. Discounts already applied keep their amounts." loading={saving} footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={save}>Save</Button></div>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Input label="Policy name" required value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} maxLength={60} />
        <Select label="Kind" value={f.category} onChange={(e) => set('category', e.target.value)} options={[{ value: 'discount', label: 'Discount' }, { value: 'scholarship', label: 'Scholarship' }]} />
        <Select label="Type" value={f.type} onChange={(e) => set('type', e.target.value)} options={[{ value: 'percentage', label: 'Percentage' }, { value: 'fixed', label: 'Fixed amount' }]} />
        <Input label={f.type === 'percentage' ? 'Value (%) — 100 is a full scholarship' : `Value (${status.currency})`} inputMode="decimal" required value={f.value ?? ''} onChange={(e) => set('value', e.target.value)} />
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-small font-medium">Reduces</legend>
          <div className="flex flex-wrap gap-4">{KINDS.map((k) => <Checkbox key={k.value} label={k.label} checked={f.appliesTo?.includes(k.value) ?? false} onChange={(e) => toggleList('appliesTo', k.value, e.target.checked)} />)}</div>
        </fieldset>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-small font-medium">Classes (none ticked: every class)</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{status.classes.map((c) => <Checkbox key={c.id} label={c.name} checked={f.classIds?.includes(c.id) ?? false} onChange={(e) => toggleList('classIds', c.id, e.target.checked)} />)}</div>
        </fieldset>
        {status.branches.length > 1 && (
          <fieldset className="sm:col-span-2">
            <legend className="mb-1 text-small font-medium">Branches (none ticked: every branch)</legend>
            <div className="flex flex-wrap gap-4">{status.branches.map((b) => <Checkbox key={b.id} label={b.name} checked={f.branchIds?.includes(b.id) ?? false} onChange={(e) => toggleList('branchIds', b.id, e.target.checked)} />)}</div>
          </fieldset>
        )}
        <Input label="Starts" type="date" value={f.startDate ?? ''} onChange={(e) => set('startDate', e.target.value)} />
        <Input label="Expires" type="date" value={f.endDate ?? ''} onChange={(e) => set('endDate', e.target.value)} />
        <Input label={`Most off one fee (${status.currency}, optional)`} inputMode="decimal" value={f.maxAmount ?? ''} onChange={(e) => set('maxAmount', e.target.value)} />
        <Input label="Most students at once (optional)" inputMode="numeric" value={f.maxStudents ?? ''} onChange={(e) => set('maxStudents', e.target.value)} />
        <Textarea label="Eligibility rules" rows={2} value={f.eligibility ?? ''} onChange={(e) => set('eligibility', e.target.value)} fieldClassName="sm:col-span-2" hint="Shown to Managers when they give it, e.g. 'Second and further children in the school'." />
        <div className="flex flex-col gap-3 sm:col-span-2">
          <Switch label="Can be combined with other discounts" description="Used when your school adds discounts together (Settings)." checked={Boolean(f.combinable)} onChange={(v) => set('combinable', v)} />
          <Switch label="Managers may give it" description="Off: only the School Owner gives it." checked={Boolean(f.managersAssign)} onChange={(v) => set('managersAssign', v)} />
        </div>
        {error && <Alert variant="error" className="sm:col-span-2">{error}</Alert>}
      </div>
    </Modal>
  );
}

function Policies({ status, onNotice }) {
  const role = useFeeRole();
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState(null);
  const data = useApiData(() => loadPolicies(role), `policies|${version}`);
  const d = data.data;
  const done = (message) => {
    setDialog(null);
    onNotice(message);
    setVersion((n) => n + 1);
  };
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="text-small text-fg-muted">{d ? (d.combination === 'stack' ? `Combinable discounts are added together, up to ${d.maxCombined}% of a fee.` : 'When a student holds several discounts, only the largest applies.') : ''}</p>
        {d?.canEdit && <Button size="sm" leftIcon={Plus} onClick={() => setDialog({ type: 'form' })}>Add Policy</Button>}
      </div>
      {data.status === 'error' && !d ? (
        <ErrorState title="Policies could not be loaded" onRetry={data.retry} />
      ) : (
        <div className="overflow-x-auto">
          <Table caption="Discount and scholarship policies">
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>#</TableHeaderCell>
                <TableHeaderCell>Policy name</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell align="right">Value</TableHeaderCell>
                <TableHeaderCell>Apply to</TableHeaderCell>
                <TableHeaderCell align="right">Students</TableHeaderCell>
                <TableHeaderCell align="right">Taken off</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell align="right">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!d && <TableLoading columns={9} />}
              {d && !d.items.length && <TableEmpty columns={9} icon={Percent} title="No policies yet" description={d.canEdit ? 'Add sibling discounts, scholarships and others.' : 'Your School Owner has not created any.'} />}
              {d?.items.map((p, i) => (
                <TableRow key={p.id}>
                  <TableCell className="tabular-nums text-fg-muted">{i + 1}</TableCell>
                  <TableCell className="font-medium">{p.name}{p.category === 'scholarship' && <Badge variant="accent" className="ml-2">Scholarship</Badge>}<span className="block text-caption text-fg-muted">{[p.eligibility, p.endDate ? `expires ${p.endDate}` : null, !p.managersAssign ? 'Owner only' : null].filter(Boolean).join(' · ')}</span></TableCell>
                  <TableCell>{p.type === 'percentage' ? 'Percentage' : 'Fixed amount'}</TableCell>
                  <TableCell align="right">{p.type === 'percentage' ? percent(p.value) : money(p.value, d.currency)}{p.maxAmount && <span className="block text-caption text-fg-muted">max {money(p.maxAmount, d.currency)}</span>}</TableCell>
                  <TableCell className="text-small">{p.appliesTo.map((k) => KINDS.find((x) => x.value === k)?.label).join(', ')}</TableCell>
                  <TableCell align="right" className="tabular-nums">{p.students}{p.maxStudents ? ` / ${p.maxStudents}` : ''}</TableCell>
                  <TableCell align="right"><Money value={p.totalApplied} currency={d.currency} /></TableCell>
                  <TableCell><Badge variant={p.status === 'active' ? 'success' : 'neutral'}>{p.status === 'active' ? 'Active' : 'Inactive'}</Badge></TableCell>
                  <TableCell align="right">
                    {d.canEdit && (
                      <TableActions>
                        <Button size="sm" variant="outline" onClick={() => setDialog({ type: 'form', policy: p })}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'status', policy: p })}>{p.status === 'active' ? 'Deactivate' : 'Reactivate'}</Button>
                      </TableActions>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <PolicyModal role={role} status={status} open={dialog?.type === 'form'} policy={dialog?.policy} onClose={() => setDialog(null)} onSaved={done} />
      <ConfirmModal open={dialog?.type === 'status'} onClose={() => setDialog(null)} title={`${dialog?.policy?.status === 'active' ? 'Deactivate' : 'Reactivate'} ${dialog?.policy?.name ?? ''}?`} description={dialog?.policy?.status === 'active' ? 'It stops reducing new fees. Fees already charged keep their discounts.' : 'It reduces new fees again for the students who hold it.'} confirmLabel={dialog?.policy?.status === 'active' ? 'Deactivate' : 'Reactivate'} variant={dialog?.policy?.status === 'active' ? 'danger' : 'secondary'} run={() => setPolicyActive(role, dialog.policy.id, dialog.policy.status !== 'active')} onDone={() => done('Policy status changed.')} />
    </Card>
  );
}

function StudentDiscounts({ status, onNotice, giving, setGiving }) {
  const role = useFeeRole();
  const [filters, setFilters] = useState({ status: 'active', q: '' });
  const [version, setVersion] = useState(0);
  const [revoking, setRevoking] = useState(null);
  const data = useApiData(() => loadStudentDiscounts(role, filters), `student-discounts|${JSON.stringify(filters)}|${version}`, { delayMs: filters.q ? 250 : 0 });
  const d = data.data;
  const year = status.academicYears.find((y) => y.status === 'current');
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
        <Select label="Show" size="sm" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} options={[{ value: 'active', label: 'Active discounts' }, { value: 'revoked', label: 'Revoked' }, { value: 'all', label: 'All' }]} />
        <Input label="Search" type="search" size="sm" placeholder="Student name or ID…" value={filters.q} onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} />
      </div>
      {data.status === 'error' && !d ? (
        <ErrorState title="Student discounts could not be loaded" onRetry={data.retry} />
      ) : (
        <div className="overflow-x-auto">
          <Table caption="Discounts given to students">
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>Student</TableHeaderCell>
                <TableHeaderCell>Policy</TableHeaderCell>
                <TableHeaderCell>Months</TableHeaderCell>
                <TableHeaderCell>Reason</TableHeaderCell>
                <TableHeaderCell align="right">Taken off</TableHeaderCell>
                <TableHeaderCell align="right">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!d && <TableLoading columns={6} />}
              {d && !d.items.length && <TableEmpty columns={6} icon={Percent} title="No student discounts" />}
              {d?.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell><Link to={`/fees/students/${r.student.id}`} className="font-medium hover:underline">{r.student.name}</Link><span className="block text-caption text-fg-muted">{r.student.studentNumber} · {r.student.class ?? '—'}</span></TableCell>
                  <TableCell>{r.policy.name}<span className="block text-caption text-fg-muted">{r.policy.type === 'percentage' ? percent(r.policy.value) : money(r.policy.value, d.currency)}</span></TableCell>
                  <TableCell className="text-small">{monthName(r.startMonth)} – {r.endMonth ? monthName(r.endMonth) : 'until revoked'}</TableCell>
                  <TableCell className="max-w-56 text-small">{r.reason}<span className="block text-caption text-fg-muted">by {r.assignedBy}</span></TableCell>
                  <TableCell align="right"><Money value={r.totalApplied} currency={d.currency} /></TableCell>
                  <TableCell align="right">{r.active ? status.permissions.assignDiscounts && <Button size="sm" variant="ghost" onClick={() => setRevoking(r)}>Revoke</Button> : <Badge variant="neutral" title={r.revokeReason}>Revoked</Badge>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <GiveDiscountModal role={role} open={giving} year={year} currency={status.currency} onClose={() => setGiving(false)} onDone={(r) => { setGiving(false); onNotice(`Discount given${r.changed ? `; ${r.changed} unpaid fee${r.changed === 1 ? '' : 's'} reduced` : ''}.`); setVersion((n) => n + 1); }} />
      <ReasonModal open={Boolean(revoking)} onClose={() => setRevoking(null)} title={`Revoke ${revoking?.policy.name ?? ''} for ${revoking?.student.name ?? ''}?`} description="Fees not paid at all from this month lose it. Fees already paid keep their discount." confirmLabel="Revoke" run={({ reason }) => revokeDiscount(role, revoking.id, { reason })} onDone={() => { setRevoking(null); onNotice('Discount revoked.'); setVersion((n) => n + 1); }} />
    </Card>
  );
}

export default function DiscountsPage() {
  const [tab, setTab] = useState('policies');
  const [notice, setNotice] = useState('');
  const [giving, setGiving] = useState(false);
  return (
    <FeePage title="Discounts & Scholarships" description="Policies set by the School Owner, given to eligible students. Fees show the original amount, each discount and what is payable." primaryAction={(s) => s.permissions.assignDiscounts && <Button leftIcon={Plus} onClick={() => { setTab('students'); setGiving(true); }}>Give Discount</Button>}>
      {(status) => (
        <div className="flex flex-col gap-4">
          {notice && <Alert variant="success" onDismiss={() => setNotice('')}>{notice}</Alert>}
          <Tabs id="discount-tabs" label="Discounts" value={tab} onChange={setTab} tabs={[{ value: 'policies', label: 'Discount Policies' }, { value: 'students', label: 'Student Discounts' }]} />
          {tab === 'policies' ? <Policies status={status} onNotice={setNotice} /> : <StudentDiscounts status={status} onNotice={setNotice} giving={giving} setGiving={setGiving} />}
        </div>
      )}
    </FeePage>
  );
}

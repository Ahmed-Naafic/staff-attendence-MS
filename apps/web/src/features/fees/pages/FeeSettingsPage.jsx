import { useEffect, useState } from 'react';
import { ImageUp, Play, Plus, RefreshCcw, Trash2, UserPlus } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ErrorState, Input, LoadingState, Modal, Select, Switch, Table, TableActions, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableLoading, TableRow, Tabs, Textarea } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { requestFailure } from '../../../hooks/useDialogForm.js';
import { ReasonModal } from '../components/FeeDialogs.jsx';
import { FeePage, useFeeRole } from '../components/FeeShell.jsx';
import { createAccountant, loadAccountants, loadBranding, loadFeeSettings, loadGeneration, reactivateAccountant, resetAccountantPassword, runGeneration, saveBranding, saveFeeSettings, suspendAccountant, updateAccountant } from '../data/feeApi.js';
import { dateTimeText, fromCents, money, toCents } from '../utils/feeFormat.js';

const GROUPS = [
  { key: 'general', title: 'General' },
  { key: 'payments', title: 'Payments and receipts', description: 'Cash only in this version. Every payment issues a receipt; printing is optional.' },
  { key: 'monthly', title: 'Monthly fees', description: 'Generated on the 1st of every month for enrolled students, from their enrollment month.' },
  { key: 'discounts', title: 'Adjustments and discounts' },
  { key: 'clearance', title: 'Examination fees and clearance', description: 'Examination fees are charged when students are assigned to a scheduled examination.' },
  { key: 'invoices', title: 'Invoices', description: 'Invoices have no payment deadline.' },
  { key: 'notifications', title: 'Notifications' },
];

/** The school's fee policies (School Owner edits; others read). */
function Policies({ status, onNotice }) {
  const role = useFeeRole();
  const [version, setVersion] = useState(0);
  const data = useApiData(() => loadFeeSettings(role), `fee-settings|${version}`);
  const [values, setValues] = useState({});
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data.data) setValues(data.data.effective);
  }, [data.data]);
  if (data.status === 'error' && !data.data) return <ErrorState title="Settings could not be loaded" onRetry={data.retry} />;
  if (!data.data) return <LoadingState label="Loading settings…" />;
  const d = data.data;
  const edit = d.canEdit;
  const set = (k, v) => setValues((x) => ({ ...x, [k]: v }));
  const save = async () => {
    const changed = {};
    for (const f of d.fields) if (JSON.stringify(values[f.key]) !== JSON.stringify(d.effective[f.key])) changed[f.key] = values[f.key];
    if (!Object.keys(changed).length) return onNotice('Nothing changed.');
    setSaving(true);
    setError('');
    setErrors({});
    try {
      await saveFeeSettings(role, changed);
      onNotice('Fee policies saved.');
      setVersion((n) => n + 1);
    } catch (e) {
      setErrors(e.details ?? {});
      setError(requestFailure(e));
    } finally {
      setSaving(false);
    }
  };
  const control = (f) => {
    const v = values[f.key];
    const common = { error: errors[f.key], hint: f.help };
    if (f.kind === 'boolean') return <Switch label={f.label} description={f.help} checked={Boolean(v)} disabled={!edit} onChange={(next) => set(f.key, next)} />;
    if (f.kind === 'choice') return <Select label={f.label} value={v ?? ''} disabled={!edit} onChange={(e) => set(f.key, e.target.value)} options={f.options} {...common} />;
    if (f.kind === 'roles')
      return (
        <fieldset>
          <legend className="text-small font-medium">{f.label}</legend>
          <div className="mt-1 flex flex-wrap gap-4">{f.options.map((o) => <Checkbox key={o.value} label={o.label} disabled={!edit || f.required?.includes(o.value)} checked={(v ?? []).includes(o.value)} onChange={(e) => set(f.key, e.target.checked ? [...(v ?? []), o.value] : (v ?? []).filter((x) => x !== o.value))} />)}</div>
          {f.help && <p className="mt-1 text-caption text-fg-muted">{f.help}</p>}
        </fieldset>
      );
    if (f.kind === 'money') return <Input label={`${f.label} (${values.currency})`} inputMode="decimal" disabled={!edit} value={fromCents(v)} onChange={(e) => set(f.key, toCents(e.target.value) ?? 0)} {...common} />;
    if (f.kind === 'int') return <Input label={f.label} type="number" min={f.min} max={f.max} disabled={!edit} value={v ?? ''} onChange={(e) => set(f.key, e.target.value === '' ? null : Number(e.target.value))} {...common} />;
    if (f.kind === 'month') return <Input label={f.label} type="month" disabled={!edit} value={v ?? ''} onChange={(e) => set(f.key, e.target.value || null)} {...common} />;
    return f.key === 'invoiceNote' ? <Textarea label={f.label} rows={2} disabled={!edit} value={v ?? ''} onChange={(e) => set(f.key, e.target.value)} {...common} /> : <Input label={f.label} disabled={!edit} value={v ?? ''} onChange={(e) => set(f.key, e.target.value)} {...common} />;
  };
  return (
    <div className="flex flex-col gap-5">
      {!edit && <Alert variant="info">Your School Owner sets these policies. You can read them here.</Alert>}
      <Alert variant="info" title="Late payment penalties">{d.latePenalties}</Alert>
      {GROUPS.map((g) => (
        <Card key={g.key} as="section">
          <CardHeader title={g.title} description={g.description} />
          <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
            {d.fields.filter((f) => f.group === g.key).map((f) => <div key={f.key} className={f.kind === 'roles' || f.kind === 'boolean' ? 'md:col-span-2' : ''}>{control(f)}</div>)}
          </div>
        </Card>
      ))}
      {edit && (
        <div className="sticky bottom-4 flex items-center justify-end gap-3 rounded-lg border border-border bg-elevated p-3 shadow-medium">
          {error && <span className="text-small text-error-fg">{error}</span>}
          {d.updatedBy && <span className="text-caption text-fg-muted">Last changed by {d.updatedBy} · {dateTimeText(d.updatedAt)}</span>}
          <Button loading={saving} onClick={save}>Save policies</Button>
        </div>
      )}
    </div>
  );
}

/** A picked image as a small JPEG data URL (white background, at most 360 px). */
function toJpeg(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 360 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error('That file is not an image.'));
    img.src = URL.createObjectURL(file);
  });
}

/** Receipt and invoice design: logo, name, address, contacts, footer, signature (a new version each save). */
function Branding({ onNotice }) {
  const role = useFeeRole();
  const [version, setVersion] = useState(0);
  const data = useApiData(() => loadBranding(role), `branding|${version}`);
  const [b, setB] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data.data) setB(data.data.branding);
  }, [data.data]);
  if (data.status === 'error' && !data.data) return <ErrorState title="The design could not be loaded" onRetry={data.retry} />;
  if (!b) return <LoadingState label="Loading…" />;
  const edit = data.data.canEdit;
  const set = (k, v) => setB((x) => ({ ...x, [k]: v }));
  const pick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      set('logo', await toJpeg(file));
    } catch (err) {
      setError(err.message);
    }
  };
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await saveBranding(role, { schoolName: b.schoolName, logo: b.logo, address: b.address, phone: b.phone, email: b.email, website: b.website, footer: b.footer, showSignature: b.showSignature, signatureLabel: b.signatureLabel });
      onNotice('Receipt and invoice design saved. Receipts already issued keep their design.');
      setVersion((n) => n + 1);
    } catch (e2) {
      setError(requestFailure(e2));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_22rem]">
      <Card as="section">
        <CardHeader title="Receipts and invoices" description={`Design version ${b.version}${b.createdBy ? ` · by ${b.createdBy}` : ''}. Each school has its own; issued documents keep the version they were issued with.`} />
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2">
          <div className="flex items-center gap-4 md:col-span-2">
            <span className="grid size-20 place-items-center overflow-hidden rounded-md border border-border-subtle bg-muted">{b.logo ? <img src={b.logo} alt="School logo" className="size-full object-contain" /> : <ImageUp className="size-6 text-fg-muted" aria-hidden="true" />}</span>
            {edit && (
              <div className="flex flex-wrap gap-2">
                <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border-strong px-3 text-small font-medium hover:bg-muted">
                  <ImageUp className="size-4" aria-hidden="true" />Upload logo
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={pick} />
                </label>
                {b.logo && <Button size="sm" variant="ghost" leftIcon={Trash2} onClick={() => set('logo', null)}>Remove</Button>}
              </div>
            )}
          </div>
          <Input label="School name" required disabled={!edit} value={b.schoolName ?? ''} onChange={(e) => set('schoolName', e.target.value)} />
          <Input label="Address" disabled={!edit} value={b.address ?? ''} onChange={(e) => set('address', e.target.value)} />
          <Input label="Phone" disabled={!edit} value={b.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
          <Input label="Email" disabled={!edit} value={b.email ?? ''} onChange={(e) => set('email', e.target.value)} />
          <Input label="Website" disabled={!edit} value={b.website ?? ''} onChange={(e) => set('website', e.target.value)} />
          <Input label="Signature label" disabled={!edit} value={b.signatureLabel ?? ''} onChange={(e) => set('signatureLabel', e.target.value)} />
          <Textarea label="Footer message" rows={2} disabled={!edit} value={b.footer ?? ''} onChange={(e) => set('footer', e.target.value)} fieldClassName="md:col-span-2" />
          <div className="md:col-span-2"><Switch label="Show a signature line on receipts" checked={Boolean(b.showSignature)} disabled={!edit} onChange={(v) => set('showSignature', v)} /></div>
          {error && <Alert variant="error" className="md:col-span-2">{error}</Alert>}
          {edit && <div className="md:col-span-2"><Button loading={saving} onClick={save}>Save design</Button></div>}
        </div>
      </Card>
      <Card className="p-5">
        <p className="mb-3 text-small font-semibold">Receipt preview</p>
        <div className="rounded-md border border-border bg-surface p-4 text-small shadow-subtle">
          <div className="flex items-center gap-3">
            {b.logo && <img src={b.logo} alt="" className="size-10 object-contain" />}
            <div><p className="font-semibold">{b.schoolName}</p><p className="text-caption text-fg-muted">{[b.address, b.phone].filter(Boolean).join(' · ')}</p></div>
          </div>
          <p className="mt-3 border-t border-border-subtle pt-2 text-caption font-semibold tracking-wide">PAYMENT RECEIPT · RCP-2026-00001</p>
          <p className="mt-2 flex justify-between"><span>Monthly fee · November 2026</span><span>{money(2000)}</span></p>
          <p className="mt-1 flex justify-between font-semibold"><span>Amount received</span><span>{money(2000)}</span></p>
          {b.showSignature && <p className="mt-4 border-t border-dashed border-border pt-1 text-right text-caption text-fg-muted">{b.signatureLabel || 'Signature'}</p>}
          {b.footer && <p className="mt-2 text-center text-caption text-fg-muted">{b.footer}</p>}
        </div>
      </Card>
    </div>
  );
}

/** Monthly generation: each month of the year, the runs, and a manual retry (Owner, Manager, Accountant). */
function Generation({ onNotice }) {
  const role = useFeeRole();
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState('');
  const data = useApiData(() => loadGeneration(role), `generation|${version}`);
  const d = data.data;
  const run = async (month) => {
    setBusy(month ?? 'now');
    try {
      const r = await runGeneration(role, month?.slice(0, 7));
      onNotice(r.run.status === 'succeeded' ? `Generation finished: ${r.run.created} new fee${r.run.created === 1 ? '' : 's'} (fees already charged are never charged twice).` : `Generation failed: ${r.run.error}`);
      setVersion((n) => n + 1);
    } catch (e) {
      onNotice(requestFailure(e));
    } finally {
      setBusy('');
    }
  };
  if (data.status === 'error' && !d) return <ErrorState title="Generation status could not be loaded" onRetry={data.retry} />;
  if (!d) return <LoadingState label="Loading…" />;
  const tone = { succeeded: 'success', failed: 'error', running: 'info', pending: 'neutral' };
  return (
    <div className="flex flex-col gap-5">
      <Card as="section">
        <CardHeader title="Monthly fee generation" description={`${d.academicYear?.name ?? 'No current year'} · ${d.autoGenerate ? 'automatic on the 1st of every month; failures are retried automatically and the School Owner is told if they continue.' : 'automatic generation is off: run it by hand.'}`} action={<Button size="sm" leftIcon={Play} loading={busy === 'now'} onClick={() => run(null)}>Run now</Button>} />
        <ul className="grid grid-cols-2 gap-2 p-5 sm:grid-cols-3 lg:grid-cols-6">
          {d.months.map((m) => (
            <li key={m.month} className="flex flex-col gap-1 rounded-md border border-border-subtle p-3 text-small">
              <span className="font-medium">{m.label}</span>
              <Badge variant={tone[m.status]}>{m.status === 'succeeded' ? 'Generated' : m.status === 'failed' ? 'Failed' : m.status === 'running' ? 'Running' : 'Pending'}</Badge>
              {m.lastRun && <span className="text-caption text-fg-muted">{dateTimeText(m.lastRun.startedAt)}</span>}
              {m.status !== 'succeeded' && <Button size="sm" variant="ghost" leftIcon={RefreshCcw} loading={busy === m.month} onClick={() => run(m.month)}>Retry</Button>}
            </li>
          ))}
          {!d.months.length && <li className="text-small text-fg-muted">No month to charge yet.</li>}
        </ul>
      </Card>
      <Card className="overflow-hidden">
        <CardHeader title="Attempts" description="Every generation attempt, automatic or by hand, with what it did." />
        <div className="mt-2 overflow-x-auto">
          <Table caption="Generation attempts">
            <TableHead><TableRow interactive={false}><TableHeaderCell>Started</TableHeaderCell><TableHeaderCell>Month</TableHeaderCell><TableHeaderCell>Trigger</TableHeaderCell><TableHeaderCell>Result</TableHeaderCell><TableHeaderCell align="right">Created</TableHeaderCell><TableHeaderCell>Details</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {!d.runs.length && <TableEmpty columns={6} title="No attempts yet" />}
              {d.runs.map((r) => (
                <TableRow key={r.id} interactive={false}>
                  <TableCell>{dateTimeText(r.startedAt)}</TableCell>
                  <TableCell>{r.month.slice(0, 7)}</TableCell>
                  <TableCell>{r.trigger === 'manual' ? `By hand${r.by ? ` (${r.by})` : ''}` : 'Automatic'}</TableCell>
                  <TableCell><Badge variant={tone[r.status]}>{r.status}</Badge></TableCell>
                  <TableCell align="right" className="tabular-nums">{r.created}</TableCell>
                  <TableCell className="max-w-72 text-caption text-fg-muted">{r.error ?? Object.entries(r.details ?? {}).filter(([, v]) => v).map(([k, v]) => `${k.replace(/([A-Z])/g, ' $1').toLowerCase()}: ${v}`).join(', ')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

/** Accountant accounts (School Owner): web sign-in, Fee Management of one branch. */
function Accountants({ onNotice }) {
  const [version, setVersion] = useState(0);
  const data = useApiData(() => loadAccountants(), `accountants|${version}`);
  const [dialog, setDialog] = useState(null);
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const d = data.data;
  const done = (message) => {
    setDialog(null);
    onNotice(message);
    setVersion((n) => n + 1);
  };
  const openForm = (a) => {
    setForm({ name: a?.name ?? '', email: a?.email ?? '', phone: a?.phone ?? '', branchId: a?.branch.id ?? d.branches.find((b) => b.status === 'active')?.id ?? '', password: '' });
    setError('');
    setDialog({ type: 'form', accountant: a });
  };
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      if (dialog.accountant) await updateAccountant(dialog.accountant.id, { name: form.name, email: form.email, phone: form.phone, branchId: form.branchId });
      else await createAccountant({ name: form.name, email: form.email, phone: form.phone, branchId: form.branchId, password: form.password });
      done(dialog.accountant ? 'Accountant updated.' : `Accountant created. Give ${form.name} the temporary password; they change it at first sign-in.`);
    } catch (e) {
      setError(e.details ? Object.values(e.details)[0] : requestFailure(e));
    } finally {
      setSaving(false);
    }
  };
  if (data.status === 'error' && !d) return <ErrorState title="Accountants could not be loaded" onRetry={data.retry} />;
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Accountants" description="They sign in to the web app with their email and work only in Fee Management for their branch: payments, receipts, invoices, cash closing and reports." action={d && <Button size="sm" leftIcon={UserPlus} onClick={() => openForm(null)}>Add Accountant</Button>} />
      <div className="mt-3 overflow-x-auto">
        <Table caption="Accountant accounts">
          <TableHead><TableRow interactive={false}><TableHeaderCell>Name</TableHeaderCell><TableHeaderCell>Email</TableHeaderCell><TableHeaderCell>Branch</TableHeaderCell><TableHeaderCell>Last sign-in</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell align="right">Actions</TableHeaderCell></TableRow></TableHead>
          <TableBody>
            {!d && <TableLoading columns={6} />}
            {d && !d.items.length && <TableEmpty columns={6} icon={UserPlus} title="No Accountants yet" description="Add one for each branch that takes fees." />}
            {d?.items.map((a) => (
              <TableRow key={a.id}>
                <TableCell className="font-medium">{a.name}{a.passwordChangePending && <span className="block text-caption text-fg-muted">Temporary password not changed yet</span>}</TableCell>
                <TableCell>{a.email}<span className="block text-caption text-fg-muted">{a.phone}</span></TableCell>
                <TableCell>{a.branch.name}</TableCell>
                <TableCell>{a.lastSignInAt ? dateTimeText(a.lastSignInAt) : 'Never'}</TableCell>
                <TableCell><Badge variant={a.status === 'active' ? 'success' : 'error'}>{a.status === 'active' ? 'Active' : 'Suspended'}</Badge></TableCell>
                <TableCell align="right">
                  <TableActions>
                    <Button size="sm" variant="outline" onClick={() => openForm(a)}>Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'password', accountant: a })}>New password</Button>
                    {a.status === 'active' ? <Button size="sm" variant="danger" onClick={() => setDialog({ type: 'suspend', accountant: a })}>Suspend</Button> : <Button size="sm" variant="ghost" onClick={async () => { await reactivateAccountant(a.id); done(`${a.name} reactivated.`); }}>Reactivate</Button>}
                  </TableActions>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Modal open={dialog?.type === 'form'} onClose={() => setDialog(null)} title={dialog?.accountant ? `Edit ${dialog.accountant.name}` : 'Add Accountant'} loading={saving} footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button leftIcon={Plus} loading={saving} onClick={save}>Save</Button></div>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Full name" required value={form.name ?? ''} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <Input label="Email (sign-in)" type="email" required value={form.email ?? ''} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          <Input label="Phone" value={form.phone ?? ''} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          <Select label="Branch" required value={form.branchId ?? ''} onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))} options={(d?.branches ?? []).filter((b) => b.status === 'active').map((b) => ({ value: b.id, label: b.name }))} />
          {!dialog?.accountant && <Input label="Temporary password" type="password" required value={form.password ?? ''} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} fieldClassName="sm:col-span-2" hint="They must change it at first sign-in." />}
          {error && <Alert variant="error" className="sm:col-span-2">{error}</Alert>}
        </div>
      </Modal>
      <ReasonModal open={dialog?.type === 'suspend'} onClose={() => setDialog(null)} title={`Suspend ${dialog?.accountant?.name ?? ''}?`} description="They are signed out and cannot sign in until reactivated. Their payments and closings stay." confirmLabel="Suspend" run={({ reason }) => suspendAccountant(dialog.accountant.id, reason)} onDone={() => done('Accountant suspended.')} />
      <PasswordModal accountant={dialog?.type === 'password' ? dialog.accountant : null} onClose={() => setDialog(null)} onDone={() => done('New temporary password set.')} />
    </Card>
  );
}

function PasswordModal({ accountant, onClose, onDone }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setPassword('');
    setError('');
  }, [accountant]);
  return (
    <Modal open={Boolean(accountant)} onClose={onClose} title={`New temporary password for ${accountant?.name ?? ''}`} description="Their sessions end; they change it at the next sign-in." loading={saving} footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button loading={saving} onClick={async () => { setSaving(true); try { await resetAccountantPassword(accountant.id, password); onDone(); } catch (e) { setError(e.details?.password ?? requestFailure(e)); } finally { setSaving(false); } }}>Set password</Button></div>}>
      <Input label="Temporary password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      {error && <Alert variant="error" className="mt-3">{error}</Alert>}
    </Modal>
  );
}

export default function FeeSettingsPage() {
  const [tab, setTab] = useState('policies');
  const [notice, setNotice] = useState('');
  return (
    <FeePage title="Settings" description="School fee policies, receipts and invoices, monthly generation and Accountant accounts.">
      {(status) => (
        <div className="flex flex-col gap-4">
          {notice && <Alert variant="info" onDismiss={() => setNotice('')}>{notice}</Alert>}
          <Tabs
            id="fee-settings"
            label="Fee settings"
            value={tab}
            onChange={setTab}
            tabs={[{ value: 'policies', label: 'Policies' }, { value: 'branding', label: 'Receipts & Invoices' }, { value: 'generation', label: 'Monthly Generation' }, ...(status.permissions.manageAccountants ? [{ value: 'accountants', label: 'Accountants' }] : [])]}
          />
          {tab === 'policies' && <Policies status={status} onNotice={setNotice} />}
          {tab === 'branding' && <Branding onNotice={setNotice} />}
          {tab === 'generation' && <Generation onNotice={setNotice} />}
          {tab === 'accountants' && <Accountants onNotice={setNotice} />}
        </div>
      )}
    </FeePage>
  );
}

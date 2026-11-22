import { useEffect, useState } from 'react';
import { Award, Plus } from 'lucide-react';
import { Alert, Badge, Button, Card, CardHeader, Checkbox, ConfirmModal, ErrorState, Input, LoadingState, Select, Switch, Table, TableActions, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableLoading, TableRow } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { requestFailure } from '../../../hooks/useDialogForm.js';
import { StatusBadge } from '../../classes/components/ClassModals.jsx';
import { ExamPage, useExamRole } from '../components/ExamGate.jsx';
import { ScaleModal } from '../components/ExamModals.jsx';
import { loadExamSettings, loadFormula, loadScales, saveExamSettings, saveFormula, setScaleActive } from '../data/examApi.js';
import { bandRange, checkWeights, SETTING_GROUPS } from '../utils/examRules.js';

const METHODS = [
  { value: 'WEIGHTED', label: 'Weighted by examination type', help: 'Each type counts for a share, e.g. Mid-Term 40%, Final 60%.' },
  { value: 'AVERAGE', label: 'Average of the year’s examinations', help: 'Every examination of the year counts the same.' },
  { value: 'LAST', label: 'The year’s last examination', help: 'Only the last examination of the year counts.' },
];

/** Grading scales of the school (School Owner manages; Managers read). */
function ScalesCard({ role, onNotice }) {
  const owner = role === 'OWNER';
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState(null);
  const list = useApiData(() => loadScales(role, { status: 'all' }), `scales|${version}`);
  const done = (message) => (scale) => {
    setDialog(null);
    onNotice(message(scale));
    setVersion((n) => n + 1);
  };
  const items = list.data?.items ?? [];
  return (
    <Card as="section" aria-labelledby="scales-title" className="overflow-hidden">
      <CardHeader
        title={<span id="scales-title">Grading scales</span>}
        description="How a percentage becomes a grade. The default scale is used by examination types without their own."
        action={owner && <Button size="sm" leftIcon={Plus} onClick={() => setDialog({ type: 'form' })}>Add Scale</Button>}
      />
      {list.status === 'error' && !list.data ? (
        <ErrorState title="Grading scales could not be loaded" description="Check your connection and try again." onRetry={list.retry} />
      ) : (
        <div role="region" aria-label="Grading scales" tabIndex={0} className="mt-4 overflow-x-auto">
          <Table caption="Grading scales, the default first">
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>Scale</TableHeaderCell>
                <TableHeaderCell>Grades</TableHeaderCell>
                <TableHeaderCell>Used by</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell align="right">{owner ? 'Actions' : ''}</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {!list.data && <TableLoading columns={5} />}
              {list.data && !items.length && <TableEmpty columns={5} icon={Award} title="No grading scale yet" description={owner ? 'Add your school’s grading scale. A letter scale (A–F) is filled in to start from.' : 'Your School Owner has not added a grading scale yet.'} />}
              {items.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">
                    <span className="flex flex-wrap items-center gap-2">
                      {s.name}
                      {s.isDefault && <Badge variant="info">Default</Badge>}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {s.bands.map((b) => (
                        <Badge key={b.id} variant={b.passes ? 'neutral' : 'error'}>
                          {b.label} {bandRange(b)}
                        </Badge>
                      ))}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">{s.usedByTypes ? `${s.usedByTypes} type${s.usedByTypes === 1 ? '' : 's'}` : '—'}</TableCell>
                  <TableCell><StatusBadge status={s.status} /></TableCell>
                  <TableCell align="right">
                    {owner && (
                      <TableActions>
                        <Button size="sm" variant="outline" onClick={() => setDialog({ type: 'form', scale: s })}>Edit</Button>
                        {!s.isDefault && <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'status', scale: s })}>{s.status === 'active' ? 'Deactivate' : 'Reactivate'}</Button>}
                      </TableActions>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {owner && (
        <>
          <ScaleModal role={role} scale={dialog?.scale} open={dialog?.type === 'form'} onClose={() => setDialog(null)} onSaved={done((s) => `${s.name} was saved.`)} />
          <ConfirmModal
            open={dialog?.type === 'status'}
            onClose={() => setDialog(null)}
            title={`${dialog?.scale?.status === 'active' ? 'Deactivate' : 'Reactivate'} ${dialog?.scale?.name ?? ''}?`}
            description={dialog?.scale?.status === 'active' ? 'It can no longer be chosen for examination types. Results already graded keep their grades.' : 'It can be chosen for examination types again.'}
            confirmLabel={dialog?.scale?.status === 'active' ? 'Deactivate' : 'Reactivate'}
            variant={dialog?.scale?.status === 'active' ? 'danger' : 'secondary'}
            run={() => setScaleActive(role, dialog.scale.id, dialog.scale.status !== 'active')}
            onDone={done((s) => `${s.name} is now ${s.status}.`)}
          />
        </>
      )}
    </Card>
  );
}

/** How the current year's final result is calculated (School Owner sets it; Managers read). */
function FormulaCard({ role, onNotice }) {
  const owner = role === 'OWNER';
  const [version, setVersion] = useState(0);
  const data = useApiData(() => loadFormula(role, { academicYear: 'current' }), `formula|${version}`);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!data.data) return;
    const f = data.data.formula;
    const weightOf = (list, key, id) => String(list?.find((w) => w[key] === id)?.weight ?? '');
    setForm({
      method: f?.method ?? 'WEIGHTED',
      types: data.data.types.map((t) => ({ id: t.id, name: t.name, weight: weightOf(f?.typeWeights, 'examTypeId', t.id) })),
      periods: data.data.periods.map((p) => ({ id: p.id, name: p.name, weight: weightOf(f?.periodWeights, 'periodId', p.id) })),
    });
    setError('');
  }, [data.data]);

  if (data.status === 'error' && !data.data) return <ErrorState title="The final result calculation could not be loaded" onRetry={data.retry} />;
  const year = data.data?.academicYear;
  const types = form && checkWeights(form.types, 'examTypeId');
  const periods = form && checkWeights(form.periods, 'periodId');
  const save = async () => {
    setError('');
    if (form.method === 'WEIGHTED' && (types.error || !types.weights.length)) return setError(types.error ?? 'Give each examination type its weight.');
    if (periods.error) return setError(`Periods: ${periods.error}`);
    setSaving(true);
    try {
      await saveFormula(role, 'current', { method: form.method, typeWeights: form.method === 'WEIGHTED' ? types.weights : [], periodWeights: periods.weights });
      onNotice(`The final result calculation for ${year.name} was saved.`);
      setVersion((n) => n + 1);
    } catch (failed) {
      setError(requestFailure(failed));
    } finally {
      setSaving(false);
    }
  };
  const setRow = (list, i, weight) => setForm((f) => ({ ...f, [list]: f[list].map((r, j) => (j === i ? { ...r, weight } : r)) }));
  const method = METHODS.find((m) => m.value === form?.method);

  return (
    <Card as="section" aria-labelledby="formula-title">
      <CardHeader
        title={<span id="formula-title">Final result calculation</span>}
        description={year ? `How each student’s final result for ${year.name} is calculated from its examinations. Promotion uses this result.` : 'Start an academic year first.'}
        action={data.data?.formula?.updatedBy && <span className="text-caption text-fg-muted">Last changed by {data.data.formula.updatedBy}</span>}
      />
      {!form ? (
        <LoadingState />
      ) : !year ? null : (
        <div className="flex flex-col gap-4 p-5">
          {error && <Alert variant="error">{error}</Alert>}
          <Select label="Method" options={METHODS} value={form.method} onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))} hint={method?.help} disabled={!owner} fieldClassName="sm:w-1/2" />
          {form.method === 'WEIGHTED' && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-body font-medium text-fg">Weight of each examination type (%)</legend>
              {!form.types.length && <p className="text-small text-fg-muted">Add examination types first (Types &amp; Periods).</p>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {form.types.map((t, i) => (
                  <Input key={t.id} label={t.name} inputMode="numeric" placeholder="0" value={t.weight} onChange={(e) => setRow('types', i, e.target.value)} disabled={!owner} />
                ))}
              </div>
              {form.types.length > 0 && <p className={`text-small ${types.total === 100 ? 'text-success-fg' : 'text-fg-muted'}`}>Total {types.total ?? 0}% of 100%.</p>}
            </fieldset>
          )}
          {form.periods.length > 1 && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-body font-medium text-fg">Weight of each period (%) <span className="font-normal text-fg-muted">— optional; empty means every period counts the same</span></legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {form.periods.map((p, i) => (
                  <Input key={p.id} label={p.name} inputMode="numeric" placeholder="—" value={p.weight} onChange={(e) => setRow('periods', i, e.target.value)} disabled={!owner} />
                ))}
              </div>
              {periods.weights?.length > 0 && <p className={`text-small ${periods.total === 100 ? 'text-success-fg' : 'text-fg-muted'}`}>Total {periods.total}% of 100%.</p>}
            </fieldset>
          )}
          {owner && (
            <div>
              <Button onClick={save} loading={saving}>
                Save Calculation
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

/** One setting's control. */
function SettingControl({ field, value, onChange, disabled }) {
  if (field.kind === 'boolean') return <Switch label={field.label} description={field.help} checked={Boolean(value)} onChange={onChange} disabled={disabled} />;
  if (field.kind === 'choice') return <Select label={field.label} options={field.options} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} hint={field.help} />;
  return <Input label={field.label} inputMode="numeric" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} disabled={disabled} hint={field.help ?? `${field.min}–${field.max}`} />;
}

/** Layered settings: the School Owner sets school values and what branches may set; a Manager sets only those, for their branch. */
function SettingsCard({ role, onNotice }) {
  const owner = role === 'OWNER';
  const [version, setVersion] = useState(0);
  const data = useApiData(() => loadExamSettings(role), `exam-settings|${version}`);
  const [values, setValues] = useState({});
  const [overridable, setOverridable] = useState([]);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!data.data) return;
    setValues(owner ? data.data.school.effective : data.data.branch.effective);
    setOverridable(data.data.branchOverridable);
    setErrors({});
  }, [data.data, owner]);
  if (data.status === 'error' && !data.data) return <ErrorState title="Settings could not be loaded" onRetry={data.retry} />;
  if (!data.data) return <LoadingState />;
  const s = data.data;
  const before = owner ? s.school.effective : s.branch.effective;
  const editable = (f) => owner || s.branchOverridable.includes(f.key);

  const save = async () => {
    setError('');
    const problems = {};
    const change = {};
    for (const f of s.fields) {
      if (!editable(f)) continue;
      let v = values[f.key];
      if (f.kind === 'int') {
        const n = Number(String(v).trim());
        if (!Number.isInteger(n) || n < f.min || n > f.max) {
          problems[f.key] = `A whole number from ${f.min} to ${f.max}.`;
          continue;
        }
        v = n;
      }
      if (v !== before[f.key]) change[f.key] = v;
    }
    setErrors(problems);
    if (Object.keys(problems).length) return setError('Check the highlighted settings.');
    const sameOverridable = JSON.stringify([...overridable].sort()) === JSON.stringify([...s.branchOverridable].sort());
    if (!Object.keys(change).length && (sameOverridable || !owner)) return onNotice('Nothing changed.');
    setSaving(true);
    try {
      await saveExamSettings(role, { ...(Object.keys(change).length && { values: change }), ...(owner && !sameOverridable && { branchOverridable: overridable }) });
      onNotice('Examination settings were saved.');
      setVersion((n) => n + 1);
    } catch (failed) {
      if (failed.details) setErrors(failed.details);
      setError(requestFailure(failed));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card as="section" aria-labelledby="exam-settings-title">
      <CardHeader
        title={<span id="exam-settings-title">{owner ? 'School settings' : `Settings of ${s.branch?.name ?? 'your branch'}`}</span>}
        description={owner ? 'Tick “Branches may set” to let each branch’s Manager choose that setting for their branch.' : s.branchOverridable.length ? 'You can set the settings your School Owner allows; the others come from the school.' : 'All settings come from your school. Your School Owner has not let branches set any.'}
      />
      <div className="flex flex-col gap-6 p-5">
        {error && <Alert variant="error">{error}</Alert>}
        {SETTING_GROUPS.map((g) => {
          const fields = s.fields.filter((f) => f.group === g.key);
          if (!fields.length) return null;
          return (
            <fieldset key={g.key} className="flex flex-col gap-4">
              <legend className="mb-1 text-card-title text-fg">{g.label}</legend>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {fields.map((f) => (
                  <div key={f.key} className="flex flex-col gap-1.5">
                    <SettingControl field={f} value={values[f.key]} disabled={!editable(f)} onChange={(v) => { setValues((cur) => ({ ...cur, [f.key]: v })); setErrors(({ [f.key]: _x, ...rest }) => rest); }} />
                    {errors[f.key] && <span className="text-small text-error-fg">{errors[f.key]}</span>}
                    {owner && f.branchable && (
                      <Checkbox
                        label="Branches may set"
                        checked={overridable.includes(f.key)}
                        onChange={(e) => setOverridable((cur) => (e.target.checked ? [...cur, f.key] : cur.filter((k) => k !== f.key)))}
                      />
                    )}
                    {!owner && (
                      <span className="text-caption text-fg-muted">{s.branch.sources[f.key] === 'branch' ? 'Set for your branch' : editable(f) ? 'From the school (you may change it)' : 'From the school'}</span>
                    )}
                  </div>
                ))}
              </div>
            </fieldset>
          );
        })}
        {(owner || s.branchOverridable.length > 0) && (
          <div>
            <Button onClick={save} loading={saving}>
              Save Settings
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Examinations → Settings: grading scales, the final result calculation and the layered settings. */
export default function ExamSettingsPage() {
  const role = useExamRole();
  const [notice, setNotice] = useState('');
  return (
    <ExamPage title="Examination Settings" description={role === 'OWNER' ? 'Grading, the final result, and how examinations are run.' : 'How examinations are run in your branch.'}>
      {() => (
        <>
          {notice && (
            <Alert variant="success" onDismiss={() => setNotice('')}>
              {notice}
            </Alert>
          )}
          <ScalesCard role={role} onNotice={setNotice} />
          <FormulaCard role={role} onNotice={setNotice} />
          <SettingsCard role={role} onNotice={setNotice} />
        </>
      )}
    </ExamPage>
  );
}

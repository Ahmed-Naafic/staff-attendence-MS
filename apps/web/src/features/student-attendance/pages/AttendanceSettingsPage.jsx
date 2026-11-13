import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Alert, Badge, Button, Card, Checkbox, Input, LoadingState, Select } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { formatDateTime } from '../../../lib/format.js';
import { useSession } from '../../auth';
import { loadOwnerBranches } from '../../classes/data/classesApi.js';
import { FeatureOffNotice, LoadFailure } from '../components/FeatureState.jsx';
import { loadAttendanceSettings, saveAttendanceSettings } from '../data/studentAttendanceApi.js';
import { settingsChanges } from '../utils/attendanceRules.js';

const SOURCE_LABELS = { platform: 'EduTrack default', school: 'School setting', branch: 'Branch setting' };
const UNITS = { minutes: 'minutes', days: 'days' };

const showValue = (field, value) => {
  if (field.kind === 'boolean') return value ? 'Yes' : 'No';
  if (field.kind === 'choice') return field.options.find((o) => o.value === value)?.label ?? value;
  return `${value} ${UNITS[field.kind] ?? ''}`.trim();
};

/**
 * Student attendance settings. School Owner: the school's values (empty: the EduTrack default) and
 * which ones each branch's Manager may change. Manager: their branch's values for those (empty:
 * the school's). Every value shows what applies and where it comes from.
 */
export default function AttendanceSettingsPage() {
  const { user } = useSession();
  const owner = user.role === 'OWNER';
  const role = owner ? 'OWNER' : 'MANAGER';
  const [params, setParams] = useSearchParams();
  const branch = owner ? (params.get('branch') ?? '') : '';
  const loaded = useApiData(() => loadAttendanceSettings(role, { branch }), `settings|${role}|${branch}`);
  const branches = useApiData(() => (owner ? loadOwnerBranches() : Promise.resolve([])), `branches|${role}`);
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [overridable, setOverridable] = useState([]);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  const reset = (next) => {
    setData(next);
    setForm(owner ? next.school.values : (next.branch?.values ?? {}));
    setOverridable(next.branchOverridable);
    setErrors({});
  };
  useEffect(() => {
    if (loaded.data) reset(loaded.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded.data]);

  if (!data) {
    return (
      <PageContainer>
        <PageHeader title="Attendance Settings" breadcrumbs={[{ label: 'Student Attendance', to: '/student-attendance' }, { label: 'Settings' }]} />
        {loaded.status === 'error' ? <LoadFailure error={loaded.error} onRetry={loaded.retry} owner={owner} what="Settings" /> : <LoadingState />}
      </PageContainer>
    );
  }

  const stored = owner ? data.school.values : (data.branch?.values ?? {});
  const body = settingsChanges(stored, form);
  if (owner && overridable.join() !== data.branchOverridable.join()) body.branchOverridable = overridable;
  const dirty = Object.keys(body).length > 0;
  const allowed = new Set(data.branchOverridable);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      reset(await saveAttendanceSettings(role, body));
      setMessage({ variant: 'success', text: 'Settings saved. They apply to attendance opened from now on.' });
    } catch (error) {
      setErrors(error.details ?? {});
      setMessage({ variant: 'error', text: error.message || 'The settings could not be saved.' });
    } finally {
      setSaving(false);
    }
  }

  const above = (key) => (owner ? data.platformDefaults[key] : data.school.effective[key]);
  const aboveLabel = owner ? 'EduTrack default' : 'School setting';
  const groups = [
    { title: 'Manager attendance', description: 'Taken by the branch Managers for each section.', fields: data.fields.filter((f) => !f.phase) },
    { title: 'Teacher lesson attendance', description: 'Used when teachers take attendance in their lessons on the mobile app.', fields: data.fields.filter((f) => f.phase === 'teachers') },
    { title: 'Notifications', description: 'Reminders when attendance is not taken. Each person can also turn student attendance notifications off for themselves.', fields: data.fields.filter((f) => f.phase === 'notifications') },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Attendance Settings"
        description={owner ? 'Your school’s student attendance rules, and which of them each branch’s Manager may change.' : 'Your branch’s student attendance rules. Your School Owner decides which ones you may change.'}
        breadcrumbs={[{ label: 'Student Attendance', to: '/student-attendance' }, { label: 'Settings' }]}
      />
      {!data.featureEnabled && <FeatureOffNotice owner={owner} />}
      {!owner && !data.canEdit && <Alert variant="info">Your School Owner sets every rule for all branches. They are shown here for reference.</Alert>}
      {message && (
        <Alert variant={message.variant} onDismiss={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}
      {owner && (
        <Card className="p-4">
          <Select
            label="See what applies in a branch"
            fieldClassName="max-w-sm"
            options={[{ value: '', label: 'The school' }, ...(branches.data ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))]}
            value={branch}
            onChange={(e) => setParams(e.target.value ? { branch: e.target.value } : {}, { replace: true })}
          />
        </Card>
      )}

      {groups.map((group) => (
        <Card key={group.title} as="section" aria-label={group.title} className="p-4">
          <h2 className="text-heading-sm font-semibold">{group.title}</h2>
          <p className="mb-4 text-body-sm text-fg-secondary">{group.description}</p>
          <ul className="flex flex-col divide-y divide-border">
            {group.fields.map((f) => {
              const editable = owner || allowed.has(f.key);
              const value = form[f.key] ?? null;
              const applied = branch && data.branch ? data.branch : owner ? data.school : data.branch;
              return (
                <li key={f.key} className="flex flex-col gap-3 py-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="max-w-xl">
                    <p className="font-medium">{f.label}</p>
                    {f.help && <p className="text-caption text-fg-muted">{f.help}</p>}
                    <p className="mt-1 text-caption text-fg-secondary">
                      Applies: <span className="font-medium">{showValue(f, applied.effective[f.key])}</span>
                      <Badge variant="neutral" className="ml-2">
                        {SOURCE_LABELS[applied.sources[f.key]]}
                      </Badge>
                    </p>
                    {owner && (
                      <Checkbox
                        className="mt-2"
                        label="Branch Managers may change this"
                        checked={overridable.includes(f.key)}
                        onChange={(e) => setOverridable((list) => (e.target.checked ? [...list, f.key] : list.filter((k) => k !== f.key)))}
                      />
                    )}
                  </div>
                  <div className="flex w-full flex-col gap-2 lg:w-80">
                    {editable ? (
                      <>
                        <Checkbox
                          label={`Use the ${aboveLabel.toLowerCase()} (${showValue(f, above(f.key))})`}
                          checked={value === null}
                          onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.checked ? null : above(f.key) }))}
                        />
                        {value !== null &&
                          (f.kind === 'choice' ? (
                            <Select label={f.label} hideLabel options={f.options} value={value} error={errors[f.key]} onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value }))} />
                          ) : f.kind === 'boolean' ? (
                            <Select
                              label={f.label}
                              hideLabel
                              options={[
                                { value: 'yes', label: 'Yes' },
                                { value: 'no', label: 'No' },
                              ]}
                              value={value ? 'yes' : 'no'}
                              error={errors[f.key]}
                              onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value === 'yes' }))}
                            />
                          ) : (
                            <Input
                              label={f.label}
                              hideLabel
                              type="number"
                              min={f.min}
                              max={f.max}
                              value={value}
                              hint={`${f.min}–${f.max} ${UNITS[f.kind]}`}
                              error={errors[f.key]}
                              onChange={(e) => setForm((v) => ({ ...v, [f.key]: e.target.value === '' ? null : Number(e.target.value) }))}
                            />
                          ))}
                      </>
                    ) : (
                      <p className="text-caption text-fg-muted">Set by your School Owner.</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}

      {(owner || data.canEdit) && (
        <div className="flex justify-end gap-3">
          <Button variant="outline" disabled={!dirty || saving} onClick={() => reset(data)}>
            Undo changes
          </Button>
          <Button loading={saving} disabled={!dirty} onClick={save}>
            Save settings
          </Button>
        </div>
      )}
      {(data.school.updatedBy || data.branch?.updatedBy) && (
        <p className="text-caption text-fg-muted">
          {data.school.updatedBy && `School settings last changed by ${data.school.updatedBy}, ${formatDateTime(data.school.updatedAt)}. `}
          {data.branch?.updatedBy && `${data.branch.name}: last changed by ${data.branch.updatedBy}, ${formatDateTime(data.branch.updatedAt)}.`}
        </p>
      )}
    </PageContainer>
  );
}

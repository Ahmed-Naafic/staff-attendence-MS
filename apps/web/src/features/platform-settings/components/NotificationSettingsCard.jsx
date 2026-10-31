import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { Alert, Button, Card, CardContent, CardHeader, ErrorState, Input, LoadingState, Switch } from '../../../components/ui';
import { apiRequest } from '../../../lib/api.js';
import { changedSettings, settingsForm, settingsProblems } from '../utils/notificationSettingsRules.js';

const load = (signal) => apiRequest('/platform/settings/notifications', { signal });
const save = (values) => apiRequest('/platform/settings/notifications', { method: 'PUT', body: values });

function NumberField({ name, label, hint, form, errors, onChange, disabled }) {
  return <Input label={label} type="number" inputMode="numeric" value={form[name]} hint={hint} error={errors[name]} disabled={disabled} onChange={(e) => onChange(name, e.target.value)} />;
}

/**
 * Platform notification settings (Super Admin, N5): push notifications for the Staff app,
 * which phone reminders exist, their default timing and the limits branches and staff stay within,
 * whether staff may adjust their timing, and the hour of the daily digest. Email and SMS are not
 * available (future scope, N14). Saving records one audit event listing each changed value.
 */
export function NotificationSettingsCard() {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal)
      .then((data) => {
        setState({ status: 'ready', data });
        setForm(settingsForm(data.notifications));
      })
      .catch((error) => error.name !== 'AbortError' && setState({ status: 'error', data: null }));
    return () => controller.abort();
  }, [attempt]);

  if (state.status === 'loading') return <LoadingState label="Loading notification settings…" />;
  if (state.status === 'error') {
    return (
      <Card>
        <ErrorState title="Notification settings could not be loaded" description="Check your connection and try again." onRetry={() => setAttempt((a) => a + 1)} />
      </Card>
    );
  }
  const { notifications: saved, limits } = state.data;
  const set = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setNotice(null);
  };
  const changes = changedSettings(form, saved);
  const dirty = Object.keys(changes).length > 0;

  async function submit(event) {
    event.preventDefault();
    const found = settingsProblems(form, limits);
    setErrors(found);
    if (Object.keys(found).length) return;
    if (!dirty) return setNotice({ variant: 'info', text: 'No changes to save.' });
    setSaving(true);
    try {
      const data = await save(changes);
      setState({ status: 'ready', data });
      setForm(settingsForm(data.notifications));
      setNotice({ variant: 'success', text: 'Notification settings saved.' });
    } catch (error) {
      if (error.details) setErrors(error.details);
      if (error.status !== 401) setNotice({ variant: 'error', text: error.message });
    } finally {
      setSaving(false);
    }
  }

  const field = { form, errors, onChange: set, disabled: saving };
  return (
    <form noValidate onSubmit={submit} className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
      <Card as="section" aria-labelledby="notif-channels">
        <CardHeader title={<span id="notif-channels">Channels and digests</span>} description="In-app notifications are always on. Email and SMS are not available." />
        <CardContent className="flex flex-col gap-5">
          <Switch label="Push notifications (Staff app)" description="A generic lock-screen message; the details are read in the app." checked={form.pushEnabled} onChange={(v) => set('pushEnabled', v)} disabled={saving} />
          <NumberField name="digestHour" label="Daily digest hour" hint={`${limits.digestHour.min}–${limits.digestHour.max}, in the platform time zone. The previous day's digest is created from this hour.`} {...field} />
        </CardContent>
      </Card>
      <Card as="section" aria-labelledby="notif-reminders">
        <CardHeader title={<span id="notif-reminders">Phone reminders</span>} description="Defaults and limits for branches and staff. A reminder never records attendance." />
        <CardContent className="flex flex-col gap-5">
          <Switch label="Check-in reminders" description="When a staff member arrives at their branch (OS geofence, with consent) and has not checked in. At most one per shift per day." checked={form.checkInReminderEnabled} onChange={(v) => set('checkInReminderEnabled', v)} disabled={saving} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <NumberField name="checkInLeadDefault" label="Default (min before start)" hint={`${limits.checkInLead.min}–${limits.checkInLead.max}`} {...field} />
            <NumberField name="checkInLeadMin" label="Minimum" {...field} />
            <NumberField name="checkInLeadMax" label="Maximum" {...field} />
          </div>
          <Switch label="Check-out reminders" description="Before the shift ends, after a recorded check-in, on days when check-out is used." checked={form.checkOutReminderEnabled} onChange={(v) => set('checkOutReminderEnabled', v)} disabled={saving} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <NumberField name="checkOutLeadDefault" label="Default (min before end)" hint={`${limits.checkOutLead.min}–${limits.checkOutLead.max}`} {...field} />
            <NumberField name="checkOutLeadMin" label="Minimum" {...field} />
            <NumberField name="checkOutLeadMax" label="Maximum" {...field} />
          </div>
          <Switch label="Upload reminders" description="When an event saved offline is close to the 24-hour upload limit." checked={form.uploadReminderEnabled} onChange={(v) => set('uploadReminderEnabled', v)} disabled={saving} />
          <Switch label="Staff can adjust their reminder timing" description="Within the limits above." checked={form.staffCanAdjustTiming} onChange={(v) => set('staffCanAdjustTiming', v)} disabled={saving} />
        </CardContent>
      </Card>
      <div className="flex flex-col gap-3 xl:col-span-2">
        {notice && (
          <Alert variant={notice.variant} onDismiss={() => setNotice(null)}>
            {notice.text}
          </Alert>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={!dirty || saving} onClick={() => (setForm(settingsForm(saved)), setErrors({}))}>
            Discard Changes
          </Button>
          <Button type="submit" leftIcon={Save} loading={saving}>
            Save Notification Settings
          </Button>
        </div>
      </div>
    </form>
  );
}

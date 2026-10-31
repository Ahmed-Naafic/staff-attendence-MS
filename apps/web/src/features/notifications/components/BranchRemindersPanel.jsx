import { useEffect, useState } from 'react';
import { Alert, Button, Card, CardContent, CardHeader, ErrorState, Input, LoadingState, Switch } from '../../../components/ui';
import { loadBranchReminders, saveBranchReminders } from '../data/notificationsApi.js';
import { minutesProblem } from '../utils/notificationRules.js';

const toForm = (s) => ({
  checkInReminderEnabled: s.checkInReminderEnabled,
  checkOutReminderEnabled: s.checkOutReminderEnabled,
  checkInLeadMinutes: s.checkInLeadMinutes ?? '',
  checkOutLeadMinutes: s.checkOutLeadMinutes ?? '',
});
const toBody = (f) => ({
  checkInReminderEnabled: f.checkInReminderEnabled,
  checkOutReminderEnabled: f.checkOutReminderEnabled,
  checkInLeadMinutes: f.checkInLeadMinutes === '' ? null : Number(f.checkInLeadMinutes),
  checkOutLeadMinutes: f.checkOutLeadMinutes === '' ? null : Number(f.checkOutLeadMinutes),
});

/**
 * Manager: reminder settings for the staff of their branch (N5), within the limits the platform
 * sets. Reminders are shown on the staff member's phone; they never record attendance. Read only
 * while the branch or school is suspended.
 */
export function BranchRemindersPanel() {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    loadBranchReminders(controller.signal)
      .then((data) => {
        setState({ status: 'ready', data });
        setForm(toForm(data.settings));
      })
      .catch((error) => error.name !== 'AbortError' && setState({ status: 'error', data: null }));
    return () => controller.abort();
  }, [attempt]);

  if (state.status === 'loading') return <LoadingState label="Loading reminder settings…" />;
  if (state.status === 'error') return <ErrorState title="Reminder settings could not be loaded" description="Check your connection and try again." onRetry={() => setAttempt((a) => a + 1)} />;
  const { platform, canChange } = state.data;
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  async function save(event) {
    event.preventDefault();
    const found = {
      checkInLeadMinutes: minutesProblem(form.checkInLeadMinutes, platform.checkIn),
      checkOutLeadMinutes: minutesProblem(form.checkOutLeadMinutes, platform.checkOut),
    };
    setErrors(found);
    setMessage(null);
    if (found.checkInLeadMinutes || found.checkOutLeadMinutes) return;
    setSaving(true);
    try {
      const data = await saveBranchReminders(toBody(form));
      setState({ status: 'ready', data });
      setForm(toForm(data.settings));
      setMessage({ variant: 'success', text: 'Reminder settings saved.' });
    } catch (error) {
      if (error.details) setErrors(error.details);
      if (error.status !== 401) setMessage({ variant: 'error', text: error.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card as="section" aria-labelledby="branch-reminders">
      <CardHeader
        title={<span id="branch-reminders">Reminders for your staff</span>}
        description="Phone reminders to check in and check out. A reminder never records attendance: only an accepted check-in does."
      />
      <CardContent>
        <form noValidate onSubmit={save} className="flex flex-col gap-5">
          {!canChange && <Alert variant="warning">Your branch or school is suspended. These settings can be viewed but not changed until it is reactivated.</Alert>}
          {message && (
            <Alert variant={message.variant} onDismiss={() => setMessage(null)}>
              {message.text}
            </Alert>
          )}
          <Switch
            label="Check-in reminders"
            description={platform.checkInReminderEnabled ? 'When a staff member arrives at the branch (geofence) and has not checked in, with their consent.' : 'Turned off for the whole platform.'}
            checked={form.checkInReminderEnabled && platform.checkInReminderEnabled}
            disabled={!canChange || !platform.checkInReminderEnabled}
            onChange={(v) => set('checkInReminderEnabled', v)}
          />
          <Input
            label="Earliest check-in reminder (minutes before the shift starts)"
            type="number"
            inputMode="numeric"
            value={form.checkInLeadMinutes}
            placeholder={`Platform default: ${platform.checkIn.default}`}
            hint={`From ${platform.checkIn.min} to ${platform.checkIn.max}. Empty: the platform default.`}
            error={errors.checkInLeadMinutes}
            disabled={!canChange || !form.checkInReminderEnabled}
            onChange={(e) => set('checkInLeadMinutes', e.target.value)}
          />
          <Switch
            label="Check-out reminders"
            description={platform.checkOutReminderEnabled ? 'Before the shift ends, on days when check-out is used, after a recorded check-in.' : 'Turned off for the whole platform.'}
            checked={form.checkOutReminderEnabled && platform.checkOutReminderEnabled}
            disabled={!canChange || !platform.checkOutReminderEnabled}
            onChange={(v) => set('checkOutReminderEnabled', v)}
          />
          <Input
            label="Check-out reminder (minutes before the shift ends)"
            type="number"
            inputMode="numeric"
            value={form.checkOutLeadMinutes}
            placeholder={`Platform default: ${platform.checkOut.default}`}
            hint={`From ${platform.checkOut.min} to ${platform.checkOut.max}. Empty: the platform default.`}
            error={errors.checkOutLeadMinutes}
            disabled={!canChange || !form.checkOutReminderEnabled}
            onChange={(e) => set('checkOutLeadMinutes', e.target.value)}
          />
          <div className="flex justify-end">
            <Button type="submit" loading={saving} disabled={!canChange}>
              Save reminder settings
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

import { useEffect, useRef, useState } from 'react';
import { CalendarClock, Save } from 'lucide-react';
import { Alert, Button, Card, CardContent, CardHeader, Checkbox, Input, Switch } from '../../../components/ui';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { saveScheduling } from '../data/saveScheduling.js';
import { changedValues, daysText, delayExample, delayProblem, EFFECTIVE_DELAY_MAX, EFFECTIVE_DELAY_MIN } from '../utils/schedulingRules.js';

const draftOf = (s) => ({
  effectiveDelayDays: String(s.effectiveDelayDays),
  immediateFirstSchedule: s.immediateFirstSchedule,
  immediateFirstAssignment: s.immediateFirstAssignment,
  timedChanges: Boolean(s.timedChanges),
});

/**
 * Scheduling & Assignments (Super Admin): the effective delay (1–30 calendar days, platform time
 * zone) for branch schedule changes, staff assignment changes and staff transfers, and whether a
 * branch's first schedule and a staff member's first assignments may start today. Changes are
 * saved at once by Managers and Owners and apply from 00:00 of their date. A change here applies to
 * changes saved afterwards; changes already saved keep their dates. "Allow Changes to Take Effect at
 * Their Scheduled Time" lets them choose today or a later date and a time (never in the past)
 * instead; the delay and the two switches then do not apply. The API checks everything again.
 * `settings` is `settings.scheduling` from the API.
 */
export function SchedulingSettingsCard({ settings: initial }) {
  const inputRef = useRef(null);
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(() => draftOf(initial));
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveOnce] = useState(createSingleFlight);

  // A reload replaces the form with the values in force.
  useEffect(() => {
    setSaved(initial);
    setDraft(draftOf(initial));
  }, [initial]);

  const isDirty =
    draft.effectiveDelayDays.trim() !== String(saved.effectiveDelayDays) ||
    draft.immediateFirstSchedule !== saved.immediateFirstSchedule ||
    draft.immediateFirstAssignment !== saved.immediateFirstAssignment ||
    draft.timedChanges !== Boolean(saved.timedChanges);

  function clear() {
    setError('');
    setFormError('');
    setNotice(null);
  }
  function set(key, value) {
    setDraft((d) => ({ ...d, [key]: value }));
    clear();
  }
  function discard() {
    setDraft(draftOf(saved));
    clear();
    setNotice({ variant: 'info', text: 'Changes discarded.' });
  }

  function submit(event) {
    event.preventDefault();
    return saveOnce(async () => {
      clear();
      const problem = delayProblem(draft.effectiveDelayDays);
      if (problem) {
        setError(problem);
        inputRef.current?.focus();
        return;
      }
      const values = changedValues(saved, draft);
      if (!Object.keys(values).length) {
        setDraft(draftOf(saved));
        setNotice({ variant: 'info', text: 'No changes to save.' });
        return;
      }
      setSaving(true);
      try {
        const next = await saveScheduling(values);
        setSaved(next);
        setDraft(draftOf(next));
        setNotice({
          variant: 'success',
          text: next.timedChanges
            ? 'Scheduling settings saved. Changes saved from now on take effect at the date and time chosen (today or later, never in the past); changes already saved keep their dates.'
            : `Scheduling settings saved. Changes saved from now on start ${delayExample(next.effectiveDelayDays)} at the earliest; changes already saved keep their dates.`,
        });
      } catch (failure) {
        if (failure.details?.effectiveDelayDays) {
          setError(failure.details.effectiveDelayDays);
          inputRef.current?.focus();
        } else if (failure.status === 403) {
          setFormError('Only a Super Admin can change scheduling settings.');
        } else if (failure.status !== 401) {
          // 401: the session ended and the app returns to the sign-in page.
          setFormError(failure.status === 0 ? failure.message : 'The scheduling settings could not be saved. Try again.');
        }
      } finally {
        setSaving(false);
      }
    });
  }

  const days = delayProblem(draft.effectiveDelayDays) ? saved.effectiveDelayDays : Number(draft.effectiveDelayDays);

  return (
    <Card as="section" aria-labelledby="settings-scheduling">
      <CardHeader
        titleAs="h2"
        title={<span id="settings-scheduling">Scheduling &amp; Assignments</span>}
        description="When schedule changes, staff assignment changes and staff transfers take effect."
      />
      <CardContent className="flex flex-col gap-4">
        {formError && <Alert variant="error">{formError}</Alert>}
        {notice && !formError && (
          <Alert variant={notice.variant} onDismiss={() => setNotice(null)}>
            {notice.text}
          </Alert>
        )}
        <form onSubmit={submit} noValidate className="flex flex-col gap-5">
          <Checkbox
            label="Allow Changes to Take Effect at Their Scheduled Time"
            description={
              draft.timedChanges
                ? 'ON: schedule changes, staff assignments and transfers can be scheduled for today or any later date at a chosen time (not in the past). The effective delay below does not apply.'
                : 'OFF: the effective delay below applies, and changes start at 00:00 of their date.'
            }
            checked={draft.timedChanges}
            onChange={(e) => set('timedChanges', e.target.checked)}
            disabled={saving}
          />
          <Input
            ref={inputRef}
            label="Effective delay (days)"
            type="number"
            inputMode="numeric"
            min={EFFECTIVE_DELAY_MIN}
            max={EFFECTIVE_DELAY_MAX}
            step={1}
            required
            autoComplete="off"
            value={draft.effectiveDelayDays}
            onChange={(e) => set('effectiveDelayDays', e.target.value)}
            error={error}
            hint={`Whole calendar days from ${EFFECTIVE_DELAY_MIN} to ${EFFECTIVE_DELAY_MAX}, in the platform time zone (not 24-hour periods). Default: 1 day. Managers and School Owners may still choose a later date.`}
            readOnly={saving || draft.timedChanges}
          />
          <Switch
            label="First schedule may start today"
            description={
              draft.immediateFirstSchedule
                ? "ON: a branch with no schedule in effect can start its first schedule today."
                : `OFF: a branch's first schedule also waits ${daysText(days)}.`
            }
            checked={draft.immediateFirstSchedule}
            onChange={(v) => set('immediateFirstSchedule', v)}
            disabled={saving}
          />
          <Switch
            label="First assignments may start today"
            description={
              draft.immediateFirstAssignment
                ? 'ON: a staff member with no assignments in effect can be assigned from today.'
                : `OFF: a staff member's first assignments also wait ${daysText(days)}.`
            }
            checked={draft.immediateFirstAssignment}
            onChange={(v) => set('immediateFirstAssignment', v)}
            disabled={saving}
          />
          <p className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-caption text-fg-secondary">
            <CalendarClock aria-hidden="true" className="mt-px size-4 shrink-0" />
            Changes are saved at once and shown as scheduled with their date. A change saved today starts {delayExample(days)} at the earliest; until then the
            current schedule and assignments stay in effect. Changes already saved keep their dates, and recorded attendance is never re-judged.
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={discard} disabled={!isDirty || saving}>
              Discard Changes
            </Button>
            <Button type="submit" leftIcon={Save} loading={saving}>
              Save Scheduling Settings
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

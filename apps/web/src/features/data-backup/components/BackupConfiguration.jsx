import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { Alert, Button, Card, CardContent, CardHeader, Input, Select } from '../../../components/ui';
import { saveConfiguration } from '../data/backupApi.js';
import {
  changedConfig,
  configDraft,
  configProblems,
  FREQUENCY_OPTIONS,
  hourOptions,
  monthDayOptions,
  retentionConsequences,
  weekdayOptions,
} from '../utils/backupRules.js';

/**
 * Backup Configuration: Neon's snapshot schedule (frequency, hour in UTC, day, retention up to 35
 * days) and how long manual backups are kept. Backup type is shown, not chosen: Neon makes a full
 * first snapshot and stores later scheduled ones as changes only (its incremental equivalent).
 */
export function BackupConfiguration({ configuration, timeZone, onSaved }) {
  const [saved, setSaved] = useState(configuration);
  const [draft, setDraft] = useState(() => configDraft(configuration));
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSaved(configuration);
    setDraft(configDraft(configuration));
  }, [configuration]);

  const configured = configuration.provider.configured;
  // Without Neon only the manual retention (kept by EduTrack) can be saved.
  const values = configured ? changedConfig(saved, draft) : Object.fromEntries(Object.entries(changedConfig(saved, draft)).filter(([k]) => k === 'manualRetentionDays'));
  const consequences = retentionConsequences(saved, draft);
  const set = (key) => (event) => {
    setDraft((d) => ({ ...d, [key]: event.target.value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setNotice(null);
  };

  async function submit(event) {
    event.preventDefault();
    const problems = configProblems(draft);
    setErrors(problems);
    if (Object.keys(problems).length) return;
    if (!Object.keys(values).length) {
      setNotice({ variant: 'info', text: 'No changes to save.' });
      return;
    }
    setSaving(true);
    try {
      const next = await saveConfiguration(values);
      setSaved(next);
      setDraft(configDraft(next));
      setNotice({ variant: 'success', text: 'Backup configuration saved. Existing backups keep the expiry they were created with.' });
      onSaved?.();
    } catch (failure) {
      if (failure.status === 401) return;
      if (failure.details) setErrors(failure.details);
      setNotice({ variant: 'error', text: failure.message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form noValidate onSubmit={submit} className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
      <Card as="section" aria-labelledby="backup-config-schedule">
        <CardHeader titleAs="h2" title={<span id="backup-config-schedule">Automated backups</span>} description="Neon takes these snapshots on its own schedule, in UTC." />
        <CardContent className="flex flex-col gap-4">
          {!configured && <Alert variant="warning">Backups are not configured on the server, so the schedule cannot be read or changed. See Storage Configuration.</Alert>}
          {configuration.scheduleError && <Alert variant="warning">The current schedule could not be read: {configuration.scheduleError.message}</Alert>}
          {notice && (
            <Alert variant={notice.variant} onDismiss={() => setNotice(null)}>
              {notice.text}
            </Alert>
          )}
          <Select label="Backup frequency" options={FREQUENCY_OPTIONS} value={draft.frequency} onChange={set('frequency')} disabled={!configured || saving} error={errors.frequency} />
          <Select
            label="Execution time"
            hint={`Neon's schedule is in UTC. ${timeZone && timeZone !== 'UTC' ? `The platform time zone (${timeZone}) is shown beside it.` : ''} Neon may start within the hour.`}
            options={hourOptions(timeZone)}
            value={draft.hour}
            onChange={set('hour')}
            disabled={!configured || saving}
            error={errors.hour}
          />
          {draft.frequency === 'weekly' && <Select label="Day of the week" options={weekdayOptions} value={draft.day} onChange={set('day')} disabled={!configured || saving} error={errors.day} />}
          {draft.frequency === 'monthly' && <Select label="Day of the month" hint="1 to 28, so every month has it." options={monthDayOptions} value={draft.day} onChange={set('day')} disabled={!configured || saving} error={errors.day} />}
          <Input
            label="Keep scheduled backups (days)"
            hint="1 to 35 days (Neon's limit). Older scheduled backups expire automatically."
            inputMode="numeric"
            value={draft.retentionDays}
            onChange={set('retentionDays')}
            disabled={!configured || saving}
            error={errors.retentionDays}
          />
          <div className="rounded-md border border-border bg-muted p-3 text-small text-fg-secondary">
            <p className="font-medium text-fg">Backup type</p>
            <p>Full database snapshot. Neon stores the first scheduled snapshot in full and later ones as the changes since the previous one (incremental storage); each one restores the whole database on its own.</p>
          </div>
        </CardContent>
      </Card>

      <Card as="section" aria-labelledby="backup-config-retention">
        <CardHeader titleAs="h2" title={<span id="backup-config-retention">Manual backups and retention</span>} description="How long backups made with Create Backup Now are kept." />
        <CardContent className="flex flex-col gap-4">
          <Input
            label="Keep manual backups (days)"
            hint="1 to 365 days. Neon deletes them when they expire. Protect a backup in Backup History to keep it without an expiry."
            inputMode="numeric"
            value={draft.manualRetentionDays}
            onChange={set('manualRetentionDays')}
            disabled={saving}
            error={errors.manualRetentionDays}
          />
          {consequences.length > 0 && (
            <Alert variant="warning" title="What this change means">
              <ul className="list-disc space-y-1 pl-5">
                {consequences.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            </Alert>
          )}
          <p className="text-small text-fg-muted">Safe defaults: daily at 02:00 UTC, scheduled backups kept 14 days, manual backups 30 days.</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={saving || !Object.keys(values).length} onClick={() => setDraft(configDraft(saved))}>
              Discard changes
            </Button>
            <Button type="submit" leftIcon={Save} loading={saving}>
              Save configuration
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}

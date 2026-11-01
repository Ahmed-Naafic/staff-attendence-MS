import { useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, Database, HardDrive, History, XCircle } from 'lucide-react';
import { Alert, Badge, Button, Card, CardContent, CardHeader } from '../../../components/ui';
import { formatDateTime, formatRelative } from '../../../lib/format.js';
import { formatBytes, restoreStatusOf, statusOf } from '../utils/backupRules.js';
import { CreateBackupButton } from './CreateBackupButton.jsx';

// Dates use the platform's display settings, as everywhere else in the app.
const zoned = (iso) => formatDateTime(iso);

function Stat({ icon: Icon, label, value, note, tone = 'info' }) {
  const tones = { info: 'bg-info-soft text-info-fg', success: 'bg-success-soft text-success-fg', error: 'bg-error-soft text-error-fg', neutral: 'bg-muted text-fg-secondary' };
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-md ${tones[tone]}`} aria-hidden="true">
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-caption text-fg-muted">{label}</p>
        <p className="text-section-title text-fg">{value}</p>
        {note && <p className="truncate text-caption text-fg-muted">{note}</p>}
      </div>
    </li>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5 border-b border-border-subtle py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <dt className="text-small text-fg-muted">{label}</dt>
      <dd className="text-small text-fg sm:text-right">{children}</dd>
    </div>
  );
}

/** Overview: warnings, key figures, the latest backup and restore, the schedule, Create Backup Now. */
export function BackupOverview({ overview, onChanged, onOpen }) {
  const [message, setMessage] = useState(null);
  const { stats, lastSuccessful, latest, lastRestore, schedule, nextScheduledAt, runningBackup, provider, alerts, settings } = overview;
  const createDisabled = !provider.configured ? 'Backups are not configured on the server (see Storage Configuration).' : runningBackup ? 'A backup operation is already running.' : undefined;

  return (
    <>
      {alerts.map((a) => (
        <Alert key={a.code} variant={a.level === 'error' ? 'error' : 'warning'} title={a.level === 'error' ? 'Needs attention' : 'Warning'}>
          {a.text}
        </Alert>
      ))}
      {message && (
        <Alert variant={message.variant} onDismiss={() => setMessage(null)}>
          {message.text}
        </Alert>
      )}

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Backup figures">
        <Stat icon={Database} label="Available backups" value={stats.total} note={`${stats.expired} expired`} />
        <Stat icon={CheckCircle2} label="Successful" value={stats.completed} tone="success" />
        <Stat icon={XCircle} label="Failed" value={stats.failed} tone={stats.failed ? 'error' : 'neutral'} note="Manual backups started here" />
        <Stat icon={HardDrive} label="Backup storage" value={formatBytes(stats.storageBytes)} tone="neutral" note="As reported by Neon" />
      </ul>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
        <Card as="section" aria-labelledby="backup-status">
          <CardHeader titleAs="h2" title={<span id="backup-status">Backup status</span>} description="Backups are Neon snapshots of the whole platform database." action={<CreateBackupButton disabledReason={createDisabled} manualRetentionDays={settings.manualRetentionDays} onStarted={onChanged} onMessage={setMessage} />} />
          <CardContent>
            <dl>
              <Row label="Latest backup status">
                {latest ? (
                  <span className="inline-flex items-center gap-2">
                    <Badge variant={statusOf(latest.status).variant} dot>
                      {statusOf(latest.status).label}
                    </Badge>
                    <span className="text-fg-muted">{formatRelative(latest.createdAt)}</span>
                  </span>
                ) : (
                  'No backup yet'
                )}
              </Row>
              <Row label="Last successful backup">{lastSuccessful ? `${zoned(lastSuccessful.createdAt)} (${lastSuccessful.kind === 'SCHEDULED' ? 'scheduled' : 'manual'})` : 'None'}</Row>
              <Row label="Running now">{runningBackup ? <Badge variant="info" dot>Running</Badge> : 'Nothing'}</Row>
            </dl>
          </CardContent>
        </Card>

        <Card as="section" aria-labelledby="backup-schedule">
          <CardHeader
            titleAs="h2"
            title={<span id="backup-schedule">Schedule</span>}
            description="Neon runs scheduled backups itself; no EduTrack job is involved."
            action={
              <Button variant="secondary" size="sm" leftIcon={CalendarClock} onClick={() => onOpen('configuration')}>
                Change
              </Button>
            }
          />
          <CardContent>
            <dl>
              <Row label="Current schedule">{schedule ? `${schedule.text}, kept ${schedule.retentionDays} days` : 'No schedule'}</Row>
              <Row label="Next scheduled backup">
                {nextScheduledAt ? (
                  <span className="inline-flex items-center gap-2">
                    <Badge variant="neutral" dot>
                      Scheduled
                    </Badge>
                    {zoned(nextScheduledAt)}
                  </span>
                ) : (
                  '—'
                )}
              </Row>
              <Row label="Manual backups kept">{settings.manualRetentionDays} days</Row>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card as="section" aria-labelledby="backup-last-restore">
        <CardHeader
          titleAs="h2"
          title={<span id="backup-last-restore">Most recent restore</span>}
          action={
            <Button variant="secondary" size="sm" leftIcon={History} onClick={() => onOpen('restore')}>
              Restore Management
            </Button>
          }
        />
        <CardContent>
          {lastRestore ? (
            <dl>
              <Row label="Status">
                <Badge variant={restoreStatusOf(lastRestore.status).variant} dot>
                  {restoreStatusOf(lastRestore.status).label}
                </Badge>
              </Row>
              <Row label="Started">{`${zoned(lastRestore.startedAt)} by ${lastRestore.requestedBy ?? '—'}`}</Row>
              {lastRestore.error && <Row label="Error">{lastRestore.error}</Row>}
            </dl>
          ) : (
            <p className="flex items-center gap-2 text-small text-fg-muted">
              <AlertTriangle className="size-4" aria-hidden="true" />
              No restore has been made. Rehearse one on a staged branch (Restore Management) so the procedure is known before it is needed.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

import { useEffect, useState } from 'react';
import { CalendarClock, Pencil } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Alert, Badge, Button, Card, EmptyState, ErrorState, Modal, Skeleton, Spinner } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { ScheduleEditorModal } from '../components/ScheduleEditorModal.jsx';
import { ShiftList } from '../components/ShiftList.jsx';
import { cancelScheduledSchedule, loadSchedule, loadVersions } from '../data/scheduleApi.js';
import { whenText } from '../utils/scheduleRules.js';

const NOT_OPERATING = {
  branch_suspended: 'Your branch is suspended.',
  school_suspended: 'Your school is suspended.',
};
const STATES = {
  current: { label: 'In effect', variant: 'success' },
  scheduled: { label: 'Scheduled', variant: 'warning' },
  previous: { label: 'Previous', variant: 'neutral' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
};

function VersionCard({ title, version, action }) {
  return (
    <Card as="section" aria-label={title} className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-card-title text-fg">{title}</h2>
          <p className="text-small text-fg-secondary">
            From {whenText(version)} · Check-out {version.checkOutEnabled ? 'ON' : 'OFF'} · {version.timeZone}
          </p>
        </div>
        {action}
      </div>
      <ShiftList shifts={version.shifts} />
    </Card>
  );
}

/** Every version, newest effective date first, with the period it applies (or that it was cancelled). */
function History({ version }) {
  const { status, data, retry } = useApiData(loadVersions, `versions|${version}`);
  if (!data) {
    if (status === 'loading') return <Spinner size="sm" label="Loading schedule history" />;
    return (
      <p className="text-small text-fg-muted">
        Could not load the history.{' '}
        <button type="button" onClick={retry} className="font-medium text-interactive underline">
          Try again
        </button>
      </p>
    );
  }
  return (
    <ol className="flex flex-col gap-3">
      {data.items.map((v) => (
        <li key={v.id} className="flex flex-col gap-1 rounded-md border border-border px-4 py-3 text-small">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-fg">
              {v.state === 'cancelled' ? `Was scheduled from ${whenText(v)}` : `From ${whenText(v)}${v.effectiveUntil ? ` until ${v.effectiveUntil}` : ''}`}
            </span>
            <Badge variant={STATES[v.state].variant}>{STATES[v.state].label}</Badge>
          </div>
          <p className="text-fg-secondary">
            {v.shifts.length} {v.shifts.length === 1 ? 'shift' : 'shifts'} ({v.shifts.map((s) => s.name).join(', ')}) · Check-out{' '}
            {v.checkOutEnabled ? 'ON' : 'OFF'} · {v.timeZone}
            {v.state === 'cancelled' ? ' · never applied' : ''}
          </p>
        </li>
      ))}
    </ol>
  );
}

function CancelScheduledModal({ scheduled, open, onClose, onDone }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveOnce] = useState(createSingleFlight);
  useEffect(() => {
    if (!open) return;
    setError('');
    setSaving(false);
  }, [open]);

  async function run() {
    setError('');
    setSaving(true);
    try {
      const page = await cancelScheduledSchedule();
      setSaving(false);
      onDone(page);
    } catch (failed) {
      setSaving(false);
      setError(failed.code === 'BRANCH_NOT_OPERATING' || failed.status === 404 || failed.status === 0 ? failed.message : 'The change could not be cancelled. Try again.');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Cancel Scheduled Change"
      loading={saving}
      loadingLabel="Cancelling…"
      error={error}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Keep It
          </Button>
          <Button variant="danger" onClick={() => saveOnce(run)} loading={saving}>
            Cancel Change
          </Button>
        </>
      }
    >
      <p className="text-body text-fg-secondary">
        The schedule change from <strong className="text-fg">{whenText(scheduled)}</strong> will not take effect. It stays in the history as cancelled.
      </p>
    </Modal>
  );
}

/**
 * Manager schedule: the schedule in effect, a scheduled change, and the history of versions for
 * the Manager's own branch, with Change Schedule and Cancel Scheduled Change. Read only while the
 * branch or school is suspended. Times are in the platform time zone.
 */
export default function SchedulePage() {
  const [version, setVersion] = useState(0);
  const { status, data, retry } = useApiData(loadSchedule, `schedule|${version}`);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  const blocked = data && !data.canChange ? 'The schedule cannot be changed while your branch or school is suspended.' : undefined;
  const done = (message) => () => {
    setDialog(null);
    setNotice(message);
    setVersion((n) => n + 1);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Schedule"
        description={data ? `Shifts and check-out for your branch. Times are in ${data.timeZone}; today is ${data.today}.` : 'Shifts and check-out for your branch.'}
        primaryAction={
          <Button leftIcon={Pencil} onClick={() => setDialog('edit')} unavailableReason={blocked} disabled={!data}>
            {data?.current || data?.scheduled ? 'Change Schedule' : 'Set Schedule'}
          </Button>
        }
      />

      {data && !data.canChange && (
        <Alert variant="warning" title="Read only">
          {data.notOperatingReasons.map((r) => NOT_OPERATING[r] ?? r).join(' ')} You can view the schedule and its history, but not change it until it is
          reactivated.
        </Alert>
      )}
      {notice && (
        <Alert variant="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}

      {status === 'error' && (
        <Card>
          <ErrorState title="The schedule could not be loaded" description="Check your connection and try again." onRetry={retry} />
        </Card>
      )}
      {!data && status !== 'error' && (
        <div aria-busy="true" aria-label="Loading the schedule" className="flex flex-col gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-24" />
        </div>
      )}

      {data && (
        <>
          {data.current ? (
            <VersionCard title="In effect" version={data.current} />
          ) : (
            <Card>
              <EmptyState
                icon={CalendarClock}
                title="No schedule in effect"
                description={
                  data.scheduled
                    ? `Your branch's first schedule starts on ${whenText(data.scheduled)}. Until then it has no working days.`
                    : 'Set your branch’s shifts and check-out setting. Until a schedule starts, your branch has no working days.'
                }
              />
            </Card>
          )}
          {data.scheduled && (
            <VersionCard
              title="Scheduled change"
              version={data.scheduled}
              action={
                <Button size="sm" variant="outline" onClick={() => setDialog('cancel')} unavailableReason={blocked}>
                  Cancel Scheduled Change
                </Button>
              }
            />
          )}
          <section aria-labelledby="schedule-history" className="flex flex-col gap-3">
            <h2 id="schedule-history" className="text-card-title text-fg">
              History
            </h2>
            <History version={version} />
          </section>
        </>
      )}

      <ScheduleEditorModal
        page={data}
        open={dialog === 'edit'}
        onClose={() => setDialog(null)}
        onSaved={(page) =>
          done(
            page.scheduled
              ? `The schedule change from ${whenText(page.scheduled)} is scheduled.`
              : page.current
                ? `The schedule is in effect from ${whenText(page.current)}.`
                : 'The schedule was saved.',
          )()
        }
      />
      <CancelScheduledModal scheduled={data?.scheduled} open={dialog === 'cancel'} onClose={() => setDialog(null)} onDone={done('The scheduled change was cancelled.')} />
    </PageContainer>
  );
}

import { useEffect, useState } from 'react';
import { BriefcaseBusiness, CalendarDays, Hash, KeyRound, LogIn, Mail, Phone, UserRound } from 'lucide-react';
import { Badge, Button, Drawer, Modal, Spinner } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { createSingleFlight } from '../../../lib/singleFlight.js';
import { formatUtc } from '../../branches';
import { dayList, whenText } from '../../schedules/utils/scheduleRules.js';
import { cancelScheduledAssignments, loadAssignmentHistory } from '../data/staffApi.js';
import { StaffStatusBadge } from './StaffTable.jsx';

const STATES = {
  current: { label: 'In effect', variant: 'success' },
  scheduled: { label: 'Scheduled', variant: 'warning' },
  previous: { label: 'Previous', variant: 'neutral' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
};

function Detail({ icon: Icon, label, children }) {
  return (
    <div className="flex gap-3">
      <Icon aria-hidden="true" className="mt-0.5 size-[1.125rem] shrink-0 text-fg-muted" />
      <div className="flex min-w-0 flex-col">
        <dt className="text-caption text-fg-muted">{label}</dt>
        <dd className="text-body break-words text-fg">{children || <span className="text-fg-muted">Not provided</span>}</dd>
      </div>
    </div>
  );
}

/** An assignment set's shifts: name (from the schedule on its date), hours and days. */
function SetShifts({ set }) {
  if (!set.shifts.length) return <p className="text-small text-fg-muted">No assigned shifts.</p>;
  return (
    <ul className="flex flex-col gap-1 text-small">
      {set.shifts.map((s) => (
        <li key={s.shiftKey} className="flex flex-wrap gap-x-2">
          <span className="font-medium text-fg">{s.name ?? 'Shift not in the schedule on this date'}</span>
          {s.start && <span className="tabular-nums text-fg-secondary">{`${s.start}–${s.end}`}</span>}
          <span className="text-fg-secondary">{dayList(s.days)}</span>
        </li>
      ))}
    </ul>
  );
}

function History({ staffId, version }) {
  const { status, data, retry } = useApiData(() => loadAssignmentHistory(staffId), `${staffId}|${version}`);
  if (!data) {
    if (status === 'loading') return <Spinner size="sm" label="Loading assignment history" />;
    return (
      <p className="text-small text-fg-muted">
        Could not load the history.{' '}
        <button type="button" onClick={retry} className="font-medium text-interactive underline">
          Try again
        </button>
      </p>
    );
  }
  if (!data.items.length) return <p className="text-small text-fg-muted">No shift assignments yet.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {data.items.map((set) => (
        <li key={set.id} className="flex flex-col gap-2 rounded-md border border-border px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 text-small">
            <span className="font-medium text-fg">
              {set.state === 'cancelled' ? `Was scheduled from ${whenText(set)}` : `From ${whenText(set)}${set.effectiveUntil ? ` until ${set.effectiveUntil}` : ''}`}
            </span>
            <Badge variant={STATES[set.state].variant}>{STATES[set.state].label}</Badge>
          </div>
          <SetShifts set={set} />
        </li>
      ))}
    </ol>
  );
}

function CancelScheduledModal({ staff, open, onClose, onDone }) {
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveOnce] = useState(createSingleFlight);
  useEffect(() => {
    if (!open) return;
    setError('');
    setSaving(false);
  }, [open]);
  async function run() {
    setSaving(true);
    try {
      const updated = await cancelScheduledAssignments(staff.id);
      setSaving(false);
      onDone(updated);
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
        The assignment change from <strong className="text-fg">{whenText(staff?.assignments.scheduled)}</strong> will not take effect. It stays in the history as cancelled.
      </p>
    </Modal>
  );
}

/**
 * Staff details side panel: overview, shift assignments (in effect, scheduled, history) and
 * actions. All actions are unavailable while the branch or school is suspended (`readOnly`).
 */
export function StaffDrawer({ staff, open, onClose, readOnly, version, onEdit, onAssign, onResetPassword, onSuspend, onReactivate, onCancelled }) {
  const [cancelling, setCancelling] = useState(false);
  if (!staff) return <Drawer open={false} onClose={onClose} title="" />;
  const suspended = staff.status === 'suspended';
  const blocked = readOnly ? 'Your branch or school is suspended: staff cannot be changed until it is reactivated.' : undefined;
  const { current, scheduled } = staff.assignments;

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        size="lg"
        title={staff.name}
        description={`Staff ID ${staff.staffId}`}
        header={
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-md bg-info-soft text-info-fg">
              <UserRound aria-hidden="true" className="size-5" />
            </span>
            <StaffStatusBadge status={staff.status} />
            {staff.passwordChangePending && <Badge variant="warning">Temporary password</Badge>}
          </div>
        }
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => onEdit(staff)} unavailableReason={blocked}>
              Edit Staff
            </Button>
            <Button variant="outline" onClick={() => onAssign(staff)} unavailableReason={blocked}>
              Change Assignments
            </Button>
            <Button variant="outline" leftIcon={KeyRound} onClick={() => onResetPassword(staff)} unavailableReason={blocked}>
              Reset Password
            </Button>
            {suspended ? (
              <Button variant="secondary" onClick={() => onReactivate(staff)} unavailableReason={blocked}>
                Reactivate Staff
              </Button>
            ) : (
              <Button variant="danger" onClick={() => onSuspend(staff)} unavailableReason={blocked}>
                Suspend Staff
              </Button>
            )}
          </div>
        }
      >
        {suspended && (
          <div className="mb-5 rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-small text-warning-fg">
            <p className="font-semibold">This staff member is suspended</p>
            <p>
              {staff.suspendedAt && <>Since {formatUtc(staff.suspendedAt)}. </>}Reason: {staff.suspensionReason}. They cannot sign in; the account and history
              are kept.
            </p>
          </div>
        )}

        <section aria-labelledby="staff-overview" className="mb-8">
          <h3 id="staff-overview" className="mb-4 text-card-title text-fg">
            Overview
          </h3>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
            <Detail icon={Hash} label="Staff ID">
              <span className="tabular-nums">{staff.staffId}</span>
            </Detail>
            <Detail icon={BriefcaseBusiness} label="Job title">
              {staff.jobTitle}
            </Detail>
            <Detail icon={Phone} label="Phone (sign-in)">
              <span className="tabular-nums">{staff.phone}</span>
            </Detail>
            <Detail icon={Mail} label="Email">
              {staff.email}
            </Detail>
            <Detail icon={CalendarDays} label="Created">
              {formatUtc(staff.createdAt)}
            </Detail>
            <Detail icon={LogIn} label="Last sign-in">
              {staff.lastSignInAt ? formatUtc(staff.lastSignInAt) : 'Never'}
            </Detail>
          </dl>
        </section>

        {staff.transfer && (staff.transfer.scheduledOut || staff.transfer.history.length > 0) && (
          <section aria-labelledby="staff-transfers" className="mb-8 flex flex-col gap-3">
            <h3 id="staff-transfers" className="text-card-title text-fg">
              Branch transfers
            </h3>
            {staff.transfer.scheduledOut && (
              <p className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-small text-warning-fg">
                This staff member moves to another branch of the school on {staff.transfer.scheduledOut.effectiveFrom} (decided by the School Owner). Shift
                assignments here must start before that date. Their attendance at your branch stays in your reports.
              </p>
            )}
            {staff.transfer.history.length > 0 && (
              <ul className="flex flex-col gap-1 text-small text-fg-secondary">
                {staff.transfer.history.map((h) => (
                  <li key={`${h.direction}-${h.effectiveFrom}`}>
                    {h.direction === 'in' ? `Joined your branch on ${h.effectiveFrom} (transfer).` : `Left your branch on ${h.effectiveFrom} (transfer).`}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section aria-labelledby="staff-assignments" className="mb-8 flex flex-col gap-3">
          <h3 id="staff-assignments" className="text-card-title text-fg">
            Shift assignments
          </h3>
          <p className="text-small text-fg-muted">Dates are in {staff.assignments.timeZone}.</p>
          {current ? (
            <div className="flex flex-col gap-2 rounded-md border border-border px-4 py-3">
              <p className="text-small font-medium text-fg">In effect since {whenText(current)}</p>
              <SetShifts set={current} />
            </div>
          ) : (
            <p className="text-small text-fg-muted">No assignments in effect.</p>
          )}
          {scheduled && (
            <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-warning-fg">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-small font-medium">Scheduled from {whenText(scheduled)}</p>
                <Button size="sm" variant="outline" onClick={() => setCancelling(true)} unavailableReason={blocked}>
                  Cancel Scheduled Change
                </Button>
              </div>
              <SetShifts set={scheduled} />
            </div>
          )}
          <h4 className="mt-2 text-label text-fg">History</h4>
          <History staffId={staff.id} version={version} />
        </section>
      </Drawer>
      <CancelScheduledModal
        staff={staff}
        open={cancelling}
        onClose={() => setCancelling(false)}
        onDone={(updated) => {
          setCancelling(false);
          onCancelled(updated);
        }}
      />
    </>
  );
}

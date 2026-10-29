import { Building2, CalendarDays, Hash, MapPin, Phone } from 'lucide-react';
import { Badge, Button, Drawer, Spinner } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { loadBranchHistory, loadLocations } from '../data/loadBranches.js';
import { formatPosition, formatUtc } from '../utils/branchRules.js';
import { BranchStatusBadge } from './BranchStatusBadge.jsx';

const ACTIONS = {
  BRANCH_CREATED: 'Branch created',
  BRANCH_UPDATED: 'Details updated',
  BRANCH_SUSPENDED: 'Branch suspended',
  BRANCH_REACTIVATED: 'Branch reactivated',
  BRANCH_LOCATION_CHANGED: 'Location changed',
  BRANCH_LOCATION_CHANGE_CANCELLED: 'Scheduled location change cancelled',
  BRANCH_SCHEDULE_CHANGED: 'Schedule changed (by the Manager)',
  BRANCH_SCHEDULE_CHANGE_CANCELLED: 'Scheduled schedule change cancelled (by the Manager)',
};
const LOCATION_STATES = {
  current: { label: 'In force', variant: 'success' },
  scheduled: { label: 'Scheduled', variant: 'warning' },
  previous: { label: 'Previous', variant: 'neutral' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
};

function Detail({ icon: Icon, label, children, wide = false }) {
  return (
    <div className={wide ? 'flex gap-3 sm:col-span-2' : 'flex gap-3'}>
      <Icon aria-hidden="true" className="mt-0.5 size-[1.125rem] shrink-0 text-fg-muted" />
      <div className="flex min-w-0 flex-col">
        <dt className="text-caption text-fg-muted">{label}</dt>
        <dd className="text-body break-words text-fg">{children || <span className="text-fg-muted">Not provided</span>}</dd>
      </div>
    </div>
  );
}

function Notice({ title, children }) {
  return (
    <div className="mb-5 rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-small text-warning-fg">
      <p className="font-semibold">{title}</p>
      <p>{children}</p>
    </div>
  );
}

function Loading({ status, label, onRetry }) {
  if (status === 'loading') return <Spinner size="sm" label={label} />;
  return (
    <p className="text-small text-fg-muted">
      {label.replace('Loading', 'Could not load')}.{' '}
      <button type="button" onClick={onRetry} className="font-medium text-interactive underline">
        Try again
      </button>
    </p>
  );
}

/** The branch's locations, newest effective time first, each with the period it applies. */
function LocationHistory({ branchId, version }) {
  const { status, data, retry } = useApiData(() => loadLocations(branchId), `${branchId}|${version}`);
  if (!data) return <Loading status={status} label="Loading location history" onRetry={retry} />;
  return (
    <ol className="flex flex-col gap-3">
      {data.map((l) => (
        <li key={l.id} className="flex flex-col gap-1 rounded-md border border-border px-4 py-3 text-small">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular-nums font-medium text-fg">{formatPosition(l)}</span>
            <span className="text-fg-muted">±{l.accuracyMeters} m</span>
            <Badge variant={LOCATION_STATES[l.state].variant}>{LOCATION_STATES[l.state].label}</Badge>
          </div>
          <p className="text-fg-secondary">
            {l.state === 'cancelled'
              ? `Was scheduled for ${formatUtc(l.effectiveFrom)}; cancelled ${formatUtc(l.cancelledAt)}. Never applied.`
              : `From ${formatUtc(l.effectiveFrom)}${l.effectiveUntil ? ` until ${formatUtc(l.effectiveUntil)}` : ''}.`}
          </p>
        </li>
      ))}
    </ol>
  );
}

/** Audit history of this branch (the owner's school only; no network or browser details). */
function BranchHistory({ branchId, version }) {
  const { status, data, retry } = useApiData(() => loadBranchHistory(branchId), `${branchId}|${version}`);
  if (!data) return <Loading status={status} label="Loading history" onRetry={retry} />;
  if (!data.items.length) return <p className="text-small text-fg-muted">No recorded changes yet.</p>;
  return (
    <ol className="flex flex-col gap-3">
      {data.items.map((event) => (
        <li key={event.id} className="flex flex-col gap-1 border-l-2 border-border pl-3 text-small">
          <p className="font-medium text-fg">{ACTIONS[event.action] ?? event.action}</p>
          <p className="text-fg-muted">
            {event.actor.name} · <time dateTime={event.occurredAt}>{formatUtc(event.occurredAt)}</time>
          </p>
          <p className="text-fg-secondary">{event.description}</p>
          {(event.change?.fields ?? []).length > 0 && (
            <dl className="mt-1 flex flex-col gap-0.5">
              {event.change.fields.map((item) => (
                <div key={item.field} className="flex flex-wrap gap-x-2">
                  <dt className="text-fg-muted">{item.field}:</dt>
                  <dd className="wrap-anywhere text-fg">
                    {item.from ?? '—'} <span aria-hidden="true">→</span>
                    <span className="sr-only">changed to</span> {item.to}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * Branch details side panel: overview, operating state, location (in force, scheduled, history)
 * and audit history. Actions open their own dialogs; all are unavailable while the school is
 * suspended (`readOnly`), when branch records can be viewed but not changed.
 */
export function BranchDrawer({ branch, open, onClose, readOnly, version, onEdit, onChangeLocation, onCancelScheduled, onSuspend, onReactivate }) {
  if (!branch) return <Drawer open={false} onClose={onClose} title="" />;
  const suspended = branch.status === 'suspended';
  const blocked = readOnly ? 'Your school is suspended: branches cannot be changed until it is reactivated.' : undefined;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="lg"
      title={branch.name}
      description={`Branch code ${branch.code}`}
      header={
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-info-soft text-info-fg">
            <Building2 aria-hidden="true" className="size-5" />
          </span>
          <BranchStatusBadge status={branch.status} />
          <Badge variant={branch.operating.operating ? 'success' : 'neutral'}>{branch.operating.operating ? 'Operating' : 'Not operating'}</Badge>
        </div>
      }
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => onEdit(branch)} unavailableReason={blocked}>
            Edit Branch
          </Button>
          <Button variant="outline" leftIcon={MapPin} onClick={() => onChangeLocation(branch)} unavailableReason={blocked}>
            Change Location
          </Button>
          {suspended ? (
            <Button variant="secondary" onClick={() => onReactivate(branch)} unavailableReason={blocked}>
              Reactivate Branch
            </Button>
          ) : (
            <Button variant="danger" onClick={() => onSuspend(branch)} unavailableReason={blocked}>
              Suspend Branch
            </Button>
          )}
        </div>
      }
    >
      {suspended && (
        <Notice title="This branch is suspended">
          {branch.suspendedAt && <>Since {formatUtc(branch.suspendedAt)}. </>}Reason: {branch.suspensionReason}. New check-ins are refused; records are kept.
        </Notice>
      )}
      {branch.operating.reasons.includes('school_suspended') && (
        <Notice title="Your school is suspended">No branch operates while the school is suspended. This branch keeps its own status.</Notice>
      )}

      <section aria-labelledby="branch-overview" className="mb-8">
        <h3 id="branch-overview" className="mb-4 text-card-title text-fg">
          Overview
        </h3>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
          <Detail icon={Building2} label="Branch name">
            {branch.name}
          </Detail>
          <Detail icon={Hash} label="Branch code">
            <span className="tabular-nums">{branch.code}</span>
          </Detail>
          <Detail icon={Phone} label="Phone">
            {branch.phone && <span className="tabular-nums">{branch.phone}</span>}
          </Detail>
          <Detail icon={CalendarDays} label="Created">
            {formatUtc(branch.createdAt)}
          </Detail>
          <Detail icon={MapPin} label="Address" wide>
            {`${branch.address}, ${branch.city}`}
          </Detail>
        </dl>
      </section>

      <section aria-labelledby="branch-location" className="mb-8 flex flex-col gap-3">
        <h3 id="branch-location" className="text-card-title text-fg">
          Location
        </h3>
        <p className="text-small text-fg-muted">Check-ins must be within 100 m of the location in force at the time. Times are in UTC.</p>
        {branch.scheduledLocation && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-small text-warning-fg">
            <span>
              Scheduled: {formatPosition(branch.scheduledLocation)} from {formatUtc(branch.scheduledLocation.effectiveFrom)}.
            </span>
            <Button size="sm" variant="outline" onClick={() => onCancelScheduled(branch)} unavailableReason={blocked}>
              Cancel Scheduled Change
            </Button>
          </div>
        )}
        <LocationHistory branchId={branch.id} version={version} />
      </section>

      <section aria-labelledby="branch-history" className="flex flex-col gap-3">
        <h3 id="branch-history" className="text-card-title text-fg">
          History
        </h3>
        <BranchHistory branchId={branch.id} version={version} />
      </section>
    </Drawer>
  );
}

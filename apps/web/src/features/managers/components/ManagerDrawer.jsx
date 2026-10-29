import { ArrowRightLeft, Building2, CalendarDays, KeyRound, LogIn, Mail, Phone, UserCog } from 'lucide-react';
import { Badge, Button, Drawer, Spinner } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { formatUtc } from '../../branches';
import { loadManagerHistory } from '../data/loadManagers.js';
import { branchLabel } from '../utils/managerRules.js';
import { ManagerStatusBadge } from './ManagerStatusBadge.jsx';

const ACTIONS = {
  MANAGER_CREATED: 'Manager created',
  MANAGER_UPDATED: 'Details updated',
  MANAGER_TRANSFERRED: 'Transferred',
  MANAGER_SUSPENDED: 'Manager suspended',
  MANAGER_REACTIVATED: 'Manager reactivated',
  MANAGER_PASSWORD_RESET: 'New temporary password set',
  PASSWORD_CHANGED: 'Temporary password changed by the Manager',
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

/** Branch assignments, newest first, each with its period (times in UTC). */
function Assignments({ items }) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((a) => (
        <li key={a.id} className="flex flex-col gap-1 rounded-md border border-border px-4 py-3 text-small">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-fg">{branchLabel(a.branch)}</span>
            {a.endedAt ? <Badge variant="neutral">Previous</Badge> : <Badge variant="success">Current</Badge>}
          </div>
          <p className="text-fg-secondary">{a.endedAt ? `From ${formatUtc(a.startedAt)} until ${formatUtc(a.endedAt)}.` : `Since ${formatUtc(a.startedAt)}.`}</p>
        </li>
      ))}
    </ol>
  );
}

/** Audit history of this Manager (the owner's school only; no network or browser details). */
function ManagerHistory({ managerId, version }) {
  const { status, data, retry } = useApiData(() => loadManagerHistory(managerId), `${managerId}|${version}`);
  if (!data) {
    if (status === 'loading') return <Spinner size="sm" label="Loading history" />;
    return (
      <p className="text-small text-fg-muted">
        Could not load history.{' '}
        <button type="button" onClick={retry} className="font-medium text-interactive underline">
          Try again
        </button>
      </p>
    );
  }
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
        </li>
      ))}
    </ol>
  );
}

/**
 * Manager details side panel: overview, current branch, assignment history and audit history.
 * Actions open their own dialogs; all are unavailable while the school is suspended (`readOnly`).
 */
export function ManagerDrawer({ manager, open, onClose, readOnly, version, onEdit, onTransfer, onResetPassword, onSuspend, onReactivate }) {
  if (!manager) return <Drawer open={false} onClose={onClose} title="" />;
  const suspended = manager.status === 'suspended';
  const blocked = readOnly ? 'Your school is suspended: Managers cannot be changed until it is reactivated.' : undefined;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="lg"
      title={manager.name}
      description={manager.email}
      header={
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-info-soft text-info-fg">
            <UserCog aria-hidden="true" className="size-5" />
          </span>
          <ManagerStatusBadge status={manager.status} />
          {manager.passwordChangePending && <Badge variant="warning">Temporary password</Badge>}
        </div>
      }
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => onEdit(manager)} unavailableReason={blocked}>
            Edit Manager
          </Button>
          <Button variant="outline" leftIcon={ArrowRightLeft} onClick={() => onTransfer(manager)} unavailableReason={blocked}>
            Transfer
          </Button>
          <Button variant="outline" leftIcon={KeyRound} onClick={() => onResetPassword(manager)} unavailableReason={blocked}>
            Reset Password
          </Button>
          {suspended ? (
            <Button variant="secondary" onClick={() => onReactivate(manager)} unavailableReason={blocked}>
              Reactivate Manager
            </Button>
          ) : (
            <Button variant="danger" onClick={() => onSuspend(manager)} unavailableReason={blocked}>
              Suspend Manager
            </Button>
          )}
        </div>
      }
    >
      {suspended && (
        <Notice title="This Manager is suspended">
          {manager.suspendedAt && <>Since {formatUtc(manager.suspendedAt)}. </>}Reason: {manager.suspensionReason}. They cannot sign in; the account
          and history are kept.
        </Notice>
      )}
      {manager.passwordChangePending && !suspended && (
        <Notice title="Temporary password">The Manager must choose a new password at their next sign-in before they can do anything else.</Notice>
      )}

      <section aria-labelledby="manager-overview" className="mb-8">
        <h3 id="manager-overview" className="mb-4 text-card-title text-fg">
          Overview
        </h3>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
          <Detail icon={Mail} label="Email">
            {manager.email}
          </Detail>
          <Detail icon={Phone} label="Phone">
            <span className="tabular-nums">{manager.phone}</span>
          </Detail>
          <Detail icon={Building2} label="Branch" wide>
            {branchLabel(manager.branch)}
            {manager.branch.status === 'suspended' && <span className="text-fg-muted"> · suspended branch</span>}
          </Detail>
          <Detail icon={CalendarDays} label="Created">
            {formatUtc(manager.createdAt)}
          </Detail>
          <Detail icon={LogIn} label="Last sign-in">
            {manager.lastSignInAt ? formatUtc(manager.lastSignInAt) : 'Never'}
          </Detail>
        </dl>
      </section>

      <section aria-labelledby="manager-assignments" className="mb-8 flex flex-col gap-3">
        <h3 id="manager-assignments" className="text-card-title text-fg">
          Branch assignments
        </h3>
        <Assignments items={manager.assignments} />
      </section>

      <section aria-labelledby="manager-history" className="flex flex-col gap-3">
        <h3 id="manager-history" className="text-card-title text-fg">
          History
        </h3>
        <ManagerHistory managerId={manager.id} version={version} />
      </section>
    </Drawer>
  );
}

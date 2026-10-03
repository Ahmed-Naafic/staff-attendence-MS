import { Building2, CircleCheck, CircleX, Settings, UserRound } from 'lucide-react';
import { Avatar, Drawer } from '../../../components/ui';
import { cn } from '../../../lib/cn.js';
import { formatDateTime } from '../../../lib/format.js';
import { actionOf, outcomeOf, targetTypes } from '../utils/auditTypes.js';
import { AuditAction, ResultBadge, RoleBadge } from './AuditBadges.jsx';

const targetIcons = { school: Building2, owner: UserRound, system: Settings };

function Section({ id, title, hideTitle = false, children }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-b border-border-subtle pb-5 last:border-b-0 last:pb-0">
      <h3 id={id} className={hideTitle ? 'sr-only' : 'text-card-title text-fg'}>
        {title}
      </h3>
      {children}
    </section>
  );
}

function Detail({ label, children }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-start gap-x-3 max-sm:grid-cols-1 max-sm:gap-y-0.5">
      <dt className="text-small text-fg-muted">{label}</dt>
      <dd className="text-small break-words text-fg">{children}</dd>
    </div>
  );
}

/**
 * Read-only details of one audit event: who, when, from where, what it affected and what changed.
 * No actions: audit events cannot be edited, deleted, retried or undone.
 */
export function AuditEventDrawer({ event, open, onClose }) {
  if (!event) return <Drawer open={false} onClose={onClose} title="" />;

  const failed = event.result === 'failure';
  const OutcomeIcon = failed ? CircleX : CircleCheck;
  const TargetIcon = targetIcons[event.target.type] ?? Settings;
  const { target, change } = event;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Log Details"
      header={
        <div className="flex items-start gap-3">
          <span
            className={cn(
              'grid size-10 shrink-0 place-items-center rounded-md',
              failed ? 'bg-error-soft text-error-fg' : 'bg-success-soft text-success-fg',
            )}
          >
            <OutcomeIcon aria-hidden="true" className="size-5" />
          </span>
          <div className="flex min-w-0 flex-col">
            <p className="text-card-title text-fg">{actionOf(event.action).label}</p>
            <p className="text-small text-fg-secondary">{outcomeOf(event)}</p>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Section id="audit-event" title="Event" hideTitle>
          <dl className="flex flex-col gap-3">
            <Detail label="Date & Time">
              <time dateTime={event.occurredAt} className="tabular-nums">
                {formatDateTime(event.occurredAt)}
              </time>
            </Detail>
            <Detail label="User">
              <span className="inline-flex items-center gap-2">
                <Avatar name={event.actor.name} size="sm" decorative />
                {event.actor.name}
              </span>
            </Detail>
            <Detail label="Role">
              <RoleBadge role={event.actor.role} />
            </Detail>
            <Detail label="IP Address">
              <span className="tabular-nums">{event.context.ipAddress}</span>
            </Detail>
            <Detail label="Status">
              <ResultBadge result={event.result} />
            </Detail>
          </dl>
        </Section>

        <Section id="audit-target" title="Target Information">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-info-soft text-info-fg">
              <TargetIcon aria-hidden="true" className="size-5" />
            </span>
            <dl className="flex min-w-0 flex-1 flex-col gap-3">
              <Detail label="Type">{targetTypes[target.type] ?? target.type}</Detail>
              <Detail label="Name">{target.name}</Detail>
              {target.code && (
                <Detail label="School code">
                  <span className="tabular-nums">{target.code}</span>
                </Detail>
              )}
              {target.location && <Detail label="Location">{target.location}, Somalia</Detail>}
              {target.schoolName && <Detail label="School">{target.schoolName}</Detail>}
            </dl>
          </div>
        </Section>

        <Section id="audit-details" title="Details">
          <dl className="flex flex-col gap-3">
            <Detail label="Action">
              <AuditAction event={event} />
            </Detail>
            <Detail label="Description">{event.description}</Detail>
            {change && (
              <>
                <Detail label={`Previous ${change.field.toLowerCase()}`}>{change.from ?? 'None (new record)'}</Detail>
                <Detail label={`New ${change.field.toLowerCase()}`}>{change.to}</Detail>
              </>
            )}
          </dl>
        </Section>

        <Section id="audit-context" title="Additional Information">
          <dl className="flex flex-col gap-3">
            <Detail label="Browser">{event.context.browser}</Detail>
            <Detail label="Device">{event.context.device}</Detail>
          </dl>
        </Section>
      </div>
    </Drawer>
  );
}

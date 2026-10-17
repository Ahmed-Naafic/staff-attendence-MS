import { CalendarDays, Hash, Landmark, LogIn, Mail, MapPin, Phone, UserRound } from 'lucide-react';
import { Avatar, Button, Drawer, LinkButton } from '../../../components/ui';
import { formatDate, formatRelative } from '../../../lib/format.js';
import { SchoolStatusBadge } from '../../schools';
import { OwnerStatusBadge } from './OwnerStatusBadge.jsx';

const statusText = {
  active: 'The account is active: the owner can sign in.',
  suspended: 'The account is suspended: the owner cannot sign in until it is reactivated.',
};

function Section({ id, title, action, children }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 border-b border-border-subtle pb-5 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between gap-3">
        <h3 id={id} className="text-card-title text-fg">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Detail({ icon: Icon, label, children }) {
  return (
    <div className="grid grid-cols-[1.25rem_7.5rem_minmax(0,1fr)] items-start gap-x-2 gap-y-0.5 max-sm:grid-cols-[1.25rem_minmax(0,1fr)]">
      <Icon aria-hidden="true" className="mt-0.5 size-[1.125rem] text-fg-muted" />
      <dt className="text-small text-fg-muted">{label}</dt>
      <dd className="text-small break-words text-fg max-sm:col-start-2">{children}</dd>
    </div>
  );
}

/**
 * School owner details side panel (Overview). Super Admins edit the owner and suspend or
 * reactivate the account from here (the actions open their own dialogs). The assigned school is
 * shown but cannot be changed; "View School" opens it.
 */
export function OwnerDrawer({ owner, open, onClose, onEdit, onSuspend, onReactivate }) {
  if (!owner) return <Drawer open={false} onClose={onClose} title="" />;
  const suspended = owner.status === 'suspended';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={owner.name}
      description="School Owner"
      header={
        <div className="flex items-center gap-3">
          <Avatar name={owner.name} size="lg" decorative />
          <div className="flex flex-col items-start gap-1">
            <OwnerStatusBadge status={owner.status} />
            <span className="text-caption text-fg-muted">
              {owner.lastSignInAt ? (
                <>
                  Last sign-in: <time dateTime={owner.lastSignInAt}>{formatRelative(owner.lastSignInAt)}</time>
                </>
              ) : (
                'Not signed in yet'
              )}
            </span>
          </div>
        </div>
      }
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => onEdit(owner)}>
            Edit Owner
          </Button>
          {suspended ? (
            <Button variant="secondary" onClick={() => onReactivate(owner)}>
              Reactivate Owner
            </Button>
          ) : (
            <Button variant="danger" onClick={() => onSuspend(owner)}>
              Suspend Owner
            </Button>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Section
          id="owner-personal"
          title="Personal Information"
          action={
            <Button variant="outline" size="sm" onClick={() => onEdit(owner)} aria-label="Edit personal information">
              Edit
            </Button>
          }
        >
          <dl className="flex flex-col gap-3">
            <Detail icon={UserRound} label="Full name">
              {owner.name}
            </Detail>
            <Detail icon={Mail} label="Email">
              {owner.email}
            </Detail>
            <Detail icon={Phone} label="Phone">
              {owner.phone ? <span className="tabular-nums">{owner.phone}</span> : <span className="text-fg-muted">Not provided</span>}
            </Detail>
          </dl>
        </Section>

        <Section
          id="owner-school"
          title="School Information"
          action={
            owner.school && (
              <LinkButton to={`/schools/${owner.school.id}`} size="sm" variant="outline" aria-label={`View school ${owner.school.name}`}>
                View School
              </LinkButton>
            )
          }
        >
          {owner.school ? (
            <dl className="flex flex-col gap-3">
              <Detail icon={Landmark} label="School name">
                {owner.school.name}
              </Detail>
              <Detail icon={Hash} label="School code">
                {owner.school.code}
              </Detail>
              <Detail icon={MapPin} label="Location">
                {owner.school.location}, Somalia
              </Detail>
              <Detail icon={Landmark} label="School status">
                <SchoolStatusBadge status={owner.school.status} />
              </Detail>
            </dl>
          ) : (
            <p className="text-small text-fg-muted">No school is linked to this account.</p>
          )}
        </Section>

        <Section id="owner-status" title="Account Status" action={<OwnerStatusBadge status={owner.status} />}>
          <p className="text-small text-fg-secondary">{statusText[owner.status] ?? ''}</p>
          {suspended && (
            <div className="rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-small text-warning-fg">
              <p className="font-semibold">This owner is suspended</p>
              <p>
                {owner.suspendedAt && (
                  <>
                    Since <time dateTime={owner.suspendedAt}>{formatDate(owner.suspendedAt)}</time>.{' '}
                  </>
                )}
                Reason: {owner.suspensionReason}
              </p>
            </div>
          )}
          <dl className="flex flex-col gap-3">
            <Detail icon={CalendarDays} label="Account created">
              <time dateTime={owner.registeredAt}>{formatDate(owner.registeredAt)}</time>
            </Detail>
            <Detail icon={LogIn} label="Last sign-in">
              {owner.lastSignInAt ? <time dateTime={owner.lastSignInAt}>{formatDate(owner.lastSignInAt)}</time> : 'Not signed in yet'}
            </Detail>
          </dl>
        </Section>
      </div>
    </Drawer>
  );
}

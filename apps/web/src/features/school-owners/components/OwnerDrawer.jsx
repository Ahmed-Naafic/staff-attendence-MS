import { CalendarDays, Landmark, Mail, MapPin, Phone, UserRound } from 'lucide-react';
import { Avatar, Button, Drawer, LinkButton } from '../../../components/ui';
import { formatDate, formatRelative } from '../../../lib/format.js';
import { OwnerStatusBadge } from './OwnerStatusBadge.jsx';

export const UNAVAILABLE_REASON = 'Not available yet: waiting for approved business rules.';

// Plain description of each status, without implying rules that are not approved.
const statusText = {
  active: 'Account is active.',
  pending: 'Account is not active yet.',
  suspended: 'Account is suspended.',
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
 * School owner details side panel (Overview). Access and activity views belong to later
 * phases; management actions are shown but unavailable. "View school" opens the school.
 */
export function OwnerDrawer({ owner, open, onClose }) {
  if (!owner) return <Drawer open={false} onClose={onClose} title="" />;

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
        <div className="flex w-full flex-col gap-3">
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" unavailableReason={UNAVAILABLE_REASON}>
              Edit Owner
            </Button>
            {owner.status === 'active' && (
              <Button variant="danger" unavailableReason={UNAVAILABLE_REASON}>
                Suspend Owner
              </Button>
            )}
          </div>
          <p className="text-right text-caption text-fg-muted">Editing and suspension open once their rules are approved.</p>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Section
          id="owner-personal"
          title="Personal Information"
          action={
            <Button variant="outline" size="sm" unavailableReason={UNAVAILABLE_REASON} aria-label="Edit personal information">
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
              <span className="tabular-nums">{owner.phone}</span>
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
              <Detail icon={MapPin} label="Location">
                {owner.school.location}, Somalia
              </Detail>
              <Detail icon={CalendarDays} label="Registered">
                <time dateTime={owner.school.registeredAt}>{formatDate(owner.school.registeredAt)}</time>
              </Detail>
            </dl>
          ) : (
            <p className="text-small text-fg-muted">No school is linked to this account.</p>
          )}
        </Section>

        <Section id="owner-status" title="Account Status" action={<OwnerStatusBadge status={owner.status} />}>
          <p className="text-small text-fg-secondary">{statusText[owner.status] ?? ''}</p>
        </Section>
      </div>
    </Drawer>
  );
}

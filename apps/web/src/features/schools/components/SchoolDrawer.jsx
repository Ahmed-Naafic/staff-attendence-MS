import { CalendarDays, FileText, Globe, Hash, Landmark, Mail, MapPin, Phone, UserRound } from 'lucide-react';
import { Button, Drawer } from '../../../components/ui';
import { formatDate } from '../../../lib/format.js';
import { SchoolStatusBadge } from './SchoolStatusBadge.jsx';

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

/**
 * School details side panel (Overview). Super Admins edit the school and suspend or reactivate it
 * from here (the actions open their own dialogs). Owner management is not part of this panel.
 */
export function SchoolDrawer({ school, open, onClose, onEdit, onSuspend, onReactivate }) {
  if (!school) return <Drawer open={false} onClose={onClose} title="" />;
  const suspended = school.status === 'suspended';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={school.name}
      description={`School code ${school.code}`}
      header={
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-info-soft text-info-fg">
            <Landmark aria-hidden="true" className="size-5" />
          </span>
          <SchoolStatusBadge status={school.status} />
        </div>
      }
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => onEdit(school)}>
            Edit School
          </Button>
          {suspended ? (
            <Button variant="secondary" onClick={() => onReactivate(school)}>
              Reactivate School
            </Button>
          ) : (
            <Button variant="danger" onClick={() => onSuspend(school)}>
              Suspend School
            </Button>
          )}
        </div>
      }
    >
      {suspended && (
        <div className="mb-5 rounded-md border border-warning/40 bg-warning-soft px-4 py-3 text-small text-warning-fg">
          <p className="font-semibold">This school is suspended</p>
          <p>
            {school.suspendedAt && (
              <>
                Since <time dateTime={school.suspendedAt}>{formatDate(school.suspendedAt)}</time>.{' '}
              </>
            )}
            Reason: {school.suspensionReason}
          </p>
        </div>
      )}
      <h3 className="mb-4 text-card-title text-fg">Overview</h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
        <Detail icon={Landmark} label="School name">
          {school.name}
        </Detail>
        <Detail icon={Hash} label="School code">
          {school.code}
        </Detail>
        <Detail icon={UserRound} label="Owner">
          {school.ownerName ?? 'No owner linked yet'}
        </Detail>
        <Detail icon={CalendarDays} label="Registered">
          <time dateTime={school.registeredAt}>{formatDate(school.registeredAt)}</time>
        </Detail>
        <Detail icon={Phone} label="Phone">
          {school.phone && <span className="tabular-nums">{school.phone}</span>}
        </Detail>
        <Detail icon={Mail} label="Email">
          {school.email}
        </Detail>
        <Detail icon={MapPin} label="Address" wide>
          {[school.address, `${school.location}, Somalia`].filter(Boolean).join(', ')}
        </Detail>
        <Detail icon={Globe} label="Website" wide>
          {school.website && (
            <a href={school.website} target="_blank" rel="noopener noreferrer" className="text-interactive underline">
              {school.website}
            </a>
          )}
        </Detail>
        <Detail icon={FileText} label="Description" wide>
          {school.description && <span className="whitespace-pre-line">{school.description}</span>}
        </Detail>
      </dl>
    </Drawer>
  );
}

import { CalendarDays, FileText, Hash, Landmark, MapPin, UserRound } from 'lucide-react';
import { Button, Drawer } from '../../../components/ui';
import { formatDate } from '../../../lib/format.js';
import { SchoolStatusBadge } from './SchoolStatusBadge.jsx';

export const UNAVAILABLE_REASON = 'Not available yet: waiting for approved business rules.';

function Detail({ icon: Icon, label, children, wide = false }) {
  return (
    <div className={wide ? 'flex gap-3 sm:col-span-2' : 'flex gap-3'}>
      <Icon aria-hidden="true" className="mt-0.5 size-[1.125rem] shrink-0 text-fg-muted" />
      <div className="flex min-w-0 flex-col">
        <dt className="text-caption text-fg-muted">{label}</dt>
        <dd className="text-body text-fg">{children}</dd>
      </div>
    </div>
  );
}

/**
 * School details side panel (Overview). Owner, branch, settings and history views belong to
 * later phases; management actions are shown but unavailable.
 */
export function SchoolDrawer({ school, open, onClose }) {
  if (!school) return <Drawer open={false} onClose={onClose} title="" />;

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
        <div className="flex w-full flex-col gap-3">
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" unavailableReason={UNAVAILABLE_REASON}>
              Edit School
            </Button>
            {school.status === 'pending' && (
              <Button variant="primary" unavailableReason={UNAVAILABLE_REASON}>
                Approve School
              </Button>
            )}
            {school.status === 'active' && (
              <Button variant="danger" unavailableReason={UNAVAILABLE_REASON}>
                Suspend School
              </Button>
            )}
          </div>
          <p className="text-right text-caption text-fg-muted">
            Editing, approval and suspension open once their rules are approved.
          </p>
        </div>
      }
    >
      <h3 className="mb-4 text-card-title text-fg">Overview</h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
        <Detail icon={Landmark} label="School name">
          {school.name}
        </Detail>
        <Detail icon={Hash} label="School code">
          {school.code}
        </Detail>
        <Detail icon={UserRound} label="Owner">
          {school.ownerName}
        </Detail>
        <Detail icon={MapPin} label="Location">
          {school.location}, Somalia
        </Detail>
        <Detail icon={CalendarDays} label="Registered">
          <time dateTime={school.registeredAt}>{formatDate(school.registeredAt)}</time>
        </Detail>
        <Detail icon={FileText} label="Description" wide>
          {school.description}
        </Detail>
      </dl>
    </Drawer>
  );
}

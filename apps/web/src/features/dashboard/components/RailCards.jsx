import {
  Activity,
  ChartColumn,
  CircleCheck,
  CircleOff,
  MapPin,
  Palette,
  PenLine,
  Plus,
  Settings,
  SquarePlus,
  UserRoundCheck,
  UserRoundPen,
  UserRoundPlus,
  UserRoundX,
  Users,
} from 'lucide-react';
import { Card, CardContent, CardHeader, EmptyState, LinkButton } from '../../../components/ui';
import { cn } from '../../../lib/cn.js';
import { formatRelative } from '../../../lib/format.js';
import { ViewAllLink } from './ViewAllLink.jsx';

// Presentation for platform activity types (the events come from audit data later).
const activityTypes = {
  SCHOOL_CREATED: { label: 'School registered', icon: SquarePlus, tile: 'bg-success-soft text-success-fg' },
  SCHOOL_REACTIVATED: { label: 'School reactivated', icon: CircleCheck, tile: 'bg-success-soft text-success-fg' },
  OWNER_CREATED: { label: 'Owner account created', icon: UserRoundPlus, tile: 'bg-warning-soft text-warning-fg' },
  OWNER_UPDATED: { label: 'Owner details updated', icon: UserRoundPen, tile: 'bg-info-soft text-info-fg' },
  OWNER_SUSPENDED: { label: 'Owner suspended', icon: UserRoundX, tile: 'bg-error-soft text-error-fg' },
  OWNER_REACTIVATED: { label: 'Owner reactivated', icon: UserRoundCheck, tile: 'bg-success-soft text-success-fg' },
  SCHOOL_SUSPENDED: { label: 'School suspended', icon: CircleOff, tile: 'bg-error-soft text-error-fg' },
  SCHOOL_UPDATED: { label: 'School profile updated', icon: PenLine, tile: 'bg-info-soft text-info-fg' },
  BRANDING_UPDATED: { label: 'Platform name changed', icon: Palette, tile: 'bg-info-soft text-info-fg' },
  GENERAL_SETTINGS_UPDATED: { label: 'General settings changed', icon: Settings, tile: 'bg-info-soft text-info-fg' },
};

export function RecentActivityCard({ activity }) {
  return (
    <Card className="h-full">
      <CardHeader
        titleAs="h2"
        title="Recent Platform Activity"
        action={<ViewAllLink to="/audit-logs" context="platform activity in the audit logs" />}
      />
      <CardContent>
        {activity.length === 0 ? (
          <EmptyState compact icon={Activity} title="No activity yet" description="Platform actions will appear here." />
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle">
            {activity.map((item) => {
              const type = activityTypes[item.type] ?? { label: item.type, icon: Activity, tile: 'bg-muted text-fg-secondary' };
              const Icon = type.icon;
              return (
                <li key={item.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className={cn('grid size-9 shrink-0 place-items-center rounded-md', type.tile)}>
                    <Icon aria-hidden="true" className="size-[1.125rem]" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-small font-medium text-fg">{type.label}</span>
                    <span className="truncate text-caption text-fg-muted">{item.subject}</span>
                  </div>
                  <time dateTime={item.occurredAt} className="shrink-0 text-caption text-fg-muted">
                    {formatRelative(item.occurredAt)}
                  </time>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Shortcuts into approved Super Admin areas only (no branch, manager, staff or attendance actions). */
export function QuickActionsCard() {
  const actions = [
    { to: '/schools', label: 'Register New School', icon: Plus, variant: 'primary' },
    { to: '/school-owners', label: 'Manage School Owners', icon: Users },
    { to: '/platform-reports', label: 'View Platform Reports', icon: ChartColumn },
  ];
  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title="Quick Actions" />
      <CardContent>
        <ul className="flex flex-col gap-2.5">
          {actions.map((action) => (
            <li key={action.label}>
              <LinkButton
                to={action.to}
                variant={action.variant ?? 'outline'}
                leftIcon={action.icon}
                className="w-full justify-start"
              >
                {action.label}
              </LinkButton>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Schools per city, ranked. Stands in for the reference's map (approved alternative). */
export function SchoolsByLocationCard({ locations }) {
  const max = Math.max(1, ...locations.map((l) => l.count));
  return (
    <Card className="h-full">
      <CardHeader titleAs="h2" title="Schools by Location" />
      <CardContent>
        {locations.length === 0 ? (
          <EmptyState compact icon={MapPin} title="No locations yet" description="Locations appear once schools join." />
        ) : (
          <ol className="flex flex-col gap-3">
            {locations.map((location, index) => (
              <li key={location.location} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3 text-small">
                  <span className="flex items-center gap-2 text-fg">
                    <MapPin aria-hidden="true" className="size-3.5 text-fg-muted" />
                    {location.location}
                  </span>
                  <span className="font-semibold text-fg tabular-nums">
                    {location.count}
                    <span className="sr-only"> {location.count === 1 ? 'school' : 'schools'}</span>
                  </span>
                </div>
                <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-pill bg-muted">
                  <span
                    className="block h-full rounded-pill"
                    style={{
                      width: `${(location.count / max) * 100}%`,
                      backgroundColor: index === 0 ? 'var(--color-accent)' : 'var(--color-chart-1)',
                    }}
                  />
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

import { Activity, Database, Download, Eraser, RotateCcw, RotateCw, TriangleAlert, Wrench } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader } from '../../../components/ui';
import { UNAVAILABLE } from '../utils/settingsOptions.js';

const NOT_CONNECTED = 'Not connected yet';

/** Live service status needs the backend; until then the card says so instead of claiming a status. */
export function PlatformStatusCard() {
  return (
    <Card as="section" aria-labelledby="settings-status">
      <CardHeader titleAs="h2" title={<span id="settings-status">Platform Status</span>} />
      <CardContent className="flex flex-col items-start gap-2">
        <Badge variant="neutral" dot>
          Not monitored yet
        </Badge>
        <p className="text-small text-fg-muted">Live service status appears once the platform is connected to its services.</p>
      </CardContent>
    </Card>
  );
}

/** Version and database from the project; live figures (storage, uptime, backups) need the backend. */
export function SystemInfoCard({ system }) {
  const rows = [
    ['Platform version', system.version],
    ['Web app build', import.meta.env.PROD ? 'Production' : 'Development'],
    ['Database', system.database],
    ['Storage usage', NOT_CONNECTED],
    ['Uptime', NOT_CONNECTED],
    ['Last backup', NOT_CONNECTED],
  ];
  return (
    <Card as="section" aria-labelledby="settings-system">
      <CardHeader titleAs="h2" title={<span id="settings-system">System Information</span>} />
      <CardContent>
        <dl className="flex flex-col divide-y divide-border-subtle">
          {rows.map(([label, value]) => (
            <div key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-3 py-2 first:pt-0 last:pb-0">
              <dt className="text-small text-fg-muted">{label}</dt>
              <dd className={value === NOT_CONNECTED ? 'text-small text-fg-muted italic' : 'text-small text-fg'}>{value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

/** Maintenance shortcuts from the reference. None exist yet, so all are unavailable. */
export function QuickActionsCard() {
  const actions = [
    { label: 'Clear System Cache', icon: Eraser },
    { label: 'Rebuild Search Index', icon: Database },
    { label: 'View System Health', icon: Activity },
    { label: 'Download System Logs', icon: Download },
    { label: 'Restart Services', icon: RotateCw, variant: 'danger' },
  ];
  return (
    <Card as="section" aria-labelledby="settings-quick-actions">
      <CardHeader titleAs="h2" title={<span id="settings-quick-actions">Quick Actions</span>} />
      <CardContent>
        <ul className="flex flex-col gap-2.5">
          {actions.map((action) => (
            <li key={action.label} className="flex flex-col">
              <Button
                variant={action.variant ?? 'outline'}
                leftIcon={action.icon}
                unavailableReason={UNAVAILABLE.operations}
                className="w-full justify-start"
              >
                {action.label}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/** Irreversible platform actions. Never functional in the frontend-only phases. */
export function DangerZoneCard() {
  return (
    <Card as="section" aria-labelledby="settings-danger" className="border-error/40">
      <CardHeader
        titleAs="h2"
        title={
          <span id="settings-danger" className="flex items-center gap-2 text-error-fg">
            <TriangleAlert aria-hidden="true" className="size-[1.125rem]" />
            Danger Zone
          </span>
        }
        description="These actions affect the whole platform and cannot be undone."
      />
      <CardContent className="flex flex-col gap-2.5">
        <Button variant="outline" leftIcon={Wrench} unavailableReason={UNAVAILABLE.operations} className="w-full justify-start">
          Maintenance Mode
        </Button>
        <Button variant="danger" leftIcon={RotateCcw} unavailableReason={UNAVAILABLE.operations} className="w-full justify-start">
          Reset Platform
        </Button>
      </CardContent>
    </Card>
  );
}

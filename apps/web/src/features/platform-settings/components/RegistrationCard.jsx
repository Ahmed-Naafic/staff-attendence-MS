import { Building2, Globe, ShieldCheck, UserRound, Users } from 'lucide-react';
import { Badge, Card, CardContent, CardHeader } from '../../../components/ui';

function Way({ icon: Icon, label, value, children }) {
  return (
    // dt and both dd directly in the div (valid description-list grouping); the explanation takes its own line.
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 py-3 first:pt-0 last:pb-0">
      <dt className="flex items-center gap-2 text-small font-medium text-fg">
        <Icon aria-hidden="true" className="size-4 text-fg-muted" />
        {label}
      </dt>
      <dd className="text-small text-fg">{value}</dd>
      <dd className="basis-full text-caption text-fg-muted">{children}</dd>
    </div>
  );
}

/**
 * Registration: how accounts and schools are created today, from the approved rules. Read only:
 * there is no public registration and nothing here can be changed. `minPasswordLength` is the
 * minimum the server enforces for an owner's initial password (from the Authentication settings).
 */
export function RegistrationCard({ minPasswordLength }) {
  return (
    <Card as="section" aria-labelledby="settings-registration">
      <CardHeader
        titleAs="h2"
        title={<span id="settings-registration">Account Creation</span>}
        description="How schools and accounts are added to the platform."
      />
      <CardContent className="flex flex-col gap-4">
        <p className="rounded-md bg-muted px-3 py-2 text-caption text-fg-secondary">Read only. These rules are set by the platform.</p>
        <dl className="flex flex-col divide-y divide-border-subtle">
          <Way icon={Globe} label="Public registration" value={<Badge variant="neutral">Not available</Badge>}>
            Nobody can create an account or register a school without a Super Admin.
          </Way>
          <Way icon={Building2} label="Schools" value="Registered by a Super Admin">
            Active as soon as they are registered; there is no approval step. Registering a school does not create its owner.
          </Way>
          <Way icon={UserRound} label="School owners" value="Added by a Super Admin">
            One owner per school, active straight away with no approval step. The Super Admin sets an initial password of at least{' '}
            {minPasswordLength} characters and gives it to the owner outside the app.
          </Way>
          <Way icon={ShieldCheck} label="Super Admins" value="Command line only">
            Created with a command on the server. They cannot be added from the web app.
          </Way>
          <Way icon={Users} label="Managers and staff" value={<Badge variant="neutral">Not available yet</Badge>}>
            School owners will add managers, and managers will add staff. Staff never register themselves.
          </Way>
        </dl>
      </CardContent>
    </Card>
  );
}

import { Badge } from '../../../components/ui';

// Display mapping for the owner statuses shown in the reference design.
// Display only: what each status allows is not defined yet.
export const ownerStatuses = {
  active: { label: 'Active', variant: 'success' },
  pending: { label: 'Pending', variant: 'warning' },
  suspended: { label: 'Suspended', variant: 'error' },
};

export function OwnerStatusBadge({ status }) {
  const { label, variant } = ownerStatuses[status] ?? { label: status, variant: 'neutral' };
  return <Badge variant={variant}>{label}</Badge>;
}

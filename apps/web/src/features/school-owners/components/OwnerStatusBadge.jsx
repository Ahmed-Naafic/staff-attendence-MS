import { Badge } from '../../../components/ui';

// Owner account statuses (approved lifecycle: ACTIVE ⇄ SUSPENDED; no pending or approval step).
export const ownerStatuses = {
  active: { label: 'Active', variant: 'success' },
  suspended: { label: 'Suspended', variant: 'error' },
};

export function OwnerStatusBadge({ status }) {
  const { label, variant } = ownerStatuses[status] ?? { label: status, variant: 'neutral' };
  return <Badge variant={variant}>{label}</Badge>;
}

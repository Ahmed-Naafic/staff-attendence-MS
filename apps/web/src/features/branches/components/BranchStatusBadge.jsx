import { Badge } from '../../../components/ui';

// Branch statuses (approved lifecycle): new branches are Active; the School Owner suspends and
// reactivates them. There is no deletion.
export const branchStatuses = {
  active: { label: 'Active', variant: 'success' },
  suspended: { label: 'Suspended', variant: 'error' },
};

export function BranchStatusBadge({ status }) {
  const { label, variant } = branchStatuses[status] ?? { label: status, variant: 'neutral' };
  return <Badge variant={variant}>{label}</Badge>;
}

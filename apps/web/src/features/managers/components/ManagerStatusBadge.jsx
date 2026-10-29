import { Badge } from '../../../components/ui';

// Manager account statuses (approved lifecycle): new Managers are Active; their School Owner
// suspends and reactivates them. There is no deletion.
export const managerStatuses = {
  active: { label: 'Active', variant: 'success' },
  suspended: { label: 'Suspended', variant: 'error' },
};

export function ManagerStatusBadge({ status }) {
  const { label, variant } = managerStatuses[status] ?? { label: status, variant: 'neutral' };
  return <Badge variant={variant}>{label}</Badge>;
}

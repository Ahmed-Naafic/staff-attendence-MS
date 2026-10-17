import { Badge } from '../../../components/ui';

// School statuses (approved lifecycle): registered schools are Active; Super Admins suspend and
// reactivate them. There is no approval step, so there is no Pending status.
export const schoolStatuses = {
  active: { label: 'Active', variant: 'success', color: 'var(--color-interactive)' },
  suspended: { label: 'Suspended', variant: 'error', color: 'var(--color-error)' },
};

export function SchoolStatusBadge({ status }) {
  const { label, variant } = schoolStatuses[status] ?? { label: status, variant: 'neutral' };
  return <Badge variant={variant}>{label}</Badge>;
}

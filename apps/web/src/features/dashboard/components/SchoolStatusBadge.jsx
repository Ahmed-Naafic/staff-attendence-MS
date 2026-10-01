import { Badge } from '../../../components/ui';

// Display mapping for the school statuses shown in the reference design.
// (Status rules themselves belong to the Schools feature, Phase 4.)
export const schoolStatuses = {
  active: { label: 'Active', variant: 'success', color: 'var(--color-interactive)' },
  pending: { label: 'Pending', variant: 'warning', color: 'var(--color-accent)' },
  suspended: { label: 'Suspended', variant: 'error', color: 'var(--color-error)' },
};

export function SchoolStatusBadge({ status }) {
  const { label, variant } = schoolStatuses[status] ?? { label: status, variant: 'neutral' };
  return <Badge variant={variant}>{label}</Badge>;
}

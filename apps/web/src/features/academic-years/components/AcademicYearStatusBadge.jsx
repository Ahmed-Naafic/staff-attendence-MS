import { Badge } from '../../../components/ui';

// Academic year lifecycle: Planned → Current → Closed. One current year per school.
export const academicYearStatuses = {
  planned: { label: 'Planned', variant: 'info' },
  current: { label: 'Current', variant: 'success' },
  closed: { label: 'Closed', variant: 'neutral' },
};

export function AcademicYearStatusBadge({ status }) {
  const { label, variant } = academicYearStatuses[status] ?? { label: status, variant: 'neutral' };
  return <Badge variant={variant}>{label}</Badge>;
}

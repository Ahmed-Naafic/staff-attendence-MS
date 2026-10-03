import { Badge } from '../../../components/ui';
import { cn } from '../../../lib/cn.js';
import { actionOf, auditResults, auditRoles } from '../utils/auditTypes.js';

const toneClass = { success: 'text-success-fg', info: 'text-info-fg', error: 'text-error-fg' };

/** Action name; failed events are shown in the error color (the Status column says "Failed"). */
export function AuditAction({ event, className }) {
  const action = actionOf(event.action);
  const tone = event.result === 'failure' ? 'error' : action.tone;
  return <span className={cn('font-medium', toneClass[tone], className)}>{action.label}</span>;
}

/** Role at the time of the event; "Unknown" when the account could not be identified (e.g. a failed sign-in). */
export function RoleBadge({ role }) {
  const { label, variant } = auditRoles[role] ?? { label: role ?? 'Unknown', variant: 'neutral' };
  return <Badge variant={variant}>{label}</Badge>;
}

export function ResultBadge({ result }) {
  const { label, variant } = auditResults[result] ?? { label: result, variant: 'neutral' };
  return <Badge variant={variant}>{label}</Badge>;
}

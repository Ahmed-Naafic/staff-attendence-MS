import { CalendarCheck } from 'lucide-react';
import { Card, EmptyState, LinkButton } from '../../../components/ui';

/**
 * The empty state of pages that work on scheduled examinations only (Marks Entry, Results, Analytics).
 * When examinations exist but are still drafts, it says so and links to the draft to schedule it:
 * a newly created examination is a draft until it is scheduled.
 */
export function NoScheduledExams({ items = [], icon, description }) {
  const drafts = items.filter((e) => e.status === 'draft');
  const first = drafts[0];
  return (
    <Card className="p-2">
      <EmptyState
        icon={drafts.length ? CalendarCheck : icon}
        title="No scheduled examinations"
        description={
          drafts.length
            ? `${drafts.length === 1 ? `${first.name} is` : `${drafts.length} examinations are`} still a draft. Open ${drafts.length === 1 ? 'it' : 'one'} and choose Schedule (its classes and papers must be ready); it then appears here. ${description}`
            : description
        }
        action={
          drafts.length > 0 && (
            <LinkButton to={drafts.length === 1 ? `/examinations/list/${first.id}` : '/examinations/list?state=draft'} variant="primary" leftIcon={CalendarCheck}>
              {drafts.length === 1 ? `Open ${first.name}` : 'Open the drafts'}
            </LinkButton>
          )
        }
      />
    </Card>
  );
}

import { GraduationCap } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Badge, Card, EmptyState, ErrorState, LoadingState } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { useSession } from '../../auth';
import { loadExamOverview } from '../data/examApi.js';
import { EXAM_STATES } from '../utils/examRules.js';

/** An examination's state (draft, planned, active, completed, cancelled). */
export const ExamStateBadge = ({ state }) => <Badge variant={EXAM_STATES[state]?.variant}>{EXAM_STATES[state]?.label ?? state}</Badge>;

/** The account's role for the examination API. */
export function useExamRole() {
  const { user } = useSession();
  return user.role === 'OWNER' ? 'OWNER' : 'MANAGER';
}

/**
 * Every Examinations page: the header, then the page only when the module is switched on for the
 * school (the Super Admin switches it on); otherwise a clear explanation. `children(overview)`.
 */
export function ExamPage({ title, description, primaryAction, children }) {
  const role = useExamRole();
  const overview = useApiData(() => loadExamOverview(role), `exam-overview|${role}`);
  const off = overview.data && !overview.data.featureEnabled;
  return (
    <PageContainer>
      <PageHeader title={title} description={description} primaryAction={overview.data?.featureEnabled ? primaryAction : undefined} />
      {overview.status === 'error' && !overview.data ? (
        <ErrorState title="Examinations could not be loaded" description="Check your connection and try again." onRetry={overview.retry} />
      ) : !overview.data ? (
        <LoadingState label="Loading examinations…" />
      ) : off ? (
        <Card className="p-2">
          <EmptyState
            icon={GraduationCap}
            title="Examinations are not switched on for your school"
            description="Examination timetables, marks, results and report cards become available once EduTrack support switches them on for your school."
          />
        </Card>
      ) : (
        children(overview.data, overview.retry)
      )}
    </PageContainer>
  );
}

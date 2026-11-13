import { useState } from 'react';
import { Badge, Button, Card, ErrorState, Skeleton } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { loadCurriculum, loadSubjects } from '../data/teachingApi.js';
import { CurriculumModal } from './TeachingModals.jsx';

/**
 * A class's subjects (curriculum) on its class page: what it studies and lessons per week. The
 * School Owner changes them; Managers read. No list set: every active subject may be taught.
 */
export function ClassSubjectsCard({ role, classId, readOnlyReason, onSaved }) {
  const owner = role === 'OWNER';
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState(false);
  const curriculum = useApiData(() => loadCurriculum(role, classId), `curriculum|${role}|${classId}|${version}`);
  const subjects = useApiData(() => (owner && editing ? loadSubjects(role, {}) : Promise.resolve(null)), `subjects|${editing}`);
  const data = curriculum.data;

  return (
    <Card as="section" aria-labelledby="class-subjects" className="flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="class-subjects" className="text-card-title text-fg">
            Subjects
          </h2>
          <p className="text-small text-fg-secondary">
            {data ? (data.open ? 'No list set: every active subject of the school can be taught in this class.' : `${data.items.length} subjects · ${data.weeklyLessons} lessons per week planned. The same every year.`) : 'What this class studies.'}
          </p>
        </div>
        {owner && (
          <Button size="sm" variant="outline" onClick={() => setEditing(true)} unavailableReason={readOnlyReason}>
            Choose Subjects
          </Button>
        )}
      </div>
      {curriculum.status === 'error' && !data && <ErrorState title="Subjects could not be loaded" description="Try again." onRetry={curriculum.retry} />}
      {!data && curriculum.status !== 'error' && <Skeleton className="h-10" />}
      {data && !data.open && (
        <ul className="flex flex-wrap gap-2">
          {data.items.map((i) => (
            <li key={i.subject.id}>
              <Badge variant={i.subject.status === 'active' ? 'neutral' : 'warning'}>
                {i.subject.name}
                {i.weeklyLessons ? ` · ${i.weeklyLessons}/week` : ''}
                {i.subject.status !== 'active' ? ' (inactive)' : ''}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {owner && editing && subjects.data && (
        <CurriculumModal
          cls={data?.class}
          curriculum={data}
          subjects={subjects.data.items}
          open
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setVersion((n) => n + 1);
            onSaved?.('The class’s subjects were saved.');
          }}
        />
      )}
    </Card>
  );
}

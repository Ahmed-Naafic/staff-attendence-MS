import { useSearchParams } from 'react-router';
import { CircleAlert, CircleCheck, ClipboardList, Presentation } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Badge, Card, EmptyState, Input, KpiCard, LinkButton, Select } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { formatFullDay } from '../../../lib/format.js';
import { useSession } from '../../auth';
import { loadOwnerBranches } from '../../classes/data/classesApi.js';
import { LoadFailure } from '../components/FeatureState.jsx';
import { loadCompletion } from '../data/studentAttendanceApi.js';

const STATUS = { missing: { label: 'Not taken', variant: 'error' }, incomplete: { label: 'Incomplete', variant: 'warning' } };
const part = (t) => (t.expected ? `${t.complete}/${t.expected}` : '—');

/**
 * Completion: for each day and branch, how many Manager sessions and lessons were taken and
 * completed, and the ones still missing or incomplete (with a link to take or finish them).
 * School Owner: every branch or one; Manager: their branch.
 */
export default function AttendanceCompletionPage() {
  const { user } = useSession();
  const owner = user.role === 'OWNER';
  const role = owner ? 'OWNER' : 'MANAGER';
  const [params, setParams] = useSearchParams();
  const set = (name, value) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(name, value);
      else next.delete(name);
      return next;
    }, { replace: true });
  const filters = { from: params.get('from') ?? '', to: params.get('to') ?? '', branch: owner ? (params.get('branch') ?? '') : '' };
  const data = useApiData(() => loadCompletion(role, filters), `completion|${role}|${JSON.stringify(filters)}`);
  const branches = useApiData(() => (owner ? loadOwnerBranches() : Promise.resolve([])), `branches|${role}`);
  const t = data.data?.totals;

  return (
    <PageContainer>
      <PageHeader
        title="Attendance Completion"
        description="Whether each day’s student attendance was taken: the Managers’ sessions and the teachers’ lessons, with what is still missing."
        breadcrumbs={[{ label: 'Student Attendance', to: '/student-attendance' }, { label: 'Completion' }]}
        primaryAction={<LinkButton to="/student-attendance" variant="outline">Attendance</LinkButton>}
      />
      <Card as="section" aria-label="Filters" className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="From" type="date" value={data.data?.from ?? filters.from} onChange={(e) => set('from', e.target.value)} hint="At most 31 days." />
          <Input label="To" type="date" value={data.data?.to ?? filters.to} onChange={(e) => set('to', e.target.value)} />
          {owner && (
            <Select
              label="Branch"
              options={[{ value: '', label: 'All branches' }, ...(branches.data ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))]}
              value={filters.branch}
              onChange={(e) => set('branch', e.target.value)}
            />
          )}
        </div>
      </Card>
      {data.status === 'error' && !data.data ? (
        <LoadFailure error={data.error} onRetry={data.retry} owner={owner} what="Completion" />
      ) : (
        <>
          {t && (
            <ul aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard label="Manager sessions complete" value={t.halves.complete} icon={CircleCheck} tone="success" note={`of ${t.halves.due} due`} />
              <KpiCard label="Manager sessions missing" value={t.halves.missing + t.halves.incomplete} icon={CircleAlert} tone={t.halves.missing + t.halves.incomplete ? 'warning' : 'info'} />
              <KpiCard label="Lessons taken" value={t.lessons.taken} icon={Presentation} note={`of ${t.lessons.due} due`} />
              <KpiCard label="Lessons missing" value={t.lessons.missing + t.lessons.incomplete} icon={ClipboardList} tone={t.lessons.missing + t.lessons.incomplete ? 'warning' : 'info'} />
            </ul>
          )}
          {data.data && !data.data.days.some((d) => d.branches.length) && (
            <Card>
              <EmptyState icon={CircleCheck} title="No attendance expected" description="No school days with attendance in these dates." />
            </Card>
          )}
          {(data.data?.days ?? [])
            .filter((d) => d.branches.length)
            .map((d) => (
              <Card key={d.date} as="section" aria-label={formatFullDay(d.date)} className="p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-heading-sm font-semibold">{formatFullDay(d.date)}</h2>
                  <LinkButton to={`/student-attendance?date=${d.date}`} variant="ghost" size="sm">
                    Open the day
                  </LinkButton>
                </div>
                <ul className="flex flex-col gap-3">
                  {d.branches.map((b) => (
                    <li key={b.branch.id} className="rounded-md border border-border p-3">
                      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
                        {owner && <span className="font-medium">{b.branch.name}</span>}
                        <span className="text-body-sm">
                          Manager sessions complete: <span className="font-medium tabular-nums">{part(b.halves)}</span>
                        </span>
                        <span className="text-body-sm">
                          Lessons complete: <span className="font-medium tabular-nums">{part(b.lessons)}</span>
                        </span>
                        {!b.attention.length && b.halves.due + b.lessons.due > 0 && <Badge variant="success">All taken</Badge>}
                      </div>
                      {b.attention.length > 0 && (
                        <ul className="mt-2 flex flex-col gap-1">
                          {b.attention.map((a) => (
                            <li key={`${a.section.id}|${a.kind}|${a.half ?? a.period}`} className="flex flex-wrap items-center gap-2 text-body-sm">
                              <Badge variant={STATUS[a.status].variant}>{STATUS[a.status].label}</Badge>
                              <span className="font-medium">{a.section.displayName}</span>
                              <span className="text-fg-secondary">{a.label}</span>
                              {a.teacher && <span className="text-fg-muted">{a.teacher.name}</span>}
                              {a.sessionId && (
                                <LinkButton to={`/student-attendance/sessions/${a.sessionId}`} variant="ghost" size="sm">
                                  Open
                                </LinkButton>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
        </>
      )}
    </PageContainer>
  );
}

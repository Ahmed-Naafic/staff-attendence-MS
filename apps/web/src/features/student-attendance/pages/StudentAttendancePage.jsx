import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { CalendarCheck, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, ClipboardList, UserCheck } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Alert, Badge, Button, Card, EmptyState, Input, KpiCard, LinkButton, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableLoading, TableRow } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { formatFullDay } from '../../../lib/format.js';
import { useSession } from '../../auth';
import { loadOwnerBranches } from '../../classes/data/classesApi.js';
import { LoadFailure } from '../components/FeatureState.jsx';
import { loadAttendanceDay, openAttendanceSession } from '../data/studentAttendanceApi.js';
import { countsText, sessionBadge } from '../utils/attendanceRules.js';

const shiftDay = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Student attendance of a day: every section of the branch (School Owner: every branch, or one)
 * with its sessions — before and after the main break, or once a day — and how far each is taken.
 * Managers open a session to take it; Owners read.
 */
export default function StudentAttendancePage() {
  const { user } = useSession();
  const owner = user.role === 'OWNER';
  const role = owner ? 'OWNER' : 'MANAGER';
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const set = (name, value) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(name, value);
      else next.delete(name);
      return next;
    }, { replace: true });
  const date = params.get('date') ?? '';
  const branch = owner ? (params.get('branch') ?? '') : '';
  const day = useApiData(() => loadAttendanceDay(role, { date: date || undefined, branch }), `day|${role}|${date}|${branch}`);
  const branches = useApiData(() => (owner ? loadOwnerBranches() : Promise.resolve([])), `branches|${role}`);
  const [opening, setOpening] = useState('');
  const [error, setError] = useState('');
  const shown = day.data?.date ?? date;

  async function take(item, half) {
    if (half.session) return navigate(`/student-attendance/sessions/${half.session.id}`);
    const key = `${item.section.id}|${half.half ?? `p${half.period}`}`;
    setOpening(key);
    setError('');
    try {
      const result = await openAttendanceSession({ section: item.section.id, date: shown, ...(half.period ? { period: half.period } : { half: half.half }) });
      navigate(`/student-attendance/sessions/${result.session.id}`);
    } catch (e) {
      setError(e.message || 'The attendance could not be opened. Try again.');
      day.retry();
    } finally {
      setOpening('');
    }
  }

  const items = day.data?.items ?? [];
  const totals = day.data?.totals;
  return (
    <PageContainer>
      <PageHeader
        title="Student Attendance"
        description={
          owner
            ? 'Each section’s attendance by day, taken by the branch Managers before and after the main break (or once a day).'
            : 'Take each section’s attendance before and after the main break (or once a day). Unmarked students are never counted absent.'
        }
        secondaryActions={
          <>
            <LinkButton to="/student-attendance/completion" variant="outline">Completion</LinkButton>
            <LinkButton to="/student-excuses" variant="outline">Excuses</LinkButton>
          </>
        }
        primaryAction={<LinkButton to="/student-attendance/settings" variant="outline">Settings</LinkButton>}
      />
      <Card as="section" aria-label="Day and filters" className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Button variant="outline" iconOnly aria-label="Previous day" onClick={() => shown && set('date', shiftDay(shown, -1))}>
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <Input label="Day" type="date" value={shown} onChange={(e) => set('date', e.target.value)} fieldClassName="w-44" />
          <Button variant="outline" iconOnly aria-label="Next day" onClick={() => shown && set('date', shiftDay(shown, 1))}>
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
          {day.data && shown !== day.data.today && (
            <Button variant="ghost" onClick={() => set('date', '')}>
              Today
            </Button>
          )}
          {owner && (
            <Select
              label="Branch"
              fieldClassName="min-w-56"
              options={[{ value: '', label: 'All branches' }, ...(branches.data ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))]}
              value={branch}
              onChange={(e) => set('branch', e.target.value)}
            />
          )}
        </div>
      </Card>
      {error && (
        <Alert variant="error" onDismiss={() => setError('')}>
          {error}
        </Alert>
      )}

      {day.status === 'error' && !day.data ? (
        <LoadFailure error={day.error} onRetry={day.retry} owner={owner} what="Attendance" />
      ) : (
        <>
          {totals && totals.sessions > 0 && (
            <ul aria-label="The day in numbers" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard label="Sessions" value={totals.sessions} icon={CalendarCheck} />
              <KpiCard label="Taken" value={totals.taken} icon={ClipboardList} />
              <KpiCard label="Complete" value={totals.complete} icon={CircleCheck} tone="success" />
              <KpiCard label="Missing (past due)" value={totals.missing} icon={CircleAlert} tone={totals.missing ? 'warning' : 'info'} />
            </ul>
          )}
          <Card className="overflow-hidden">
            <div role="region" aria-label="Sections" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
              <Table caption={shown ? `Student attendance on ${formatFullDay(shown)}` : 'Student attendance'}>
                <TableHead>
                  <TableRow interactive={false}>
                    <TableHeaderCell>Section</TableHeaderCell>
                    <TableHeaderCell>Students</TableHeaderCell>
                    <TableHeaderCell>Sessions</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {!day.data && <TableLoading columns={3} />}
                  {day.data && !items.length && (
                    <tr>
                      <td colSpan={3}>
                        <EmptyState icon={UserCheck} title="No sections on this day" description="Sections of the academic year covering this day appear here." compact />
                      </td>
                    </tr>
                  )}
                  {items.map((item) => (
                    <TableRow key={item.section.id} interactive={false}>
                      <TableCell className="whitespace-nowrap align-top">
                        <span className="font-medium">{item.section.displayName}</span>
                        {owner && <span className="block text-caption text-fg-muted">{item.section.branch.name}</span>}
                        {item.extraDay && <span className="block text-caption text-fg-muted">Extra school day: {item.extraDay.name}</span>}
                      </TableCell>
                      <TableCell className="align-top tabular-nums text-fg-secondary">{item.students}</TableCell>
                      <TableCell>
                        {!item.schoolDay && !item.halves.length ? (
                          <span className="text-fg-muted">No school: {item.reasonText}</span>
                        ) : (
                          <ul className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-4">
                            {item.halves.map((half) => {
                              const badge = sessionBadge(half);
                              const busy = opening === `${item.section.id}|${half.half}`;
                              return (
                                <li key={half.half} className="flex min-w-60 flex-col gap-1 rounded-md border border-border p-3">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-body-sm font-medium">
                                      {half.label}
                                      {half.start && <span className="ml-1 font-normal text-fg-muted">{half.start}–{half.end}</span>}
                                    </span>
                                    <Badge variant={badge.variant}>{badge.label}</Badge>
                                  </div>
                                  {half.session && <span className="text-caption text-fg-secondary">{countsText(half.session.counts)}</span>}
                                  <div className="mt-1 flex gap-2">
                                    {half.session ? (
                                      <Button size="sm" variant={half.canTake && !half.session.complete ? 'primary' : 'outline'} onClick={() => take(item, half)}>
                                        {half.canTake ? (half.session.complete ? 'Review' : 'Continue') : 'View'}
                                      </Button>
                                    ) : half.canTake ? (
                                      <Button size="sm" loading={busy} onClick={() => take(item, half)}>
                                        Take attendance
                                      </Button>
                                    ) : null}
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                        {item.lessons?.length > 0 && (
                          <details className="mt-3">
                            <summary className="cursor-pointer text-body-sm text-fg-secondary">
                              Lessons: {item.lessons.filter((l) => l.session).length} of {item.lessons.length} taken
                            </summary>
                            <ul className="mt-2 flex flex-col gap-1">
                              {item.lessons.map((lesson) => {
                                const badge = sessionBadge(lesson);
                                return (
                                  <li key={lesson.period} className="flex flex-wrap items-center gap-2 text-body-sm">
                                    <span className="w-28 text-fg-muted tabular-nums">
                                      P{lesson.period} {lesson.start}–{lesson.end}
                                    </span>
                                    <span className="font-medium">{lesson.subject.name}</span>
                                    <span className="text-fg-muted">{lesson.teacher?.name ?? 'Subject teacher'}</span>
                                    <Badge variant={badge.variant}>{badge.label}</Badge>
                                    {(lesson.session || lesson.canTake) && (
                                      <Button size="sm" variant="ghost" loading={opening === `${item.section.id}|p${lesson.period}`} onClick={() => take(item, lesson)}>
                                        {lesson.session ? (lesson.canTake ? 'Review' : 'View') : 'Take'}
                                      </Button>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </details>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}
    </PageContainer>
  );
}

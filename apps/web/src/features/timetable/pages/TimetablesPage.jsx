import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { CalendarClock } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Alert, Badge, Button, Card, ErrorState, LinkButton, Select, Table, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableLoading, TableRow } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { formatFullDay } from '../../../lib/format.js';
import { loadAcademicYears, loadOwnerSchoolStatus } from '../../academic-years';
import { useSession } from '../../auth';
import { loadOwnerBranches } from '../../classes/data/classesApi.js';
import { pickYear } from '../../classes/utils/classRules.js';
import { TimetableEditor } from '../components/TimetableEditor.jsx';
import { loadTimetables } from '../data/timetableApi.js';

const YEAR_SUFFIX = { current: ' (current)', planned: ' (planned)', closed: ' (closed)' };

/**
 * Timetables: every section of a year with its timetable today, and one section's timetable to
 * view and change. School Owner: every branch. Manager: their branch's sections.
 */
export default function TimetablesPage() {
  const { user } = useSession();
  const role = user.role === 'OWNER' ? 'OWNER' : 'MANAGER';
  const owner = role === 'OWNER';
  const [params, setParams] = useSearchParams();
  const set = (name, value) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(name, value);
        else next.delete(name);
        if (name !== 'section') next.delete('section');
        return next;
      },
      { replace: name !== 'section' },
    );
  const [notice, setNotice] = useState('');

  const years = useApiData(() => loadAcademicYears(role), `years|${role}`);
  const year = pickYear(years.data?.items ?? [], params.get('year'));
  const branches = useApiData(() => (owner ? loadOwnerBranches() : Promise.resolve([])), `branches|${role}`);
  const school = useApiData(() => (owner ? loadOwnerSchoolStatus() : Promise.resolve(null)), 'school');
  const branch = owner ? (params.get('branch') ?? '') : '';
  const sectionId = params.get('section') ?? '';
  const list = useApiData(() => (year && !sectionId ? loadTimetables(role, { academicYear: year.id, branch }) : Promise.resolve(null)), `tts|${year?.id}|${branch}|${sectionId}`);
  const writable = school.data !== 'suspended';
  const items = list.data?.items ?? [];
  const missing = items.filter((i) => !i.timetable && i.section.status === 'active').length;

  return (
    <PageContainer>
      <PageHeader
        title="Timetables"
        description={
          owner
            ? 'Each section’s bell schedule and weekly lessons. Lesson attendance, the halves of the day and reports follow them.'
            : 'Your sections’ bell schedules and weekly lessons. Lesson attendance, the halves of the day and reports follow them.'
        }
        primaryAction={<LinkButton to="/bell-schedules" variant="outline">Bell Schedules</LinkButton>}
      />
      {school.data === 'suspended' && <Alert variant="warning" title="Your school is suspended">You can view timetables but not change them until the school is reactivated.</Alert>}
      {notice && (
        <Alert variant="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}

      {sectionId ? (
        <>
          <div>
            <Button variant="outline" size="sm" onClick={() => set('section', '')}>
              All sections
            </Button>
          </div>
          <TimetableEditor role={role} sectionId={sectionId} writable={writable} onNotice={setNotice} />
        </>
      ) : (
        <>
          <Card as="section" aria-label="Timetable filters" className="p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Select
                label="Academic year"
                options={(years.data?.items ?? []).length ? years.data.items.map((y) => ({ value: y.id, label: `${y.name}${YEAR_SUFFIX[y.status] ?? ''}` })) : [{ value: '', label: 'No academic years yet' }]}
                value={year?.id ?? ''}
                onChange={(e) => set('year', e.target.value)}
              />
              {owner && (
                <Select
                  label="Branch"
                  options={[{ value: '', label: 'All branches' }, ...(branches.data ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))]}
                  value={branch}
                  onChange={(e) => set('branch', e.target.value)}
                />
              )}
            </div>
          </Card>
          {years.data && !year && <Alert variant="info" title="No academic year yet">Timetables belong to the sections of an academic year.</Alert>}
          {missing > 0 && <Alert variant="info">{missing} active section{missing === 1 ? ' has' : 's have'} no timetable yet: no lessons or halves of the day for attendance until one is set.</Alert>}
          {year && (
            <Card className="overflow-hidden">
              {list.status === 'error' && !list.data ? (
                <ErrorState title="Timetables could not be loaded" description="Check your connection and try again." onRetry={list.retry} />
              ) : (
                <div role="region" aria-label="Timetables" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
                  <Table caption={`Timetables in ${year.name}`}>
                    <TableHead>
                      <TableRow interactive={false}>
                        <TableHeaderCell>Section</TableHeaderCell>
                        <TableHeaderCell>Bell schedule</TableHeaderCell>
                        <TableHeaderCell>Lessons a week</TableHeaderCell>
                        <TableHeaderCell>Status</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {!list.data && <TableLoading columns={4} />}
                      {list.data && !items.length && <TableEmpty columns={4} icon={CalendarClock} title="No sections" description="Sections of this year appear here." />}
                      {items.map((i) => (
                        <TableRow key={i.section.id}>
                          <TableCell className="whitespace-nowrap">
                            <button type="button" className="font-medium text-interactive underline-offset-2 hover:underline" onClick={() => set('section', i.section.id)}>
                              {i.section.displayName}
                            </button>
                            {owner && <span className="block text-caption text-fg-muted">{i.section.branch.name}</span>}
                          </TableCell>
                          <TableCell className="text-fg-secondary">{i.timetable?.bellSchedule.name ?? '—'}</TableCell>
                          <TableCell className="tabular-nums text-fg-secondary">{i.timetable ? i.timetable.lessons : '—'}</TableCell>
                          <TableCell>
                            {!i.timetable ? (
                              <Badge variant={i.section.status === 'active' ? 'warning' : 'neutral'}>{i.section.status === 'active' ? 'Not set' : 'Inactive section'}</Badge>
                            ) : i.timetable.state === 'scheduled' ? (
                              <Badge variant="info">From {formatFullDay(i.timetable.effectiveFrom)}</Badge>
                            ) : (
                              <Badge variant="success">{i.nextChange ? `Changes ${formatFullDay(i.nextChange)}` : 'Set'}</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </PageContainer>
  );
}

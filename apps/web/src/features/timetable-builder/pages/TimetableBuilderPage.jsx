import { useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Alert, Card, ErrorState, Input, Select, Skeleton, TabPanel, Tabs } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { loadAcademicYears } from '../../academic-years';
import { useSession } from '../../auth';
import { loadOwnerBranches } from '../../classes/data/classesApi.js';
import { pickYear } from '../../classes/utils/classRules.js';
import { FixedLessonsPanel, ReadinessPanel, RulesPanel, TeachersPanel } from '../components/BuilderPanels.jsx';
import { DraftPanel } from '../components/DraftPanel.jsx';
import { loadBuilder } from '../data/builderApi.js';

const YEAR_SUFFIX = { current: ' (current)', planned: ' (planned)', closed: ' (closed)' };
const TABS = ['readiness', 'rules', 'teachers', 'fixed', 'draft'];

/**
 * Timetable Builder: for one branch and academic year — 1. Readiness (what to fix first), 2. Rules
 * (and each class's bell schedule), 3. Teachers (limits and unavailable times), 4. Fixed lessons,
 * 5. Draft & publish (generate, review, edit, publish). School Owner: any branch; Manager: theirs.
 */
export default function TimetableBuilderPage() {
  const { user } = useSession();
  const role = user.role === 'OWNER' ? 'OWNER' : 'MANAGER';
  const owner = role === 'OWNER';
  const tabsId = useId();
  const [params, setParams] = useSearchParams();
  const set = (name, value) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(name, value);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState('');
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'readiness';

  const years = useApiData(() => loadAcademicYears(role), `years|${role}`);
  const year = pickYear(years.data?.items ?? [], params.get('year'));
  const branches = useApiData(() => (owner ? loadOwnerBranches() : Promise.resolve([])), `branches|${role}`);
  const branch = owner ? params.get('branch') || branches.data?.[0]?.id || '' : '';
  const date = params.get('date') ?? '';
  const context = { academicYear: year?.id, branch, date };
  const canLoad = Boolean(year) && (!owner || branch);
  const builder = useApiData(() => (canLoad ? loadBuilder(role, context) : Promise.resolve(null)), `builder|${year?.id}|${branch}|${date}|${version}`);
  const b = builder.data;
  const writable = Boolean(year) && year.status !== 'closed';
  const changed = (message) => {
    setNotice(message);
    setVersion((n) => n + 1);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Timetable Builder"
        description="Generate the whole branch’s timetable at once: every class, every teacher, no clashes. Work through the tabs from left to right; nothing changes for anyone until you publish."
      />
      {notice && (
        <Alert variant="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}
      <Card as="section" aria-label="What to build" className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Select
            label="Academic year"
            options={(years.data?.items ?? []).length ? years.data.items.map((y) => ({ value: y.id, label: `${y.name}${YEAR_SUFFIX[y.status] ?? ''}` })) : [{ value: '', label: 'No academic years yet' }]}
            value={year?.id ?? ''}
            onChange={(e) => set('year', e.target.value)}
          />
          {owner && (
            <Select label="Branch" options={(branches.data ?? []).map((x) => ({ value: x.id, label: `${x.name} (${x.code})` }))} value={branch} onChange={(e) => set('branch', e.target.value)} />
          )}
          <Input
            label="Plan for"
            type="date"
            value={date || b?.planDate || ''}
            min={b?.today}
            max={b?.academicYear.endDate}
            hint="Bell times, teaching and other timetables of this day are used. Default: tomorrow."
            onChange={(e) => set('date', e.target.value)}
          />
        </div>
      </Card>
      {years.data && !year && <Alert variant="info" title="No academic year yet">The timetable belongs to an academic year and its classes.</Alert>}
      {year?.status === 'closed' && <Alert variant="info" title={`${year.name} is closed`}>Its timetables are kept as they are.</Alert>}
      {builder.status === 'error' && !b && <ErrorState title="The builder could not be loaded" description={builder.error?.message} onRetry={builder.retry} />}
      {canLoad && !b && builder.status !== 'error' && <Skeleton className="h-64" />}
      {b && (
        <>
          <Tabs
            id={tabsId}
            label="Timetable builder steps"
            tabs={[
              { value: 'readiness', label: `1. Readiness${b.readiness.blockers ? ` (${b.readiness.blockers} to fix)` : ' ✓'}` },
              { value: 'rules', label: '2. Rules' },
              { value: 'teachers', label: '3. Teachers' },
              { value: 'fixed', label: `4. Fixed lessons${b.fixedLessons.length ? ` (${b.fixedLessons.length})` : ''}` },
              { value: 'draft', label: `5. Draft & publish${b.draft ? ' •' : ''}` },
            ]}
            value={tab}
            onChange={(next) => set('tab', next === 'readiness' ? '' : next)}
          />
          <TabPanel tabsId={tabsId} value={tab}>
            {tab === 'readiness' && <ReadinessPanel role={role} context={context} version={version} onTab={(t) => set('tab', t)} />}
            {tab === 'rules' && (
              <RulesPanel
                key={b.setup.updatedAt ?? 'new'}
                role={role}
                context={context}
                builder={b}
                writable={writable}
                onSaved={() => changed('The rules were saved.')}
              />
            )}
            {tab === 'teachers' && (
              <TeachersPanel
                role={role}
                context={context}
                academicYear={b.academicYear.id}
                days={[...new Set(b.sections.flatMap((s) => Object.keys(s.periods)))]}
                writable={writable}
                version={version}
                onChanged={changed}
              />
            )}
            {tab === 'fixed' && <FixedLessonsPanel role={role} context={context} builder={b} writable={writable} onChanged={changed} />}
            {tab === 'draft' && <DraftPanel role={role} context={context} builder={b} writable={writable} version={version} onChanged={changed} />}
          </TabPanel>
        </>
      )}
    </PageContainer>
  );
}

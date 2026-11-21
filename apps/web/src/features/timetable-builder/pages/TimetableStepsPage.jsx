import { useEffect, useId, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Alert, Badge, Button, Card, Select, TabPanel, Tabs } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { AcademicCalendarPage } from '../../academic-calendar';
import { AcademicYearsPage, loadAcademicYears } from '../../academic-years';
import { useSession } from '../../auth';
import { ClassesPage } from '../../classes';
import { loadOwnerBranches } from '../../classes/data/classesApi.js';
import { pickYear } from '../../classes/utils/classRules.js';
import { SubjectsPage, TeachingPage } from '../../teaching';
import { BellSchedulesPage } from '../../timetable';
import { AssignGrid } from '../components/AssignGrid.jsx';
import { LessonsGrid } from '../components/LessonsGrid.jsx';
import { loadProgress } from '../data/builderApi.js';
import { BUILDER_TAB_STEP, sharedSearch, STATE_MARK, stepOf, TIMETABLE_STEPS } from '../utils/timetableSteps.js';
import TimetableBuilderPage from './TimetableBuilderPage.jsx';
import TimetableViewsPage from './TimetableViewsPage.jsx';

const YEAR_SUFFIX = { current: ' (current)', planned: ' (planned)', closed: ' (closed)' };
const STATE_BADGE = { done: 'success', attention: 'error', todo: 'neutral', optional: 'neutral' };
const STATE_TEXT = { done: 'Done', attention: 'Needs attention', todo: 'To do', optional: 'Optional' };

/**
 * School Schedule → Timetable: everything needed to build a timetable, as 15 steps in tabs
 * (/timetable/:step), in five groups. One academic year and (School Owner) branch for every step,
 * kept in the address (?year=&branch=, which the step pages read). Each tab shows where it stands
 * (✓ done, ! needs attention, ○ to do, · optional) from GET …/timetable-builder/progress. Who can
 * change what is decided by each page and the API.
 */
export default function TimetableStepsPage() {
  const { user } = useSession();
  const role = user.role === 'OWNER' ? 'OWNER' : 'MANAGER';
  const owner = role === 'OWNER';
  const { step: key } = useParams();
  const { search } = useLocation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tabsId = useId();
  const [notice, setNotice] = useState('');
  const [version, setVersion] = useState(0);
  const step = stepOf(key);

  const years = useApiData(() => loadAcademicYears(role), `steps-years|${role}`);
  const year = pickYear(years.data?.items ?? [], params.get('year'));
  const branches = useApiData(() => (owner ? loadOwnerBranches() : Promise.resolve([])), `steps-branches|${role}`);
  const branch = owner ? params.get('branch') || branches.data?.[0]?.id || '' : '';
  const ready = Boolean(year) && (!owner || branch);
  const progress = useApiData(() => (ready ? loadProgress(role, { academicYear: year.id, branch }) : Promise.resolve(null)), `steps-progress|${year?.id}|${branch}|${step.key}|${version}`);
  const states = progress.data?.steps ?? {};
  // Write the year and branch in effect into the address, so every step page shows the same ones
  // (pages treat a missing branch differently: all branches, or the first).
  useEffect(() => {
    if (!year) return;
    const wantBranch = owner ? branch : '';
    if (params.get('year') === year.id && (params.get('branch') ?? '') === wantBranch) return;
    setParams(
      (cur) => {
        const next = new URLSearchParams(cur);
        next.set('year', year.id);
        if (wantBranch) next.set('branch', wantBranch);
        else next.delete('branch');
        return next;
      },
      { replace: true },
    );
  }, [year, branch, owner, params, setParams]);

  const choose = (name, value) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(sharedSearch(current.toString()));
        if (value) next.set(name, value);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );
  // The year and branch in effect go along to every step (so the pages show the same ones).
  const shared = () => {
    const next = new URLSearchParams(sharedSearch(search));
    if (year) next.set('year', year.id);
    if (owner && branch) next.set('branch', branch);
    return next.toString() ? `?${next}` : '';
  };
  const go = (next) => navigate(`/timetable/${next}${shared()}`);
  const changed = (message) => {
    if (message) setNotice(message);
    setVersion((n) => n + 1);
  };
  const toBuilderTab = (tab) => go(BUILDER_TAB_STEP[tab] ?? 'readiness');

  const mark = (k) => (states[k] ? `${STATE_MARK[states[k].state]} ` : '');
  const current = states[step.key];
  const page = () => {
    switch (step.key) {
      case 'year':
        return <AcademicYearsPage />;
      case 'school-days':
        return <AcademicCalendarPage />;
      case 'bell-times':
        return <BellSchedulesPage />;
      case 'subjects':
        return <SubjectsPage />;
      case 'classes':
        return <ClassesPage />;
      case 'lessons':
        return (
          <PageContainer>
            <LessonsGrid role={role} academicYear={year?.id} branch={branch} onChanged={changed} />
          </PageContainer>
        );
      case 'teachers':
        return <TeachingPage fixedTab="teachers" />;
      case 'assign':
        return (
          <PageContainer>
            <AssignGrid role={role} academicYear={year?.id} branch={branch} onChanged={changed} />
          </PageContainer>
        );
      case 'limits':
        return <TimetableBuilderPage embedded part="teachers" onTab={toBuilderTab} />;
      case 'rules':
        return <TimetableBuilderPage embedded part="rules" onTab={toBuilderTab} />;
      case 'fixed':
        return <TimetableBuilderPage embedded part="fixed" onTab={toBuilderTab} />;
      case 'readiness':
        return <TimetableBuilderPage embedded part="readiness" onTab={toBuilderTab} />;
      case 'generate':
        return <TimetableBuilderPage embedded part="draft" onTab={toBuilderTab} />;
      case 'publish':
        return <TimetableBuilderPage embedded part="publish" onTab={toBuilderTab} />;
      default:
        return <TimetableViewsPage />;
    }
  };

  return (
    <div className="flex flex-col">
      <div className="mx-auto flex w-full max-w-page flex-col gap-4 px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8">
        <PageHeader title="Timetable" description="Everything needed to build a timetable, from start to finish. Work through the steps from left to right; each tab shows where it stands." />
        <Card as="section" aria-label="Year and branch" className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
          <Select
            label="Academic year"
            options={(years.data?.items ?? []).length ? years.data.items.map((y) => ({ value: y.id, label: `${y.name}${YEAR_SUFFIX[y.status] ?? ''}` })) : [{ value: '', label: years.data ? 'No academic years yet' : 'Loading…' }]}
            value={year?.id ?? ''}
            hint="Every step works on this year."
            onChange={(e) => choose('year', e.target.value)}
          />
          {owner && (
            <Select
              label="Branch"
              options={(branches.data ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))}
              value={branch}
              hint="The branch whose timetable you build."
              onChange={(e) => choose('branch', e.target.value)}
            />
          )}
        </Card>
        {notice && (
          <Alert variant="success" onDismiss={() => setNotice('')}>
            {notice}
          </Alert>
        )}
        <Tabs id={tabsId} label="Timetable steps" tabs={TIMETABLE_STEPS.map((s, i) => ({ value: s.key, label: `${mark(s.key)}${i + 1}. ${s.label}` }))} value={step.key} onChange={go} />
        <div className="flex flex-col gap-3 rounded-md border border-border bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="flex flex-wrap items-center gap-2 text-small text-fg-muted">
              <span className="font-medium uppercase tracking-wide">{step.group}</span>
              <span>
                Step {step.number} of {TIMETABLE_STEPS.length}
              </span>
              {current && <Badge variant={STATE_BADGE[current.state]}>{STATE_TEXT[current.state]}</Badge>}
            </p>
            <p className="text-body text-fg">
              <span className="font-medium">{step.label}.</span> {step.what}
            </p>
            {current?.note && <p className={`text-small ${current.state === 'attention' ? 'text-error-fg' : 'text-fg-secondary'}`}>{current.note}</p>}
            <p className="text-small text-fg-muted">Who: {step.who}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            {step.previous && (
              <Button variant="outline" size="sm" leftIcon={ArrowLeft} onClick={() => go(step.previous.key)}>
                {step.previous.label}
              </Button>
            )}
            {step.next && (
              <Button size="sm" rightIcon={ArrowRight} onClick={() => go(step.next.key)}>
                Next: {step.next.label}
              </Button>
            )}
          </div>
        </div>
      </div>
      <TabPanel tabsId={tabsId} value={step.key}>
        {page()}
      </TabPanel>
    </div>
  );
}

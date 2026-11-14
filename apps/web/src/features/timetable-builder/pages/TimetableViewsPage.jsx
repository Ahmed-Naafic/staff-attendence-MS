import { useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { FileDown, Sheet } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Alert, Button, Card, ErrorState, Input, Select, Skeleton, TabPanel, Tabs } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { loadAcademicYears } from '../../academic-years';
import { saveFile } from '../../attendance-reports/utils/exportRules.js';
import { useSession } from '../../auth';
import { loadOwnerBranches, loadSections } from '../../classes/data/classesApi.js';
import { pickYear } from '../../classes/utils/classRules.js';
import { loadTeachers } from '../../teaching/data/teachingApi.js';
import { ClassGrid, MasterGrid, TeacherGrid } from '../components/TimetableGrids.jsx';
import { downloadView, loadMasterView, loadSectionView, loadTeacherView } from '../data/builderApi.js';
import { DAY_NAMES, orderDays, timetableGaps } from '../utils/builderRules.js';

const KINDS = ['section', 'teacher', 'master'];

/**
 * Timetable Views: a class's timetable, a teacher's timetable (every class and branch they teach)
 * and the branch's master timetable, as published on a date or as the open draft, with Excel and
 * PDF downloads.
 */
export default function TimetableViewsPage() {
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
  const [downloading, setDownloading] = useState('');
  const [error, setError] = useState('');
  const [day, setDay] = useState('');
  const kind = KINDS.includes(params.get('view')) ? params.get('view') : 'section';
  const source = params.get('source') === 'draft' ? 'draft' : 'published';
  const date = params.get('date') ?? '';

  const years = useApiData(() => loadAcademicYears(role), `years|${role}`);
  const year = pickYear(years.data?.items ?? [], params.get('year'));
  const branches = useApiData(() => (owner ? loadOwnerBranches() : Promise.resolve([])), `branches|${role}`);
  const branch = owner ? params.get('branch') || branches.data?.[0]?.id || '' : '';
  const sections = useApiData(() => (year ? loadSections(role, { academicYear: year.id, branch, status: 'active' }) : Promise.resolve(null)), `sections|${year?.id}|${branch}`);
  const teachers = useApiData(() => (year ? loadTeachers(role, { academicYear: year.id, show: 'all' }) : Promise.resolve(null)), `teachers|${year?.id}`);
  const sectionId = params.get('section') || sections.data?.items?.[0]?.id || '';
  const teacherId = params.get('teacher') || teachers.data?.items?.find((t) => t.suggested)?.id || teachers.data?.items?.[0]?.id || '';
  const query = { academicYear: year?.id, branch, date, source };
  const target = kind === 'section' ? sectionId : kind === 'teacher' ? teacherId : branch || 'mine';
  const view = useApiData(
    () => {
      if (!year || !target) return Promise.resolve(null);
      if (kind === 'master') return loadMasterView(role, query);
      if (kind === 'section') return loadSectionView(role, sectionId, query);
      return loadTeacherView(role, teacherId, query);
    },
    `view|${kind}|${target}|${year?.id}|${branch}|${date}|${source}`,
  );
  const v = view.data && view.data.kind === kind ? view.data : null;

  async function download(format) {
    setDownloading(format);
    setError('');
    try {
      const { blob, filename } = await downloadView(role, kind, kind === 'section' ? sectionId : teacherId, query, format);
      saveFile(blob, filename);
    } catch (e) {
      setError(e.message || 'The file could not be downloaded.');
    } finally {
      setDownloading('');
    }
  }

  const days = v ? orderDays(v.days) : [];
  const activeDay = days.includes(day) ? day : days[0];
  const gaps = timetableGaps(v);
  return (
    <PageContainer>
      <PageHeader
        title="Timetable Views"
        description="The class, teacher and master timetables, as published or as the draft being prepared."
        secondaryActions={
          v && (
            <>
              <Button variant="outline" leftIcon={Sheet} loading={downloading === 'xlsx'} onClick={() => download('xlsx')}>
                Excel
              </Button>
              <Button variant="outline" leftIcon={FileDown} loading={downloading === 'pdf'} onClick={() => download('pdf')}>
                PDF
              </Button>
            </>
          )
        }
      />
      {error && (
        <Alert variant="error" onDismiss={() => setError('')}>
          {error}
        </Alert>
      )}
      <Tabs
        id={tabsId}
        label="Timetable"
        tabs={[
          { value: 'section', label: 'Class' },
          { value: 'teacher', label: 'Teacher' },
          { value: 'master', label: 'Master' },
        ]}
        value={kind}
        onChange={(next) => set('view', next === 'section' ? '' : next)}
      />
      <Card as="section" aria-label="Timetable filters" className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Select label="Academic year" options={(years.data?.items ?? []).map((y) => ({ value: y.id, label: y.name }))} value={year?.id ?? ''} onChange={(e) => set('year', e.target.value)} />
          {owner && kind !== 'teacher' && (
            <Select label="Branch" options={(branches.data ?? []).map((x) => ({ value: x.id, label: x.name }))} value={branch} onChange={(e) => set('branch', e.target.value)} />
          )}
          {kind === 'section' && (
            <Select label="Class" options={(sections.data?.items ?? []).map((s) => ({ value: s.id, label: s.displayName }))} value={sectionId} onChange={(e) => set('section', e.target.value)} />
          )}
          {kind === 'teacher' && (
            <Select
              label="Teacher"
              options={(teachers.data?.items ?? []).map((t) => ({ value: t.id, label: `${t.name} (${t.staffId})` }))}
              value={teacherId}
              onChange={(e) => set('teacher', e.target.value)}
            />
          )}
          <Select
            label="Show"
            options={[
              { value: 'published', label: 'Published' },
              { value: 'draft', label: 'Draft (not published)' },
            ]}
            value={source}
            onChange={(e) => set('source', e.target.value === 'published' ? '' : e.target.value)}
          />
          {source === 'published' && <Input label="On" type="date" value={date || v?.date || ''} onChange={(e) => set('date', e.target.value)} />}
        </div>
      </Card>
      {view.status === 'error' && !v && <ErrorState title="The timetable could not be loaded" description={view.error?.message} onRetry={view.retry} />}
      {!v && view.status !== 'error' && target && <Skeleton className="h-64" />}
      <TabPanel tabsId={tabsId} value={kind}>
        {v && (
          <Card className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-card-title text-fg">
                  {kind === 'section' ? v.section.displayName : kind === 'teacher' ? `${v.teacher.name} (${v.teacher.staffId})` : v.branch.name}
                </h2>
                <p className="text-small text-fg-muted">
                  {source === 'draft' ? `Draft planned for ${v.date} — not published.` : `In effect on ${v.date}.`}
                  {kind === 'section' && v.bell ? ` Bell schedule: ${v.bell.name}.` : ''}
                  {kind === 'teacher' ? ` ${v.total} lesson${v.total === 1 ? '' : 's'} a week.` : ''}
                  {kind === 'master' ? ` ${v.sections.length} classes, ${v.teachers.length} teachers.` : ''}
                </p>
              </div>
              {kind === 'master' && days.length > 0 && (
                <Select label="Day" fieldClassName="w-48" options={days.map((d) => ({ value: d, label: DAY_NAMES[d] }))} value={activeDay} onChange={(e) => setDay(e.target.value)} />
              )}
            </div>
            {v.nextStart && (
              <Alert
                variant="info"
                title={kind === 'master' && days.length ? 'Some classes have no timetable on this day' : `No timetable on ${v.date}`}
                action={
                  <Button size="sm" variant="outline" onClick={() => set('date', v.nextStart)}>
                    Show {v.nextStart}
                  </Button>
                }
              >
                The published timetable starts on {v.nextStart}. Days before it keep the timetable they had.
              </Alert>
            )}
            {gaps && (
              <Alert
                variant="warning"
                title="This published timetable no longer fits the school week"
                action={
                  <Link to="/timetable-builder" className="text-small font-medium text-interactive underline-offset-2 hover:underline">
                    Open Timetable Builder
                  </Link>
                }
              >
                {gaps.empty > 0 && `${gaps.empty} empty period${gaps.empty === 1 ? '' : 's'} in ${gaps.classes.length === 1 ? gaps.classes[0] : `${gaps.classes.length} classes`}. `}
                {gaps.offDay > 0 && `${gaps.offDay} lesson${gaps.offDay === 1 ? ' is' : 's are'} on ${gaps.offDays.map((d) => DAY_NAMES[d]).join(', ')}, which ${gaps.offDays.length === 1 ? 'is' : 'are'} no longer a school day, and ${gaps.offDay === 1 ? 'is' : 'are'} not shown. `}
                It was published before the school days, bell times or lessons per week changed. Generate and publish a new timetable in the Timetable Builder.
              </Alert>
            )}
            {!days.length && !v.nextStart && <p className="text-body text-fg-secondary">No timetable {source === 'draft' ? 'in the draft' : 'on this day'}. Generate and publish one in the Timetable Builder.</p>}
            {days.length > 0 && kind === 'section' && <ClassGrid caption={`Timetable of ${v.section.displayName}`} days={days} periods={v.periods} lessons={v.lessons} />}
            {days.length > 0 && kind === 'teacher' && <TeacherGrid view={{ ...v, days }} />}
            {days.length > 0 && kind === 'master' && <MasterGrid sections={v.sections} day={activeDay} />}
          </Card>
        )}
      </TabPanel>
    </PageContainer>
  );
}

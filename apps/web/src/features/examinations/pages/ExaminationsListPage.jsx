import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CalendarCheck, CalendarClock, ClipboardList, FilePen, Plus, Search } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  ConfirmModal,
  DropdownMenu,
  ErrorState,
  Input,
  KpiCard,
  Select,
  Table,
  TableActions,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableLoading,
  TableRow,
} from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { loadAcademicYears } from '../../academic-years';
import { ExamPage, ExamStateBadge, useExamRole } from '../components/ExamGate.jsx';
import { ExaminationModal, ExamStopModal } from '../components/ExaminationModals.jsx';
import { loadExaminationOptions, loadExaminations, scheduleExamination, unscheduleExamination } from '../data/examApi.js';
import { EXAM_SCOPE_OPTIONS, EXAM_STATE_OPTIONS, examScopeText } from '../utils/examRules.js';

/** Examinations → Examinations: every examination of a year, filtered, with what can be done to each. */
export default function ExaminationsListPage() {
  const role = useExamRole();
  const owner = role === 'OWNER';
  const navigate = useNavigate();
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState(null);
  const [notice, setNotice] = useState('');
  // ?state=draft (e.g. from a page that only lists scheduled examinations) opens the list on that status.
  const [params] = useSearchParams();
  const startState = EXAM_STATE_OPTIONS.some((o) => o.value === params.get('state')) ? params.get('state') : 'all';
  const [filters, setFilters] = useState({ yearId: '', period: '', scope: 'all', branch: '', state: startState, q: '' });
  const setFilter = (key) => (e) => setFilters((f) => ({ ...f, [key]: e.target.value, ...(key === 'yearId' && { period: '' }) }));

  const years = useApiData(() => loadAcademicYears(role), `years|${role}`);
  const year = filters.yearId || years.data?.current?.id || years.data?.items?.[0]?.id || '';
  const options = useApiData(() => (year ? loadExaminationOptions(role, { academicYear: year }) : Promise.resolve(null)), `exam-options|${role}|${year}|${version}`);
  const list = useApiData(
    () => (year ? loadExaminations(role, { academicYear: year, period: filters.period, scope: filters.scope, branch: filters.branch, state: filters.state, q: filters.q.trim() }) : Promise.resolve(null)),
    `exams|${role}|${year}|${filters.period}|${filters.scope}|${filters.branch}|${filters.state}|${filters.q.trim()}|${version}`,
    { delayMs: filters.q ? 300 : 0 },
  );
  const items = list.data?.items ?? [];
  const counts = list.data?.counts;
  const closed = list.data?.academicYear?.status === 'closed';
  const refresh = (message) => {
    setDialog(null);
    if (message) setNotice(message);
    setVersion((n) => n + 1);
  };
  const canCreate = Boolean(list.data?.canCreate && options.data);

  const menu = (exam) => {
    const a = exam.actions;
    const entries = [{ label: 'View', onSelect: () => navigate(`/examinations/list/${exam.id}`) }];
    if (a.edit) entries.push({ label: 'Edit', onSelect: () => setDialog({ type: 'edit', exam }) });
    if (a.schedule) entries.push({ label: 'Schedule', onSelect: () => setDialog({ type: 'schedule', exam }) });
    if (a.unschedule) entries.push({ label: 'Back to draft', onSelect: () => setDialog({ type: 'unschedule', exam }) });
    if (a.cancel) entries.push({ type: 'separator' }, { label: a.cancel === 'end' ? 'End early' : 'Cancel', destructive: true, onSelect: () => setDialog({ type: 'stop', exam, mode: a.cancel }) });
    return entries;
  };

  return (
    <ExamPage
      title="Examinations"
      description={owner ? 'Create, schedule and follow your school’s examinations.' : 'Your school’s examinations and your branch’s own.'}
      primaryAction={
        canCreate && (
          <Button leftIcon={Plus} onClick={() => setDialog({ type: 'create' })}>
            New Examination
          </Button>
        )
      }
    >
      {() => (
        <>
          {notice && (
            <Alert variant="success" onDismiss={() => setNotice('')}>
              {notice}
            </Alert>
          )}
          {list.data && !list.data.canCreate && !closed && !owner && (
            <Alert variant="info">Your School Owner manages examinations. You can see them and your branch’s own.</Alert>
          )}
          {counts && (
            <ul className="grid grid-cols-2 gap-4 xl:grid-cols-4" aria-label="Examinations by status">
              <li><KpiCard label="Active" value={counts.active} icon={CalendarCheck} tone="success" note="Being held now" /></li>
              <li><KpiCard label="Planned" value={counts.planned} icon={CalendarClock} tone="info" note="Scheduled, not started" /></li>
              <li><KpiCard label="Drafts" value={counts.draft} icon={FilePen} tone="warning" note="Not on the calendar yet" /></li>
              <li><KpiCard label="Completed" value={counts.completed} icon={ClipboardList} note={`${counts.cancelled} cancelled`} /></li>
            </ul>
          )}
          <Card as="section" aria-label="Examinations" className="overflow-hidden">
            <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2 lg:grid-cols-6">
              <Input
                label="Search"
                hideLabel
                type="search"
                leftIcon={Search}
                placeholder="Search examinations…"
                value={filters.q}
                onChange={setFilter('q')}
                fieldClassName="sm:col-span-2 lg:col-span-6"
              />
              <Select
                label="Academic year"
                options={(years.data?.items ?? []).map((y) => ({ value: y.id, label: `${y.name}${y.status === 'current' ? ' (current)' : y.status === 'closed' ? ' (closed)' : ''}` }))}
                value={year}
                onChange={setFilter('yearId')}
                disabled={!years.data?.items?.length}
              />
              <Select label="Period" options={[{ value: '', label: 'All periods' }, ...(options.data?.periods ?? []).map((p) => ({ value: p.id, label: p.name }))]} value={filters.period} onChange={setFilter('period')} />
              <Select label="Scope" options={EXAM_SCOPE_OPTIONS} value={filters.scope} onChange={setFilter('scope')} />
              {owner && <Select label="Branch" options={[{ value: '', label: 'All branches' }, ...(options.data?.branches ?? []).map((b) => ({ value: b.id, label: b.name }))]} value={filters.branch} onChange={setFilter('branch')} />}
              <Select label="Status" options={EXAM_STATE_OPTIONS} value={filters.state} onChange={setFilter('state')} />
            </div>
            {list.status === 'error' && !list.data ? (
              <ErrorState title="Examinations could not be loaded" description="Check your connection and try again." onRetry={list.retry} />
            ) : (
              <div role="region" aria-label="Examinations table" tabIndex={0} className="overflow-x-auto">
                <Table caption="Examinations of the year by first day">
                  <TableHead>
                    <TableRow interactive={false}>
                      <TableHeaderCell>#</TableHeaderCell>
                      <TableHeaderCell>Examination</TableHeaderCell>
                      <TableHeaderCell>Period</TableHeaderCell>
                      <TableHeaderCell>Scope</TableHeaderCell>
                      <TableHeaderCell>First Day</TableHeaderCell>
                      <TableHeaderCell>Last Day</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell align="right">Actions</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {year && !list.data && <TableLoading columns={8} />}
                    {years.data && !years.data.items.length && <TableEmpty columns={8} icon={ClipboardList} title="No academic years yet" description="Add an academic year under School Schedule first." />}
                    {list.data && !items.length && (
                      <TableEmpty
                        columns={8}
                        icon={ClipboardList}
                        title={filters.q || filters.state !== 'all' || filters.period || filters.scope !== 'all' || filters.branch ? 'No examinations match' : 'No examinations yet'}
                        description={list.data.canCreate ? 'Create one with New Examination: it starts as a draft and goes on the calendar when you schedule it.' : 'Examinations of this year appear here.'}
                      />
                    )}
                    {items.map((exam, i) => (
                      <TableRow key={exam.id}>
                        <TableCell className="tabular-nums text-fg-secondary">{i + 1}</TableCell>
                        <TableCell>
                          <Link to={`/examinations/list/${exam.id}`} className="font-medium text-fg underline-offset-2 hover:underline">
                            {exam.name}
                          </Link>
                          <span className="block text-caption text-fg-muted">
                            {exam.examType.name} · {exam.classes.length} class{exam.classes.length === 1 ? '' : 'es'} · {exam.papers} paper{exam.papers === 1 ? '' : 's'}
                            {!exam.stopsLessons && ' · lessons go on'}
                          </span>
                        </TableCell>
                        <TableCell>{exam.period?.name ?? <span className="text-fg-muted">Whole year</span>}</TableCell>
                        <TableCell>{examScopeText(exam)}</TableCell>
                        <TableCell className="tabular-nums">{exam.startDate}</TableCell>
                        <TableCell className="tabular-nums">{exam.endDate}</TableCell>
                        <TableCell><ExamStateBadge state={exam.state} /></TableCell>
                        <TableCell align="right">
                          <TableActions>
                            <DropdownMenu label={`Actions for ${exam.name}`} items={menu(exam)} />
                          </TableActions>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </Card>

          <ExaminationModal
            role={role}
            options={options.data}
            detail={dialog?.type === 'edit' ? { examination: dialog.exam } : null}
            open={dialog?.type === 'create' || dialog?.type === 'edit'}
            onClose={() => setDialog(null)}
            onSaved={(r, changed) => {
              if (dialog?.type === 'create') navigate(`/examinations/list/${r.examination.id}`);
              else refresh(changed ? `${r.examination.name} saved.` : '');
            }}
          />
          <ConfirmModal
            open={dialog?.type === 'schedule'}
            onClose={() => setDialog(null)}
            title={`Schedule ${dialog?.exam?.name ?? ''}`}
            description={
              dialog?.exam?.stopsLessons
                ? `It goes on the academic calendar. From ${dialog?.exam?.startDate} to ${dialog?.exam?.endDate} its classes have no normal lessons in ${dialog?.exam ? examScopeText(dialog.exam).replace('School-wide', 'every branch') : ''}.`
                : 'It goes on the academic calendar. Its classes keep their normal lessons.'
            }
            confirmLabel="Schedule"
            variant="primary"
            run={() => scheduleExamination(role, dialog.exam.id)}
            onDone={(r) => refresh(`${r.examination.name} is scheduled.`)}
          />
          <ConfirmModal
            open={dialog?.type === 'unschedule'}
            onClose={() => setDialog(null)}
            title={`Return ${dialog?.exam?.name ?? ''} to Draft`}
            description="It comes off the calendar and its classes keep their normal lessons until you schedule it again."
            confirmLabel="Back to Draft"
            variant="primary"
            run={() => unscheduleExamination(role, dialog.exam.id)}
            onDone={(r) => refresh(`${r.examination.name} is a draft again.`)}
          />
          <ExamStopModal
            role={role}
            exam={dialog?.exam}
            mode={dialog?.mode}
            open={dialog?.type === 'stop'}
            onClose={() => setDialog(null)}
            onDone={(r) => refresh(dialog?.mode === 'end' ? `${r.examination.name} ended early.` : `${r.examination.name} is cancelled.`)}
          />
        </>
      )}
    </ExamPage>
  );
}

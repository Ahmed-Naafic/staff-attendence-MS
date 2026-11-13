import { useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import { FileCheck, Plus } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmModal,
  Input,
  LinkButton,
  Modal,
  Pagination,
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
  Textarea,
} from '../../../components/ui';
import { requestFailure, useDialogForm } from '../../../hooks/useDialogForm.js';
import { useApiData } from '../../../hooks/useApiData.js';
import { formatFullDay } from '../../../lib/format.js';
import { useSession } from '../../auth';
import { loadOwnerBranches } from '../../classes/data/classesApi.js';
import { loadStudents } from '../../students/data/studentsApi.js';
import { LoadFailure } from '../components/FeatureState.jsx';
import { cancelExcuse, createExcuse, loadExcuses } from '../data/studentAttendanceApi.js';
import { HALF_OPTIONS } from '../utils/attendanceRules.js';

const STATUS_VARIANTS = { current: 'info', upcoming: 'accent', past: 'neutral', cancelled: 'neutral' };
const STATUS_LABELS = { current: 'Current', upcoming: 'Upcoming', past: 'Past', cancelled: 'Cancelled' };

/**
 * Excuses: a student excused for whole days, one half of each day, or some lessons, with a reason.
 * They are kept apart from the marks and applied when attendance is read. Managers record and
 * cancel them for their branch's students; School Owners read every branch's.
 */
export default function StudentExcusesPage() {
  const { user } = useSession();
  const owner = user.role === 'OWNER';
  const role = owner ? 'OWNER' : 'MANAGER';
  const [params, setParams] = useSearchParams();
  const set = (name, value) =>
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(name, value);
      else next.delete(name);
      if (name !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  const filters = { status: params.get('status') ?? 'active', branch: owner ? (params.get('branch') ?? '') : '', page: Number(params.get('page') ?? 1), pageSize: 20 };
  const list = useApiData(() => loadExcuses(role, filters), `excuses|${role}|${JSON.stringify(filters)}`);
  const branches = useApiData(() => (owner ? loadOwnerBranches() : Promise.resolve([])), `branches|${role}`);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [notice, setNotice] = useState('');
  const items = list.data?.items ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="Student Excuses"
        description="Excused students count as excused when absent or not marked; a student marked present or late came anyway."
        breadcrumbs={[{ label: 'Student Attendance', to: '/student-attendance' }, { label: 'Excuses' }]}
        secondaryActions={<LinkButton to="/student-attendance" variant="outline">Attendance</LinkButton>}
        primaryAction={
          !owner && list.data ? (
            <Button leftIcon={Plus} onClick={() => setCreating(true)}>
              Excuse a student
            </Button>
          ) : undefined
        }
      />
      {notice && (
        <Alert variant="success" onDismiss={() => setNotice('')}>
          {notice}
        </Alert>
      )}
      <Card as="section" aria-label="Filters" className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label="Show"
            options={[
              { value: 'active', label: 'Active excuses' },
              { value: 'cancelled', label: 'Cancelled' },
              { value: 'all', label: 'All' },
            ]}
            value={filters.status}
            onChange={(e) => set('status', e.target.value === 'active' ? '' : e.target.value)}
          />
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
      {list.status === 'error' && !list.data ? (
        <LoadFailure error={list.error} onRetry={list.retry} owner={owner} what="Excuses" />
      ) : (
        <Card className="overflow-hidden">
          <div role="region" aria-label="Excuses" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
            <Table caption="Student excuses">
              <TableHead>
                <TableRow interactive={false}>
                  <TableHeaderCell>Student</TableHeaderCell>
                  <TableHeaderCell>Days</TableHeaderCell>
                  <TableHeaderCell>Covers</TableHeaderCell>
                  <TableHeaderCell>Reason</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  {!owner && <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {!list.data && <TableLoading columns={owner ? 5 : 6} />}
                {list.data && !items.length && <TableEmpty columns={owner ? 5 : 6} icon={FileCheck} title="No excuses" description={owner ? 'Excuses recorded by the Managers appear here.' : 'Excuse a student for days, half days or lessons.'} />}
                {items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap">
                      <span className="font-medium">{e.student.name}</span>
                      <span className="block text-caption text-fg-muted">
                        {e.student.number}
                        {owner && ` · ${e.branch.name}`}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-fg-secondary">{e.startDate === e.endDate ? formatFullDay(e.startDate) : `${formatFullDay(e.startDate)} – ${formatFullDay(e.endDate)}`}</TableCell>
                    <TableCell className="text-fg-secondary">{e.covers}</TableCell>
                    <TableCell>
                      {e.reason}
                      {e.note && <span className="block text-caption text-fg-muted">{e.note}</span>}
                      <span className="block text-caption text-fg-muted">By {e.createdBy}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[e.status]}>{STATUS_LABELS[e.status]}</Badge>
                    </TableCell>
                    {!owner && (
                      <TableCell>
                        {e.status !== 'cancelled' && (
                          <TableActions>
                            <Button size="sm" variant="ghost" onClick={() => setCancelling(e)}>
                              Cancel
                            </Button>
                          </TableActions>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {list.data && list.data.total > list.data.pageSize && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPageChange={(p) => set('page', String(p))} itemLabel="excuses" />}
        </Card>
      )}
      <ExcuseModal
        open={creating}
        onClose={() => setCreating(false)}
        onDone={(excuse) => {
          setCreating(false);
          setNotice(`${excuse.student.name} is excused (${excuse.covers}).`);
          list.retry();
        }}
      />
      <ConfirmModal
        open={Boolean(cancelling)}
        onClose={() => setCancelling(null)}
        title="Cancel this excuse?"
        description={cancelling ? `${cancelling.student.name}, ${cancelling.covers}: “${cancelling.reason}”. Attendance on these days will count as marked again.` : ''}
        confirmLabel="Cancel excuse"
        run={() => cancelExcuse(cancelling.id)}
        onDone={() => {
          setCancelling(null);
          setNotice('The excuse is cancelled.');
          list.retry();
        }}
      />
    </PageContainer>
  );
}

const EMPTY = { student: '', studentLabel: '', startDate: '', endDate: '', half: '', periods: '', reason: '', note: '' };

function ExcuseModal({ open, onClose, onDone }) {
  const formId = useId();
  const form = useDialogForm(open, EMPTY, (error) => requestFailure(error, { notFound: 'This student is not registered in your branch.' }));
  const [query, setQuery] = useState('');
  const found = useApiData(() => (open && query.trim().length >= 2 ? loadStudents('MANAGER', { q: query.trim(), pageSize: 8 }) : Promise.resolve(null)), `excuse-students|${open}|${query}`, { delayMs: 250 });
  const v = form.values;
  const field = (name) => ({ value: v[name], error: form.errors[name], onChange: (e) => form.set(name, e.target.value) });

  function submit(event) {
    event.preventDefault();
    const problems = {};
    if (!v.student) problems.student = 'Choose a student.';
    if (!v.startDate) problems.startDate = 'Choose the first day.';
    if (v.endDate && v.startDate && v.endDate < v.startDate) problems.endDate = 'The last day cannot be before the first.';
    if (v.reason.trim().length < 2) problems.reason = 'Give the reason for the excuse.';
    const periods = v.periods.trim() ? v.periods.split(/[\s,]+/).filter(Boolean).map(Number) : [];
    if (periods.some((p) => !Number.isInteger(p) || p < 1 || p > 20)) problems.periods = 'Lesson periods are numbers from 1 to 20, e.g. 3, 4.';
    if (periods.length && v.half) problems.periods = 'Choose a half of the day or some lessons, not both.';
    form.submit(
      problems,
      ['student', 'startDate', 'endDate', 'half', 'periods', 'reason', 'note'],
      () => createExcuse({ student: v.student, startDate: v.startDate, endDate: v.endDate || v.startDate, half: v.half || null, periods, reason: v.reason.trim(), note: v.note.trim() || null }),
      onDone,
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Excuse a student"
      description="For days already passed (within the correction period) or planned ahead, e.g. a medical leave."
      loading={form.saving}
      error={form.formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" form={formId}>
            Save excuse
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {v.student ? (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border p-3">
            <span className="font-medium">{v.studentLabel}</span>
            <Button size="sm" variant="ghost" onClick={() => form.set('student', '')}>
              Change
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Input label="Student" placeholder="Name or Student ID" value={query} error={form.errors.student} onChange={(e) => setQuery(e.target.value)} />
            {(found.data?.items ?? []).length > 0 && (
              <ul className="max-h-48 overflow-y-auto rounded-md border border-border">
                {found.data.items.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="w-full px-3 py-2 text-left hover:bg-muted"
                      onClick={() => {
                        form.set('student', s.id);
                        form.set('studentLabel', `${s.fullName} (${s.studentNumber})`);
                      }}
                    >
                      {s.fullName} <span className="text-caption text-fg-muted">{s.studentNumber}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query.trim().length >= 2 && found.data && !found.data.items.length && <p className="text-caption text-fg-muted">No students found in your branch.</p>}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="First day" type="date" required {...field('startDate')} />
          <Input label="Last day" type="date" hint="Empty: the first day only." {...field('endDate')} />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select label="Part of each day" options={HALF_OPTIONS} {...field('half')} />
          <Input label="Only these lessons (optional)" placeholder="e.g. 3, 4" hint="Lesson periods, for teachers’ lesson attendance." {...field('periods')} />
        </div>
        <Input label="Reason" required maxLength={200} {...field('reason')} />
        <Textarea label="Note (optional)" rows={2} maxLength={300} {...field('note')} />
      </form>
    </Modal>
  );
}

import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { CalendarCheck, CircleAlert, Download, Percent, Users } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import {
  Alert,
  Badge,
  Button,
  Card,
  Drawer,
  Input,
  KpiCard,
  LoadingState,
  Pagination,
  Select,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableLoading,
  TableRow,
} from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { useSession } from '../../auth';
import { saveFile } from '../../attendance-reports/utils/exportRules.js';
import { loadOwnerBranches } from '../../classes/data/classesApi.js';
import { LoadFailure } from '../components/FeatureState.jsx';
import { downloadReport, loadReport, loadStudentHistory } from '../data/studentAttendanceApi.js';
import { EFFECTIVE_LABELS, EFFECTIVE_VARIANTS } from '../utils/attendanceRules.js';

const SOURCES = [
  { value: 'manager', label: 'Daily attendance (Managers)' },
  { value: 'lessons', label: 'Lesson attendance (teachers)' },
];
const rateText = (rate) => (rate === null || rate === undefined ? '—' : `${rate}%`);
const rateVariant = (rate, below = 80) => (rate === null ? 'neutral' : rate < below ? 'error' : rate < 90 ? 'warning' : 'success');

/**
 * Student attendance reports: totals, each section (attendance taken and the rate), and each
 * student (lowest rate first), from the Managers' daily sessions or the teachers' lessons, with
 * excuses applied. Exports to CSV and Excel. School Owner: every branch or one; Manager: their branch.
 */
export default function StudentAttendanceReportsPage() {
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
      if (name === 'source') next.delete('subject');
      return next;
    }, { replace: true });
  const filters = {
    from: params.get('from') || undefined,
    to: params.get('to') || undefined,
    source: params.get('source') || 'manager',
    branch: owner ? params.get('branch') || undefined : undefined,
    class: params.get('class') || undefined,
    section: params.get('section') || undefined,
    subject: params.get('subject') || undefined,
    below: params.get('below') || undefined,
    page: Number(params.get('page') || 1),
    pageSize: 25,
  };
  const report = useApiData(() => loadReport(role, filters), `report|${role}|${JSON.stringify(filters)}`);
  const branches = useApiData(() => (owner ? loadOwnerBranches() : Promise.resolve([])), `branches|${role}`);
  const [exporting, setExporting] = useState('');
  const [exportError, setExportError] = useState('');
  const [student, setStudent] = useState(null);
  const data = report.data;
  const t = data?.totals;

  async function exportAs(format) {
    setExporting(format);
    setExportError('');
    try {
      const file = await downloadReport(role, filters, format);
      saveFile(file.blob, file.filename);
    } catch (error) {
      setExportError(error.message || 'The export failed. Try again.');
    } finally {
      setExporting('');
    }
  }

  const sectionOptions = (data?.options.sections ?? []).filter((s) => (!filters.class || s.classId === filters.class) && (!filters.branch || s.branchId === filters.branch));
  return (
    <PageContainer>
      <PageHeader
        title="Student Attendance Reports"
        description="Attendance rate = (present + late) ÷ (present + late + absent). Excused and unmarked students are never counted as absent."
        breadcrumbs={[{ label: 'Student Attendance', to: '/student-attendance' }, { label: 'Reports' }]}
        secondaryActions={
          <Button variant="outline" leftIcon={Download} loading={exporting === 'csv'} disabled={!data || Boolean(exporting)} onClick={() => exportAs('csv')}>
            CSV
          </Button>
        }
        primaryAction={
          <Button variant="outline" leftIcon={Download} loading={exporting === 'xlsx'} disabled={!data || Boolean(exporting)} onClick={() => exportAs('xlsx')}>
            Excel
          </Button>
        }
      />
      {exportError && (
        <Alert variant="error" onDismiss={() => setExportError('')}>
          {exportError}
        </Alert>
      )}
      <Card as="section" aria-label="Filters" className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input label="From" type="date" value={data?.filters.from ?? filters.from ?? ''} onChange={(e) => set('from', e.target.value)} hint="At most 93 days." />
          <Input label="To" type="date" value={data?.filters.to ?? filters.to ?? ''} onChange={(e) => set('to', e.target.value)} />
          <Select label="Attendance" options={SOURCES} value={filters.source} onChange={(e) => set('source', e.target.value === 'manager' ? '' : e.target.value)} />
          {owner && (
            <Select
              label="Branch"
              options={[{ value: '', label: 'All branches' }, ...(branches.data ?? []).map((b) => ({ value: b.id, label: `${b.name} (${b.code})` }))]}
              value={filters.branch ?? ''}
              onChange={(e) => set('branch', e.target.value)}
            />
          )}
          <Select label="Class" options={[{ value: '', label: 'All classes' }, ...(data?.options.classes ?? []).map((c) => ({ value: c.id, label: c.name }))]} value={filters.class ?? ''} onChange={(e) => set('class', e.target.value)} />
          <Select label="Section" options={[{ value: '', label: 'All sections' }, ...sectionOptions.map((s) => ({ value: s.id, label: s.displayName }))]} value={filters.section ?? ''} onChange={(e) => set('section', e.target.value)} />
          {filters.source === 'lessons' && (
            <Select label="Subject" options={[{ value: '', label: 'All subjects' }, ...(data?.options.subjects ?? []).map((s) => ({ value: s.id, label: s.name }))]} value={filters.subject ?? ''} onChange={(e) => set('subject', e.target.value)} />
          )}
          <Select
            label="Students"
            options={[
              { value: '', label: 'All students' },
              { value: '90', label: 'Below 90%' },
              { value: '80', label: 'Below 80%' },
              { value: '70', label: 'Below 70%' },
            ]}
            value={filters.below ?? ''}
            onChange={(e) => set('below', e.target.value)}
          />
        </div>
      </Card>

      {report.status === 'error' && !data ? (
        <LoadFailure error={report.error} onRetry={report.retry} owner={owner} what="The report" />
      ) : (
        <>
          {t && (
            <ul aria-label="Totals" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <KpiCard label="Attendance rate" value={t.rate ?? 0} icon={Percent} tone={t.rate === null ? 'info' : t.rate < 80 ? 'error' : t.rate < 90 ? 'warning' : 'success'} note={t.rate === null ? 'Nothing counted' : `${t.present + t.late} of ${t.present + t.late + t.absent}`} />
              <KpiCard label="Students" value={t.students} icon={Users} />
              <KpiCard label="Absent marks" value={t.absent} icon={CircleAlert} tone={t.absent ? 'warning' : 'info'} note={`${t.excused} excused · ${t.notMarked} not marked`} />
              <KpiCard label={filters.source === 'manager' ? 'Sessions taken' : 'Lessons taken'} value={t.completion.taken} icon={CalendarCheck} note={`of ${t.completion.expected} expected`} />
            </ul>
          )}

          <Card className="overflow-hidden">
            <div role="region" aria-label="Sections" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
              <Table caption="Sections">
                <TableHead>
                  <TableRow interactive={false}>
                    <TableHeaderCell>Section</TableHeaderCell>
                    <TableHeaderCell>Taken</TableHeaderCell>
                    <TableHeaderCell>Present</TableHeaderCell>
                    <TableHeaderCell>Late</TableHeaderCell>
                    <TableHeaderCell>Absent</TableHeaderCell>
                    <TableHeaderCell>Excused</TableHeaderCell>
                    <TableHeaderCell>Not marked</TableHeaderCell>
                    <TableHeaderCell>Rate</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {!data && <TableLoading columns={8} />}
                  {data && !data.sections.length && <TableEmpty columns={8} icon={CalendarCheck} title="No attendance in these dates" description="Change the dates or filters." />}
                  {data?.sections.map((s) => (
                    <TableRow key={s.section.id}>
                      <TableCell className="whitespace-nowrap">
                        <span className="font-medium">{s.section.displayName}</span>
                        {owner && <span className="block text-caption text-fg-muted">{s.section.branch.name}</span>}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {s.completion.taken}/{s.completion.expected}
                        {s.completion.missing > 0 && <span className="ml-1 text-caption text-error-fg">({s.completion.missing} missing)</span>}
                      </TableCell>
                      <TableCell className="tabular-nums">{s.counts.present}</TableCell>
                      <TableCell className="tabular-nums">{s.counts.late}</TableCell>
                      <TableCell className="tabular-nums">{s.counts.absent}</TableCell>
                      <TableCell className="tabular-nums">{s.counts.excused}</TableCell>
                      <TableCell className="tabular-nums">{s.counts.notMarked}</TableCell>
                      <TableCell>
                        <Badge variant={rateVariant(s.rate)}>{rateText(s.rate)}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div role="region" aria-label="Students" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
              <Table caption="Students, lowest attendance first">
                <TableHead>
                  <TableRow interactive={false}>
                    <TableHeaderCell>Student</TableHeaderCell>
                    <TableHeaderCell>Section</TableHeaderCell>
                    <TableHeaderCell>Present</TableHeaderCell>
                    <TableHeaderCell>Late</TableHeaderCell>
                    <TableHeaderCell>Absent</TableHeaderCell>
                    <TableHeaderCell>Excused</TableHeaderCell>
                    <TableHeaderCell>Not marked</TableHeaderCell>
                    <TableHeaderCell>Rate</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {!data && <TableLoading columns={8} />}
                  {data && !data.students.items.length && <TableEmpty columns={8} icon={Users} title="No students" description={filters.below ? `No student is below ${filters.below}%.` : 'Students with attendance in these dates appear here.'} />}
                  {data?.students.items.map((r) => (
                    <TableRow key={r.student.id}>
                      <TableCell className="whitespace-nowrap">
                        <button type="button" className="font-medium text-interactive underline-offset-2 hover:underline" onClick={() => setStudent(r.student)}>
                          {r.student.name}
                        </button>
                        <span className="block text-caption text-fg-muted">{r.student.number}</span>
                      </TableCell>
                      <TableCell className="text-fg-secondary">{r.sections.join(', ')}</TableCell>
                      <TableCell className="tabular-nums">{r.counts.present}</TableCell>
                      <TableCell className="tabular-nums">{r.counts.late}</TableCell>
                      <TableCell className="tabular-nums">{r.counts.absent}</TableCell>
                      <TableCell className="tabular-nums">{r.counts.excused}</TableCell>
                      <TableCell className="tabular-nums">{r.counts.notMarked}</TableCell>
                      <TableCell>
                        <Badge variant={rateVariant(r.rate, Number(filters.below) || 80)}>{rateText(r.rate)}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {data && data.students.total > data.students.pageSize && (
              <Pagination page={data.students.page} pageSize={data.students.pageSize} total={data.students.total} onPageChange={(p) => set('page', String(p))} itemLabel="students" />
            )}
          </Card>
        </>
      )}
      <StudentDrawer role={role} student={student} range={data?.filters} onClose={() => setStudent(null)} />
    </PageContainer>
  );
}

function StudentDrawer({ role, student, range, onClose }) {
  const history = useApiData(() => (student ? loadStudentHistory(role, student.id, { from: range?.from, to: range?.to }) : Promise.resolve(null)), `history|${student?.id}|${range?.from}|${range?.to}`);
  const h = history.data;
  return (
    <Drawer open={Boolean(student)} onClose={onClose} title={student?.name ?? 'Student'} description={student ? `${student.number}${range ? ` · ${range.from} to ${range.to}` : ''}` : ''}>
      {!h && history.status !== 'error' && <LoadingState />}
      {history.status === 'error' && <Alert variant="error">The attendance could not be loaded.</Alert>}
      {h && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Card className="p-3">
              <p className="text-caption text-fg-muted">Daily attendance</p>
              <p className="text-heading-sm font-semibold">{rateText(h.summary.manager.rate)}</p>
            </Card>
            <Card className="p-3">
              <p className="text-caption text-fg-muted">Lessons</p>
              <p className="text-heading-sm font-semibold">{rateText(h.summary.lessons.rate)}</p>
            </Card>
          </div>
          {!h.items.length && <p className="text-fg-muted">No attendance in these dates.</p>}
          <ul className="flex flex-col divide-y divide-border">
            {h.items.map((i) => (
              <li key={`${i.sessionId}`} className="flex items-start justify-between gap-3 py-2">
                <div>
                  <p className="text-body-sm font-medium">
                    {i.date} · {i.label}
                  </p>
                  <p className="text-caption text-fg-muted">
                    {i.section}
                    {i.markedBy ? ` · ${i.markedBy}` : ''}
                  </p>
                  {i.excuse && <p className="text-caption text-info-fg">Excused: {i.excuse}</p>}
                  {i.reason && <p className="text-caption text-fg-secondary">Reason: {i.reason}</p>}
                </div>
                <Badge variant={EFFECTIVE_VARIANTS[i.effective]}>{EFFECTIVE_LABELS[i.effective]}</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Drawer>
  );
}

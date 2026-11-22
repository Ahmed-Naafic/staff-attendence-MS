import { useEffect, useId, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ArrowLeft, PenLine } from 'lucide-react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Modal,
  Select,
  Table,
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
import { loadOwnerBranches } from '../../classes/data/classesApi.js';
import { DownloadButton } from '../components/DownloadButton.jsx';
import { ExamPage, useExamRole } from '../components/ExamGate.jsx';
import { approveMarkSheet, downloadMarkSheet, loadExaminations, loadMarkSheet, loadMarkSheets, returnMarkSheet, saveMarkSheet, submitMarkSheet } from '../data/examApi.js';
import { parseMark, SHEET_STATES } from '../utils/examRules.js';

const SheetBadge = ({ status }) => <Badge variant={SHEET_STATES[status]?.variant}>{SHEET_STATES[status]?.label ?? status}</Badge>;
const STATUS_OPTIONS = [{ value: 'all', label: 'All statuses' }, ...Object.entries(SHEET_STATES).map(([value, s]) => ({ value, label: s.label }))];

function ReturnModal({ open, onClose, onReturn }) {
  const formId = useId();
  const form = useDialogForm(open, { reason: '' }, (e) => requestFailure(e));
  const save = () => {
    const reason = form.values.reason.trim();
    return form.submit(reason.length < 3 || reason.length > 300 ? { reason: 'Say why (3–300 characters).' } : {}, ['reason'], () => onReturn(reason), onClose);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Return Marks"
      description="The marks go back to the subject teacher with your reason; they correct them and submit again."
      loading={form.saving}
      error={form.formError}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={form.saving}>Cancel</Button>
          <Button type="submit" form={formId} loading={form.saving} variant="danger">Return Marks</Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Textarea label="Reason" required rows={3} maxLength={300} value={form.values.reason} error={form.errors.reason} onChange={(e) => form.set('reason', e.target.value)} />
      </form>
    </Modal>
  );
}

/** One mark sheet: students, marks (or absent), and the steps (save, submit, approve, return). */
function SheetEditor({ role, paperId, sectionId, onBack, onChanged }) {
  const [version, setVersion] = useState(0);
  const data = useApiData(() => loadMarkSheet(role, paperId, sectionId), `sheet|${paperId}|${sectionId}|${version}`);
  const [typed, setTyped] = useState({});
  const [absent, setAbsent] = useState({});
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);
  const [returning, setReturning] = useState(false);
  const sheet = data.data;
  useEffect(() => {
    setTyped({});
    setAbsent({});
  }, [version]);
  if (data.status === 'error' && !sheet) return <ErrorState title="The mark sheet could not be loaded" description="Check your connection and try again." onRetry={data.retry} />;
  if (!sheet) return <LoadingState label="Loading marks…" />;
  const max = sheet.paper.maxMarks;
  const errors = Object.fromEntries(Object.entries(typed).map(([k, v]) => [k, parseMark(v, max).error]).filter(([, e]) => e));
  const changes = sheet.students
    .filter((r) => !r.lockedByAttendance && (typed[r.student.id] !== undefined || absent[r.student.id] !== undefined))
    .map((r) => {
      const isAbsent = absent[r.student.id] ?? r.absent;
      const value = typed[r.student.id] !== undefined ? parseMark(typed[r.student.id], max).value : r.marks;
      return { student: r.student.id, marks: isAbsent ? null : value, absent: isAbsent, before: r };
    })
    .filter((c) => c.marks !== c.before.marks || c.absent !== c.before.absent);
  const run = async (name, fn, done) => {
    setBusy(name);
    setMessage(null);
    try {
      await fn();
      setMessage({ variant: 'success', text: done });
      setVersion((n) => n + 1);
      onChanged();
    } catch (e) {
      setMessage({ variant: 'error', text: requestFailure(e) });
    } finally {
      setBusy('');
    }
  };
  const a = sheet.actions;
  return (
    <Card as="section" aria-labelledby="sheet-title" className="flex flex-col gap-4 p-5">
      <button type="button" onClick={onBack} className="inline-flex w-fit items-center gap-1.5 text-small font-medium text-interactive underline-offset-2 hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" /> All mark sheets
      </button>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="sheet-title" className="flex flex-wrap items-center gap-2 text-card-title text-fg">
            {sheet.paper.subject.name} · {sheet.section.name} <SheetBadge status={sheet.status} />
          </h2>
          <p className="text-small text-fg-secondary">
            {sheet.examination.name} · out of {max} · {sheet.satOn ? `sat on ${sheet.satOn}` : 'not timetabled'} · teacher’s deadline {sheet.deadline}
          </p>
          <p className="text-small text-fg-muted">
            {sheet.stats.entered}/{sheet.stats.students} entered · average {sheet.stats.average ?? '—'} ({sheet.stats.averagePercent ?? '—'}%) · highest {sheet.stats.highest ?? '—'} · lowest {sheet.stats.lowest ?? '—'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <DownloadButton load={() => downloadMarkSheet(role, paperId, sectionId, false)} onError={(text) => setMessage({ variant: 'error', text })}>PDF</DownloadButton>
          <DownloadButton load={() => downloadMarkSheet(role, paperId, sectionId, true)} onError={(text) => setMessage({ variant: 'error', text })}>Blank PDF</DownloadButton>
          {a.edit && (
            <Button size="sm" loading={busy === 'save'} disabled={!changes.length || Object.keys(errors).length > 0} onClick={() => run('save', () => saveMarkSheet(role, paperId, sectionId, changes.map(({ before, ...c }) => c)), 'Marks saved.')}>
              Save{changes.length ? ` (${changes.length})` : ''}
            </Button>
          )}
          {a.submit && !changes.length && <Button size="sm" variant="outline" loading={busy === 'submit'} onClick={() => run('submit', () => submitMarkSheet(role, paperId, sectionId), 'Marks submitted for approval.')}>Submit</Button>}
          {a.return && <Button size="sm" variant="danger" onClick={() => setReturning(true)}>{sheet.status === 'approved' ? 'Reopen' : 'Return'}</Button>}
          {a.approve && !changes.length && <Button size="sm" variant="secondary" loading={busy === 'approve'} onClick={() => run('approve', () => approveMarkSheet(role, paperId, sectionId), 'Marks approved.')}>Approve</Button>}
        </div>
      </div>
      {!sheet.opened && <Alert variant="info">Marks are entered once the paper has been sat.</Alert>}
      {sheet.resultsPublished && <Alert variant="info">The results of this class are published: these marks stay as they are.</Alert>}
      {sheet.returnedReason && sheet.status === 'returned' && <Alert variant="warning" title="Returned">{sheet.returnedReason}</Alert>}
      {message && <Alert variant={message.variant} onDismiss={() => setMessage(null)}>{message.text}</Alert>}
      <div className="overflow-x-auto">
        <Table caption={`Marks of ${sheet.section.name} in ${sheet.paper.subject.name}`}>
          <TableHead>
            <TableRow interactive={false}>
              <TableHeaderCell>#</TableHeaderCell>
              <TableHeaderCell>Student</TableHeaderCell>
              <TableHeaderCell>Admission No.</TableHeaderCell>
              <TableHeaderCell>Attendance</TableHeaderCell>
              <TableHeaderCell align="right">Marks ({max})</TableHeaderCell>
              <TableHeaderCell>Absent</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!sheet.students.length && <TableEmpty columns={6} icon={PenLine} title="No students" description="No students are enrolled or seated for this paper." />}
            {sheet.students.map((r, i) => {
              const isAbsent = absent[r.student.id] ?? r.absent;
              return (
                <TableRow key={r.student.id} interactive={false}>
                  <TableCell className="tabular-nums text-fg-secondary">{i + 1}</TableCell>
                  <TableCell>{r.student.name}</TableCell>
                  <TableCell className="tabular-nums">{r.student.number}</TableCell>
                  <TableCell>{r.attendance ? <Badge variant={r.lockedByAttendance ? 'warning' : 'neutral'}>{r.attendance}</Badge> : <span className="text-fg-muted">—</span>}</TableCell>
                  <TableCell align="right">
                    {a.edit && !r.lockedByAttendance && !isAbsent ? (
                      <Input
                        label={`Marks of ${r.student.name}`}
                        hideLabel
                        inputMode="decimal"
                        className="ml-auto w-24 text-right"
                        value={typed[r.student.id] ?? (r.marks ?? '')}
                        error={errors[r.student.id]}
                        onChange={(e) => setTyped((t) => ({ ...t, [r.student.id]: e.target.value }))}
                      />
                    ) : (
                      <span className="tabular-nums">{r.excused ? 'Excused' : isAbsent ? 'Absent' : (r.marks ?? '—')}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Checkbox
                      aria-label={`${r.student.name} absent`}
                      checked={isAbsent}
                      disabled={!a.edit || r.lockedByAttendance}
                      onChange={(e) => setAbsent((x) => ({ ...x, [r.student.id]: e.target.checked }))}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <ReturnModal
        open={returning}
        onClose={() => setReturning(false)}
        onReturn={async (reason) => {
          await returnMarkSheet(role, paperId, sectionId, reason);
          setMessage({ variant: 'success', text: 'Marks returned to the teacher.' });
          setVersion((n) => n + 1);
          onChanged();
        }}
      />
    </Card>
  );
}

/** Examinations → Marks Entry: every paper × section of an examination, and its marks. */
export default function ExamMarksPage() {
  const role = useExamRole();
  const owner = role === 'OWNER';
  const [params, setParams] = useSearchParams();
  const [version, setVersion] = useState(0);
  const exams = useApiData(() => loadExaminations(role, {}), `marks-exams|${role}`);
  const choices = (exams.data?.items ?? []).filter((e) => e.status === 'scheduled');
  const examId = params.get('exam') || choices.find((e) => e.state === 'active')?.id || choices.find((e) => e.state === 'completed')?.id || choices[0]?.id || '';
  const branches = useApiData(() => (owner ? loadOwnerBranches() : Promise.resolve([])), `branches|${role}`);
  const branch = params.get('branch') || '';
  const status = params.get('status') || 'all';
  const open = params.get('paper') && params.get('section') ? { paper: params.get('paper'), section: params.get('section') } : null;
  const set = (changes) => setParams((p) => {
    const next = new URLSearchParams(p);
    for (const [k, v] of Object.entries(changes)) if (v) next.set(k, v); else next.delete(k);
    return next;
  });
  const list = useApiData(() => (examId ? loadMarkSheets(role, examId, { branch, status }) : Promise.resolve(null)), `sheets|${role}|${examId}|${branch}|${status}|${version}`);

  return (
    <ExamPage title="Marks Entry" description="Teachers enter their papers’ marks in the Staff app; Managers and the School Owner review, enter and approve them here.">
      {() =>
        open ? (
          <SheetEditor role={role} paperId={open.paper} sectionId={open.section} onBack={() => set({ paper: '', section: '' })} onChanged={() => setVersion((n) => n + 1)} />
        ) : (
          <>
            <Card as="section" aria-label="Choose the examination" className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
              <Select label="Examination" placeholder={choices.length ? undefined : 'No scheduled examinations'} options={choices.map((e) => ({ value: e.id, label: e.name }))} value={examId} onChange={(e) => set({ exam: e.target.value })} disabled={!choices.length} />
              {owner && <Select label="Branch" options={[{ value: '', label: 'All branches' }, ...(branches.data ?? []).map((b) => ({ value: b.id, label: b.name }))]} value={branch} onChange={(e) => set({ branch: e.target.value })} />}
              <Select label="Status" options={STATUS_OPTIONS} value={status} onChange={(e) => set({ status: e.target.value })} />
            </Card>
            {list.data && (
              <p className="text-small text-fg-secondary">
                {list.data.counts.approved} approved · {list.data.counts.submitted} waiting for approval · {list.data.counts.returned} returned · {list.data.counts.draft} in progress
              </p>
            )}
            {!examId && exams.data ? (
              <Card className="p-2"><EmptyState icon={PenLine} title="No scheduled examinations" description="Marks are entered for scheduled examinations once their papers are sat." /></Card>
            ) : list.status === 'error' && !list.data ? (
              <ErrorState title="Mark sheets could not be loaded" description="Check your connection and try again." onRetry={list.retry} />
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <Table caption="Mark sheets by class and subject">
                    <TableHead>
                      <TableRow interactive={false}>
                        <TableHeaderCell>Class</TableHeaderCell>
                        <TableHeaderCell>Subject</TableHeaderCell>
                        <TableHeaderCell>Teacher</TableHeaderCell>
                        <TableHeaderCell align="right">Entered</TableHeaderCell>
                        <TableHeaderCell>Deadline</TableHeaderCell>
                        <TableHeaderCell>Status</TableHeaderCell>
                        <TableHeaderCell align="right">Actions</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {!list.data && examId && <TableLoading columns={7} />}
                      {list.data && !list.data.items.length && <TableEmpty columns={7} icon={PenLine} title="No mark sheets" description="Papers of classes with sections appear here." />}
                      {(list.data?.items ?? []).map((i) => (
                        <TableRow key={`${i.paper.id}|${i.section.id}`}>
                          <TableCell className="font-medium">
                            {i.section.name}
                            {owner && <span className="block text-caption text-fg-muted">{i.section.branch.name}</span>}
                          </TableCell>
                          <TableCell>{i.paper.subject.name}</TableCell>
                          <TableCell>{i.teachers.map((t) => t.name).join(', ') || <span className="text-fg-muted">None</span>}</TableCell>
                          <TableCell align="right">{i.entered}/{i.students}</TableCell>
                          <TableCell className={i.overdue ? 'tabular-nums text-error-fg' : 'tabular-nums'}>{i.deadline}{i.overdue ? ' (overdue)' : ''}</TableCell>
                          <TableCell><SheetBadge status={i.status} /></TableCell>
                          <TableCell align="right">
                            <Button size="sm" variant="outline" onClick={() => set({ paper: i.paper.id, section: i.section.id })}>Open</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Card>
            )}
          </>
        )
      }
    </ExamPage>
  );
}

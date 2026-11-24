import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, Clock, ShieldCheck, ShieldOff, Users, XCircle } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { Badge, Button, Card, CardHeader, DropdownMenu, EmptyState, ErrorState, Input, LoadingState, Pagination, Select, Table, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableLoading, TableRow, Tabs } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { ReasonModal } from '../components/FeeDialogs.jsx';
import { Facts, FeeFilters, FeePage, Money, Stat, StatRow, StatusBadge, useFeeRole } from '../components/FeeShell.jsx';
import { grantException, loadClearance, loadClearanceExams, loadExamClearance, loadStudentClearance, revokeException } from '../data/feeApi.js';
import { CLEARANCE, dayText, money, PAYMENT_STATE } from '../utils/feeFormat.js';

const STATUS_OPTIONS = [{ value: 'all', label: 'All statuses' }, ...Object.entries(CLEARANCE).map(([value, c]) => ({ value, label: c.label }))];

function Counts({ counts, total }) {
  return (
    <StatRow>
      <Stat icon={CheckCircle2} tone="success" label="Cleared" value={counts.cleared} />
      <Stat icon={Clock} tone="warning" label="Partially cleared" value={counts.partially_cleared} />
      <Stat icon={XCircle} tone="error" label="Not cleared" value={counts.not_cleared} />
      <Stat icon={Users} tone="info" label="Total students" value={total} />
    </StatRow>
  );
}

/** Students' general fee clearance: fees due so far, paid or not (monthly and examination fees apart). */
function StudentsClearance({ status }) {
  const role = useFeeRole();
  const navigate = useNavigate();
  const [filters, setFilters] = useState({ academicYear: '', branch: '', class: '', section: '', status: 'all', q: '', page: 1, pageSize: 25 });
  const data = useApiData(() => loadClearance(role, filters), `clearance|${JSON.stringify(filters)}`, { delayMs: filters.q ? 250 : 0 });
  const d = data.data;
  const currency = status.currency;
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v, page: k === 'page' ? v : 1 }));
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <FeeFilters status={status} value={filters} onChange={setFilters}>
          <Select label="Status" size="sm" value={filters.status} onChange={(e) => set('status', e.target.value)} options={STATUS_OPTIONS} />
          <Input label="Search" type="search" size="sm" placeholder="Search student…" value={filters.q} onChange={(e) => set('q', e.target.value)} />
        </FeeFilters>
      </Card>
      {d && <Counts counts={d.counts} total={d.counts.all} />}
      <Card className="overflow-hidden">
        {data.status === 'error' && !d ? (
          <ErrorState title="Fee clearance could not be loaded" onRetry={data.retry} />
        ) : (
          <div className="overflow-x-auto" role="region" aria-label="Student clearance" tabIndex={0}>
            <Table caption="Fee clearance of students">
              <TableHead>
                <TableRow interactive={false}>
                  <TableHeaderCell>#</TableHeaderCell>
                  <TableHeaderCell>Student</TableHeaderCell>
                  <TableHeaderCell>Class</TableHeaderCell>
                  <TableHeaderCell align="right">Monthly fees</TableHeaderCell>
                  <TableHeaderCell align="right">Exam fees</TableHeaderCell>
                  <TableHeaderCell align="right">Total due</TableHeaderCell>
                  <TableHeaderCell align="right">Paid</TableHeaderCell>
                  <TableHeaderCell align="right">Outstanding</TableHeaderCell>
                  <TableHeaderCell>Clearance</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {!d && <TableLoading columns={9} />}
                {d && !d.items.length && <TableEmpty columns={9} icon={ShieldCheck} title="No students match" />}
                {d?.items.map((r, i) => (
                  <TableRow key={r.student.id} className="cursor-pointer" onClick={() => navigate(`/fees/clearance/${r.student.id}`)}>
                    <TableCell className="tabular-nums text-fg-muted">{(d.page - 1) * d.pageSize + i + 1}</TableCell>
                    <TableCell><span className="font-medium">{r.student.name}</span><span className="block text-caption text-fg-muted">{r.student.studentNumber}{status.role === 'OWNER' ? ` · ${r.branch.name}` : ''}</span></TableCell>
                    <TableCell>{r.section.displayName}</TableCell>
                    <TableCell align="right"><Money value={r.monthly.due} currency={currency} /></TableCell>
                    <TableCell align="right"><Money value={r.exam.due} currency={currency} /></TableCell>
                    <TableCell align="right"><Money value={r.totalDue} currency={currency} /></TableCell>
                    <TableCell align="right"><Money value={r.paid} currency={currency} /></TableCell>
                    <TableCell align="right"><Money value={r.balance} currency={currency} className={r.balance ? 'font-semibold' : ''} /></TableCell>
                    <TableCell><span title={r.explanation}><StatusBadge map={CLEARANCE} value={r.clearance} /></span></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {d && d.total > 0 && <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPageChange={(p) => set('page', p)} itemLabel="students" className="px-4 py-3" />}
      </Card>
    </div>
  );
}

/** Clearance for one examination: every student assigned to it, judged by the school's policy. */
function ExamClearance({ status }) {
  const role = useFeeRole();
  const navigate = useNavigate();
  const exams = useApiData(() => loadClearanceExams(role), 'clearance-exams');
  const [examId, setExamId] = useState('');
  const [filters, setFilters] = useState({ branch: '', class: '', section: '', status: 'all', q: '', page: 1, pageSize: 50 });
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState(null);
  useEffect(() => {
    if (!examId && exams.data?.items.length) setExamId((exams.data.items.find((e) => e.upcoming) ?? exams.data.items[0]).id);
  }, [exams.data, examId]);
  const data = useApiData(() => (examId ? loadExamClearance(role, examId, filters) : Promise.resolve(null)), `exam-clearance|${examId}|${JSON.stringify(filters)}|${version}`, { delayMs: filters.q ? 250 : 0 });
  const d = data.data;
  const currency = status.currency;
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v, page: k === 'page' ? v : 1 }));
  if (exams.data && !exams.data.items.length) return <Card className="p-2"><EmptyState icon={ShieldCheck} title="No scheduled examinations" description="Examination clearance appears once an examination is scheduled. Its students are charged the examination fee then." /></Card>;
  const policyText = d ? [d.policy.examFeeRequired ? 'The examination fee must be paid' : 'The examination fee is not required', d.policy.monthlyBlocks === 'none' ? 'monthly fees do not count' : d.policy.monthlyBlocks === 'overdue' ? 'overdue monthly fees must be paid' : 'every monthly fee due must be paid', d.policy.partialQualifies ? `part payment of at least ${d.policy.partialMinimumPercent}% qualifies` : 'part payment does not qualify'].join('; ') : '';
  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select label="Examination" size="sm" value={examId} onChange={(e) => setExamId(e.target.value)} options={(exams.data?.items ?? []).map((e) => ({ value: e.id, label: `${e.name} (${dayText(e.startDate)})` }))} fieldClassName="lg:col-span-2" />
          <Select label="Status" size="sm" value={filters.status} onChange={(e) => set('status', e.target.value)} options={STATUS_OPTIONS} />
          <Input label="Search" type="search" size="sm" placeholder="Search student…" value={filters.q} onChange={(e) => set('q', e.target.value)} />
        </div>
        <div className="mt-3"><FeeFilters status={status} value={filters} onChange={setFilters} show={['branch', 'class', 'section']} /></div>
        {d && <p className="mt-3 text-caption text-fg-muted">Clearance deadline {dayText(d.deadline)} (judged on {dayText(d.asOf)}): {policyText}.</p>}
      </Card>
      {d && <Counts counts={d.counts} total={d.counts.all} />}
      <Card className="overflow-hidden">
        {data.status === 'error' && !d ? (
          <ErrorState title="Examination clearance could not be loaded" onRetry={data.retry} />
        ) : (
          <div className="overflow-x-auto" role="region" aria-label="Examination clearance" tabIndex={0}>
            <Table caption="Examination clearance">
              <TableHead>
                <TableRow interactive={false}>
                  <TableHeaderCell>Student</TableHeaderCell>
                  <TableHeaderCell>Class</TableHeaderCell>
                  <TableHeaderCell align="right">Exam fee</TableHeaderCell>
                  <TableHeaderCell align="right">Monthly overdue</TableHeaderCell>
                  <TableHeaderCell align="right">Required</TableHeaderCell>
                  <TableHeaderCell align="right">Paid</TableHeaderCell>
                  <TableHeaderCell>Clearance</TableHeaderCell>
                  <TableHeaderCell>Eligible</TableHeaderCell>
                  <TableHeaderCell align="right">Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {!d && <TableLoading columns={9} />}
                {d && !d.items.length && <TableEmpty columns={9} icon={ShieldCheck} title="No students" description="No examination fees are charged for this examination yet. Set its fee under Fee Structures." />}
                {d?.items.map((r) => (
                  <TableRow key={r.student.id}>
                    <TableCell><Link to={`/fees/clearance/${r.student.id}`} className="font-medium hover:underline">{r.student.name}</Link><span className="block text-caption text-fg-muted">{r.student.studentNumber}</span></TableCell>
                    <TableCell>{r.section?.displayName ?? r.class?.name}</TableCell>
                    <TableCell align="right"><Money value={r.examFee.netAmount} currency={currency} /><span className="block text-caption text-fg-muted">{r.examFee.paidAmount >= r.examFee.netAmount ? 'Paid' : `${money(r.examFee.paidAmount, currency)} paid`}</span></TableCell>
                    <TableCell align="right"><Money value={r.monthlyOverdue} currency={currency} className={r.monthlyOverdue ? 'text-error-fg' : ''} /></TableCell>
                    <TableCell align="right"><Money value={r.required} currency={currency} /></TableCell>
                    <TableCell align="right"><Money value={r.paid} currency={currency} /></TableCell>
                    <TableCell><span title={r.explanation}><StatusBadge map={CLEARANCE} value={r.clearance} /></span>{r.byException && <span className="block text-caption text-fg-muted">By exception</span>}</TableCell>
                    <TableCell>{r.eligible ? <Badge variant="success">Yes</Badge> : <Badge variant="error">No</Badge>}</TableCell>
                    <TableCell align="right">
                      {d.canGrant && (
                        <DropdownMenu
                          label={`Clearance actions for ${r.student.name}`}
                          items={[
                            !r.exception && !r.eligible && { label: 'Grant exception', icon: ShieldCheck, onSelect: () => setDialog({ type: 'grant', row: r }) },
                            r.exception && { label: 'Revoke exception', icon: ShieldOff, destructive: true, onSelect: () => setDialog({ type: 'revoke', row: r }) },
                            { label: 'Open clearance details', onSelect: () => navigate(`/fees/clearance/${r.student.id}`) },
                          ].filter(Boolean)}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {d && d.total > d.pageSize && <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPageChange={(p) => set('page', p)} itemLabel="students" className="px-4 py-3" />}
        {d?.removed.length > 0 && <p className="px-4 py-3 text-caption text-fg-muted">Removed from the examination ({d.removed.length}): {d.removed.map((r) => `${r.student.name} (${r.examFee.cancelReason})`).join('; ')}. Their unpaid examination fees were cancelled.</p>}
      </Card>
      <ReasonModal open={dialog?.type === 'grant'} onClose={() => setDialog(null)} variant="primary" title={`Grant a clearance exception to ${dialog?.row.student.name ?? ''}?`} description={`They are cleared for ${d?.examination.name ?? 'this examination'} whatever they owe (${money(dialog?.row.outstanding, currency)} outstanding). Recorded in the audit log.`} confirmLabel="Grant exception" run={({ reason }) => grantException(role, { student: dialog.row.student.id, examination: examId, reason })} onDone={() => { setDialog(null); setVersion((n) => n + 1); }} />
      <ReasonModal open={dialog?.type === 'revoke'} onClose={() => setDialog(null)} title={`Revoke the exception of ${dialog?.row.student.name ?? ''}?`} confirmLabel="Revoke" run={({ reason }) => revokeException(role, dialog.row.exception.id, reason)} onDone={() => { setDialog(null); setVersion((n) => n + 1); }} />
    </div>
  );
}

export default function FeeClearancePage() {
  const [tab, setTab] = useState('students');
  return (
    <FeePage title="Fee Clearance" description="Whether students' fees allow them to sit examinations. Not related to graduation; monthly and examination fees stay separate.">
      {(status) => (
        <div className="flex flex-col gap-4">
          <Tabs id="clearance-tabs" label="Fee clearance" value={tab} onChange={setTab} tabs={[{ value: 'students', label: 'Students Clearance' }, { value: 'exams', label: 'Examination Clearance' }]} />
          {tab === 'students' ? <StudentsClearance status={status} /> : <ExamClearance status={status} />}
        </div>
      )}
    </FeePage>
  );
}

const MONTH_TONE = { paid: 'border-success/40 bg-success-soft text-success-fg', partial: 'border-warning/40 bg-warning-soft text-warning-fg', overdue: 'border-error/40 bg-error-soft text-error-fg', unpaid: 'border-border bg-surface', cancelled: 'border-border-subtle bg-muted text-fg-muted', not_charged: 'border-dashed border-border-subtle text-fg-muted', upcoming: 'border-dashed border-border-subtle text-fg-muted' };

/** A student's clearance details: decision and why, fee summary, monthly status, examination fees, payments. */
function StudentClearance({ status }) {
  const role = useFeeRole();
  const { studentId } = useParams();
  const [version, setVersion] = useState(0);
  const [tab, setTab] = useState('clearance');
  const [dialog, setDialog] = useState(null);
  const data = useApiData(() => loadStudentClearance(role, studentId), `student-clearance|${studentId}|${version}`);
  const a = data.data;
  const currency = status.currency;
  if (data.status === 'error' && !a) return <ErrorState title="Clearance could not be loaded" onRetry={data.retry} />;
  if (!a) return <LoadingState label="Loading clearance…" />;
  const c = a.clearance;
  const key = c.status.toLowerCase();
  const tone = { cleared: 'bg-success-soft text-success-fg', partially_cleared: 'bg-warning-soft text-warning-fg', not_cleared: 'bg-error-soft text-error-fg' }[key];
  return (
    <div className="flex flex-col gap-5">
      <nav className="flex items-center gap-2 text-small text-fg-muted" aria-label="Breadcrumb">
        <Link to="/fees/clearance" className="inline-flex items-center gap-1 hover:text-fg"><ArrowLeft className="size-4" aria-hidden="true" />Fee Clearance</Link>
        <span>›</span><span>Student Clearance</span>
      </nav>
      <Card className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <h1 className="text-section-title">{a.student.name}</h1>
          <p className="text-small text-fg-muted">Student ID: {a.student.studentNumber} · {a.enrollment?.section.displayName ?? 'Not enrolled'}</p>
        </div>
        <span className={`inline-flex items-center gap-2 rounded-md px-4 py-2 font-semibold ${tone}`}><ShieldCheck className="size-5" aria-hidden="true" />{CLEARANCE[key].label}</span>
      </Card>
      <Tabs id="student-clearance" label="Student clearance" value={tab} onChange={setTab} tabs={[{ value: 'clearance', label: 'Clearance' }, { value: 'payments', label: 'Payments' }, { value: 'obligations', label: 'Obligations' }]} />
      {tab === 'clearance' && (
        <>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Clearance status" />
              <div className={`m-5 mt-3 flex flex-col items-center gap-2 rounded-lg p-6 text-center ${tone}`}>
                <ShieldCheck className="size-10" aria-hidden="true" />
                <p className="text-section-title">{CLEARANCE[key].label}</p>
                <ul className="text-small">{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            </Card>
            <Card>
              <CardHeader title="Fee summary" description={a.academicYear?.name} />
              <div className="p-5">
                <Facts className="sm:grid-cols-1" items={[[`Monthly fees (${a.totals.monthly.count})`, money(a.totals.monthly.due, currency)], [`Examination fees (${a.totals.exam.count})`, money(a.totals.exam.due, currency)], a.totals.other.count ? ['Other charges', money(a.totals.other.due, currency)] : null, ['Total due', money(a.totals.due, currency)], ['Total paid', money(a.totals.paid, currency)], ['Remaining balance', money(a.totals.balance, currency)]].filter(Boolean)} />
              </div>
            </Card>
          </div>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Monthly fee status" />
              <ul className="grid grid-cols-3 gap-2 p-5 sm:grid-cols-6">
                {a.months.map((m) => <li key={m.month} className={`rounded-md border px-2 py-1.5 text-center text-small ${MONTH_TONE[m.state]}`} title={PAYMENT_STATE[m.state]?.label}>{m.label}</li>)}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Examination fees and clearance" description={a.policy.deadlineDays ? `Fees are due ${a.policy.deadlineDays} days before each examination.` : 'Fees are due on the first day of each examination.'} />
              <ul className="divide-y divide-border-subtle px-5 pb-3 text-small">
                {!a.examinations.length && <li className="py-3 text-fg-muted">No scheduled examination charges this student.</li>}
                {a.examinations.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0">
                      <span className="block font-medium">{e.name}</span>
                      <span className="block text-caption text-fg-muted">{dayText(e.startDate)} · fee {e.fee ? `${money(e.fee.netAmount, currency)} (${e.fee.paidAmount >= e.fee.netAmount ? 'paid' : `${money(e.fee.paidAmount, currency)} paid`})` : 'none'}</span>
                      {e.exception && <span className="block text-caption text-fg-muted">Exception: {e.exception.reason} · {e.exception.grantedBy}</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      <StatusBadge map={CLEARANCE} value={e.status} />
                      {a.permissions.grantExceptions && !e.eligible && !e.exception && <Button size="sm" variant="outline" onClick={() => setDialog({ type: 'grant', exam: e })}>Exception</Button>}
                      {a.permissions.grantExceptions && e.exception && <Button size="sm" variant="ghost" onClick={() => setDialog({ type: 'revoke', exam: e })}>Revoke</Button>}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}
      {tab === 'payments' && (
        <Card className="overflow-x-auto">
          <Table caption="Payments">
            <TableHead><TableRow interactive={false}><TableHeaderCell>Receipt</TableHeaderCell><TableHeaderCell>Date</TableHeaderCell><TableHeaderCell align="right">Amount</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {!a.payments.length && <TableEmpty columns={4} title="No payments" />}
              {a.payments.map((p) => <TableRow key={p.id}><TableCell>{p.receipt?.number}</TableCell><TableCell>{dayText(p.receivedAt.slice(0, 10))}</TableCell><TableCell align="right"><Money value={p.amount} currency={currency} /></TableCell><TableCell>{p.status === 'reversed' ? <Badge variant="error">Reversed</Badge> : <Badge variant="success">Recorded</Badge>}</TableCell></TableRow>)}
            </TableBody>
          </Table>
        </Card>
      )}
      {tab === 'obligations' && (
        <Card className="overflow-x-auto">
          <Table caption="Obligations">
            <TableHead><TableRow interactive={false}><TableHeaderCell>Fee</TableHeaderCell><TableHeaderCell>Due</TableHeaderCell><TableHeaderCell align="right">Payable</TableHeaderCell><TableHeaderCell align="right">Paid</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell></TableRow></TableHead>
            <TableBody>
              {a.obligations.map((o) => <TableRow key={o.id}><TableCell>{o.title}</TableCell><TableCell>{dayText(o.dueDate)}</TableCell><TableCell align="right"><Money value={o.netAmount} currency={currency} /></TableCell><TableCell align="right"><Money value={o.paidAmount} currency={currency} /></TableCell><TableCell><StatusBadge map={PAYMENT_STATE} value={o.status === 'cancelled' ? 'cancelled' : o.paymentState === 'paid' ? 'paid' : o.overdue ? 'overdue' : o.paymentState} /></TableCell></TableRow>)}
            </TableBody>
          </Table>
        </Card>
      )}
      <div><Link to={`/fees/students/${a.student.id}`} className="text-small font-medium text-accent-fg hover:underline">Open the full financial account →</Link></div>
      <ReasonModal open={dialog?.type === 'grant'} onClose={() => setDialog(null)} variant="primary" title={`Clearance exception for ${dialog?.exam?.name ?? ''}`} description="The student is cleared for this examination whatever they owe. Recorded in the audit log." confirmLabel="Grant exception" run={({ reason }) => grantException(role, { student: a.student.id, examination: dialog.exam.id, reason })} onDone={() => { setDialog(null); setVersion((n) => n + 1); }} />
      <ReasonModal open={dialog?.type === 'revoke'} onClose={() => setDialog(null)} title="Revoke this exception?" confirmLabel="Revoke" run={({ reason }) => revokeException(role, dialog.exam.exception.id, reason)} onDone={() => { setDialog(null); setVersion((n) => n + 1); }} />
    </div>
  );
}

export function StudentClearancePage() {
  return <FeePage title="Fee Clearance" description="A student's clearance decision and why.">{(status) => <StudentClearance status={status} />}</FeePage>;
}

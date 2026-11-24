import { useState } from 'react';
import { BellRing, CheckCircle2, Clock, MessageCircle, Send, Users, XCircle } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Alert, Badge, Button, Card, ErrorState, Input, Pagination, Table, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableLoading, TableRow, Tabs } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { requestFailure } from '../../../hooks/useDialogForm.js';
import { FeeFilters, FeePage, Money, Stat, StatRow, StatusBadge, useFeeRole } from '../components/FeeShell.jsx';
import { loadAccounts, loadReminders, logReminder } from '../data/feeApi.js';
import { ACCOUNT_STATUS, dateTimeText, dayText, money } from '../utils/feeFormat.js';

const STATUS_TABS = [
  { value: 'all', label: 'All' },
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'partial', label: 'Partially paid' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'cleared', label: 'Cleared' },
];

function Accounts({ status }) {
  const role = useFeeRole();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [filters, setFilters] = useState({ academicYear: '', branch: '', class: '', section: '', q: '', status: params.get('status') ?? 'all', page: 1, pageSize: 20 });
  const data = useApiData(() => loadAccounts(role, filters), `accounts|${JSON.stringify(filters)}`, { delayMs: filters.q ? 250 : 0 });
  const d = data.data;
  const currency = status.currency;
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v, page: k === 'page' ? v : 1 }));
  return (
    <div className="flex flex-col gap-4">
      {d && (
        <StatRow>
          <Stat icon={Users} tone="info" label="Students" value={d.counts.all} note={d.academicYear?.name} />
          <Stat icon={CheckCircle2} tone="success" label="Cleared" value={d.counts.cleared} />
          <Stat icon={Clock} tone="warning" label="Partially paid" value={d.counts.partial} />
          <Stat icon={XCircle} tone="error" label="Overdue" value={d.counts.overdue} note={money(d.totals.overdue, currency)} />
        </StatRow>
      )}
      <Card className="p-4">
        <FeeFilters status={status} value={filters} onChange={setFilters}>
          <Input label="Search" type="search" size="sm" placeholder="Name or Student ID…" value={filters.q} onChange={(e) => set('q', e.target.value)} fieldClassName="sm:col-span-2" />
        </FeeFilters>
      </Card>
      <Card className="overflow-hidden">
        <div className="px-4 pt-3">
          <Tabs id="account-status" label="Fee status" value={filters.status} onChange={(v) => set('status', v)} tabs={STATUS_TABS.map((t) => ({ ...t, label: d ? `${t.label} (${d.counts[t.value] ?? 0})` : t.label }))} />
        </div>
        {data.status === 'error' && !d ? (
          <ErrorState title="Student fees could not be loaded" onRetry={data.retry} />
        ) : (
          <div className="overflow-x-auto" role="region" aria-label="Student fee accounts" tabIndex={0}>
            <Table caption="Students and their fees for the year">
              <TableHead>
                <TableRow interactive={false}>
                  <TableHeaderCell>Student</TableHeaderCell>
                  <TableHeaderCell>Class</TableHeaderCell>
                  {status.role === 'OWNER' && <TableHeaderCell>Branch</TableHeaderCell>}
                  <TableHeaderCell align="right">Monthly fees</TableHeaderCell>
                  <TableHeaderCell align="right">Exam fees</TableHeaderCell>
                  <TableHeaderCell align="right">Total due</TableHeaderCell>
                  <TableHeaderCell align="right">Paid</TableHeaderCell>
                  <TableHeaderCell align="right">Balance</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {!d && <TableLoading columns={9} />}
                {d && !d.items.length && <TableEmpty columns={9} icon={Users} title="No students match" description="Change the filters, or enroll students in the academic year." />}
                {d?.items.map((r) => (
                  <TableRow key={r.student.id} className="cursor-pointer" onClick={() => navigate(`/fees/students/${r.student.id}`)}>
                    <TableCell>
                      <Link to={`/fees/students/${r.student.id}`} className="font-medium text-fg hover:underline" onClick={(e) => e.stopPropagation()}>{r.student.name}</Link>
                      <span className="block text-caption text-fg-muted">{r.student.studentNumber}</span>
                    </TableCell>
                    <TableCell>{r.section.displayName}</TableCell>
                    {status.role === 'OWNER' && <TableCell>{r.branch.name}</TableCell>}
                    <TableCell align="right"><Money value={r.totals.monthly.due} currency={currency} /></TableCell>
                    <TableCell align="right"><Money value={r.totals.exam.due} currency={currency} /></TableCell>
                    <TableCell align="right"><Money value={r.totals.due} currency={currency} /></TableCell>
                    <TableCell align="right"><Money value={r.totals.paid} currency={currency} className="text-success-fg" /></TableCell>
                    <TableCell align="right">
                      <Money value={r.totals.balance} currency={currency} className={r.totals.balance ? 'font-semibold' : ''} />
                      {r.totals.overdue > 0 && <span className="block text-caption text-error-fg">{money(r.totals.overdue, currency)} overdue</span>}
                    </TableCell>
                    <TableCell><StatusBadge map={ACCOUNT_STATUS} value={r.status} /></TableCell>
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

/** Guardians due a reminder under the school's policy; staff send it from their phone and log it. */
function Reminders({ status }) {
  const role = useFeeRole();
  const [version, setVersion] = useState(0);
  const [error, setError] = useState('');
  const data = useApiData(() => loadReminders(role), `reminders|${version}`);
  const d = data.data;
  const log = async (student, channel) => {
    setError('');
    try {
      await logReminder(role, { student, channel });
      setVersion((n) => n + 1);
    } catch (e) {
      setError(requestFailure(e));
    }
  };
  if (data.status === 'error' && !d) return <ErrorState title="Reminders could not be loaded" onRetry={data.retry} />;
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-2 p-4">
        {d && !d.enabled && <Alert variant="info" title="Parent reminders are off">Your School Owner can turn them on under Fees → Settings. The list below still shows guardians of students with overdue fees.</Alert>}
        <p className="text-small text-fg-muted">
          {d ? `First reminder after ${d.firstAfterDays} days overdue, then every ${d.repeatDays} days. EduTrack has no direct WhatsApp or SMS service: send from your phone, then mark it sent.` : 'Loading…'}
        </p>
        {error && <Alert variant="error">{error}</Alert>}
      </div>
      <div className="overflow-x-auto">
        <Table caption="Guardians to remind">
          <TableHead>
            <TableRow interactive={false}>
              <TableHeaderCell>Student</TableHeaderCell>
              <TableHeaderCell>Guardian</TableHeaderCell>
              <TableHeaderCell align="right">Overdue</TableHeaderCell>
              <TableHeaderCell>Since</TableHeaderCell>
              <TableHeaderCell>Last reminder</TableHeaderCell>
              <TableHeaderCell align="right">Send</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!d && <TableLoading columns={6} />}
            {d && !d.items.length && <TableEmpty columns={6} icon={BellRing} title="Nobody to remind" description="No student is overdue long enough for a reminder." />}
            {d?.items.map((r) => (
              <TableRow key={r.student.id}>
                <TableCell><Link className="font-medium hover:underline" to={`/fees/students/${r.student.id}`}>{r.student.name}</Link><span className="block text-caption text-fg-muted">{r.student.studentNumber}</span></TableCell>
                <TableCell>{r.guardian.name}<span className="block text-caption text-fg-muted">{r.guardian.phone}</span></TableCell>
                <TableCell align="right"><Money value={r.amount} currency={status.currency} className="font-semibold text-error-fg" /></TableCell>
                <TableCell>{dayText(r.oldestDue)}<span className="block text-caption text-fg-muted">{r.daysOverdue} days</span></TableCell>
                <TableCell>{r.lastReminder ? <>{dateTimeText(r.lastReminder.at)}<span className="block text-caption text-fg-muted">{r.lastReminder.channel} · {r.lastReminder.by}</span></> : <Badge variant="neutral">Never</Badge>}{r.due ? <Badge variant="warning" className="ml-1">Due</Badge> : <span className="block text-caption text-fg-muted">Next {dayText(r.nextDue)}</span>}</TableCell>
                <TableCell align="right">
                  <div className="flex justify-end gap-1">
                    <a className="inline-flex h-8 items-center gap-1 rounded-md border border-border-strong px-2 text-small hover:bg-muted" href={r.links.whatsapp} target="_blank" rel="noopener noreferrer" onClick={() => log(r.student.id, 'whatsapp')}><MessageCircle className="size-4" aria-hidden="true" />WhatsApp</a>
                    <a className="inline-flex h-8 items-center gap-1 rounded-md border border-border-strong px-2 text-small hover:bg-muted" href={r.links.sms} onClick={() => log(r.student.id, 'sms')}><Send className="size-4" aria-hidden="true" />SMS</a>
                    <Button size="sm" variant="ghost" onClick={() => log(r.student.id, 'call')}>Called</Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}

export default function StudentFeesPage() {
  const [tab, setTab] = useState('accounts');
  return (
    <FeePage title="Student Fees" description="Every student's financial account: what they owe, what they paid, and what is overdue.">
      {(status) => (
        <div className="flex flex-col gap-4">
          <Tabs id="student-fees" label="Student fees" value={tab} onChange={setTab} tabs={[{ value: 'accounts', label: 'Accounts' }, { value: 'reminders', label: 'Parent reminders' }]} />
          {tab === 'accounts' ? <Accounts status={status} /> : <Reminders status={status} />}
        </div>
      )}
    </FeePage>
  );
}

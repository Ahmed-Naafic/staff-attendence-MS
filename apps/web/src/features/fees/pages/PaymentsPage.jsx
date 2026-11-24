import { useState } from 'react';
import { Banknote, Download, Plus, Printer, RotateCcw, Undo2 } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { Alert, Badge, Button, Card, ErrorState, Input, Pagination, Select, Table, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableLoading, TableRow } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { requestFailure } from '../../../hooks/useDialogForm.js';
import { saveFile } from '../../attendance-reports/utils/exportRules.js';
import { ReasonModal } from '../components/FeeDialogs.jsx';
import { FeeFilters, FeePage, Money, printBlob, Stat, StatRow, useFeeRole } from '../components/FeeShell.jsx';
import { PaymentDrawer } from '../components/PaymentDrawer.jsx';
import { downloadReceipt, loadPayments, markReceiptPrinted, reversePayment } from '../data/feeApi.js';
import { dateTimeText, money, monthName, ROLE_LABEL } from '../utils/feeFormat.js';

function Payments({ status, recording, setRecording }) {
  const role = useFeeRole();
  const [filters, setFilters] = useState({ branch: '', class: '', from: '', to: '', status: 'all', recordedBy: '', q: '', page: 1, pageSize: 20 });
  const [version, setVersion] = useState(0);
  const [reversing, setReversing] = useState(null);
  const [notice, setNotice] = useState('');
  const data = useApiData(() => loadPayments(role, filters), `payments|${JSON.stringify(filters)}|${version}`, { delayMs: filters.q ? 250 : 0 });
  const d = data.data;
  const currency = status.currency;
  const p = status.permissions;
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v, page: k === 'page' ? v : 1 }));
  const receipt = async (pay, kind) => {
    try {
      const f = await downloadReceipt(role, pay.receipt.id);
      if (kind === 'print') printBlob(f.blob);
      else saveFile(f.blob, f.filename);
      await markReceiptPrinted(role, pay.receipt.id).catch(() => {});
    } catch (e) {
      setNotice(requestFailure(e));
    }
  };
  return (
    <div className="flex flex-col gap-4">
      {notice && <Alert variant="info" onDismiss={() => setNotice('')}>{notice}</Alert>}
      {d && (
        <StatRow cols={3}>
          <Stat icon={Banknote} tone="success" label={`Received (${d.summary.recordedCount} payments)`} value={money(d.summary.recorded, currency)} />
          <Stat icon={Undo2} tone="error" label={`Reversed (${d.summary.reversedCount})`} value={money(d.summary.reversed, currency)} />
          <Stat icon={Banknote} tone="info" label="Method" value="Cash" note="Version 1 records cash payments only." />
        </StatRow>
      )}
      <Card className="p-4">
        <FeeFilters status={status} value={filters} onChange={setFilters} show={['branch', 'class', 'dates']}>
          <Select label="Status" size="sm" value={filters.status} onChange={(e) => set('status', e.target.value)} options={[{ value: 'all', label: 'All' }, { value: 'recorded', label: 'Recorded' }, { value: 'reversed', label: 'Reversed' }]} />
          <Select label="Received by" size="sm" value={filters.recordedBy} onChange={(e) => set('recordedBy', e.target.value)} options={[{ value: '', label: 'Anyone' }, ...(d?.recorders ?? []).map((r) => ({ value: r.id, label: `${r.name} (${ROLE_LABEL[r.role] ?? r.role})` }))]} />
          <Input label="Search" type="search" size="sm" placeholder="Receipt no., name or ID…" value={filters.q} onChange={(e) => set('q', e.target.value)} />
        </FeeFilters>
      </Card>
      <Card className="overflow-hidden">
        {data.status === 'error' && !d ? (
          <ErrorState title="Payments could not be loaded" onRetry={data.retry} />
        ) : (
          <div className="overflow-x-auto" role="region" aria-label="Payments" tabIndex={0}>
            <Table caption="Payments, newest first">
              <TableHead>
                <TableRow interactive={false}>
                  <TableHeaderCell>Receipt</TableHeaderCell>
                  <TableHeaderCell>Student</TableHeaderCell>
                  <TableHeaderCell>Covers</TableHeaderCell>
                  <TableHeaderCell align="right">Amount</TableHeaderCell>
                  <TableHeaderCell>Received</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell align="right">Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {!d && <TableLoading columns={7} />}
                {d && !d.items.length && <TableEmpty columns={7} icon={Banknote} title="No payments" description="Record a payment to start." />}
                {d?.items.map((pay) => (
                  <TableRow key={pay.id}>
                    <TableCell className="font-medium">{pay.receipt?.number}{pay.receipt?.void && <Badge variant="error" className="ml-2">VOID</Badge>}{pay.closed && <span className="block text-caption text-fg-muted">In a cash closing</span>}</TableCell>
                    <TableCell><Link to={`/fees/students/${pay.student.id}`} className="font-medium hover:underline">{pay.student.name}</Link><span className="block text-caption text-fg-muted">{pay.student.studentNumber}</span></TableCell>
                    <TableCell className="max-w-64 text-small">{pay.allocations.map((a) => (a.obligation.month ? monthName(a.obligation.month) : a.obligation.title)).join(', ')}</TableCell>
                    <TableCell align="right"><Money value={pay.amount} currency={currency} className={pay.status === 'reversed' ? 'text-fg-muted line-through' : 'font-semibold'} /></TableCell>
                    <TableCell>{dateTimeText(pay.receivedAt)}<span className="block text-caption text-fg-muted">{pay.recordedBy.name}{status.role === 'OWNER' ? ` · ${pay.branch.name}` : ''}</span></TableCell>
                    <TableCell>{pay.status === 'reversed' ? <><Badge variant="error">Reversed</Badge><span className="block text-caption text-fg-muted">{pay.reversalReason}</span></> : <Badge variant="success">Recorded</Badge>}</TableCell>
                    <TableCell align="right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" leftIcon={Printer} onClick={() => receipt(pay, 'print')} aria-label={`Print receipt ${pay.receipt?.number}`} />
                        <Button size="sm" variant="ghost" leftIcon={Download} onClick={() => receipt(pay, 'download')} aria-label={`Download receipt ${pay.receipt?.number}`} />
                        {p.reversePayments && pay.status === 'recorded' && <Button size="sm" variant="danger" leftIcon={RotateCcw} onClick={() => setReversing(pay)}>Reverse</Button>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {d && d.total > 0 && <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPageChange={(n) => set('page', n)} itemLabel="payments" className="px-4 py-3" />}
      </Card>
      <PaymentDrawer role={role} currency={currency} open={recording} onClose={() => setRecording(false)} onRecorded={() => setVersion((n) => n + 1)} />
      <ReasonModal
        open={Boolean(reversing)}
        onClose={() => setReversing(null)}
        title={`Reverse payment ${reversing?.receipt?.number ?? ''}?`}
        description={`${money(reversing?.amount, currency)} goes back onto the fees it paid. The payment stays on record and its receipt is marked VOID. This cannot be undone.`}
        confirmLabel="Reverse payment"
        run={({ reason }) => reversePayment(role, reversing.id, reason)}
        onDone={() => {
          setReversing(null);
          setNotice('Payment reversed; the receipt is void.');
          setVersion((n) => n + 1);
        }}
      />
    </div>
  );
}

export default function PaymentsPage() {
  const [params] = useSearchParams();
  const [recording, setRecording] = useState(params.get('record') === '1');
  return (
    <FeePage title="Payments" description="Cash payments, each allocated to the exact fees it pays, with its receipt." primaryAction={(s) => s.permissions.recordPayments && <Button leftIcon={Plus} onClick={() => setRecording(true)}>Record Payment</Button>}>
      {(status) => <Payments status={status} recording={recording} setRecording={setRecording} />}
    </FeePage>
  );
}

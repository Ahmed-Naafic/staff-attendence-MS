import { useState } from 'react';
import { CheckCircle2, Clock, FileStack, FileText, Plus, XCircle } from 'lucide-react';
import { Alert, Button, Card, DropdownMenu, ErrorState, Input, Pagination, Select, Table, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableLoading, TableRow } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { requestFailure } from '../../../hooks/useDialogForm.js';
import { saveFile } from '../../attendance-reports/utils/exportRules.js';
import { InvoicePreview } from '../components/FeeDialogs.jsx';
import { InvoiceCreateModal } from '../components/FeeForms.jsx';
import { FeeFilters, FeePage, Money, Stat, StatRow, StatusBadge, useFeeRole } from '../components/FeeShell.jsx';
import { downloadInvoices, loadInvoices } from '../data/feeApi.js';
import { dayText, INVOICE_STATUS } from '../utils/feeFormat.js';

function Invoices({ status, creating, setCreating }) {
  const role = useFeeRole();
  const [filters, setFilters] = useState({ class: '', section: '', branch: '', status: 'all', q: '', page: 1, pageSize: 20 });
  const [version, setVersion] = useState(0);
  const [preview, setPreview] = useState(null);
  const [notice, setNotice] = useState('');
  const data = useApiData(() => loadInvoices(role, filters), `invoices|${JSON.stringify(filters)}|${version}`, { delayMs: filters.q ? 250 : 0 });
  const d = data.data;
  const currency = status.currency;
  const set = (k, v) => setFilters((f) => ({ ...f, [k]: v, page: k === 'page' ? v : 1 }));
  const batchPdf = async (batch) => {
    try {
      const f = await downloadInvoices(role, { batch });
      saveFile(f.blob, f.filename);
    } catch (e) {
      setNotice(requestFailure(e));
    }
  };
  return (
    <div className="flex flex-col gap-4">
      {notice && <Alert variant="info" onDismiss={() => setNotice('')}>{notice}</Alert>}
      {d && (
        <StatRow>
          <Stat icon={FileText} tone="accent" label="Total invoices" value={d.counts.all - d.counts.cancelled} note={`${d.counts.draft} draft · ${d.counts.cancelled} cancelled`} />
          <Stat icon={CheckCircle2} tone="success" label="Paid" value={d.counts.paid} />
          <Stat icon={Clock} tone="warning" label="Partially paid" value={d.counts.partially_paid} />
          <Stat icon={XCircle} tone="error" label="Unpaid (issued)" value={d.counts.issued} />
        </StatRow>
      )}
      <Card className="p-4">
        <FeeFilters status={status} value={filters} onChange={setFilters} show={['branch', 'class', 'section']}>
          <Select label="Status" size="sm" value={filters.status} onChange={(e) => set('status', e.target.value)} options={[{ value: 'all', label: 'All statuses' }, ...Object.entries(INVOICE_STATUS).map(([value, s]) => ({ value, label: s.label }))]} />
          <Input label="Search" type="search" size="sm" placeholder="Invoice no. or student…" value={filters.q} onChange={(e) => set('q', e.target.value)} fieldClassName="sm:col-span-2" />
        </FeeFilters>
        <p className="mt-3 text-caption text-fg-muted">Invoices have no payment deadline and are never overdue. Overdue applies to monthly fees, shown on Student Fees.</p>
      </Card>
      <Card className="overflow-hidden">
        {data.status === 'error' && !d ? (
          <ErrorState title="Invoices could not be loaded" onRetry={data.retry} />
        ) : (
          <div className="overflow-x-auto" role="region" aria-label="Invoices" tabIndex={0}>
            <Table caption="Invoices, newest first">
              <TableHead>
                <TableRow interactive={false}>
                  <TableHeaderCell>#</TableHeaderCell>
                  <TableHeaderCell>Invoice No.</TableHeaderCell>
                  <TableHeaderCell>Student</TableHeaderCell>
                  <TableHeaderCell>Class</TableHeaderCell>
                  <TableHeaderCell align="right">Amount</TableHeaderCell>
                  <TableHeaderCell align="right">Paid</TableHeaderCell>
                  <TableHeaderCell align="right">Balance</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Date</TableHeaderCell>
                  <TableHeaderCell align="right">Actions</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {!d && <TableLoading columns={10} />}
                {d && !d.items.length && <TableEmpty columns={10} icon={FileText} title="No invoices" description="Create an invoice for a student, or invoices for a whole class." />}
                {d?.items.map((inv, i) => (
                  <TableRow key={inv.id} className="cursor-pointer" onClick={() => setPreview(inv.id)}>
                    <TableCell className="tabular-nums text-fg-muted">{(d.page - 1) * d.pageSize + i + 1}</TableCell>
                    <TableCell className="font-medium">{inv.number ?? 'Draft'}</TableCell>
                    <TableCell>{inv.student.name}<span className="block text-caption text-fg-muted">{inv.student.studentNumber}</span></TableCell>
                    <TableCell>{inv.student.class ?? '—'}</TableCell>
                    <TableCell align="right"><Money value={inv.totals.total} currency={currency} /></TableCell>
                    <TableCell align="right"><Money value={inv.totals.paid} currency={currency} /></TableCell>
                    <TableCell align="right"><Money value={inv.totals.balance} currency={currency} className={inv.totals.balance ? 'font-semibold' : ''} /></TableCell>
                    <TableCell><StatusBadge map={INVOICE_STATUS} value={inv.status} /></TableCell>
                    <TableCell>{dayText((inv.issuedAt ?? inv.createdAt).slice(0, 10))}</TableCell>
                    <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu label={`Actions for ${inv.number ?? 'draft'}`} items={[{ label: 'Preview', onSelect: () => setPreview(inv.id) }, inv.batchId && { label: 'Download its bulk batch (PDF)', onSelect: () => batchPdf(inv.batchId) }].filter(Boolean)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {d && d.total > 0 && <Pagination page={d.page} pageSize={d.pageSize} total={d.total} onPageChange={(p) => set('page', p)} itemLabel="invoices" className="px-4 py-3" />}
      </Card>
      <InvoiceCreateModal
        role={role}
        status={status}
        open={Boolean(creating)}
        mode={creating === 'bulk' ? 'bulk' : 'student'}
        onClose={() => setCreating(null)}
        onDone={(r) => {
          setCreating(null);
          setVersion((n) => n + 1);
          if (r.single) setPreview(r.single.invoice.id);
          else {
            setNotice(`${r.bulk.created} invoice${r.bulk.created === 1 ? '' : 's'} created (${r.bulk.skipped} skipped: nothing to invoice).`);
            if (r.bulk.created) batchPdf(r.bulk.batchId);
          }
        }}
      />
      <InvoicePreview role={role} invoiceId={preview} open={Boolean(preview)} onClose={() => setPreview(null)} onChanged={() => setVersion((n) => n + 1)} />
    </div>
  );
}

export default function InvoicesPage() {
  const [creating, setCreating] = useState(null);
  return (
    <FeePage
      title="Invoices"
      description="Invoices made when needed, one per student, with discounts, previous payments and the balance."
      secondaryActions={() => <Button variant="outline" leftIcon={FileStack} onClick={() => setCreating('bulk')}>Bulk Invoice</Button>}
      primaryAction={() => <Button leftIcon={Plus} onClick={() => setCreating('single')}>New Invoice</Button>}
    >
      {(status) => <Invoices status={status} creating={creating} setCreating={setCreating} />}
    </FeePage>
  );
}

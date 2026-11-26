import { useMemo, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Badge, Button, Card, CardHeader, ConfirmModal, ErrorState, Input, Select, Table, TableActions, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableLoading, TableRow } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { loadStaffFeeAccess, setStaffFeeAccess } from '../data/feeApi.js';

/**
 * School Owner (Fees → Settings → Accountants): staff members given Fee Management access. They sign in
 * with their usual staff sign-in and get the Accountant workspace of their branch (payments, receipts,
 * invoices, their own cash closing, reports), with the same limits as an Accountant account. The API
 * checks the access on every request, so taking it back applies at once. Both changes are audited.
 */
export function StaffFeeAccess({ onNotice }) {
  const [version, setVersion] = useState(0);
  const data = useApiData(() => loadStaffFeeAccess(), `staff-fee-access|${version}`);
  const [dialog, setDialog] = useState(null);
  const [choice, setChoice] = useState('');
  const [search, setSearch] = useState('');
  const items = useMemo(() => data.data?.items ?? [], [data.data]);
  const withAccess = items.filter((s) => s.feeAccess);
  const q = search.trim().toLowerCase();
  const candidates = items.filter((s) => !s.feeAccess && s.status === 'active' && (!q || `${s.name} ${s.staffId} ${s.jobTitle} ${s.branch.name}`.toLowerCase().includes(q)));
  // Staff whose job title says Accountant first: the likely choice.
  candidates.sort((a, b) => Number(/accountant/i.test(b.jobTitle)) - Number(/accountant/i.test(a.jobTitle)));
  const chosen = items.find((s) => s.id === choice);
  const done = (message) => {
    setDialog(null);
    setChoice('');
    setSearch('');
    onNotice(message);
    setVersion((n) => n + 1);
  };

  if (data.status === 'error' && !data.data) return <ErrorState title="Staff access could not be loaded" onRetry={data.retry} />;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Staff with Fee Management access"
        description="Instead of a separate Accountant account, give a staff member access: they keep their staff sign-in and attendance, and also get the Accountant workspace of their branch with the same limits."
        action={data.data && <Button size="sm" leftIcon={KeyRound} onClick={() => setDialog({ type: 'grant' })}>Give access</Button>}
      />
      <div className="mt-3 overflow-x-auto">
        <Table caption="Staff members with Fee Management access">
          <TableHead>
            <TableRow interactive={false}>
              <TableHeaderCell>Staff member</TableHeaderCell>
              <TableHeaderCell>Job title</TableHeaderCell>
              <TableHeaderCell>Branch</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell align="right">Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {!data.data && <TableLoading columns={5} />}
            {data.data && !withAccess.length && <TableEmpty columns={5} icon={KeyRound} title="No staff members have access" description="Give access to the staff member who takes fees in a branch." />}
            {withAccess.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}<span className="block text-caption text-fg-muted">{s.staffId}</span></TableCell>
                <TableCell>{s.jobTitle || '—'}</TableCell>
                <TableCell>{s.branch.name}</TableCell>
                <TableCell><Badge variant={s.status === 'active' ? 'success' : 'error'}>{s.status === 'active' ? 'Active' : 'Suspended'}</Badge></TableCell>
                <TableCell align="right">
                  <TableActions>
                    <Button size="sm" variant="danger" onClick={() => setDialog({ type: 'revoke', staff: s })}>Take back access</Button>
                  </TableActions>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ConfirmModal
        open={dialog?.type === 'grant'}
        onClose={() => setDialog(null)}
        title="Give Fee Management access"
        description="The staff member signs in to the web app with their usual phone number or email and password."
        confirmLabel="Give access"
        variant="primary"
        run={() => {
          if (!chosen) return Promise.reject(Object.assign(new Error('Choose a staff member.'), { status: 409 }));
          return setStaffFeeAccess(chosen.id, true);
        }}
        onDone={() => done(`${chosen?.name ?? 'The staff member'} now has Fee Management access for ${chosen?.branch.name ?? 'their branch'}.`)}
      >
        <div className="flex flex-col gap-3">
          <Input label="Find a staff member" size="sm" placeholder="Name, Staff ID, job title or branch" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select
            label="Staff member"
            required
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            placeholder={candidates.length ? 'Choose a staff member' : 'No staff members match'}
            options={candidates.slice(0, 200).map((s) => ({ value: s.id, label: `${s.name} · ${s.jobTitle || 'Staff'} · ${s.branch.name}` }))}
          />
          <p className="text-caption text-fg-muted">They can record payments, print receipts, make invoices, close their own cash and see reports for their branch. They cannot change fee structures, settings or discount policies, give discounts or adjust fees.</p>
        </div>
      </ConfirmModal>

      <ConfirmModal
        open={dialog?.type === 'revoke'}
        onClose={() => setDialog(null)}
        title={`Take back access from ${dialog?.staff?.name ?? ''}?`}
        description="They can no longer open Fee Management. Their payments, receipts and cash closings stay. If they still hold cash, ask them to close it first."
        confirmLabel="Take back access"
        run={() => setStaffFeeAccess(dialog.staff.id, false)}
        onDone={() => done(`Fee Management access taken back from ${dialog?.staff?.name ?? 'the staff member'}.`)}
      />
    </Card>
  );
}

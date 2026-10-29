import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { Alert, Badge, Button, Card, Table, TableActions, TableBody, TableCell, TableEmpty, TableHead, TableHeaderCell, TableRow } from '../../../components/ui';

const COLUMNS = [
  { key: 'checkIns', label: 'Check-ins' },
  { key: 'present', label: 'Present' },
  { key: 'late', label: 'Late' },
  { key: 'checkedOut', label: 'Checked out' },
  { key: 'checkOutMissing', label: 'No check-out' },
  { key: 'staffCheckedIn', label: 'Staff checked in' },
];

/**
 * Owner branch comparison: the same counts for every branch of the school (suspended branches and
 * branches with no records included). Raw counts only: no rates, percentages or ranking (D19).
 * "View" switches the whole report to that branch; the combined view is restored from the filter bar.
 */
export function BranchesPanel({ summary, view, update }) {
  const [sort, setSort] = useState({ key: 'code', dir: 'asc' });

  if (view.branch) {
    return (
      <Alert variant="info" title="One branch is selected" action={<Button size="sm" variant="outline" onClick={() => update({ branch: '' })}>Compare all branches</Button>}>
        The comparison lists every branch. Clear the branch filter to see it.
      </Alert>
    );
  }

  const rows = [...(summary.byBranch ?? [])].sort((a, b) => {
    const order = sort.key === 'code' ? a.branch.code.localeCompare(b.branch.code) : a[sort.key] - b[sort.key] || a.branch.code.localeCompare(b.branch.code);
    return sort.dir === 'asc' ? order : -order;
  });
  const toggle = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === 'asc' ? 'desc' : 'asc' }));
  const sortButton = (key, label) => (
    <button type="button" onClick={() => toggle(key)} className="inline-flex items-center gap-1 font-semibold hover:text-fg" aria-label={`Sort by ${label}`}>
      {label}
      {sort.key === key && <span aria-hidden="true">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
    </button>
  );
  const ariaSort = (key) => (sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-small text-fg-secondary">Counts for the selected dates and filters. Counts are not adjusted for branch size.</p>
      <Card className="overflow-hidden">
        <div role="region" aria-label="Branch comparison" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
          <Table caption="Attendance by branch">
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell aria-sort={ariaSort('code')}>{sortButton('code', 'Branch')}</TableHeaderCell>
                {COLUMNS.map((c) => (
                  <TableHeaderCell key={c.key} align="right" aria-sort={ariaSort(c.key)}>
                    {sortButton(c.key, c.label)}
                  </TableHeaderCell>
                ))}
                <TableHeaderCell align="right">Report</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 && <TableEmpty columns={COLUMNS.length + 2} icon={Building2} title="No branches yet" description="Branches you create appear here." />}
              {rows.map((row) => (
                <TableRow key={row.branch.id}>
                  <TableCell className="whitespace-nowrap">
                    <span className="font-medium">{row.branch.name}</span> <span className="text-fg-secondary tabular-nums">{row.branch.code}</span>
                    {row.branch.status === 'suspended' && (
                      <Badge variant="error" className="ml-2">
                        Suspended
                      </Badge>
                    )}
                  </TableCell>
                  {COLUMNS.map((c) => (
                    <TableCell key={c.key} align="right">
                      {row[c.key].toLocaleString()}
                    </TableCell>
                  ))}
                  <TableCell align="right">
                    <TableActions>
                      <Button size="sm" variant="outline" onClick={() => update({ branch: row.branch.id, tab: 'records' })} aria-label={`View records of ${row.branch.name}`}>
                        View
                      </Button>
                    </TableActions>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

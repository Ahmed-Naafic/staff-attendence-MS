import { SearchX, Users } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  LinkButton,
  Pagination,
  Table,
  TableActions,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../../components/ui';
import { PAGE_SIZE } from '../utils/staffRules.js';

const COLUMNS = 6;
export const staffStatuses = {
  active: { label: 'Active', variant: 'success' },
  suspended: { label: 'Suspended', variant: 'error' },
};

export function StaffStatusBadge({ status }) {
  const { label, variant } = staffStatuses[status] ?? { label: status, variant: 'neutral' };
  return <Badge variant={variant}>{label}</Badge>;
}

/** The branch's staff with View (opens the details panel, where the actions are) and pagination. */
export function StaffTable({ rows, total, page, onPageChange, selectedId, search, isFiltered, onReset, onAdd, addUnavailable }) {
  return (
    <Card className="overflow-hidden">
      <div role="region" aria-label="Staff" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
        <Table caption="Staff of your branch">
          <TableHead>
            <TableRow interactive={false}>
              <TableHeaderCell>Staff ID</TableHeaderCell>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Job title</TableHeaderCell>
              <TableHeaderCell>Phone</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell align="right">Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 &&
              (isFiltered ? (
                <TableEmpty
                  columns={COLUMNS}
                  icon={SearchX}
                  title="No staff found"
                  description="No staff match your search and filter."
                  action={
                    <Button variant="outline" size="sm" onClick={onReset}>
                      Clear search and filter
                    </Button>
                  }
                />
              ) : (
                <TableEmpty
                  columns={COLUMNS}
                  icon={Users}
                  title="No staff yet"
                  description={addUnavailable ?? 'Add your branch’s staff. Each account is active at once; staff sign in with their phone number.'}
                  action={
                    !addUnavailable && (
                      <Button size="sm" onClick={onAdd}>
                        Add Staff
                      </Button>
                    )
                  }
                />
              ))}
            {rows.map((s) => (
              <TableRow key={s.id} selected={s.id === selectedId}>
                <TableCell className="whitespace-nowrap tabular-nums text-fg-secondary">{s.staffId}</TableCell>
                <TableCell className="font-medium whitespace-nowrap">{s.name}</TableCell>
                <TableCell className="whitespace-nowrap text-fg-secondary">{s.jobTitle}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums text-fg-secondary">{s.phone}</TableCell>
                <TableCell>
                  <StaffStatusBadge status={s.status} />
                </TableCell>
                <TableCell align="right">
                  <TableActions>
                    <LinkButton to={{ pathname: `/staff/${s.id}`, search }} size="sm" variant="outline" aria-label={`View ${s.name}`} className="min-w-[4.5rem]">
                      View
                    </LinkButton>
                  </TableActions>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={onPageChange} itemLabel="staff" />}
    </Card>
  );
}

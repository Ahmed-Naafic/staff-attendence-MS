import { SearchX, UserCog } from 'lucide-react';
import {
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
import { PAGE_SIZE } from '../utils/managerRules.js';
import { ManagerStatusBadge } from './ManagerStatusBadge.jsx';

const COLUMNS = 6;

/** The school's Managers with View (opens the details panel, where the actions are) and pagination. */
export function ManagersTable({ rows, total, page, onPageChange, selectedId, search, isFiltered, onReset, onAdd, addUnavailable }) {
  return (
    <Card className="overflow-hidden">
      <div role="region" aria-label="Managers" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
        <Table caption="Managers of your school">
          <TableHead>
            <TableRow interactive={false}>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Email</TableHeaderCell>
              <TableHeaderCell>Branch</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Password</TableHeaderCell>
              <TableHeaderCell align="right">Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 &&
              (isFiltered ? (
                <TableEmpty
                  columns={COLUMNS}
                  icon={SearchX}
                  title="No Managers found"
                  description="No Managers match your search and filters."
                  action={
                    <Button variant="outline" size="sm" onClick={onReset}>
                      Clear search and filters
                    </Button>
                  }
                />
              ) : (
                <TableEmpty
                  columns={COLUMNS}
                  icon={UserCog}
                  title="No Managers yet"
                  description={addUnavailable ?? 'Add a Manager for one of your branches. You set a temporary password that they change at first sign-in.'}
                  action={
                    !addUnavailable && (
                      <Button size="sm" onClick={onAdd}>
                        Add Manager
                      </Button>
                    )
                  }
                />
              ))}
            {rows.map((manager) => (
              <TableRow key={manager.id} selected={manager.id === selectedId}>
                <TableCell className="font-medium whitespace-nowrap">{manager.name}</TableCell>
                <TableCell className="whitespace-nowrap text-fg-secondary">{manager.email}</TableCell>
                <TableCell className="whitespace-nowrap text-fg-secondary">
                  {manager.branch.name} <span className="tabular-nums text-fg-muted">({manager.branch.code})</span>
                </TableCell>
                <TableCell>
                  <ManagerStatusBadge status={manager.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-fg-secondary">{manager.passwordChangePending ? 'Temporary' : 'Changed'}</TableCell>
                <TableCell align="right">
                  <TableActions>
                    <LinkButton
                      to={{ pathname: `/managers/${manager.id}`, search }}
                      size="sm"
                      variant="outline"
                      aria-label={`View ${manager.name}`}
                      className="min-w-[4.5rem]"
                    >
                      View
                    </LinkButton>
                  </TableActions>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={onPageChange} itemLabel="Managers" />}
    </Card>
  );
}

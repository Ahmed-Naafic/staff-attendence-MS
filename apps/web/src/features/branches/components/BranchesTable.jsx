import { Building2, SearchX } from 'lucide-react';
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
import { PAGE_SIZE } from '../utils/branchRules.js';
import { BranchStatusBadge } from './BranchStatusBadge.jsx';

const COLUMNS = 6;

/** The school's branches with View (opens the details panel, where the actions are) and pagination. */
export function BranchesTable({ rows, total, page, onPageChange, selectedId, search, isFiltered, onReset, onAdd, readOnly }) {
  return (
    <Card className="overflow-hidden">
      <div role="region" aria-label="Branches" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
        <Table caption="Branches of your school">
          <TableHead>
            <TableRow interactive={false}>
              <TableHeaderCell>Branch code</TableHeaderCell>
              <TableHeaderCell>Branch name</TableHeaderCell>
              <TableHeaderCell>City</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Operating</TableHeaderCell>
              <TableHeaderCell align="right">Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 &&
              (isFiltered ? (
                <TableEmpty
                  columns={COLUMNS}
                  icon={SearchX}
                  title="No branches found"
                  description="No branches match your search and filter."
                  action={
                    <Button variant="outline" size="sm" onClick={onReset}>
                      Clear search and filter
                    </Button>
                  }
                />
              ) : (
                <TableEmpty
                  columns={COLUMNS}
                  icon={Building2}
                  title="No branches yet"
                  description="Add your school's first branch. You will need to be at the branch to capture its location."
                  action={
                    !readOnly && (
                      <Button size="sm" onClick={onAdd}>
                        Add Branch
                      </Button>
                    )
                  }
                />
              ))}
            {rows.map((branch) => (
              <TableRow key={branch.id} selected={branch.id === selectedId}>
                <TableCell className="whitespace-nowrap tabular-nums text-fg-secondary">{branch.code}</TableCell>
                <TableCell className="font-medium whitespace-nowrap">{branch.name}</TableCell>
                <TableCell className="whitespace-nowrap text-fg-secondary">{branch.city}</TableCell>
                <TableCell>
                  <BranchStatusBadge status={branch.status} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-fg-secondary">{branch.operating.operating ? 'Yes' : 'No'}</TableCell>
                <TableCell align="right">
                  <TableActions>
                    <LinkButton
                      to={{ pathname: `/branches/${branch.id}`, search }}
                      size="sm"
                      variant="outline"
                      aria-label={`View ${branch.name}`}
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
      {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={onPageChange} itemLabel="branches" />}
    </Card>
  );
}

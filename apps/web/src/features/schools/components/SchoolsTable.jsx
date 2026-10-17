import { useNavigate } from 'react-router';
import { CircleOff, Eye, Pencil, RotateCcw, School, SearchX } from 'lucide-react';
import {
  Button,
  Card,
  DropdownMenu,
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
import { formatDate } from '../../../lib/format.js';
import { PAGE_SIZE } from '../utils/filterSchools.js';
import { SchoolStatusBadge } from './SchoolStatusBadge.jsx';

const COLUMNS = 7;

/**
 * Schools table with View (opens the details panel), a ⋮ menu (view, edit, suspend or reactivate)
 * and pagination.
 */
export function SchoolsTable({ rows, total, page, offset, onPageChange, selectedId, search, isFiltered, onReset, onEdit, onSuspend, onReactivate }) {
  const navigate = useNavigate();
  const detailsLink = (id) => ({ pathname: `/schools/${id}`, search });

  return (
    <Card className="overflow-hidden">
      <div role="region" aria-label="Schools" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
        <Table caption="Schools on the platform">
          <TableHead>
            <TableRow interactive={false}>
              <TableHeaderCell className="w-12">#</TableHeaderCell>
              <TableHeaderCell>School name</TableHeaderCell>
              <TableHeaderCell>Owner</TableHeaderCell>
              <TableHeaderCell>Location</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Registered</TableHeaderCell>
              <TableHeaderCell align="right">Actions</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 &&
              (isFiltered ? (
                <TableEmpty
                  columns={COLUMNS}
                  icon={SearchX}
                  title="No schools found"
                  description="No schools match your search and filters."
                  action={
                    <Button variant="outline" size="sm" onClick={onReset}>
                      Clear search and filters
                    </Button>
                  }
                />
              ) : (
                <TableEmpty columns={COLUMNS} icon={School} title="No schools yet" description="Schools will appear here once they are registered." />
              ))}
            {rows.map((school, index) => {
              const suspended = school.status === 'suspended';
              return (
                <TableRow key={school.id} selected={school.id === selectedId}>
                  <TableCell className="text-fg-muted tabular-nums">{offset + index + 1}</TableCell>
                  <TableCell className="font-medium whitespace-nowrap">{school.name}</TableCell>
                  <TableCell className="whitespace-nowrap text-fg-secondary">
                    {school.ownerName ?? (
                      <span className="text-fg-muted">
                        <span aria-hidden="true">—</span>
                        <span className="sr-only">No owner linked</span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-fg-secondary">{school.location}</TableCell>
                  <TableCell>
                    <SchoolStatusBadge status={school.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-fg-secondary">
                    <time dateTime={school.registeredAt}>{formatDate(school.registeredAt)}</time>
                  </TableCell>
                  <TableCell align="right">
                    <TableActions>
                      <LinkButton
                        to={detailsLink(school.id)}
                        size="sm"
                        variant="outline"
                        aria-label={`View ${school.name}`}
                        className="min-w-[4.5rem]"
                      >
                        View
                      </LinkButton>
                      <DropdownMenu
                        label={`More actions for ${school.name}`}
                        items={[
                          { label: 'View details', icon: Eye, onSelect: () => navigate(detailsLink(school.id)) },
                          { label: 'Edit school', icon: Pencil, onSelect: () => onEdit(school) },
                          { type: 'separator' },
                          suspended
                            ? { label: 'Reactivate school', icon: RotateCcw, onSelect: () => onReactivate(school) }
                            : { label: 'Suspend school', icon: CircleOff, destructive: true, onSelect: () => onSuspend(school) },
                        ]}
                      />
                    </TableActions>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={onPageChange} itemLabel="schools" />}
    </Card>
  );
}

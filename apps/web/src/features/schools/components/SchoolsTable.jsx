import { useNavigate } from 'react-router';
import { Eye, Pencil, CircleCheck, CircleOff, School, SearchX } from 'lucide-react';
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
 * Schools table with View/Review (opens the details panel), a ⋮ menu and pagination.
 * Management actions are shown but unavailable until their business rules are approved.
 */
export function SchoolsTable({ rows, total, page, offset, onPageChange, selectedId, search, isFiltered, onReset }) {
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
              const isPending = school.status === 'pending';
              return (
                <TableRow key={school.id} selected={school.id === selectedId}>
                  <TableCell className="text-fg-muted tabular-nums">{offset + index + 1}</TableCell>
                  <TableCell className="font-medium whitespace-nowrap">{school.name}</TableCell>
                  <TableCell className="whitespace-nowrap text-fg-secondary">{school.ownerName}</TableCell>
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
                        aria-label={`${isPending ? 'Review' : 'View'} ${school.name}`}
                        className="min-w-[4.5rem]"
                      >
                        {isPending ? 'Review' : 'View'}
                      </LinkButton>
                      <DropdownMenu
                        label={`More actions for ${school.name}`}
                        items={[
                          { label: 'View details', icon: Eye, onSelect: () => navigate(detailsLink(school.id)) },
                          { type: 'separator' },
                          { type: 'label', label: 'Not available yet' },
                          { label: 'Edit school', icon: Pencil, disabled: true },
                          ...(isPending ? [{ label: 'Approve school', icon: CircleCheck, disabled: true }] : []),
                          ...(school.status === 'active'
                            ? [{ label: 'Suspend school', icon: CircleOff, disabled: true, destructive: true }]
                            : []),
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

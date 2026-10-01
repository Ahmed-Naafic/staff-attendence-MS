import { useNavigate } from 'react-router';
import { CircleOff, Eye, Landmark, Pencil, SearchX, Users } from 'lucide-react';
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
import { PAGE_SIZE } from '../utils/filterOwners.js';
import { OwnerStatusBadge } from './OwnerStatusBadge.jsx';

const COLUMNS = 9;

/**
 * School owners table with View/Review (opens the details panel), a ⋮ menu and pagination.
 * Management actions are shown but unavailable until their business rules are approved.
 */
export function OwnersTable({ rows, total, page, offset, onPageChange, selectedId, search, isFiltered, onReset }) {
  const navigate = useNavigate();
  const detailsLink = (id) => ({ pathname: `/school-owners/${id}`, search });

  return (
    <Card className="overflow-hidden">
      <div role="region" aria-label="School owners" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
        <Table caption="School owners on the platform">
          <TableHead>
            <TableRow interactive={false}>
              <TableHeaderCell className="w-12">#</TableHeaderCell>
              <TableHeaderCell>Owner name</TableHeaderCell>
              <TableHeaderCell>Email</TableHeaderCell>
              {/* Phone shows from 1536px so the table fits common laptop widths; it is always in the panel. */}
              <TableHeaderCell className="hidden 2xl:table-cell">Phone</TableHeaderCell>
              <TableHeaderCell>School</TableHeaderCell>
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
                  title="No school owners found"
                  description="No school owners match your search and filters."
                  action={
                    <Button variant="outline" size="sm" onClick={onReset}>
                      Clear search and filters
                    </Button>
                  }
                />
              ) : (
                <TableEmpty
                  columns={COLUMNS}
                  icon={Users}
                  title="No school owners yet"
                  description="School owners will appear here once their accounts exist."
                />
              ))}
            {rows.map((owner, index) => {
              const isPending = owner.status === 'pending';
              return (
                <TableRow key={owner.id} selected={owner.id === selectedId}>
                  <TableCell className="text-fg-muted tabular-nums">{offset + index + 1}</TableCell>
                  <TableCell className="font-medium whitespace-nowrap">{owner.name}</TableCell>
                  <TableCell className="whitespace-nowrap text-fg-secondary">{owner.email}</TableCell>
                  <TableCell className="hidden whitespace-nowrap text-fg-secondary tabular-nums 2xl:table-cell">{owner.phone}</TableCell>
                  <TableCell className="whitespace-nowrap text-fg-secondary">{owner.school.name}</TableCell>
                  <TableCell className="whitespace-nowrap text-fg-secondary">{owner.school.location}</TableCell>
                  <TableCell>
                    <OwnerStatusBadge status={owner.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-fg-secondary">
                    <time dateTime={owner.registeredAt}>{formatDate(owner.registeredAt)}</time>
                  </TableCell>
                  <TableCell align="right">
                    <TableActions>
                      <LinkButton
                        to={detailsLink(owner.id)}
                        size="sm"
                        variant="outline"
                        aria-label={`${isPending ? 'Review' : 'View'} ${owner.name}`}
                        className="min-w-[4.5rem]"
                      >
                        {isPending ? 'Review' : 'View'}
                      </LinkButton>
                      <DropdownMenu
                        label={`More actions for ${owner.name}`}
                        items={[
                          { label: 'View details', icon: Eye, onSelect: () => navigate(detailsLink(owner.id)) },
                          { label: 'View school', icon: Landmark, onSelect: () => navigate(`/schools/${owner.school.id}`) },
                          { type: 'separator' },
                          { type: 'label', label: 'Not available yet' },
                          { label: 'Edit owner', icon: Pencil, disabled: true },
                          ...(owner.status === 'active'
                            ? [{ label: 'Suspend owner', icon: CircleOff, disabled: true, destructive: true }]
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
      {total > 0 && <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={onPageChange} itemLabel="owners" />}
    </Card>
  );
}

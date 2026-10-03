import { Link } from 'react-router';
import { Eye, History, SearchX } from 'lucide-react';
import {
  Avatar,
  Button,
  buttonClassName,
  Card,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tooltip,
} from '../../../components/ui';
import { formatDateTime } from '../../../lib/format.js';
import { actionOf, targetTypes } from '../utils/auditTypes.js';
import { PAGE_SIZES } from '../utils/filterAuditLogs.js';
import { AuditAction, ResultBadge, RoleBadge } from './AuditBadges.jsx';

const COLUMNS = 10;

/**
 * Read-only audit events table. The eye button opens the event's details panel;
 * there are no actions on the events themselves.
 */
export function AuditTable({ rows, total, page, pageSize, offset, onPageChange, onPageSizeChange, selectedId, search, isFiltered, onReset }) {
  return (
    <Card className="overflow-hidden">
      <div role="region" aria-label="Audit events" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
        {/* Tighter cell padding so all ten columns fit from 1536px; Target Type and IP Address
            (also in the details panel) show from 1536px. */}
        <Table caption="Audit events, newest first" className="[&_td]:px-2.5 [&_th]:px-2.5">
          <TableHead>
            <TableRow interactive={false}>
              <TableHeaderCell className="w-12">#</TableHeaderCell>
              <TableHeaderCell>Date &amp; Time</TableHeaderCell>
              <TableHeaderCell>User</TableHeaderCell>
              <TableHeaderCell>Role</TableHeaderCell>
              <TableHeaderCell>Action</TableHeaderCell>
              <TableHeaderCell className="hidden 2xl:table-cell">Target Type</TableHeaderCell>
              <TableHeaderCell>Target</TableHeaderCell>
              <TableHeaderCell className="hidden 2xl:table-cell">IP Address</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell align="right">Details</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 &&
              (isFiltered ? (
                <TableEmpty
                  columns={COLUMNS}
                  icon={SearchX}
                  title="No audit events found"
                  description="No audit events match your search and filters."
                  action={
                    <Button variant="outline" size="sm" onClick={onReset}>
                      Clear search and filters
                    </Button>
                  }
                />
              ) : (
                <TableEmpty
                  columns={COLUMNS}
                  icon={History}
                  title="No audit activity yet"
                  description="Important platform actions will be recorded here."
                />
              ))}
            {rows.map((event, index) => {
              const when = formatDateTime(event.occurredAt);
              const label = `View details: ${actionOf(event.action).label} by ${event.actor.name}, ${when}`;
              return (
                <TableRow key={event.id} selected={event.id === selectedId}>
                  <TableCell className="text-fg-muted tabular-nums">{offset + index + 1}</TableCell>
                  <TableCell className="whitespace-nowrap text-fg-secondary tabular-nums">
                    <time dateTime={event.occurredAt}>{when}</time>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-2 whitespace-nowrap">
                      <Avatar name={event.actor.name} size="sm" decorative />
                      <span className="font-medium">{event.actor.name}</span>
                    </span>
                  </TableCell>
                  <TableCell>
                    <RoleBadge role={event.actor.role} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <AuditAction event={event} />
                  </TableCell>
                  <TableCell className="hidden whitespace-nowrap text-fg-secondary 2xl:table-cell">{targetTypes[event.target.type] ?? event.target.type}</TableCell>
                  <TableCell className="min-w-28 text-fg-secondary">{event.target.name}</TableCell>
                  <TableCell className="hidden whitespace-nowrap text-fg-secondary tabular-nums 2xl:table-cell">{event.context.ipAddress}</TableCell>
                  <TableCell>
                    <ResultBadge result={event.result} />
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip content="View details" placement="left" decorative>
                      <Link
                        to={{ pathname: `/audit-logs/${event.id}`, search }}
                        aria-label={label}
                        className={buttonClassName({ variant: 'outline', size: 'sm', iconOnly: true })}
                      >
                        <Eye aria-hidden="true" className="size-4" />
                      </Link>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={onPageChange}
          itemLabel="events"
          pageSizeOptions={PAGE_SIZES}
          onPageSizeChange={onPageSizeChange}
        />
      )}
    </Card>
  );
}

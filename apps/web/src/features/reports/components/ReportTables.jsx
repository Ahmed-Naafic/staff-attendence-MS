import { useState } from 'react';
import { FileX } from 'lucide-react';
import {
  Card,
  CardHeader,
  Pagination,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../../components/ui';
import { formatDate } from '../../../lib/format.js';
import { OwnerStatusBadge } from '../../school-owners';
import { SchoolStatusBadge } from '../../schools';

const PAGE_SIZE = 10;

/** Read-only report table in a card: no row actions. Scrolls inside the card on small screens. */
function ReportTable({ title, description, caption, columns, rows, renderRow, itemLabel, paginate = true }) {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const visible = paginate ? rows.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE) : rows;
  const offset = paginate ? (current - 1) * PAGE_SIZE : 0;

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader titleAs="h2" title={title} description={description} />
      <div role="region" aria-label={title} tabIndex={0} className="relative mt-4 overflow-x-auto border-t border-border focus-visible:outline-offset-[-2px]">
        <Table caption={caption}>
          <TableHead>
            <TableRow interactive={false}>
              <TableHeaderCell className="w-12">#</TableHeaderCell>
              {columns.map((column) => (
                <TableHeaderCell key={column}>{column}</TableHeaderCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty columns={columns.length + 1} icon={FileX} title="No report data available" description="Nothing was registered in this period." />
            ) : (
              visible.map((row, index) => (
                <TableRow key={row.id}>
                  <TableCell className="text-fg-muted tabular-nums">{offset + index + 1}</TableCell>
                  {renderRow(row)}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {paginate && rows.length > PAGE_SIZE && (
        <Pagination page={current} pageSize={PAGE_SIZE} total={rows.length} onPageChange={setPage} itemLabel={itemLabel} />
      )}
    </Card>
  );
}

const cell = 'whitespace-nowrap text-fg-secondary';
const date = (iso) => <time dateTime={iso}>{formatDate(iso)}</time>;

/** Schools registered in the period. `limit` shows only the newest few (overview). */
export function SchoolsReportTable({ schools, title, description, limit }) {
  const rows = limit ? schools.slice(0, limit) : schools;
  return (
    <ReportTable
      title={title}
      description={description}
      caption={`${title}, ${rows.length} schools`}
      columns={['School name', 'Owner', 'Location', 'Status', 'Registered']}
      rows={rows}
      itemLabel="schools"
      paginate={!limit}
      renderRow={(s) => (
        <>
          <TableCell className="font-medium whitespace-nowrap">{s.name}</TableCell>
          <TableCell className={cell}>{s.ownerName || <><span aria-hidden="true">—</span><span className="sr-only">No owner linked</span></>}</TableCell>
          <TableCell className={cell}>{s.location}</TableCell>
          <TableCell>
            <SchoolStatusBadge status={s.status} />
          </TableCell>
          <TableCell className={cell}>{date(s.registeredAt)}</TableCell>
        </>
      )}
    />
  );
}

/** School owners registered in the period. */
export function OwnersReportTable({ owners }) {
  return (
    <ReportTable
      title="Owners registered in this period"
      caption={`School owners registered in this period, ${owners.length} owners`}
      columns={['Owner name', 'Email', 'School', 'Location', 'Status', 'Registered']}
      rows={owners}
      itemLabel="owners"
      renderRow={(o) => (
        <>
          <TableCell className="font-medium whitespace-nowrap">{o.name}</TableCell>
          <TableCell className={cell}>{o.email}</TableCell>
          <TableCell className={cell}>{o.schoolName}</TableCell>
          <TableCell className={cell}>{o.location}</TableCell>
          <TableCell>
            <OwnerStatusBadge status={o.status} />
          </TableCell>
          <TableCell className={cell}>{date(o.registeredAt)}</TableCell>
        </>
      )}
    />
  );
}

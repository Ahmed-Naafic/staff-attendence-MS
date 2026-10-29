import { ClipboardList, SearchX } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Drawer,
  Input,
  Pagination,
  Select,
  Table,
  TableActions,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../../components/ui';
import { ExportReport } from './ExportReport.jsx';
import { CHECK_OUT, formatMeters, formatWorked, PAGE_SIZE, shortTime, SORTS, STATUS } from '../utils/reportRules.js';

const STATUS_OPTIONS = [{ value: '', label: 'All statuses' }, ...Object.entries(STATUS).map(([value, s]) => ({ value: value.toLowerCase(), label: s.label }))];
const CHECK_OUT_OPTIONS = [{ value: '', label: 'All check-outs' }, ...Object.entries(CHECK_OUT).map(([value, s]) => ({ value, label: s.label }))];

export function StatusBadge({ status }) {
  const s = STATUS[status] ?? { label: status, variant: 'neutral' };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

function CheckOutCell({ record }) {
  if (record.checkOut) return <span className="tabular-nums">{shortTime(record.checkOut.time)}</span>;
  const s = CHECK_OUT[record.checkOutState];
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

const Unavailable = () => <span className="text-fg-muted">Not available</span>;

/** Search, status and check-out filters, sort, the records table and pagination. */
export function RecordsPanel({ role, view, update, data, range, filtered, onOpen, selectedId }) {
  const owner = role === 'OWNER';
  const columns = owner ? 11 : 10;
  const sorts = SORTS.filter((s) => owner || !s.ownerOnly);
  const zones = [...new Set(data.items.map((r) => r.timeZone))];

  return (
    <div className="flex flex-col gap-4">
      <Card as="section" aria-label="Search and filter records" className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
          <Input type="search" label="Search records" hideLabel placeholder="Search by staff name or Staff ID…" value={view.q} onChange={(event) => update({ q: event.target.value })} />
          <Select label="Status" hideLabel options={STATUS_OPTIONS} value={view.status} onChange={(event) => update({ status: event.target.value })} />
          <Select label="Check-out" hideLabel options={CHECK_OUT_OPTIONS} value={view.checkOut} onChange={(event) => update({ checkOut: event.target.value })} />
          <Select label="Sort" hideLabel options={sorts} value={view.sort} onChange={(event) => update({ sort: event.target.value === 'date:desc' ? '' : event.target.value })} />
        </div>
        <div className="mt-3 border-t border-border-subtle pt-3">
          <ExportReport role={role} view={view} range={range} total={data.total} />
        </div>
      </Card>

      <p aria-live="polite" className="sr-only">
        {`${data.total} records found`}
      </p>

      <Card className="overflow-hidden">
        <div role="region" aria-label="Attendance records" tabIndex={0} className="relative overflow-x-auto focus-visible:outline-offset-[-2px]">
          <Table caption="Attendance records: one row per accepted check-in" className="min-w-[60rem]">
            <TableHead>
              <TableRow interactive={false}>
                <TableHeaderCell>Date</TableHeaderCell>
                <TableHeaderCell>Staff ID</TableHeaderCell>
                <TableHeaderCell>Staff</TableHeaderCell>
                {owner && <TableHeaderCell>Branch</TableHeaderCell>}
                <TableHeaderCell>Shift</TableHeaderCell>
                <TableHeaderCell>Scheduled</TableHeaderCell>
                <TableHeaderCell>Check-in</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Check-out</TableHeaderCell>
                <TableHeaderCell>Worked (calculated)</TableHeaderCell>
                <TableHeaderCell align="right">Details</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.items.length === 0 && (
                <TableEmpty
                  columns={columns}
                  icon={filtered ? SearchX : ClipboardList}
                  title="No attendance recorded for these filters"
                  description="Only accepted check-ins are listed. Days without a check-in are not shown and are not counted as absent."
                />
              )}
              {data.items.map((r) => (
                <TableRow key={r.id} selected={r.id === selectedId}>
                  <TableCell className="whitespace-nowrap tabular-nums">{r.workDate}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-fg-secondary">{r.staff.staffId}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    <span className="font-medium">{r.staff.name}</span>
                    {r.staff.status === 'suspended' && (
                      <Badge variant="error" className="ml-2">
                        Suspended
                      </Badge>
                    )}
                  </TableCell>
                  {owner && <TableCell className="whitespace-nowrap text-fg-secondary">{r.branch.name}</TableCell>}
                  <TableCell className="whitespace-nowrap">{r.shift.name ?? <Unavailable />}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-fg-secondary">{r.shift.start ? `${r.shift.start}–${r.shift.end}` : <Unavailable />}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{shortTime(r.checkIn.time)}</TableCell>
                  <TableCell>
                    <StatusBadge status={r.status} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    <CheckOutCell record={r} />
                  </TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-fg-secondary">{formatWorked(r.workedMinutes) ?? '—'}</TableCell>
                  <TableCell align="right">
                    <TableActions>
                      <Button size="sm" variant="outline" onClick={() => onOpen(r)} aria-label={`Details of ${r.staff.name}, ${r.workDate}`}>
                        View
                      </Button>
                    </TableActions>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {data.total > 0 && <Pagination page={data.page} pageSize={PAGE_SIZE} total={data.total} onPageChange={(page) => update({ page })} itemLabel="records" />}
      </Card>
      {zones.length > 0 && <p className="text-small text-fg-muted">Times are branch times in {zones.join(', ')}, from the schedule in effect on each day.</p>}
    </div>
  );
}

function Fact({ label, children }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body text-fg">{children ?? <Unavailable />}</dd>
    </div>
  );
}

/** One recorded event (check-in or check-out): recorded and received times, distance and accuracy. */
function EventFacts({ title, event, timeZone }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-md border border-border px-4 py-3">
      <h3 className="text-card-title text-fg">{title}</h3>
      <dl className="grid grid-cols-2 gap-3">
        <Fact label="Recorded time">
          <span className="tabular-nums">{`${event.date} ${event.time}`}</span>
          <span className="block text-caption text-fg-muted">{timeZone}</span>
        </Fact>
        <Fact label="Received by the server">
          <span className="tabular-nums">{`${event.received.date} ${event.received.time}`}</span>
          {event.uploadedLater && (
            <Badge variant="info" className="mt-1">
              Uploaded later
            </Badge>
          )}
        </Fact>
        <Fact label="Distance to the branch">{formatMeters(event.distanceMeters)}</Fact>
        <Fact label="GPS accuracy">{formatMeters(event.accuracyMeters)}</Fact>
      </dl>
    </section>
  );
}

/** Details of one record: what was recorded (times, distance, accuracy) and what is calculated (worked time). */
export function RecordDrawer({ record, role, onClose }) {
  if (!record) return null;
  const s = CHECK_OUT[record.checkOutState];
  return (
    <Drawer
      open
      onClose={onClose}
      title={record.staff.name}
      description={`${record.staff.staffId} · ${record.staff.jobTitle}`}
      header={
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={record.status} />
          {record.staff.status === 'suspended' && <Badge variant="error">Account suspended</Badge>}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-2 gap-3">
          <Fact label="Work date">{record.workDate}</Fact>
          {role === 'OWNER' && <Fact label="Branch">{`${record.branch.name} (${record.branch.code})`}</Fact>}
          <Fact label="Shift">{record.shift.name}</Fact>
          <Fact label="Scheduled">{record.shift.start && `${record.shift.start}–${record.shift.end}`}</Fact>
          <Fact label="Grace period">{record.shift.graceMinutes !== null && `${record.shift.graceMinutes} min`}</Fact>
          <Fact label="Time zone">{record.timeZone}</Fact>
        </dl>
        <EventFacts title="Check-in" event={record.checkIn} timeZone={record.timeZone} />
        {record.checkOut ? (
          <EventFacts title="Check-out" event={record.checkOut} timeZone={record.timeZone} />
        ) : (
          <section aria-label="Check-out" className="flex flex-col gap-2 rounded-md border border-border px-4 py-3">
            <h3 className="text-card-title text-fg">Check-out</h3>
            <div>
              <Badge variant={s.variant}>{s.label}</Badge>
            </div>
            <p className="text-small text-fg-secondary">
              {record.checkOutState === 'not_required' && 'Check-out was not used at this branch on this day.'}
              {record.checkOutState === 'open' && 'No check-out yet. One can still be recorded today or uploaded within 24 hours after the work day ends.'}
              {record.checkOutState === 'missing' && 'No check-out was recorded. No end time is assumed.'}
            </p>
          </section>
        )}
        <dl>
          <Fact label="Worked time (calculated from the recorded check-in and check-out)">{formatWorked(record.workedMinutes)}</Fact>
        </dl>
        <p className="text-caption text-fg-muted">The status was set when the check-in was recorded, from the schedule in effect that day. Exact GPS positions are not shown.</p>
      </div>
    </Drawer>
  );
}

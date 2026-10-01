import { Card, Skeleton, Table, TableBody, TableHead, TableHeaderCell, TableLoading, TableRow } from '../../../components/ui';

const HEADERS = ['#', 'Owner name', 'Email', 'Phone', 'School', 'Location', 'Status', 'Registered', 'Actions'];

/** Loading placeholder matching the School Owners page layout. */
export function OwnersSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading school owners</span>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} as="li" className="flex-row gap-3 p-4">
            <Skeleton className="size-10 shrink-0" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-7 w-12" />
              <Skeleton className="h-3 w-20" />
            </div>
          </Card>
        ))}
      </ul>
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.7fr)_repeat(3,minmax(0,1fr))_auto]">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
          <Skeleton className="h-10 w-full xl:w-20" />
        </div>
      </Card>
      <Card className="overflow-hidden">
        <div className="relative overflow-x-auto">
          <Table caption="Loading school owners">
            <TableHead>
              <TableRow interactive={false}>
                {HEADERS.map((h) => (
                  <TableHeaderCell key={h}>{h}</TableHeaderCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              <TableLoading columns={HEADERS.length} rows={8} label="Loading school owners" />
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

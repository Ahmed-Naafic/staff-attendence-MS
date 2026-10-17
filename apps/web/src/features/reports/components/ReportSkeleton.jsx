import { Card, CardContent, Skeleton } from '../../../components/ui';

function BlockCard({ block, lines = 0, className }) {
  return (
    <Card className={className}>
      <CardContent className="flex flex-col gap-3 py-5">
        <Skeleton className="h-4 w-40" />
        {block && <Skeleton className={block} />}
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

function KpiRow() {
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {Array.from({ length: 3 }, (_, i) => (
        <Card key={i} as="li" className="flex-row gap-3 p-4">
          <Skeleton className="size-10 shrink-0" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-7 w-12" />
          </div>
        </Card>
      ))}
    </ul>
  );
}

/** Loading placeholder matching the report layout (schools, then owners). */
export function ReportSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading report</span>
      <Skeleton className="h-6 w-32" />
      <KpiRow />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <BlockCard lines={5} />
        <BlockCard block="mx-auto size-32 rounded-pill" />
      </div>
      <BlockCard block="h-48 w-full" />
      <Skeleton className="h-6 w-40" />
      <KpiRow />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <BlockCard block="mx-auto size-32 rounded-pill" />
        <BlockCard block="h-48 w-full" />
      </div>
    </div>
  );
}

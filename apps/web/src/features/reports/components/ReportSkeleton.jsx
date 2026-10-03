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

/** Loading placeholder matching the report overview layout. */
export function ReportSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Loading report</span>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} as="li" className="flex-row gap-3 p-4">
            <Skeleton className="size-10 shrink-0" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-7 w-12" />
              <Skeleton className="h-3 w-28" />
            </div>
          </Card>
        ))}
      </ul>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 2xl:grid-cols-[1.5fr_1fr_1fr_0.9fr]">
        <BlockCard block="h-48 w-full" className="md:col-span-2 2xl:col-span-1" />
        <BlockCard block="mx-auto size-32 rounded-pill" />
        <BlockCard lines={5} />
        <BlockCard lines={3} className="md:col-span-2 2xl:col-span-1" />
      </div>
      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1fr_1.2fr]">
        <BlockCard block="h-48 w-full" />
        <BlockCard lines={5} />
      </div>
    </div>
  );
}

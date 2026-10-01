import { Card, CardContent, Skeleton } from '../../../components/ui';
import { DashboardLayout } from './DashboardLayout.jsx';

function CardSkeleton({ lines = 0, block }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-5">
        <Skeleton className="h-4 w-36" />
        {block && <Skeleton className={block} />}
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </CardContent>
    </Card>
  );
}

/** Loading placeholder with the same layout as the dashboard. */
export function DashboardSkeleton() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading dashboard</span>
      <DashboardLayout
        kpis={Array.from({ length: 5 }, (_, i) => (
          <Card key={i} as="li" className="flex-row gap-3 p-4">
            <Skeleton className="size-10 shrink-0" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-7 w-12" />
              <Skeleton className="h-3 w-20" />
            </div>
          </Card>
        ))}
        growth={<CardSkeleton block="h-48 w-full" />}
        status={<CardSkeleton block="mx-auto size-32 rounded-pill" />}
        newSchools={<CardSkeleton block="h-48 w-full" />}
        recentSchools={<CardSkeleton lines={5} />}
        activity={<CardSkeleton lines={5} />}
        quickActions={<CardSkeleton lines={4} />}
        locations={<CardSkeleton lines={4} />}
      />
    </div>
  );
}

import { Card, Skeleton } from '../../../components/ui';
import { GeneralLayout } from './GeneralLayout.jsx';

function SkeletonCard({ fields = 4 }) {
  return (
    <Card className="gap-4 p-5">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-3 w-56" />
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </Card>
  );
}

/** Loading placeholder in the General layout. */
export function SettingsSkeleton() {
  return (
    <div role="status" aria-busy="true">
      <span className="sr-only">Loading platform settings</span>
      <GeneralLayout
        main={[<SkeletonCard key="a" fields={5} />, <SkeletonCard key="b" fields={2} />, <SkeletonCard key="c" />, <SkeletonCard key="d" fields={3} />]}
        rail={[<SkeletonCard key="e" fields={1} />, <SkeletonCard key="f" fields={3} />]}
      />
    </div>
  );
}

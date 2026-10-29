import { Building2, Hash, MapPin, Phone, School } from 'lucide-react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Alert, Badge, Card, ErrorState, Skeleton } from '../../../components/ui';
import { useApiData } from '../../../hooks/useApiData.js';
import { loadMyBranch } from '../data/loadMyBranch.js';

const NOT_OPERATING = {
  branch_suspended: 'Your branch is suspended by the School Owner.',
  school_suspended: 'Your school is suspended.',
};

function Detail({ icon: Icon, label, children }) {
  return (
    <div className="flex gap-3">
      <Icon aria-hidden="true" className="mt-0.5 size-[1.125rem] shrink-0 text-fg-muted" />
      <div className="flex min-w-0 flex-col">
        <dt className="text-caption text-fg-muted">{label}</dt>
        <dd className="text-body break-words text-fg">{children || <span className="text-fg-muted">Not provided</span>}</dd>
      </div>
    </div>
  );
}

/**
 * Manager home: the branch the Manager is assigned to (read only; branch details, location and
 * status belong to the School Owner). The schedule has its own page; staff and attendance are later features.
 */
export default function MyBranchPage() {
  const { status, data, retry } = useApiData(loadMyBranch, 'my-branch');

  return (
    <PageContainer>
      <PageHeader title="My Branch" description="The branch you manage. Its details and location are managed by your School Owner." />

      {status === 'error' && (
        <Card>
          <ErrorState title="Your branch could not be loaded" description="Check your connection and try again." onRetry={retry} />
        </Card>
      )}
      {!data && status !== 'error' && (
        <div aria-busy="true" aria-label="Loading your branch">
          <Skeleton className="h-48" />
        </div>
      )}

      {data && (
        <>
          {!data.branch.operating && (
            <Alert variant="warning" title="Your branch is not operating">
              {data.branch.notOperatingReasons.map((reason) => NOT_OPERATING[reason] ?? reason).join(' ')}
            </Alert>
          )}
          <Card as="section" aria-labelledby="my-branch-overview" className="p-6">
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <h2 id="my-branch-overview" className="text-card-title text-fg">
                {data.branch.name}
              </h2>
              <Badge variant={data.branch.status === 'active' ? 'success' : 'error'}>{data.branch.status === 'active' ? 'Active' : 'Suspended'}</Badge>
              <Badge variant={data.branch.operating ? 'success' : 'neutral'}>{data.branch.operating ? 'Operating' : 'Not operating'}</Badge>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
              <Detail icon={Hash} label="Branch code">
                <span className="tabular-nums">{data.branch.code}</span>
              </Detail>
              <Detail icon={School} label="School">
                {`${data.school.name} (${data.school.code})`}
              </Detail>
              <Detail icon={MapPin} label="Address">
                {`${data.branch.address}, ${data.branch.city}`}
              </Detail>
              <Detail icon={Phone} label="Phone">
                {data.branch.phone && <span className="tabular-nums">{data.branch.phone}</span>}
              </Detail>
            </dl>
          </Card>
          <p className="flex items-center gap-2 text-small text-fg-muted">
            <Building2 aria-hidden="true" className="size-4" />
            Shifts and check-out are set under Schedule, and staff under Staff. Attendance will follow in a later version.
          </p>
        </>
      )}
    </PageContainer>
  );
}

import { Link } from 'react-router';
import { Compass } from 'lucide-react';
import { PageContainer, PageHeader } from '../../components/layout';
import { Card, EmptyState } from '../../components/ui';
import { useSession } from '../../features/auth/SessionProvider.jsx';
import { getRoleProfile } from '../config/navigation.js';

/** Unknown URL inside the shell: keeps navigation available and links back home. */
export default function NotFoundPage() {
  const { user } = useSession();
  const home = getRoleProfile(user.role)?.home ?? '/';

  return (
    <PageContainer>
      <PageHeader title="Page not found" description="The address does not match any page." />
      <Card>
        <EmptyState
          icon={Compass}
          title="Nothing here"
          description="Check the address or use the navigation."
          action={
            <Link
              to={home}
              className="inline-flex h-10 items-center rounded-md border border-border-strong bg-surface px-4 text-button text-fg hover:bg-muted"
            >
              Go to the start page
            </Link>
          }
        />
      </Card>
    </PageContainer>
  );
}

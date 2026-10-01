import { Compass } from 'lucide-react';
import { PageContainer, PageHeader } from '../../components/layout';
import { Card, EmptyState, LinkButton } from '../../components/ui';
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
            <LinkButton to={home}>Go to the start page</LinkButton>
          }
        />
      </Card>
    </PageContainer>
  );
}

import { Construction } from 'lucide-react';
import { PageContainer, PageHeader } from '../../components/layout';
import { Card, EmptyState } from '../../components/ui';

/**
 * Temporary page used by routes whose feature is scheduled for a later phase.
 * Each feature replaces its placeholder with the real page in its own phase.
 */
export function PlaceholderPage({ title, description, phase }) {
  return (
    <PageContainer>
      <PageHeader title={title} description={description} />
      <Card>
        <EmptyState icon={Construction} title={`Coming in ${phase}`} description="This page is part of the application shell only." />
      </Card>
    </PageContainer>
  );
}

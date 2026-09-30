import { Download, Plus, SearchX } from 'lucide-react';
import { ContentSection, PageContainer, PageHeader } from '../../components/layout';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardHeader,
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  Skeleton,
  Spinner,
} from '../../components/ui';

export default function LayoutPreview() {
  return (
    <PageContainer>
      <PageHeader
        title="Layout & states"
        description="Page header, content sections and feedback states."
        breadcrumbs={[{ label: 'Design system', to: '/design-system' }, { label: 'Layout & states' }]}
        secondaryActions={
          <Button variant="outline" leftIcon={Download}>
            Export
          </Button>
        }
        primaryAction={<Button leftIcon={Plus}>Primary action</Button>}
      />

      <ContentSection
        title="Content section"
        description="A titled region with optional actions."
        actions={<Button variant="ghost" size="sm">Section action</Button>}
      >
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {['First', 'Second', 'Third', 'Fourth'].map((label) => (
            <Card key={label}>
              <CardContent className="flex flex-col gap-1">
                <span className="text-small text-fg-muted">{label} figure</span>
                <span className="text-display text-fg">128</span>
              </CardContent>
            </Card>
          ))}
        </div>
      </ContentSection>

      <ContentSection title="Feedback">
        <div className="grid gap-3 lg:grid-cols-2">
          <Alert variant="success" title="Saved">
            Your changes were saved successfully.
          </Alert>
          <Alert variant="info" title="Information">
            Neutral information for the user.
          </Alert>
          <Alert variant="warning" title="Warning">
            Check this before you continue.
          </Alert>
          <Alert
            variant="error"
            title="Could not save"
            action={
              <Button variant="outline" size="sm">
                Retry
              </Button>
            }
          >
            The request failed. Try again.
          </Alert>
        </div>
      </ContentSection>

      <ContentSection title="Loading, empty and error">
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader title="Loading" />
            <LoadingState label="Loading content…" />
          </Card>
          <Card>
            <CardHeader title="Empty" />
            <EmptyState
              icon={SearchX}
              title="No results"
              description="Try a different search or clear the filters."
              action={
                <Button variant="outline" size="sm">
                  Clear filters
                </Button>
              }
            />
          </Card>
          <Card>
            <CardHeader title="Error" />
            <ErrorState onRetry={() => {}} />
          </Card>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Skeleton" />
            <CardContent aria-busy="true" className="flex flex-col gap-3">
              <span className="sr-only">Loading</span>
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3.5 w-full" />
              <Skeleton className="h-3.5 w-5/6" />
              <Skeleton className="h-3.5 w-2/3" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader title="Spinner and disabled" />
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center gap-4 text-interactive">
                <Spinner size="sm" />
                <Spinner size="md" />
                <Spinner size="lg" label="Loading" />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Input label="Disabled input" disabled defaultValue="Not editable" />
                <div className="flex items-end">
                  <Button disabled>Disabled button</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </ContentSection>
    </PageContainer>
  );
}

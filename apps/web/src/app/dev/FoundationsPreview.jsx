import { ContentSection, PageContainer, PageHeader } from '../../components/layout';
import { Card, CardContent } from '../../components/ui';

const colorGroups = [
  { title: 'Brand', tokens: ['primary', 'secondary', 'accent', 'interactive'] },
  { title: 'Background', tokens: ['page', 'surface', 'elevated', 'muted'] },
  { title: 'Text', tokens: ['fg', 'fg-secondary', 'fg-muted', 'fg-inverse', 'fg-disabled'] },
  { title: 'Border', tokens: ['border', 'border-strong', 'border-subtle', 'border-input'] },
  {
    title: 'Status',
    tokens: ['success', 'success-soft', 'warning', 'warning-soft', 'error', 'error-soft', 'info', 'info-soft'],
  },
  { title: 'Sidebar', tokens: ['sidebar', 'sidebar-active', 'sidebar-fg', 'sidebar-active-fg'] },
];

const typeScale = [
  ['text-display', 'Display — key figures', '30 / 38 · 700'],
  ['text-page-title', 'Page title', '26 / 32 · 700'],
  ['text-section-title', 'Section title', '18 / 26 · 600'],
  ['text-card-title', 'Card title', '15 / 22 · 600'],
  ['text-body', 'Body text for paragraphs and form values.', '14 / 22 · 400'],
  ['text-small', 'Small text for secondary information.', '13 / 20 · 400'],
  ['text-table', 'Table cell text', '13 / 20 · 400'],
  ['text-label', 'Form label', '13 / 20 · 500'],
  ['text-button', 'Button text', '14 / 20 · 600'],
  ['text-caption', 'Caption, helper and badge text', '12 / 16 · 400'],
];

const spacing = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
const radii = ['rounded-sm', 'rounded-md', 'rounded-lg', 'rounded-pill'];
const shadows = ['shadow-none', 'shadow-subtle', 'shadow-medium', 'shadow-large'];

export default function FoundationsPreview() {
  return (
    <PageContainer>
      <PageHeader
        title="Foundations"
        description="Color tokens, typography, spacing, radius and shadows. Switch the theme in the top bar."
        breadcrumbs={[{ label: 'Design system', to: '/design-system' }, { label: 'Foundations' }]}
      />

      <ContentSection title="Color tokens" description="Components use these semantic tokens only.">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {colorGroups.map((group) => (
            <Card key={group.title}>
              <CardContent className="flex flex-col gap-3">
                <h3 className="text-card-title">{group.title}</h3>
                <ul className="flex flex-col gap-2">
                  {group.tokens.map((token) => (
                    <li key={token} className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="size-8 shrink-0 rounded-md border border-border"
                        style={{ backgroundColor: `var(--color-${token})` }}
                      />
                      <code className="text-small text-fg-secondary">{token}</code>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </ContentSection>

      <ContentSection title="Typography" description="Inter. One semantic class per role.">
        <Card>
          <CardContent className="flex flex-col divide-y divide-border-subtle p-0">
            {typeScale.map(([className, sample, spec]) => (
              <div key={className} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-baseline sm:gap-6">
                <code className="w-40 shrink-0 text-caption text-fg-muted">{className}</code>
                <span className={`${className} min-w-0 flex-1 text-fg`}>{sample}</span>
                <span className="text-caption text-fg-muted">{spec}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </ContentSection>

      <div className="grid gap-6 lg:grid-cols-3">
        <ContentSection title="Spacing" description="Tailwind 4px scale.">
          <Card>
            <CardContent className="flex flex-col gap-2">
              {spacing.map((step) => (
                <div key={step} className="flex items-center gap-3">
                  <code className="w-10 text-caption text-fg-muted">{step}</code>
                  <span className="h-3 rounded-sm bg-accent" style={{ width: `calc(var(--spacing) * ${step})` }} />
                  <span className="text-caption text-fg-muted">{step * 4}px</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </ContentSection>

        <ContentSection title="Radius">
          <Card>
            <CardContent className="grid grid-cols-2 gap-4">
              {radii.map((radius) => (
                <div key={radius} className="flex flex-col items-center gap-2">
                  <span className={`size-16 border-2 border-interactive bg-interactive-soft ${radius}`} />
                  <code className="text-caption text-fg-muted">{radius}</code>
                </div>
              ))}
            </CardContent>
          </Card>
        </ContentSection>

        <ContentSection title="Shadows">
          <Card>
            <CardContent className="grid grid-cols-2 gap-4">
              {shadows.map((shadow) => (
                <div key={shadow} className="flex flex-col items-center gap-2">
                  <span className={`size-16 rounded-lg border border-border-subtle bg-elevated ${shadow}`} />
                  <code className="text-caption text-fg-muted">{shadow}</code>
                </div>
              ))}
            </CardContent>
          </Card>
        </ContentSection>
      </div>
    </PageContainer>
  );
}

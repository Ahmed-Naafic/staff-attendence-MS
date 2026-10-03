import { useMemo } from 'react';
import { BookOpen, ImageUp } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, Input, Select, Switch, Textarea } from '../../../components/ui';
import {
  configurationItems,
  dateFormatOptions,
  firstDayOptions,
  languageOptions,
  timeFormatOptions,
  timezoneOptions,
  UNAVAILABLE,
} from '../utils/settingsOptions.js';

/** Platform name, description and public contact details (editable in the page only). */
export function PlatformInfoCard({ values, onChange }) {
  const set = (name) => (event) => onChange('information', name, event.target.value);
  return (
    <Card as="section" aria-labelledby="settings-information">
      <CardHeader titleAs="h2" title={<span id="settings-information">Platform Information</span>} description="Basic information about the platform." />
      <CardContent className="flex flex-col gap-4">
        <Input label="Platform name" value={values.platformName} onChange={set('platformName')} autoComplete="off" />
        <Textarea label="Platform description" rows={3} value={values.description} onChange={set('description')} />
        <Input label="Support email" type="email" value={values.supportEmail} onChange={set('supportEmail')} autoComplete="off" />
        <Input label="Support phone" type="tel" value={values.supportPhone} onChange={set('supportPhone')} autoComplete="off" />
        <Input label="Website URL" type="url" value={values.websiteUrl} onChange={set('websiteUrl')} autoComplete="off" />
      </CardContent>
    </Card>
  );
}

function LogoTile({ size = 'lg' }) {
  return (
    <span
      className={
        size === 'lg'
          ? 'grid size-20 place-items-center rounded-lg border border-accent/50 bg-sidebar text-accent'
          : 'grid size-12 place-items-center rounded-md border border-accent/50 bg-sidebar text-accent'
      }
    >
      <BookOpen aria-hidden="true" className={size === 'lg' ? 'size-9' : 'size-6'} />
    </span>
  );
}

/** Current logo and favicon. Uploading and removing need settings persistence, so they are unavailable. */
export function PlatformLogoCard() {
  return (
    <Card as="section" aria-labelledby="settings-logo">
      <CardHeader titleAs="h2" title={<span id="settings-logo">Platform Logo</span>} description="The logo shown for the platform." />
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-strong bg-muted/40 px-4 py-6 text-center">
          <LogoTile />
          <div className="flex flex-col gap-0.5">
            <p className="flex items-center justify-center gap-1.5 text-small font-medium text-fg">
              <ImageUp aria-hidden="true" className="size-4 text-fg-muted" />
              Logo upload is not available yet
            </p>
            <p className="text-caption text-fg-muted">A placeholder logo is shown until a logo is supplied.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" unavailableReason={UNAVAILABLE.persistence}>
            Change Logo
          </Button>
          <Button variant="danger" unavailableReason={UNAVAILABLE.persistence} aria-label="Remove logo">
            Remove
          </Button>
        </div>

        <section aria-labelledby="settings-favicon" className="flex flex-col gap-3 border-t border-border-subtle pt-5">
          <div className="flex flex-col gap-0.5">
            <h3 id="settings-favicon" className="text-card-title text-fg">
              Favicon
            </h3>
            <p className="text-small text-fg-muted">The icon shown in the browser tab.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <LogoTile size="sm" />
            <Button variant="outline" unavailableReason={UNAVAILABLE.persistence}>
              Change Favicon
            </Button>
            <Button variant="danger" unavailableReason={UNAVAILABLE.persistence} aria-label="Remove favicon">
              Remove
            </Button>
          </div>
        </section>
      </CardContent>
    </Card>
  );
}

/** Default timezone, language, date and time formats and first day of the week (editable in the page only). */
export function LocalizationCard({ values, onChange }) {
  const set = (name) => (event) => onChange('localization', name, event.target.value);
  const dateFormats = useMemo(() => dateFormatOptions(), []);
  return (
    <Card as="section" aria-labelledby="settings-localization">
      <CardHeader
        titleAs="h2"
        title={<span id="settings-localization">Timezone &amp; Localization</span>}
        description="Default timezone and formats for the platform."
      />
      <CardContent className="flex flex-col gap-4">
        <Select label="Default timezone" options={timezoneOptions} value={values.timezone} onChange={set('timezone')} />
        <Select
          label="Default language"
          options={languageOptions}
          value={values.language}
          onChange={set('language')}
          hint="English is the only language available."
        />
        <Select label="Date format" options={dateFormats} value={values.dateFormat} onChange={set('dateFormat')} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Select label="Time format" options={timeFormatOptions} value={values.timeFormat} onChange={set('timeFormat')} />
          <Select label="First day of week" options={firstDayOptions} value={values.firstDayOfWeek} onChange={set('firstDayOfWeek')} />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Platform-wide switches, shown read-only: each one depends on workflow rules
 * (registration, approval, notifications, maintenance) that are not approved yet.
 */
export function ConfigurationCard({ values }) {
  return (
    <Card as="section" aria-labelledby="settings-configuration">
      <CardHeader
        titleAs="h2"
        title={<span id="settings-configuration">Platform Configuration</span>}
        description="General platform options."
      />
      <CardContent className="flex flex-col gap-4">
        <p id="settings-configuration-note" className="rounded-md bg-muted px-3 py-2 text-caption text-fg-secondary">
          Read only. {UNAVAILABLE.rules}
        </p>
        <ul className="flex flex-col gap-3.5">
          {configurationItems.map((item) => (
            <li key={item.key} className="flex items-start justify-between gap-3">
              <Switch label={item.label} description={item.description} checked={values[item.key]} disabled />
              <span className="mt-0.5 shrink-0 text-caption font-medium text-fg-secondary" aria-hidden="true">
                {values[item.key] ? 'On' : 'Off'}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

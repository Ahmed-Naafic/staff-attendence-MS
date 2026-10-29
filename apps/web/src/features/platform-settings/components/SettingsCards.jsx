import { useMemo } from 'react';
import { BookOpen, ImageUp } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, Input, Select, Switch, Textarea } from '../../../components/ui';
import { DEFAULT_PLATFORM_NAME } from '../../branding';
import { DESCRIPTION_MAX, textLength } from '../utils/generalRules.js';
import {
  configurationItems,
  dateFormatOptions,
  firstDayOptions,
  languageOptions,
  timeFormatOptions,
  timezoneOptions,
  UNAVAILABLE,
} from '../utils/settingsOptions.js';

// Shown when no value is stored yet.
const NOT_SET = 'Not set';

/** Hint for a field whose saved value breaks the approved rules (kept until changed). */
const conflictHint = (problem) => problem && `The saved value does not meet the current rules: ${problem}`;

/**
 * Platform name, description and public contact details. The name is saved in Branding and shown
 * here read-only (`platformName`, '' when not set; `onEditName` opens Branding). The other fields
 * are edited here and saved with Save Settings. `values`, `errors` and `conflicts` are keyed by
 * field; `onChange(field, value)`; `disabled` while saving.
 */
export function PlatformInfoCard({ values, errors, conflicts, onChange, disabled, platformName, onEditName }) {
  const field = (name) => ({
    name,
    value: values[name],
    onChange: (event) => onChange(name, event.target.value),
    error: errors[name],
    readOnly: disabled,
    placeholder: NOT_SET,
  });
  const descriptionLength = textLength(values.description.trim());
  return (
    <Card as="section" aria-labelledby="settings-information">
      <CardHeader titleAs="h2" title={<span id="settings-information">Platform Information</span>} description="Basic information about the platform." />
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Input
            label="Platform name"
            value={platformName}
            placeholder={`Not set: ${DEFAULT_PLATFORM_NAME} is shown`}
            readOnly
            hint="Read only here. The platform name is changed in Branding."
          />
          <Button variant="outline" size="sm" className="self-start" onClick={onEditName}>
            Change in Branding
          </Button>
        </div>
        <Textarea
          label="Platform description"
          rows={3}
          {...field('description')}
          hint={conflictHint(conflicts.description) || `Optional. ${descriptionLength} of ${DESCRIPTION_MAX} characters.`}
        />
        <Input
          label="Support email"
          type="email"
          autoComplete="off"
          {...field('supportEmail')}
          hint={conflictHint(conflicts.supportEmail) || 'Optional. Saved in lower case.'}
        />
        <Input
          label="Support phone"
          type="tel"
          autoComplete="off"
          {...field('supportPhone')}
          placeholder="+252612345678"
          hint={conflictHint(conflicts.supportPhone) || 'Optional. International format: + and up to 15 digits, no spaces.'}
        />
        <Input
          label="Website URL"
          type="url"
          autoComplete="off"
          {...field('websiteUrl')}
          placeholder="https://www.example.com"
          hint={conflictHint(conflicts.websiteUrl) || 'Optional. A full https:// address.'}
        />
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

// The choices, plus the saved value when it is not one of them (kept until changed, never selectable again).
function withSaved(options, saved) {
  if (!saved || options.some((option) => option.value === saved)) return options;
  return [...options, { value: saved, label: `${saved} (no longer available)`, disabled: true }];
}

/**
 * Default timezone, language, date and time formats and first day of the week, saved with Save
 * Settings. The time zone is stored as its IANA name (e.g. Africa/Mogadishu) and controls the
 * platform's dates: Reports and Dashboard days and months, and dates and times shown in the app.
 */
export function LocalizationCard({ values, savedValues, errors, conflicts, onChange, disabled }) {
  const dateFormats = useMemo(() => dateFormatOptions(), []);
  const timezones = useMemo(() => timezoneOptions(), []);
  const field = (name, options, hint) => ({
    name,
    options: withSaved(options, savedValues[name]),
    value: values[name],
    // A choice cannot be unset once saved; until then "Not set" is shown.
    placeholder: NOT_SET,
    required: true,
    onChange: (event) => onChange(name, event.target.value),
    error: errors[name],
    disabled,
    hint: conflictHint(conflicts[name]) || hint,
  });
  return (
    <Card as="section" aria-labelledby="settings-localization">
      <CardHeader
        titleAs="h2"
        title={<span id="settings-localization">Timezone &amp; Localization</span>}
        description="Default timezone and formats for the platform."
      />
      <CardContent className="flex flex-col gap-4">
        <Select
          label="Default timezone"
          {...field('timezone', timezones, 'Used for dates and times across the platform, and for the days and months in Reports and the Dashboard. Not set: UTC.')}
        />
        <Select label="Default language" {...field('language', languageOptions, 'English is the only language available.')} />
        <Select label="Date format" {...field('dateFormat', dateFormats, 'Used for dates shown in the app. Not set: Jan 12, 2026.')} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <Select label="Time format" {...field('timeFormat', timeFormatOptions, 'Used for times shown in the app. Not set: 24-hour.')} />
          <Select label="First day of week" {...field('firstDayOfWeek', firstDayOptions, 'Saved for calendars; no calendar uses it yet.')} />
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Platform-wide switches, shown read-only: each one depends on workflow rules
 * (registration, approval, notifications, maintenance) that are not approved yet.
 * They are not stored either, so without values each switch is off and marked "Not set".
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
              <Switch label={item.label} description={item.description} checked={values?.[item.key] === true} disabled />
              <span className="mt-0.5 shrink-0 text-caption font-medium text-fg-secondary">
                {values?.[item.key] === undefined || values?.[item.key] === null ? (
                  NOT_SET
                ) : (
                  <span aria-hidden="true">{values[item.key] ? 'On' : 'Off'}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

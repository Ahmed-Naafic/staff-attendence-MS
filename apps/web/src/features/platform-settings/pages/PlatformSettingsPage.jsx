import { useEffect, useId, useRef, useState } from 'react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { useDisplaySettings } from '../../../app/providers/DisplaySettingsProvider.jsx';
import { Alert, Badge, Card, EmptyState, ErrorState, TabPanel, Tabs } from '../../../components/ui';
import { useBranding } from '../../branding';
import { DataBackupPanel } from '../../data-backup';
import { InactivityTimeoutCard, SessionLifetimeCard, SignInSecurityCard } from '../components/AuthenticationCards.jsx';
import { BrandingCard } from '../components/BrandingCard.jsx';
import { GeneralLayout } from '../components/GeneralLayout.jsx';
import { NotificationSettingsCard } from '../components/NotificationSettingsCard.jsx';
import { SchedulingSettingsCard } from '../components/SchedulingSettingsCard.jsx';
import { RegistrationCard } from '../components/RegistrationCard.jsx';
import { SaveBar } from '../components/SaveBar.jsx';
import { ConfigurationCard, LocalizationCard, PlatformInfoCard, PlatformLogoCard } from '../components/SettingsCards.jsx';
import { SettingsSkeleton } from '../components/SettingsSkeleton.jsx';
import { DangerZoneCard, PlatformStatusCard, QuickActionsCard, SystemInfoCard } from '../components/SystemCards.jsx';
import { usePlatformSettings } from '../hooks/usePlatformSettings.js';
import { useSettingsForm } from '../hooks/useSettingsForm.js';
import { useSettingsTab } from '../hooks/useSettingsTab.js';
import { settingsTabs } from '../utils/settingsOptions.js';

// Field names for the saved-value warning.
const FIELD_LABELS = {
  description: 'Platform description',
  supportEmail: 'Support email',
  supportPhone: 'Support phone',
  websiteUrl: 'Website URL',
  timezone: 'Default timezone',
  language: 'Default language',
  dateFormat: 'Date format',
  timeFormat: 'Time format',
  firstDayOfWeek: 'First day of week',
};

/**
 * Super Admin Platform Settings. General saves platform information and localization (the
 * platform name is shown read-only and changed in Branding); Branding saves the platform name;
 * Authentication saves the absolute session lifetime and the inactivity timeout and shows the
 * other sign-in protection the server enforces (read only). Registration shows how schools and
 * accounts are created (read only; there is no public registration). Notifications saves push,
 * reminder defaults and limits, and the digest hour (docs/notifications/). Scheduling & Assignments
 * saves the effective delay and the two "first may start today" switches. Data & Backup manages
 * Neon snapshots, their schedule and staged restores (docs/data-backup/). On General, the platform
 * switches, uploads, operations and dangerous actions are shown but unavailable. The other
 * sections are not available yet. The active section lives in the URL (?tab=).
 */
export default function PlatformSettingsPage() {
  const tabsId = useId();
  const { tab, setTab } = useSettingsTab();
  const { status, data, retry } = usePlatformSettings();
  const { applyDisplaySettings } = useDisplaySettings();

  // The latest saved General settings: loaded with the settings, replaced when General is saved.
  const [general, setGeneral] = useState(null);
  useEffect(() => {
    if (!data) return setGeneral(null);
    const { information, localization, conflicts, display } = data.settings;
    setGeneral({ information, localization, conflicts: conflicts ?? {}, display });
  }, [data]);
  const form = useSettingsForm(general, (saved) => {
    setGeneral(saved);
    applyDisplaySettings(saved.display);
  });
  const conflictFields = general ? Object.keys(general.conflicts).map((key) => FIELD_LABELS[key] ?? key) : [];
  const current = settingsTabs.find((t) => t.value === tab);
  const { setPlatformName } = useBranding();

  // The stored platform name ('' when not set): loaded with the settings, replaced when Branding saves.
  const [platformName, setSavedName] = useState('');
  useEffect(() => setSavedName(data?.settings.information.platformName ?? ''), [data]);
  const onBrandingSaved = (name) => {
    setSavedName(name);
    setPlatformName(name);
  };

  // Authentication Settings as enforced by the server: loaded with the settings, replaced when saved.
  const [authentication, setAuthentication] = useState(null);
  useEffect(() => setAuthentication(data?.settings.authentication ?? null), [data]);

  // On narrow screens the tab strip scrolls: keep the selected section's tab in view (e.g. after a deep link).
  const tabsRef = useRef(null);
  // Repeated once web fonts have loaded, because they change the tabs' widths.
  useEffect(() => {
    let active = true;
    const reveal = () =>
      active && tabsRef.current?.querySelector('[role=tab][aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    reveal();
    document.fonts?.ready.then(reveal);
    return () => {
      active = false;
    };
  }, [tab]);

  // "Change in Branding" leaves with the General section: once Branding is selected, continue from its tab.
  const focusTabOnChange = useRef(false);
  useEffect(() => {
    if (!focusTabOnChange.current) return;
    focusTabOnChange.current = false;
    tabsRef.current?.querySelector('[role=tab][aria-selected=true]')?.focus();
  }, [tab]);

  return (
    <PageContainer>
      <PageHeader
        title="Platform Settings"
        description="Configure platform-wide settings for all schools."
        secondaryActions={
          data?.isDemo && (
            <Badge variant="warning" dot>
              Demo data<span className="sr-only">: sample settings, nothing is saved yet</span>
            </Badge>
          )
        }
      />

      <div ref={tabsRef}>
        <Tabs id={tabsId} label="Settings sections" tabs={settingsTabs} value={tab} onChange={setTab} />
      </div>

      <TabPanel tabsId={tabsId} value={tab} className="flex flex-col gap-6">
        {status === 'error' && (
          <Card>
            <ErrorState
              title="Platform settings could not be loaded"
              description="Settings are unavailable right now. Check your connection and try again."
              onRetry={retry}
            />
          </Card>
        )}

        {status === 'loading' && !data && <SettingsSkeleton />}

        {data && general && form.draft && status !== 'error' && tab === 'general' && (
          <>
            {conflictFields.length > 0 && (
              <Alert variant="warning" title="Some saved values do not meet the current rules">
                {conflictFields.join(', ')}. They are kept as saved until you change them; each field explains what is needed.
              </Alert>
            )}
            <form
              id="general-settings"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                form.save();
              }}
            >
              <GeneralLayout
                main={[
                  <PlatformInfoCard
                    key="information"
                    values={form.draft}
                    errors={form.errors}
                    conflicts={general.conflicts}
                    onChange={form.setField}
                    disabled={form.saving}
                    platformName={platformName}
                    onEditName={() => {
                      focusTabOnChange.current = true;
                      setTab('branding');
                    }}
                  />,
                  <PlatformLogoCard key="logo" />,
                  <LocalizationCard
                    key="localization"
                    values={form.draft}
                    savedValues={general.localization}
                    errors={form.errors}
                    conflicts={general.conflicts}
                    onChange={form.setField}
                    disabled={form.saving}
                  />,
                  <ConfigurationCard key="configuration" values={data.settings.configuration} />,
                ]}
                rail={[
                  <PlatformStatusCard key="status" />,
                  <SystemInfoCard key="system" system={data.system} />,
                  <QuickActionsCard key="actions" />,
                  <DangerZoneCard key="danger" />,
                ]}
              />
            </form>
            <SaveBar form={form} />
          </>
        )}

        {data && status !== 'error' && tab === 'branding' && <BrandingCard savedName={platformName} onSaved={onBrandingSaved} />}

        {data && status !== 'error' && tab === 'authentication' && authentication && (
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
            <div className="flex flex-col gap-6">
              <SessionLifetimeCard settings={authentication} onSaved={setAuthentication} />
              <InactivityTimeoutCard settings={authentication} onSaved={setAuthentication} />
            </div>
            <SignInSecurityCard settings={authentication} />
          </div>
        )}

        {data && status !== 'error' && tab === 'registration' && authentication && (
          <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-2">
            <RegistrationCard minPasswordLength={authentication.minPasswordLength} />
          </div>
        )}

        {data && status !== 'error' && tab === 'notifications' && <NotificationSettingsCard />}

        {data && status !== 'error' && tab === 'scheduling' && data.settings.scheduling && <SchedulingSettingsCard settings={data.settings.scheduling} />}

        {data && status !== 'error' && tab === 'data-backup' && <DataBackupPanel timeZone={data.settings.localization?.timezone ?? 'UTC'} />}

        {data && status !== 'error' && !['general', 'branding', 'authentication', 'registration', 'notifications', 'scheduling', 'data-backup'].includes(tab) && (
          <Card as="section" aria-label={`${current.label} settings`}>
            <EmptyState
              icon={current.icon}
              title={`${current.label} settings are not available yet`}
              description="This section is waiting for approved business rules. Its settings will appear here once they are defined."
            />
          </Card>
        )}
      </TabPanel>
    </PageContainer>
  );
}

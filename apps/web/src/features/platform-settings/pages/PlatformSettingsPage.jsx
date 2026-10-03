import { useEffect, useId, useRef } from 'react';
import { PageContainer, PageHeader } from '../../../components/layout';
import { Badge, Card, EmptyState, ErrorState, TabPanel, Tabs } from '../../../components/ui';
import { GeneralLayout } from '../components/GeneralLayout.jsx';
import { SaveBar } from '../components/SaveBar.jsx';
import { ConfigurationCard, LocalizationCard, PlatformInfoCard, PlatformLogoCard } from '../components/SettingsCards.jsx';
import { SettingsSkeleton } from '../components/SettingsSkeleton.jsx';
import { DangerZoneCard, PlatformStatusCard, QuickActionsCard, SystemInfoCard } from '../components/SystemCards.jsx';
import { usePlatformSettings } from '../hooks/usePlatformSettings.js';
import { useSettingsForm } from '../hooks/useSettingsForm.js';
import { useSettingsTab } from '../hooks/useSettingsTab.js';
import { settingsTabs } from '../utils/settingsOptions.js';

/**
 * Super Admin Platform Settings. Only the General section has approved content: platform
 * information and localization can be edited in the page (nothing is saved yet); platform
 * switches, uploads, operations and dangerous actions are shown but unavailable.
 * The active section lives in the URL (?tab=).
 */
export default function PlatformSettingsPage() {
  const tabsId = useId();
  const { tab, setTab } = useSettingsTab();
  const { status, data, retry } = usePlatformSettings();
  const form = useSettingsForm(data?.settings);
  const current = settingsTabs.find((t) => t.value === tab);

  // On narrow screens the tab strip scrolls: keep the selected section's tab in view (e.g. after a deep link).
  const tabsRef = useRef(null);
  useEffect(() => {
    tabsRef.current?.querySelector('[role=tab][aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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

        {data && form.draft && status !== 'error' && tab === 'general' && (
          <>
            <GeneralLayout
              main={[
                <PlatformInfoCard key="information" values={form.draft.information} onChange={form.setField} />,
                <PlatformLogoCard key="logo" />,
                <LocalizationCard key="localization" values={form.draft.localization} onChange={form.setField} />,
                <ConfigurationCard key="configuration" values={data.settings.configuration} />,
              ]}
              rail={[
                <PlatformStatusCard key="status" />,
                <SystemInfoCard key="system" system={data.system} />,
                <QuickActionsCard key="actions" />,
                <DangerZoneCard key="danger" />,
              ]}
            />
            <SaveBar isDirty={form.isDirty} changedCount={form.changedCount} notice={form.notice} onDiscard={form.discard} />
          </>
        )}

        {data && status !== 'error' && tab !== 'general' && (
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

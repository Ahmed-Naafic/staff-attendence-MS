import { useId, useState } from 'react';
import { Activity, ArchiveRestore, HardDrive, History, SlidersHorizontal } from 'lucide-react';
import { Card, ErrorState, LoadingState, TabPanel, Tabs } from '../../../components/ui';
import { useBackupData } from '../hooks/useBackupData.js';
import { BackupConfiguration } from './BackupConfiguration.jsx';
import { BackupHistory } from './BackupHistory.jsx';
import { BackupOverview } from './BackupOverview.jsx';
import { RestoreManagement } from './RestoreManagement.jsx';
import { StorageConfiguration } from './StorageConfiguration.jsx';

const SECTIONS = [
  { value: 'overview', label: 'Overview', icon: Activity },
  { value: 'configuration', label: 'Backup Configuration', icon: SlidersHorizontal },
  { value: 'history', label: 'Backup History', icon: History },
  { value: 'restore', label: 'Restore Management', icon: ArchiveRestore },
  { value: 'storage', label: 'Storage Configuration', icon: HardDrive },
];

/**
 * Platform Settings → Data & Backup (Super Admin; docs/data-backup/). Backups are Neon snapshots of
 * the platform database; restores are staged on a separate branch and checked before production
 * can be replaced. `timeZone` is the platform time zone (schedule hours are shown in UTC and in it).
 */
export function DataBackupPanel({ timeZone }) {
  const tabsId = useId();
  const [section, setSection] = useState('overview');
  const [restoreFrom, setRestoreFrom] = useState(null);
  const data = useBackupData();

  if (data.status === 'loading') {
    return (
      <Card>
        <LoadingState label="Loading backups…" />
      </Card>
    );
  }
  if (data.status === 'error') {
    return (
      <Card>
        <ErrorState title="Data & Backup could not be loaded" description={data.error?.status === 403 ? 'Only a Super Admin can manage backups.' : 'Check your connection and try again.'} onRetry={data.reload} />
      </Card>
    );
  }

  const goRestore = (backup) => {
    setRestoreFrom(backup);
    setSection('restore');
  };

  return (
    <div className="flex flex-col gap-6">
      <Tabs id={tabsId} label="Data & Backup sections" tabs={SECTIONS} value={section} onChange={setSection} />
      <TabPanel tabsId={tabsId} value={section} className="flex flex-col gap-6">
        {section === 'overview' && <BackupOverview overview={data.overview} onChanged={data.reload} onOpen={setSection} />}
        {section === 'configuration' && <BackupConfiguration configuration={data.configuration} timeZone={timeZone} onSaved={data.reload} />}
        {section === 'history' && <BackupHistory configured={data.overview.provider.configured} onChanged={data.reload} onRestore={goRestore} activeRestore={data.overview.activeRestore} />}
        {section === 'restore' && (
          <RestoreManagement overview={data.overview} restores={data.restores} selected={restoreFrom} onSelectedUsed={() => setRestoreFrom(null)} onChanged={data.reload} onOpen={setSection} />
        )}
        {section === 'storage' && <StorageConfiguration overview={data.overview} />}
      </TabPanel>
    </div>
  );
}

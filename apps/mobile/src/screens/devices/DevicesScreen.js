/*
 * My devices (docs/mobile/devices.md): the phones registered to this account (at most three), with
 * "Report lost or stolen" for another of them: it is blocked at once and wiped when it next connects.
 * Waiting requests for another phone are shown with their state. Online only.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { userMessage } from '../../api/errors';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Badge, Button, Card, ConfirmDialog, LoadingView, Notice, Screen, ScreenHeader } from '../../components/ui';
import { formatDayTime } from '../../lib/format';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

export const DEVICE_STATUS = {
  active: ['Active', 'success'],
  revoked: ['Revoked', 'warning'],
  lost: ['Lost or stolen', 'error'],
};
export const WIPE_LABEL = { requested: 'Wipe requested', delivered: 'Wipe delivered', completed: 'Wiped' };

/** One phone: name, model, state, dates and wipe progress. */
export function DeviceCard({ device, owner, children }) {
  const { colors } = useTheme();
  const [label, tone] = DEVICE_STATUS[device.status] ?? [device.status, 'neutral'];
  return (
    <Card style={{ gap: space(1) }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space(2) }}>
        <AppText variant="cardTitle" style={{ flex: 1 }} numberOfLines={1}>
          {owner ? `${owner} · ${device.name}` : device.name}
        </AppText>
        <Badge label={device.current ? 'This phone' : label} tone={device.current ? 'info' : tone} />
      </View>
      <AppText variant="small" color={colors.fgSecondary}>{[device.platform, device.model, device.appVersion && `app ${device.appVersion}`].filter(Boolean).join(' · ')}</AppText>
      <AppText variant="caption" color={colors.fgMuted}>{`Registered ${formatDayTime(device.registeredAt, 'UTC')} · last active ${formatDayTime(device.lastSeenAt, 'UTC')}`}</AppText>
      {device.revokedAt ? <AppText variant="caption" color={colors.fgMuted}>{`${label} ${formatDayTime(device.revokedAt, 'UTC')}${device.revokedBy ? ` by ${device.revokedBy}` : ''}${device.revokeReason ? `: ${device.revokeReason}` : ''}`}</AppText> : null}
      {device.wipe ? <AppText variant="small" color={colors.errorFg}>{WIPE_LABEL[device.wipe.state] ?? device.wipe.state}</AppText> : null}
      {children}
    </Card>
  );
}

export default function DevicesScreen({ navigation }) {
  const { api } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [message, setMessage] = useState(null);

  const load = useCallback(async () => {
    try {
      setData((await api.request('/api/devices/mine')).data);
      setError(null);
    } catch (e) {
      setError(e);
    }
  }, [api]);
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function reportLost(device) {
    setConfirm(null);
    try {
      await api.request(`/api/devices/${device.id}/report-lost`, { method: 'POST', body: {} });
      setMessage({ tone: 'success', text: `${device.name} is blocked. Its EduTrack data is deleted when it next connects. Your Manager and School Owner were told.` });
      await load();
    } catch (e) {
      setMessage({ tone: 'error', text: userMessage(e) });
    }
  }

  const current = data?.devices.find((d) => d.current);
  return (
    <Screen>
      <ScreenHeader title="My devices" subtitle={data ? `At most ${data.max} phones` : undefined} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: space(5), paddingTop: 0, gap: space(3) }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        {!data && !error ? <LoadingView /> : null}
        {error ? <Notice title="Your devices could not be loaded" message={userMessage(error)} onRetry={load} /> : null}
        {message ? <Notice tone={message.tone} message={message.text} /> : null}
        {data && !current ? <Notice tone="info" message="This phone signed in before phones were registered. Sign out and in again to register it." /> : null}
        {(data?.devices ?? []).map((d) => (
          <DeviceCard key={d.id} device={d}>
            {d.status === 'active' && !d.current && current ? <Button testID={`report-lost-${d.id}`} title="Report lost or stolen" variant="ghost" icon="alert-circle-outline" onPress={() => setConfirm(d)} style={{ alignSelf: 'flex-start', paddingHorizontal: 0, minHeight: 40 }} /> : null}
          </DeviceCard>
        ))}
        {(data?.requests ?? []).map((r) => (
          <Card key={r.id}>
            <AppText variant="cardTitle">{`Request: ${r.name}`}</AppText>
            <AppText variant="small">{r.status === 'pending' ? 'Waiting for your Manager or School Owner' : r.status === 'approved' ? 'Approved: sign in on that phone' : 'Refused'}</AppText>
          </Card>
        ))}
      </ScrollView>
      <ConfirmDialog
        visible={Boolean(confirm)}
        title={`Report ${confirm?.name ?? ''} lost or stolen?`}
        message="It is signed out and blocked now, and everything EduTrack keeps on it (including records not uploaded) is deleted when it next connects. This cannot be undone; if you find it, sign in again to register it as a new phone."
        confirmLabel="Report and wipe"
        destructive
        onConfirm={() => reportLost(confirm)}
        onCancel={() => setConfirm(null)}
      />
    </Screen>
  );
}

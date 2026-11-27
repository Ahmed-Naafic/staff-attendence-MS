/*
 * Staff devices for Managers (their branch's staff and Accountants; docs/mobile/devices.md): approve
 * or refuse a request for another phone, revoke a phone, or report it lost or stolen with a remote
 * wipe (one Manager decides; a wipe cannot be cancelled). Each needs a reason and is audited by the
 * server. Online only.
 */
import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import { Modal, RefreshControl, ScrollView, View } from 'react-native';
import { userMessage } from '../../api/errors';
import { useSession } from '../../auth/SessionProvider';
import { AppText, Button, Card, LoadingView, Notice, Screen, ScreenHeader, TextField } from '../../components/ui';
import { useTheme } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';
import { DeviceCard } from './DevicesScreen';

const M = '/api/manager';

export default function ManagerDevicesScreen({ navigation }) {
  const { api } = useSession();
  const { colors } = useTheme();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [action, setAction] = useState(null); // { kind: 'revoke' | 'wipe', device }
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData((await api.request(`${M}/devices`)).data);
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

  const run = async (path, body, done) => {
    setBusy(true);
    setMessage(null);
    try {
      await api.request(`${M}${path}`, { method: 'POST', body });
      setMessage({ tone: 'success', text: done });
      setAction(null);
      setReason('');
      await load();
    } catch (e) {
      setMessage({ tone: 'error', text: userMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <ScreenHeader title="Staff devices" subtitle={data ? `At most ${data.max} phones per person` : undefined} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: space(5), paddingTop: 0, gap: space(3) }} refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}>
        {!data && !error ? <LoadingView /> : null}
        {error ? <Notice title="Devices could not be loaded" message={userMessage(error)} onRetry={load} /> : null}
        {message ? <Notice tone={message.tone} message={message.text} /> : null}
        {data?.requests?.length ? (
          <AppText variant="label" color={colors.fgSecondary}>
            Requests for another phone
          </AppText>
        ) : null}
        {(data?.requests ?? []).map((r) => (
          <Card key={r.id} style={{ gap: space(2) }}>
            <AppText variant="cardTitle">{`${r.user.name} · ${r.name}`}</AppText>
            <View style={{ flexDirection: 'row', gap: space(3) }}>
              <Button testID={`approve-${r.id}`} title="Approve" onPress={() => run(`/device-requests/${r.id}/approve`, {}, `Approved: ${r.user.name} can sign in on ${r.name}.`)} />
              <Button title="Refuse" variant="secondary" onPress={() => run(`/device-requests/${r.id}/reject`, {}, 'Request refused.')} />
            </View>
          </Card>
        ))}
        {(data?.devices ?? []).map((d) => (
          <DeviceCard key={d.id} device={d} owner={d.user?.name}>
            {d.status === 'active' ? (
              <View style={{ flexDirection: 'row', gap: space(4) }}>
                <Button title="Revoke" variant="ghost" onPress={() => setAction({ kind: 'revoke', device: d })} style={{ paddingHorizontal: 0, minHeight: 40 }} />
                <Button testID={`wipe-${d.id}`} title="Lost or stolen" variant="ghost" onPress={() => setAction({ kind: 'wipe', device: d })} style={{ paddingHorizontal: 0, minHeight: 40 }} />
              </View>
            ) : null}
          </DeviceCard>
        ))}
      </ScrollView>
      <Modal visible={Boolean(action)} transparent animationType="fade" onRequestClose={() => setAction(null)}>
        <View style={{ flex: 1, justifyContent: 'center', padding: space(6), backgroundColor: colors.overlay }}>
          <Card style={{ gap: space(3) }}>
            <AppText variant="cardTitle">{action?.kind === 'wipe' ? `Report ${action?.device.name} lost or stolen?` : `Revoke ${action?.device.name}?`}</AppText>
            <AppText variant="small" color={colors.fgSecondary}>
              {action?.kind === 'wipe'
                ? 'It is signed out and blocked now, and all EduTrack data on it, including records not uploaded, is deleted when it next connects. This cannot be cancelled.'
                : 'It is signed out now and cannot be used with this registration again.'}
            </AppText>
            <TextField testID="device-reason" label="Reason" icon="create-outline" value={reason} onChangeText={setReason} />
            <View style={{ flexDirection: 'row', gap: space(3) }}>
              <Button
                testID="confirm-device-action"
                title={action?.kind === 'wipe' ? 'Report and wipe' : 'Revoke'}
                loading={busy}
                disabled={!reason.trim() || busy}
                onPress={() => run(`/devices/${action.device.id}/${action.kind}`, { reason: reason.trim() }, action.kind === 'wipe' ? 'Reported lost; the wipe is registered.' : 'Phone revoked.')}
              />
              <Button title="Cancel" variant="secondary" onPress={() => setAction(null)} />
            </View>
          </Card>
        </View>
      </Modal>
    </Screen>
  );
}

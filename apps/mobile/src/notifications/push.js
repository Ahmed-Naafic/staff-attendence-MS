/*
 * Remote push (N2 phase 3). The phone's Expo push token is registered for the current session only
 * (the server removes it when the session ends). Push messages are generic on the lock screen
 * (N21): "Waxaad leedahay ogeysiis cusub…"; the details are read in the app after signing in.
 */
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { registerDevice, unregisterDevice } from './api';
import { ensureChannel, notificationPermission } from './local';

/** The EAS project id the push token belongs to (app.json → extra.eas.projectId), or null. */
export const projectId = () => Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null;

/**
 * Registers this phone for push when allowed: → 'registered' | 'permission_denied' | 'not_configured'
 * | 'failed'. Asks for the notification permission only when `ask`.
 */
export async function enablePush(api, { ask = false } = {}) {
  if (!projectId()) return 'not_configured';
  if ((await notificationPermission({ ask })) !== 'granted') return 'permission_denied';
  try {
    await ensureChannel();
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() });
    await registerDevice(api, { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    return 'registered';
  } catch {
    return 'failed';
  }
}

export const disablePush = (api) => unregisterDevice(api).catch(() => {});

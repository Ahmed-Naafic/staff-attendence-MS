/*
 * Test doubles for native modules. The device database is a real SQLite engine (Node's built-in
 * node:sqlite) behind expo-sqlite's async API, so queue tests run real SQL, including reopening a
 * database file to simulate an app restart.
 */
/* global jest */
import { DatabaseSync } from 'node:sqlite';

/** expo-sqlite's async API over node:sqlite (the subset the app uses). */
export function wrapSqlite(raw) {
  const params = (p) => (p === undefined ? [] : Array.isArray(p) ? p : [p]);
  return {
    raw,
    execAsync: async (sql) => raw.exec(sql),
    runAsync: async (sql, p) => {
      const r = raw.prepare(sql).run(...params(p));
      return { changes: Number(r.changes), lastInsertRowId: Number(r.lastInsertRowid) };
    },
    getAllAsync: async (sql, p) => raw.prepare(sql).all(...params(p)).map((row) => ({ ...row })),
    getFirstAsync: async (sql, p) => {
      const row = raw.prepare(sql).get(...params(p));
      return row ? { ...row } : null;
    },
    closeAsync: async () => raw.close(),
  };
}
global.__wrapSqlite = wrapSqlite;
global.__openTestDatabase = (file = ':memory:') => wrapSqlite(new DatabaseSync(file));

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => global.__openTestDatabase()),
}));

const secure = new Map();
global.__secureStore = secure;
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (key) => (global.__secureStore.has(key) ? global.__secureStore.get(key) : null)),
  setItemAsync: jest.fn(async (key, value) => void global.__secureStore.set(key, value)),
  deleteItemAsync: jest.fn(async (key) => void global.__secureStore.delete(key)),
}));

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => require('node:crypto').randomUUID()) }));

jest.mock('expo-location', () => ({
  Accuracy: { Highest: 5 },
  GeofencingEventType: { Enter: 1, Exit: 2 },
  getForegroundPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
  requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
  // Background location ("Allow all the time") starts not granted, as on a new install.
  getBackgroundPermissionsAsync: jest.fn(async () => ({ granted: false, status: 'undetermined', canAskAgain: true })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
  hasServicesEnabledAsync: jest.fn(async () => true),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 2.046934, longitude: 45.318162, accuracy: 12 }, timestamp: Date.now() })),
  hasStartedGeofencingAsync: jest.fn(async () => false),
  startGeofencingAsync: jest.fn(async () => {}),
  stopGeofencingAsync: jest.fn(async () => {}),
}));

// Device notifications: scheduled reminders are kept in a map so tests can inspect them.
global.__scheduled = new Map();
jest.mock('expo-notifications', () => ({
  AndroidImportance: { HIGH: 4 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => {}),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted', canAskAgain: true })),
  scheduleNotificationAsync: jest.fn(async (request) => {
    global.__scheduled.set(request.identifier, request);
    return request.identifier;
  }),
  cancelScheduledNotificationAsync: jest.fn(async (id) => void global.__scheduled.delete(id)),
  getAllScheduledNotificationsAsync: jest.fn(async () => [...global.__scheduled.values()]),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[test-device-token]' })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn(), isTaskDefined: jest.fn(() => false) }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'test-project' } } } } }));

jest.mock('@react-native-community/netinfo', () => require('@react-native-community/netinfo/jest/netinfo-mock.js'));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(async () => {}), hideAsync: jest.fn(async () => {}) }));
jest.mock('expo-system-ui', () => ({ setBackgroundColorAsync: jest.fn(async () => {}) }));

// Icon fonts are not loaded in tests: an icon renders as an empty Text carrying its name.
jest.mock('@expo/vector-icons', () => {
  const { Text } = require('react-native');
  const icon = (family) => {
    const Icon = ({ name, testID }) => require('react').createElement(Text, { testID, accessibilityHint: `${family}:${name}` });
    return Icon;
  };
  return { Ionicons: icon('ion'), MaterialCommunityIcons: icon('mci') };
});

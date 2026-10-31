import { registerRootComponent } from 'expo';

import App from './App';
// Defines the background geofence task (check-in reminders) when the bundle loads, as the OS requires.
import './src/notifications/geofence';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);

/* EduTrack Staff app: providers (safe area, theme, session) and navigation. */
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import * as ExpoSplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useMemo } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from './src/auth/SessionProvider';
import RootNavigator from './src/navigation/RootNavigator';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';

ExpoSplashScreen.preventAutoHideAsync().catch(() => {});

function ThemedApp() {
  const { colors, scheme } = useTheme();
  const navigationTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, primary: colors.accent, background: colors.page, card: colors.surface, text: colors.fg, border: colors.border } };
  }, [colors, scheme]);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(colors.page).catch(() => {});
  }, [colors.page]);

  useEffect(() => {
    // The in-app splash (src/screens/auth/SplashScreen.js) takes over while the session is restored.
    ExpoSplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <NavigationContainer theme={navigationTheme}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <RootNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider>
          <ThemedApp />
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

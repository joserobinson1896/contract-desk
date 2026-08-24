/**
 * Root navigation.
 *
 * A stack holding the tab group plus the contract detail screen, which pushes over
 * the tabs — a contract is a place you go into and come back from, not a peer of
 * the top-level sections.
 *
 * Navigator headers are off throughout. Each screen renders its own title inside
 * the shared width container, so the nav, the page title and the body all line up
 * on one left edge.
 *
 * `AppearanceProvider` sits above the navigator so the palette is resolved once,
 * before anything themed renders. The navigator's own theme is derived from the
 * same source, which is what stops the gap behind a push transition flashing the
 * wrong colour on the way through.
 */

import { StatusBar } from 'expo-status-bar';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { purgeLegacyCredentials } from '@/data/settings';
import { AppearanceProvider, useIsDark, useTheme } from '@/hooks/use-theme';

SplashScreen.preventAutoHideAsync();

function RootStack() {
  const palette = useTheme();
  const isDark = useIsDark();

  useEffect(() => {
    SplashScreen.hideAsync();
    // Clears a parse token left in device storage by an older build, where the user
    // pasted their own. Nothing reads it now; this stops it lingering at rest.
    void purgeLegacyCredentials();
  }, []);

  const base = isDark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    dark: isDark,
    colors: {
      ...base.colors,
      background: palette.background,
      card: palette.surface,
      text: palette.text,
      border: palette.separatorOpaque,
      primary: palette.accent,
    },
  };

  return (
    <ThemeProvider value={navTheme}>
      {/* Inverted against the app, not the OS: the bar sits on our navy chrome. */}
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: palette.background },
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="contract/[id]" />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <AppearanceProvider>
      <RootStack />
    </AppearanceProvider>
  );
}

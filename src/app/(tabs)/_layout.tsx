/**
 * Tab group.
 *
 * The bar adapts by position, not just by styling: along the top on desktop, where
 * a bottom tab bar reads as a phone app in a window and wastes the widest axis,
 * and as iOS-style bottom tabs on a phone, where the thumb is.
 *
 * On wide viewports the bar is rendered above the navigator rather than handed to
 * it as `tabBar` — the navigator's own `tabBarPosition` did not reliably move it,
 * and placing it here makes the ordering explicit. The navigator still owns tab
 * semantics either way: no growing back stack, and state kept per tab.
 */

import { Tabs } from 'expo-router';
import { View } from 'react-native';

import { AppNav } from '@/components/ui/nav';
import { useTheme } from '@/hooks/use-theme';
import { useBreakpoint } from '@/hooks/use-breakpoint';

export default function TabsLayout() {
  const { isCompact } = useBreakpoint();
  const palette = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      {!isCompact && <AppNav />}

      <Tabs
        // Compact keeps the navigator-owned bottom bar; wide already drew it above.
        tabBar={isCompact ? () => <AppNav /> : () => null}
        screenOptions={{
          headerShown: false,
          sceneStyle: { backgroundColor: palette.background },
        }}
      >
        {/* Order matches NAV_ITEMS. `index` is the home screen at '/'; the
            contracts library moved to '/contracts' so the root could become the
            entry point. Upload stays ahead of Contracts. */}
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="import" options={{ title: 'Upload' }} />
        <Tabs.Screen name="contracts" options={{ title: 'Contracts' }} />
        <Tabs.Screen name="invoices" options={{ title: 'Invoices' }} />
        <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
      </Tabs>
    </View>
  );
}

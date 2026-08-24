/**
 * Application navigation.
 *
 * Adapts rather than picking one shape: a top bar on desktop, where a bottom tab
 * bar looks out of place and wastes the widest axis, and iOS-style bottom tabs on
 * a phone, where the thumb is.
 *
 * Drawn in Hologram's navy, mirroring the dark sidebar against a white content
 * area in their platform. Dark chrome around light content does the work a border
 * otherwise has to: the page reads as a distinct surface without one being drawn.
 *
 * The active item is a lime pill with near-black text — the same treatment their
 * status pills use, and the one place the brand lime earns full saturation.
 *
 * The nav renders inside the same width container as page content, so the app
 * title, the tabs and the body all share one left edge. A full-bleed header over a
 * capped body is the single most visible way a layout looks unfinished.
 */

import { Link, usePathname } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { Hairline, Hologram, Radius, Spacing } from '@/constants/theme';
import { useBreakpoint } from '@/hooks/use-breakpoint';
import { useAppearance, useIsDark, useTheme } from '@/hooks/use-theme';
import { Text } from './text';

export type NavItem = {
  href: '/' | '/contracts' | '/invoices' | '/import' | '/settings';
  label: string;
  glyph: string;
  badge?: number;
};

export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Home', glyph: '⌂' },
  { href: '/import', label: 'Upload', glyph: '↑' },
  { href: '/contracts', label: 'Contracts', glyph: '◧' },
  { href: '/invoices', label: 'Invoices', glyph: '§' },
  { href: '/settings', label: 'Settings', glyph: '⚙' },
];

function isActive(pathname: string, href: string): boolean {
  // Home matches exactly. A `startsWith` test on '/' would mark it active on every
  // route in the app.
  if (href === '/') return pathname === '/' || pathname === '/index';
  return pathname.startsWith(href);
}

/* -------------------------------------------------------------------------- */

/**
 * Appearance toggle.
 *
 * Flips straight between light and dark rather than cycling system → light →
 * dark. One button stepping through three unlabelled states leaves you unable to
 * tell what pressing it will do; `system` still exists and lives in Settings,
 * where it can carry the sentence that explains it.
 *
 * The glyph shows the mode you are in, not the one you would switch to. Both
 * conventions exist and neither is self-evident, so the label states the action
 * explicitly for anyone using a screen reader.
 */
function AppearanceToggle() {
  const { isDark, setPreference } = useAppearance();

  return (
    <Pressable
      onPress={() => setPreference(isDark ? 'light' : 'dark')}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: isDark }}
      accessibilityLabel={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      style={StyleSheet.flatten([styles.toggle, { borderColor: Hologram.onInkMuted }])}
    >
      <Text variant="footnote" style={{ color: isDark ? Hologram.lime : Hologram.onInk }}>
        {isDark ? '☾' : '☀'}
      </Text>
    </Pressable>
  );
}

export function AppNav({ items = NAV_ITEMS }: { items?: NavItem[] }) {
  const { isCompact, maxWidth } = useBreakpoint();
  const theme = useTheme();
  const isDark = useIsDark();
  const pathname = usePathname();

  /**
   * Against a white page the navy defines its own edge. Against a near-black one
   * it measures 1.2:1 against the ground and the boundary disappears, so dark mode
   * draws the hairline that the value difference is no longer carrying.
   */
  const edge = isDark ? { borderColor: theme.separatorOpaque, borderWidth: Hairline } : null;

  if (isCompact) {
    return (
      <View
        style={[
          styles.bottomBar,
          { backgroundColor: Hologram.ink },
          edge && { borderTopColor: edge.borderColor, borderTopWidth: edge.borderWidth },
        ]}
      >
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link key={item.href} href={item.href} asChild>
              <Pressable style={StyleSheet.flatten(styles.bottomItem)}>
                {/* The lime dot carries the active state alongside the colour
                    change, so it survives greyscale and every CVD type. */}
                <View
                  style={[
                    styles.activeDot,
                    { backgroundColor: active ? Hologram.lime : 'transparent' },
                  ]}
                />
                <Text
                  variant="title3"
                  style={{ color: active ? Hologram.lime : Hologram.onInkMuted }}
                >
                  {item.glyph}
                </Text>
                <Text
                  variant="caption2"
                  weight={active ? '600' : '500'}
                  style={{ color: active ? Hologram.onInk : Hologram.onInkMuted }}
                >
                  {item.label}
                </Text>
              </Pressable>
            </Link>
          );
        })}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.topBar,
        { backgroundColor: Hologram.ink },
        edge && { borderBottomColor: edge.borderColor, borderBottomWidth: edge.borderWidth },
      ]}
    >
      <View style={[styles.topInner, { maxWidth }]}>
        <Link href="/" asChild>
          <Pressable style={StyleSheet.flatten(styles.brand)}>
            <View style={[styles.mark, { backgroundColor: Hologram.lime }]} />
            <Text variant="headline" style={{ color: Hologram.onInk }}>
              Contract Desk
            </Text>
          </Pressable>
        </Link>

        <View style={styles.topItems}>
          {items.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} asChild>
                <Pressable
                  style={StyleSheet.flatten([
                    styles.topItem,
                    active && { backgroundColor: Hologram.lime },
                  ])}
                >
                  <Text
                    variant="subhead"
                    weight={active ? '600' : '400'}
                    style={{ color: active ? Hologram.onLime : Hologram.onInkMuted }}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              </Link>
            );
          })}

          <View style={[styles.toggleDivider, { backgroundColor: Hologram.onInkMuted }]} />
          <AppearanceToggle />
        </View>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  topBar: { paddingHorizontal: Spacing.three },
  topInner: {
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.four,
    minHeight: 64,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  mark: { width: 4, height: 18, borderRadius: Radius.pill },
  topItems: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  topItem: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two - 1,
    borderRadius: Radius.pill,
  },
  bottomBar: {
    flexDirection: 'row',
    paddingBottom: Spacing.four,
    paddingTop: Spacing.two,
  },
  bottomItem: { flex: 1, alignItems: 'center', gap: 2 },
  activeDot: { width: 4, height: 4, borderRadius: Radius.pill, marginBottom: 2 },
  toggle: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* Separates a mode switch from the destinations beside it — without it the
     toggle reads as a fifth place to go. */
  toggleDivider: { width: 1, height: 18, opacity: 0.35, marginHorizontal: Spacing.two },
});

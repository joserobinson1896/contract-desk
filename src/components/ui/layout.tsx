/**
 * Layout primitives: screens, page headers, grouped cards, rows, separators.
 *
 * One rule runs through all of it: the nav, the page title, and the body share a
 * single width container and therefore a single left edge. A full-bleed header
 * over a capped body is the most visible way a layout reads as unfinished.
 *
 * Shadows use `boxShadow` rather than the `shadow*` props, which React Native Web
 * now warns about as deprecated.
 */

import { type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Hairline, Radius, Spacing } from '@/constants/theme';
import { useBreakpoint } from '@/hooks/use-breakpoint';
import { useTheme } from '@/hooks/use-theme';
import { Text } from './text';

/**
 * Cross-platform elevation without the deprecated shadow props.
 *
 * Two stacked shadows on web rather than one. A single blur reads as a grey halo;
 * real depth is a tight contact shadow holding the edge down plus a wider ambient
 * one carrying the lift. Native gets the closest single-layer approximation, since
 * RN takes only one shadow per view.
 */
export function elevation(color: string, level: 1 | 2 = 1) {
  return Platform.select({
    web: {
      boxShadow:
        level === 1
          ? `0 1px 2px ${color}, 0 4px 12px -2px ${color}`
          : `0 2px 4px ${color}, 0 12px 32px -6px ${color}`,
    },
    default: {
      shadowColor: color,
      shadowOffset: { width: 0, height: level === 1 ? 2 : 8 },
      shadowOpacity: 1,
      shadowRadius: level === 1 ? 6 : 20,
      elevation: level * 2,
    },
  }) as ViewStyle;
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                      */
/* -------------------------------------------------------------------------- */

export function Screen({
  children,
  scroll = true,
  contentStyle,
}: {
  children: ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const { maxWidth } = useBreakpoint();

  const inner = <View style={[styles.inner, { maxWidth }, contentStyle]}>{children}</View>;

  if (!scroll) {
    return <View style={[styles.screen, { backgroundColor: theme.background }]}>{inner}</View>;
  }

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: theme.background }]}
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
    >
      {inner}
    </ScrollView>
  );
}

/* -------------------------------------------------------------------------- */
/* Page header                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The page title, rendered inside the content container rather than by the
 * navigator. Navigator headers span the full window while the body is capped,
 * which is what pushed the old Settings link to the far edge of the screen.
 */
export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.pageHeader}>
      <View style={styles.pageHeaderText}>
        <Text variant="largeTitle">{title}</Text>
        {subtitle && (
          <Text variant="subhead" color="textSecondary">
            {subtitle}
          </Text>
        )}
      </View>
      {action}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Section                                                                     */
/* -------------------------------------------------------------------------- */

export function Section({
  title,
  footer,
  action,
  children,
  style,
}: {
  title?: string;
  footer?: string;
  action?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.section, style]}>
      {(title || action) && (
        <View style={styles.sectionHeader}>
          {title ? (
            <Text variant="footnote" color="textSecondary" style={styles.sectionTitle}>
              {title.toUpperCase()}
            </Text>
          ) : (
            <View />
          )}
          {action}
        </View>
      )}
      {children}
      {footer && (
        <Text variant="footnote" color="textSecondary" style={styles.sectionFooter}>
          {footer}
        </Text>
      )}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Card                                                                        */
/* -------------------------------------------------------------------------- */

export function Card({
  children,
  padded = true,
  style,
  tone,
}: {
  children: ReactNode;
  padded?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Accent stripe down the leading edge. Wide enough to read as intentional. */
  tone?: string;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.separator },
        elevation(theme.shadow, 1),
        tone ? { borderLeftWidth: 5, borderLeftColor: tone } : null,
        padded && styles.cardPadded,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

export function Row({
  label,
  value,
  detail,
  onPress,
  accessory,
  last,
}: {
  label: string;
  value?: ReactNode;
  detail?: string;
  onPress?: () => void;
  accessory?: ReactNode;
  last?: boolean;
}) {
  const theme = useTheme();

  const content = (
    <View
      style={[
        styles.row,
        !last && { borderBottomWidth: Hairline, borderBottomColor: theme.separator },
      ]}
    >
      <View style={styles.rowMain}>
        <Text variant="body">{label}</Text>
        {detail && (
          <Text variant="footnote" color="textSecondary">
            {detail}
          </Text>
        )}
      </View>
      {typeof value === 'string' ? (
        <Text variant="body" color="textSecondary" numeric>
          {value}
        </Text>
      ) : (
        value
      )}
      {accessory}
      {onPress && (
        <Text variant="body" color="textTertiary">
          ›
        </Text>
      )}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [pressed && { backgroundColor: theme.backgroundSelected }]}
    >
      {content}
    </Pressable>
  );
}

export function Divider() {
  const theme = useTheme();
  return <View style={{ height: Hairline, backgroundColor: theme.separator }} />;
}

/* -------------------------------------------------------------------------- */
/* Empty state                                                                 */
/* -------------------------------------------------------------------------- */

export function EmptyState({
  title,
  message,
  action,
  glyph,
}: {
  title: string;
  message: string;
  action?: ReactNode;
  glyph?: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.empty}>
      {glyph && (
        <View style={[styles.emptyGlyph, { backgroundColor: theme.accentMuted }]}>
          <Text variant="largeTitle" style={{ color: theme.accent }}>
            {glyph}
          </Text>
        </View>
      )}
      <Text variant="title2" style={styles.center}>
        {title}
      </Text>
      <Text variant="callout" color="textSecondary" style={[styles.center, styles.emptyMessage]}>
        {message}
      </Text>
      {action}
    </View>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollContent: { paddingBottom: Spacing.six, paddingHorizontal: Spacing.three },
  inner: { width: '100%', alignSelf: 'center' },

  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.two,
  },
  pageHeaderText: { flex: 1, gap: Spacing.one },

  section: { marginTop: Spacing.four },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.two,
    paddingHorizontal: Spacing.one,
  },
  sectionTitle: { letterSpacing: 0.7, fontWeight: '600' },
  sectionFooter: { marginTop: Spacing.two, paddingHorizontal: Spacing.one },

  card: {
    borderRadius: Radius.large,
    borderWidth: Hairline,
    overflow: 'hidden',
  },
  cardPadded: { padding: Spacing.four },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    minHeight: 52,
  },
  rowMain: { flex: 1, gap: 2 },

  empty: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingVertical: Spacing.six,
    paddingHorizontal: Spacing.four,
  },
  emptyGlyph: {
    width: 76,
    height: 76,
    borderRadius: Radius.xlarge,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.two,
  },
  center: { textAlign: 'center' },
  emptyMessage: { maxWidth: 420 },
});

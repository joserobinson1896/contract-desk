/**
 * Status chips, stat tiles, and buttons.
 *
 * Small pieces, but they carry most of the app's meaning at a glance — a chip is
 * how you tell a blocked contract from a verified one without reading anything.
 */

import { type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Hairline, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { elevation } from './layout';
import { Text } from './text';

/* -------------------------------------------------------------------------- */
/* Chip                                                                        */
/* -------------------------------------------------------------------------- */

export function Chip({
  label,
  fg,
  bg,
  icon,
  style,
}: {
  label: string;
  fg: string;
  bg: string;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.chip, { backgroundColor: bg }, style]}>
      {icon}
      <Text variant="caption2" style={{ color: fg, fontWeight: '700', letterSpacing: 0.3 }}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Stat tile                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One number and its label. `tone` colours the value when it carries a verdict —
 * a blocking count, a total that has gone over. Left neutral otherwise, so colour
 * stays meaningful rather than decorative.
 */
export function StatTile({
  label,
  value,
  caption,
  tone,
  style,
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.tile,
        { backgroundColor: theme.surface, borderColor: theme.separator },
        elevation(theme.shadow, 1),
        style,
      ]}
    >
      <Text variant="footnote" color="textSecondary" numberOfLines={1}>
        {label}
      </Text>
      <Text
        variant="title1"
        numeric
        style={tone ? { color: tone } : undefined}
        numberOfLines={1}
      >
        {value}
      </Text>
      {caption && (
        <Text variant="caption" color="textTertiary" numberOfLines={1}>
          {caption}
        </Text>
      )}
    </View>
  );
}

/** Evenly-wrapping tile row. */
export function TileGrid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'destructive' | 'plain';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();

  const palette = {
    primary: { bg: theme.accent, fg: '#FFFFFF' },
    secondary: { bg: theme.accentMuted, fg: theme.accent },
    destructive: { bg: theme.dangerMuted, fg: theme.danger },
    plain: { bg: 'transparent', fg: theme.accent },
  }[variant];

  const inactive = disabled || loading;

  return (
    <Pressable
      onPress={inactive ? undefined : onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg },
        inactive && styles.buttonDisabled,
        pressed && styles.buttonPressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.fg} />
      ) : (
        <Text variant="headline" style={{ color: palette.fg }}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
  tile: {
    flexGrow: 1,
    flexBasis: 170,
    minWidth: 150,
    gap: Spacing.one,
    padding: Spacing.four,
    borderRadius: Radius.large,
    borderWidth: Hairline,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  button: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    borderRadius: Radius.medium,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { opacity: 0.75 },
});

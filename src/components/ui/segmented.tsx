/**
 * Segmented control.
 *
 * The iOS pattern for switching panes within one screen. Chosen over nested
 * navigators here because the panes are views of a single contract, not separate
 * destinations — a back button between them would be wrong.
 */

import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useBreakpoint } from '@/hooks/use-breakpoint';
import { useTheme } from '@/hooks/use-theme';
import { elevation } from './layout';
import { Text } from './text';

export type Segment<T extends string> = {
  key: T;
  label: string;
  /**
   * Shorter label for compact viewports. Five segments have to share a phone's
   * width, and one long label pushes the rest off-screen into a scroll nobody
   * knows is there. Omit it when the label is already short.
   */
  compactLabel?: string;
  /** Rendered as a superscript count — used for open findings. */
  badge?: number;
  badgeTone?: string;
};

export function SegmentedControl<T extends string>({
  segments,
  value,
  onChange,
}: {
  segments: Segment<T>[];
  value: T;
  onChange: (key: T) => void;
}) {
  const theme = useTheme();
  const { isCompact } = useBreakpoint();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scroll}
    >
      <View style={[styles.track, { backgroundColor: theme.surfaceSunken }]}>
        {segments.map((segment) => {
          const active = segment.key === value;
          return (
            <Pressable
              key={segment.key}
              onPress={() => onChange(segment.key)}
              style={[
                styles.segment,
                active && [{ backgroundColor: theme.surface }, elevation(theme.shadow, 1)],
              ]}
            >
              <Text
                variant="footnote"
                weight={active ? '600' : '400'}
                color={active ? 'text' : 'textSecondary'}
                numberOfLines={1}
              >
                {isCompact ? (segment.compactLabel ?? segment.label) : segment.label}
              </Text>
              {segment.badge !== undefined && segment.badge > 0 && (
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: segment.badgeTone ?? theme.textTertiary },
                  ]}
                >
                  <Text variant="caption2" style={styles.badgeText}>
                    {segment.badge}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingVertical: Spacing.two },
  track: {
    flexDirection: 'row',
    padding: 2,
    borderRadius: Radius.medium,
    gap: 2,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.one,
    paddingVertical: Spacing.two - 2,
    paddingHorizontal: Spacing.three - 2,
    borderRadius: Radius.small + 2,
  },
  badge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: 5,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#FFFFFF', fontWeight: '700' },
});

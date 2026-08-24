/**
 * Expanded contract detail — the full field set from the assignment spec.
 *
 * A wrapping grid, not a wide table. The brief for the collapsed row is that it
 * must never scroll sideways, and the same constraint applies here: forty fields
 * cannot become forty columns. Laid out as label-over-value pairs that wrap, the
 * panel reflows from four columns to one as the viewport narrows, and the widest
 * value sets its own cell rather than the whole row.
 *
 * Fields the contract is silent on are shown, not hidden. A gap you cannot see is
 * a gap nobody chases — "Not stated" in muted type is the point of the panel as
 * much as the values that are present.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { Hairline, Radius, Spacing } from '@/constants/theme';
import { absentCount, contractFields } from '@/domain/fields';
import type { ContractRecord } from '@/domain/record';
import { useBreakpoint } from '@/hooks/use-breakpoint';
import { useTheme } from '@/hooks/use-theme';

export function ContractFieldGrid({
  record,
  onOpen,
}: {
  record: ContractRecord;
  onOpen: () => void;
}) {
  const theme = useTheme();
  const { isCompact, maxWidth } = useBreakpoint();

  /**
   * A fixed column count, not a flexible basis.
   *
   * The first version used `flexBasis` with `flexGrow`, which let each wrapped row
   * size itself independently — the last row stretched to fill, and a two-line
   * value in one cell pushed its neighbours out of line. Columns that do not line
   * up vertically read as broken even when every value is correct. Fixing the
   * count and giving every cell the same width makes the grid an actual grid.
   */
  const columns = isCompact ? 1 : maxWidth >= 900 ? 4 : 2;

  const groups = contractFields(record.config);
  const missing = absentCount(groups);

  return (
    <View style={[styles.panel, { backgroundColor: theme.surfaceSunken }]}>
      {groups.map((group) => (
        <View key={group.title} style={styles.group}>
          <Text variant="caption2" color="textTertiary" style={styles.groupTitle}>
            {group.title.toUpperCase()}
          </Text>
          <View style={styles.grid}>
            {group.fields.map((f) => (
              <View
                key={f.label}
                style={[styles.cell, { width: `${100 / columns}%` }]}
              >
                <Text variant="caption" color="textTertiary" numberOfLines={1}>
                  {f.label}
                </Text>
                <Text
                  variant="footnote"
                  color={f.absent ? 'textTertiary' : 'text'}
                  weight={f.absent ? '400' : '500'}
                  style={f.absent && styles.absent}
                >
                  {f.value}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ))}

      <View style={[styles.foot, { borderTopColor: theme.separator }]}>
        <Text variant="caption" color="textTertiary">
          {missing === 0
            ? 'The contract addresses every field above.'
            : `${missing} field${missing === 1 ? '' : 's'} the contract does not address.`}
        </Text>
        {/* The row itself now toggles, so the way through to the contract has to
            be its own control rather than the row's press. */}
        <Pressable onPress={onOpen} hitSlop={8}>
          <Text variant="footnote" weight="600" style={{ color: theme.accent }}>
            Open contract →
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { padding: Spacing.four, gap: Spacing.four },
  group: { gap: Spacing.two },
  groupTitle: { letterSpacing: 0.9 },

  /* No gap — the cells carry their own padding instead. A percentage width plus a
     flex gap overflows the row, because the gap is added on top of 100%. */
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { gap: 1, paddingRight: Spacing.three, paddingBottom: Spacing.three },

  absent: { fontStyle: 'italic' },

  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.three,
    flexWrap: 'wrap',
    paddingTop: Spacing.three,
    borderTopWidth: Hairline,
  },
});

export const FIELD_PANEL_RADIUS = Radius.medium;

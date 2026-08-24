/**
 * Pool meter.
 *
 * Form choice: this is one magnitude against a capacity, not a distribution — so
 * it is a meter, not a chart. Per the form heuristic, a single headline value gets
 * a stated number; the bar exists only to show the relationship to capacity, and
 * the megabyte figures are written out rather than left to be estimated off a
 * scale.
 *
 * The whole point is making the pooled-data trap visible: the pool grows with the
 * SIM count, so "over" is a property of the fleet, not of any one SIM. When usage
 * exceeds capacity the bar rescales so the overflow is drawn to scale beyond the
 * capacity marker, rather than just pinning at 100%.
 */

import { StyleSheet, View } from 'react-native';

import { Radius, Spacing, chartPalette } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Text } from '../ui/text';

const BAR_HEIGHT = 28;

function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
}

export function PoolMeter({
  includedMb,
  usedMb,
  contributingSims,
  perSimMb,
}: {
  includedMb: number;
  usedMb: number;
  contributingSims: number;
  perSimMb: number;
}) {
  const theme = useTheme();
  const palette = chartPalette(theme);

  const overageMb = Math.max(0, usedMb - includedMb);
  const isOver = overageMb > 0;

  // Scale to whichever is larger so the overflow is drawn truthfully rather than
  // clipped at the capacity line.
  const scaleMax = Math.max(includedMb, usedMb, 1);
  const withinPct = (Math.min(usedMb, includedMb) / scaleMax) * 100;
  const overPct = (overageMb / scaleMax) * 100;
  const capacityPct = (includedMb / scaleMax) * 100;

  return (
    <View style={styles.wrap}>
      {/*
        Header states capacity and how it was arrived at; the footer states usage.
        Keeping them apart matters — labelling the within-pool portion "used" beside
        an identical capacity figure read as though the pool were exactly full.
      */}
      <View style={styles.header}>
        <Text variant="footnote" color="textSecondary">
          {contributingSims.toLocaleString()} SIM{contributingSims === 1 ? '' : 's'} × {perSimMb} MB
        </Text>
        <Text variant="footnote" weight="600" numeric>
          {formatMb(includedMb)} capacity
        </Text>
      </View>

      <View style={[styles.track, { backgroundColor: theme.surfaceSunken }]}>
        <View
          style={[styles.fill, { width: `${withinPct}%`, backgroundColor: palette.series }]}
        />
        {isOver && (
          <View
            style={[
              styles.fill,
              styles.overFill,
              { width: `${overPct}%`, backgroundColor: palette.defect },
            ]}
          />
        )}

        {/* Capacity marker — only meaningful when there is something beyond it. */}
        {isOver && (
          <View style={[styles.capacityMark, { left: `${capacityPct}%`, backgroundColor: theme.surface }]} />
        )}
      </View>

      <View style={styles.footer}>
        <View style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: palette.series }]} />
          <Text variant="caption" color="textSecondary" numeric>
            {formatMb(usedMb)} used
          </Text>
        </View>

        {isOver ? (
          <View style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: palette.defect }]} />
            <Text variant="caption" weight="600" numeric style={{ color: palette.defect }}>
              {formatMb(overageMb)} over capacity
            </Text>
          </View>
        ) : (
          <Text variant="caption" color="textSecondary" numeric>
            {formatMb(includedMb - usedMb)} remaining
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  track: {
    flexDirection: 'row',
    height: BAR_HEIGHT,
    borderRadius: Radius.small,
    overflow: 'hidden',
  },
  fill: { height: '100%' },
  // 2px surface gap between adjacent fills, per the mark spec.
  overFill: { marginLeft: 2 },
  capacityMark: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
  },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.one },
  swatch: { width: 10, height: 10, borderRadius: 2 },
});

/**
 * Minimum-spend schedule — a step chart.
 *
 * Form choice: the data is a magnitude that holds flat across a span of months and
 * then jumps. A line would imply the commitment ramps continuously between bands,
 * which is wrong — it steps. A bar per band would lose the month axis. A step
 * chart is the only form that states both the amount and the span truthfully.
 *
 * Colour: one series, so no legend — the title names it. Bands the rule engine
 * flagged are drawn in the defect colour AND hatched AND labelled, because status
 * must never be carried by colour alone.
 *
 * Overlapping bands are drawn overlapping. The chart's job is to show the schedule
 * as signed, and an overlap is precisely the thing worth seeing.
 */

import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, G, Line, Pattern, Rect, Text as SvgText } from 'react-native-svg';

import { Spacing, chartPalette } from '@/constants/theme';
import type { SpendPeriod } from '@/domain/schema';
import { useTheme } from '@/hooks/use-theme';
import { Text } from '../ui/text';

const HEIGHT = 180;
const PAD = { top: 16, right: 12, bottom: 28, left: 52 };

export function SpendScheduleChart({
  schedule,
  flaggedPeriodIndexes = [],
  termMonths,
}: {
  schedule: SpendPeriod[];
  /** Period indexes the rule engine flagged. Drawn distinctly and labelled. */
  flaggedPeriodIndexes?: number[];
  termMonths: number | null;
}) {
  const theme = useTheme();
  const palette = chartPalette(theme);
  const flagged = useMemo(() => new Set(flaggedPeriodIndexes), [flaggedPeriodIndexes]);

  const [width, setWidth] = useState(320);

  const model = useMemo(() => {
    if (schedule.length === 0) return null;

    const sorted = [...schedule].sort((a, b) => a.startMonth - b.startMonth);
    const lastMonth = Math.max(
      termMonths ?? 0,
      ...sorted.map((p) => p.endMonth ?? p.startMonth + 11),
    );
    const maxAmount = Math.max(...sorted.map((p) => p.amountPerMonth));

    const plotW = Math.max(40, width - PAD.left - PAD.right);
    const plotH = HEIGHT - PAD.top - PAD.bottom;

    const x = (month: number) => PAD.left + ((month - 1) / Math.max(1, lastMonth - 1)) * plotW;
    // A floor of 4% keeps a near-zero band visible rather than collapsing it onto
    // the axis — the $3.00 band is a finding, and an invisible bar hides it.
    const y = (amount: number) =>
      PAD.top + plotH - Math.max(0.04, amount / maxAmount) * plotH;

    return { sorted, lastMonth, maxAmount, plotW, plotH, x, y };
  }, [schedule, termMonths, width]);

  if (!model) {
    return (
      <Text variant="footnote" color="textSecondary">
        This contract has no minimum-spend schedule.
      </Text>
    );
  }

  const { sorted, lastMonth, maxAmount, plotH, x, y } = model;

  const ticks = [0, maxAmount / 2, maxAmount];

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={styles.wrap}>
      <Svg width="100%" height={HEIGHT}>
        <Defs>
          {/* Secondary encoding for flagged bands — survives greyscale and CVD. */}
          <Pattern
            id="defectHatch"
            patternUnits="userSpaceOnUse"
            width={6}
            height={6}
            patternTransform="rotate(45)"
          >
            <Rect width={6} height={6} fill={palette.defect} opacity={0.22} />
            <Line x1={0} y1={0} x2={0} y2={6} stroke={palette.defect} strokeWidth={2} />
          </Pattern>
        </Defs>

        {/* Recessive gridlines */}
        <G>
          {ticks.map((t, i) => (
            <G key={i}>
              <Line
                x1={PAD.left}
                y1={y(t)}
                x2={width - PAD.right}
                y2={y(t)}
                stroke={palette.grid}
                strokeWidth={1}
              />
              <SvgText
                x={PAD.left - 8}
                y={y(t) + 4}
                fill={palette.axis}
                fontSize={10}
                textAnchor="end"
              >
                {t >= 1000 ? `$${Math.round(t / 1000)}k` : `$${Math.round(t)}`}
              </SvgText>
            </G>
          ))}
        </G>

        {/* Bands */}
        {sorted.map((period) => {
          const isFlagged = flagged.has(period.index);
          const startX = x(period.startMonth);
          const endX = x((period.endMonth ?? lastMonth) + 1);
          const topY = y(period.amountPerMonth);
          const w = Math.max(2, endX - startX - 2); // 2px surface gap between bands

          return (
            <G key={period.index}>
              <Rect
                x={startX}
                y={topY}
                width={w}
                height={PAD.top + plotH - topY}
                fill={isFlagged ? 'url(#defectHatch)' : palette.series}
                opacity={isFlagged ? 1 : 0.9}
                rx={4}
              />
              {isFlagged && (
                <Rect
                  x={startX}
                  y={topY}
                  width={w}
                  height={PAD.top + plotH - topY}
                  fill="none"
                  stroke={palette.defect}
                  strokeWidth={2}
                  rx={4}
                />
              )}
            </G>
          );
        })}

        {/* Baseline */}
        <Line
          x1={PAD.left}
          y1={PAD.top + plotH}
          x2={width - PAD.right}
          y2={PAD.top + plotH}
          stroke={palette.axis}
          strokeWidth={1}
        />

        {/* Month axis — endpoints only, to avoid a wall of numbers */}
        <SvgText x={PAD.left} y={HEIGHT - 8} fill={palette.axis} fontSize={10}>
          Month 1
        </SvgText>
        <SvgText
          x={width - PAD.right}
          y={HEIGHT - 8}
          fill={palette.axis}
          fontSize={10}
          textAnchor="end"
        >
          Month {lastMonth}
        </SvgText>
      </Svg>

      {/* Direct labels — the amounts, stated rather than estimated off an axis */}
      <View style={styles.legend}>
        {sorted.map((period) => {
          const isFlagged = flagged.has(period.index);
          return (
            <View key={period.index} style={styles.legendItem}>
              <View
                style={[
                  styles.swatch,
                  {
                    backgroundColor: isFlagged ? theme.dangerMuted : palette.series,
                    borderColor: isFlagged ? palette.defect : 'transparent',
                    borderWidth: isFlagged ? 2 : 0,
                  },
                ]}
              />
              <Text variant="caption" color="textSecondary" numeric>
                {period.startMonth}–{period.endMonth ?? '∞'}
              </Text>
              <Text variant="caption" weight="600" numeric>
                ${period.amountPerMonth.toLocaleString()}
              </Text>
              {isFlagged && (
                <Text variant="caption2" style={{ color: palette.defect, fontWeight: '700' }}>
                  FLAGGED
                </Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.two },
  legend: { gap: Spacing.one },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  swatch: { width: 12, height: 12, borderRadius: 3 },
});

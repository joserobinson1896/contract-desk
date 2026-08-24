/**
 * Financial projections — the payoff.
 *
 * A config that has been reviewed but never exercised is still a guess. This
 * projects a real month from it, which is the only way to demonstrate the pooled
 * allowance, the minimum-spend floor, and the exclusion of non-qualifying charges
 * all behave as the contract says.
 *
 * It also makes findings consequential. A month sitting inside two minimum-spend
 * bands does not compute — the screen refuses and names the finding to go resolve.
 * That refusal is deliberate: a plausible wrong number is worse than no number,
 * and it is the difference between a QA register that matters and one people skim.
 */

import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { PoolMeter } from '@/components/charts/pool-meter';
import { Chip } from '@/components/ui/chip';
import { Card, Divider, Section } from '@/components/ui/layout';
import { Text } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import { simulateMonth } from '@/domain/billing';
import { flagsBlockingMonth } from '@/domain/flags';
import type { ContractRecord } from '@/domain/record';
import { useTheme } from '@/hooks/use-theme';

/* -------------------------------------------------------------------------- */

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Stepper({
  label,
  value,
  onChange,
  step,
  min = 0,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
  min?: number;
  suffix?: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.stepper}>
      <View style={styles.stepperLabel}>
        <Text variant="footnote" color="textSecondary">
          {label}
        </Text>
        <Text variant="title3" numeric>
          {value.toLocaleString()}
          {suffix ? ` ${suffix}` : ''}
        </Text>
      </View>
      <View style={[styles.stepperControls, { backgroundColor: theme.surfaceSunken }]}>
        <Pressable
          onPress={() => onChange(Math.max(min, value - step))}
          style={styles.stepperButton}
          hitSlop={6}
        >
          <Text variant="title3" style={{ color: theme.accent }}>
            −
          </Text>
        </Pressable>
        <View style={[styles.stepperDivider, { backgroundColor: theme.separator }]} />
        <Pressable onPress={() => onChange(value + step)} style={styles.stepperButton} hitSlop={6}>
          <Text variant="title3" style={{ color: theme.accent }}>
            +
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */

export function FinancialProjectionsPane({ record }: { record: ContractRecord }) {
  const theme = useTheme();

  const [month, setMonth] = useState(8);
  const [activeSims, setActiveSims] = useState(150);
  const [mbUsed, setMbUsed] = useState(2400);
  const [testModeSims, setTestModeSims] = useState(0);

  const blockingHere = useMemo(
    () => flagsBlockingMonth(record.flags, month),
    [record.flags, month],
  );

  const outcome = useMemo(
    () =>
      simulateMonth(
        record.config,
        record.policy,
        { month, activeSims, mbUsed, testModeSims },
        { ambiguousMinimum: blockingHere.map((f) => f.id) },
      ),
    [record.config, record.policy, month, activeSims, mbUsed, testModeSims, blockingHere],
  );

  const perSimMb = record.config.ratePlan.includedDataMbPerSim ?? 0;

  return (
    <>
      <Section title="Inputs">
        <Card style={styles.inputs}>
          <Stepper label="Month of term" value={month} onChange={setMonth} step={1} min={1} />
          <Divider />
          <Stepper
            label="Active SIMs"
            value={activeSims}
            onChange={setActiveSims}
            step={10}
          />
          <Divider />
          <Stepper
            label="Pooled data used"
            value={mbUsed}
            onChange={setMbUsed}
            step={100}
            suffix="MB"
          />
          {record.config.testMode && (
            <>
              <Divider />
              <Stepper
                label="SIMs in Test Mode"
                value={testModeSims}
                onChange={setTestModeSims}
                step={10}
              />
            </>
          )}
        </Card>
      </Section>

      {!outcome.ok ? (
        <Section title="Cannot compute">
          <Card style={[styles.blocked, { backgroundColor: theme.dangerMuted }]}>
            <Text variant="headline" style={{ color: theme.danger }}>
              Month {month} does not compute
            </Text>
            <Text variant="footnote" color="textSecondary">
              {outcome.message}
            </Text>
            {blockingHere.length > 0 && (
              <View style={styles.blockedList}>
                {blockingHere.map((flag) => (
                  <Text key={flag.id} variant="footnote" weight="600">
                    · {flag.title}
                  </Text>
                ))}
              </View>
            )}
            <Text variant="caption" color="textTertiary">
              Resolve it in Findings, or set the policy that answers it. Financial projections
              will not guess.
            </Text>
          </Card>
        </Section>
      ) : (
        <>
          {record.config.ratePlan.pooling && (
            <Section
              title="Data pool"
              footer="The pool scales with the SIM count. One SIM exceeding its own allowance creates no overage while the pool still has room."
            >
              <Card>
                <PoolMeter
                  includedMb={outcome.breakdown.mbIncluded}
                  usedMb={outcome.breakdown.mbUsed}
                  contributingSims={outcome.breakdown.poolContributingSims}
                  perSimMb={perSimMb}
                />
              </Card>
            </Section>
          )}

          {/* ---- The MAX --------------------------------------------------- */}
          {outcome.breakdown.applicableMinimum !== null && (
            <Section
              title="Greater of"
              footer="The customer pays whichever is larger — never both added together."
            >
              <View style={styles.versus}>
                <Card
                  style={[
                    styles.versusCard,
                    outcome.breakdown.controlling === 'actual' && {
                      borderColor: theme.accent,
                      borderWidth: 2,
                    },
                  ]}
                >
                  <Text variant="caption" color="textSecondary">
                    QUALIFYING FEES
                  </Text>
                  <Text variant="title2" numeric>
                    {money(outcome.breakdown.qualifyingFees)}
                  </Text>
                  {outcome.breakdown.controlling === 'actual' && (
                    <Chip label="Controls" fg={theme.accent} bg={theme.accentMuted} />
                  )}
                </Card>

                <Card
                  style={[
                    styles.versusCard,
                    outcome.breakdown.controlling === 'minimum' && {
                      borderColor: theme.accent,
                      borderWidth: 2,
                    },
                  ]}
                >
                  <Text variant="caption" color="textSecondary">
                    PERIOD MINIMUM
                  </Text>
                  <Text variant="title2" numeric>
                    {money(outcome.breakdown.applicableMinimum)}
                  </Text>
                  {outcome.breakdown.controlling === 'minimum' && (
                    <Chip label="Controls" fg={theme.accent} bg={theme.accentMuted} />
                  )}
                </Card>
              </View>
            </Section>
          )}

          {/* ---- Lines ----------------------------------------------------- */}
          <Section title="Invoice">
            <Card padded={false}>
              {outcome.breakdown.lines.map((line) => (
                <View
                  key={line.chargeId}
                  style={[styles.line, { borderBottomColor: theme.separator }]}
                >
                  <View style={styles.lineMain}>
                    <Text variant="subhead">{line.label}</Text>
                    <Text variant="caption" color="textTertiary" numeric>
                      {line.quantity.toLocaleString()} × {money(line.unitRate)}
                      {line.countsTowardMinimum ? '' : ' · does not count toward minimum'}
                    </Text>
                  </View>
                  <Text variant="subhead" numeric>
                    {money(line.amount)}
                  </Text>
                </View>
              ))}

              <View style={[styles.total, { backgroundColor: theme.surfaceSunken }]}>
                <View>
                  <Text variant="headline">Month {month} total</Text>
                  <Text variant="caption" color="textSecondary">
                    exclusive of tax
                  </Text>
                </View>
                <Text variant="title2" numeric>
                  {money(outcome.breakdown.invoiceTotal)}
                </Text>
              </View>
            </Card>
          </Section>
        </>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  inputs: { gap: Spacing.three },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepperLabel: { gap: 2 },
  stepperControls: { flexDirection: 'row', borderRadius: Radius.medium, overflow: 'hidden' },
  stepperButton: { width: 48, height: 40, alignItems: 'center', justifyContent: 'center' },
  stepperDivider: { width: 1 },
  blocked: { gap: Spacing.two },
  blockedList: { gap: 2 },
  versus: { flexDirection: 'row', gap: Spacing.two },
  versusCard: { flex: 1, gap: Spacing.one, alignItems: 'flex-start' },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
    padding: Spacing.three,
    borderBottomWidth: 1,
  },
  lineMain: { flex: 1, gap: 2 },
  total: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.three,
  },
});

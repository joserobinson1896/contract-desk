/**
 * Billing policy — the decisions the contract leaves open.
 *
 * Every control here corresponds to something a real order form failed to state.
 * The app ships a conservative default for each so a month can be computed at all,
 * but a default is not a decision: until someone sets a value deliberately, the
 * row reads "not decided" and any finding attached to it stays open.
 *
 * Making that distinction visible is the whole point. A silent default is how a
 * guess reaches an invoice.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { Chip } from '@/components/ui/chip';
import { Card, Divider, Section, elevation } from '@/components/ui/layout';
import { Text } from '@/components/ui/text';
import { Radius, Spacing } from '@/constants/theme';
import { isDecided, type PolicyField, type PolicyValues } from '@/domain/policy';
import type { ContractRecord } from '@/domain/record';
import { changePolicy } from '@/domain/resolve';
import { useTheme } from '@/hooks/use-theme';

/* -------------------------------------------------------------------------- */

type Choice<K extends PolicyField> = { label: string; value: PolicyValues[K] };

type Control<K extends PolicyField> = {
  field: K;
  title: string;
  /** What the contract fails to say, and why it matters to an invoice. */
  because: string;
  choices: Choice<K>[];
};

const CONTROLS: Control<PolicyField>[] = [
  {
    field: 'actualSpendDefinition',
    title: 'Actual Spend definition',
    because:
      'Decides which charges move the customer toward their minimum. The narrow reading counts rate plans, add-ons and support packages only.',
    choices: [
      { label: 'Narrow', value: 'narrow' },
      { label: 'Broad', value: 'broad' },
    ],
  },
  {
    field: 'smsCountsTowardMinimum',
    title: 'SMS counts toward minimum',
    because: 'SMS fits none of the categories the narrow definition names, so its treatment is undefined.',
    choices: [
      { label: 'Counts', value: true },
      { label: 'Excluded', value: false },
    ],
  },
  {
    field: 'testModeSimsContributeToPool',
    title: 'Test Mode SIMs enlarge the pool',
    because:
      'If a non-billable SIM adds its allowance, the pool grows with no revenue behind it and overage is undercharged.',
    choices: [
      { label: 'Contribute', value: true },
      { label: 'Excluded', value: false },
    ],
  },
  {
    field: 'testModeSmsBilled',
    title: 'Test Mode SMS is billed',
    because: 'The exit clause names only recurring and data charges as beginning at ACTIVE.',
    choices: [
      { label: 'Billed', value: true },
      { label: 'Not billed', value: false },
    ],
  },
  {
    field: 'prorateMidMonthActivation',
    title: 'Prorate mid-month activation',
    because: 'Affects every month with fleet movement, which during a migration is most of them.',
    choices: [
      { label: 'Prorate', value: true },
      { label: 'Full month', value: false },
    ],
  },
  {
    field: 'simCountBasis',
    title: 'Active SIM count basis',
    because: 'Drives both the recurring charge and, under pooling, the pool size.',
    choices: [
      { label: 'Month end', value: 'month_end' },
      { label: 'Month start', value: 'month_start' },
      { label: 'Average', value: 'average' },
      { label: 'Peak', value: 'peak' },
    ],
  },
  {
    field: 'overageRounding',
    title: 'Overage rounding',
    because: 'The contract does not say how partial megabytes are treated.',
    choices: [
      { label: 'None', value: 'none' },
      { label: 'Ceil MB', value: 'ceil_mb' },
      { label: 'Ceil KB', value: 'ceil_kb' },
    ],
  },
  {
    field: 'poolRollover',
    title: 'Unused pool data rolls over',
    because: 'Overage is assessed at month end, which implies the pool resets — but it is not stated.',
    choices: [
      { label: 'Rolls over', value: true },
      { label: 'Resets', value: false },
    ],
  },
  {
    field: 'overlappingBandResolution',
    title: 'Overlapping band resolution',
    because:
      'When two minimum-spend bands claim the same month, no month in the overlap can be computed until this is set.',
    choices: [
      { label: 'Lower', value: 'lower' },
      { label: 'Higher', value: 'upper' },
    ],
  },
] as Control<PolicyField>[];

/* -------------------------------------------------------------------------- */

export function PolicyPane({
  record,
  operator,
  onChange,
}: {
  record: ContractRecord;
  operator: string;
  onChange: (next: ContractRecord) => void;
}) {
  const theme = useTheme();

  const undecided = CONTROLS.filter((c) => !isDecided(record.policy, c.field)).length;

  /** Only show controls a contract actually needs. */
  const relevant = CONTROLS.filter((control) => {
    switch (control.field) {
      case 'overlappingBandResolution':
        return record.flags.some((f) => f.ruleId === 'spend_band_overlap');
      case 'testModeSimsContributeToPool':
      case 'testModeSmsBilled':
        return record.config.testMode !== null;
      case 'actualSpendDefinition':
      case 'smsCountsTowardMinimum':
        return record.config.minimumSpend !== null;
      default:
        return true;
    }
  });

  return (
    <Section
      title="Billing policy"
      footer={
        'Each of these is something the contract does not state. Defaults let a month be computed, ' +
        'but a default is not a decision — anything still marked “not decided” keeps its finding open.'
      }
    >
      {undecided > 0 && (
        <Card style={[styles.banner, { backgroundColor: theme.warningMuted }]}>
          <Text variant="footnote" style={{ color: theme.warning, fontWeight: '600' }}>
            {undecided} of {CONTROLS.length} still on defaults
          </Text>
        </Card>
      )}

      <View style={styles.list}>
        {relevant.map((control) => {
          const current = record.policy.values[control.field];
          const decided = isDecided(record.policy, control.field);
          const meta = record.policy.setBy[control.field];

          return (
            <Card key={control.field} style={styles.control}>
              <View style={styles.controlHeader}>
                <Text variant="subhead" weight="600" style={styles.controlTitle}>
                  {control.title}
                </Text>
                <Chip
                  label={decided ? 'Decided' : 'Default'}
                  fg={decided ? theme.success : theme.textSecondary}
                  bg={decided ? theme.successMuted : theme.surfaceSunken}
                />
              </View>

              <Text variant="footnote" color="textSecondary">
                {control.because}
              </Text>

              <View style={[styles.options, { backgroundColor: theme.surfaceSunken }]}>
                {control.choices.map((choice) => {
                  const active = current === choice.value;
                  return (
                    <Pressable
                      key={String(choice.value)}
                      onPress={() =>
                        onChange(
                          changePolicy(record, control.field, choice.value, operator),
                        )
                      }
                      style={[
                        styles.option,
                        active && [{ backgroundColor: theme.surface }, elevation(theme.shadow, 1)],
                      ]}
                    >
                      <Text
                        variant="footnote"
                        weight={active ? '600' : '400'}
                        color={active ? 'text' : 'textSecondary'}
                      >
                        {choice.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {decided && meta?.at && (
                <>
                  <Divider />
                  <Text variant="caption2" color="textTertiary">
                    Set by {meta.by ?? 'someone'} on {new Date(meta.at).toLocaleDateString()}
                  </Text>
                </>
              )}
            </Card>
          );
        })}
      </View>
    </Section>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  banner: { marginBottom: Spacing.two },
  list: { gap: Spacing.two },
  control: { gap: Spacing.two },
  controlHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  controlTitle: { flex: 1 },
  options: { flexDirection: 'row', padding: 2, borderRadius: Radius.medium, gap: 2 },
  option: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: Spacing.two - 2,
    borderRadius: Radius.small + 2,
  },
});

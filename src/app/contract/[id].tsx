/**
 * Contract detail.
 *
 * One route with a segmented control rather than nested navigators: the panes are
 * five views of the same contract, not five destinations, and a back button
 * between them would misdescribe the relationship.
 *
 * Financial Projections is gated on there being no unresolved finding that blocks
 * it. The gate is what makes the findings register load-bearing instead of
 * advisory.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ConfigJsonPane } from '@/components/contract/config-json';
import { GenerateInvoiceButton } from '@/components/contract/generate-invoice';
import { FindingsPane } from '@/components/contract/findings';
import { OverviewPane } from '@/components/contract/overview';
import { PolicyPane } from '@/components/contract/policy-pane';
import { FinancialProjectionsPane } from '@/components/contract/financial-projections';
import { Button } from '@/components/ui/chip';
import { Card, EmptyState, PageHeader, Screen } from '@/components/ui/layout';
import { AppNav } from '@/components/ui/nav';
import { SegmentedControl, type Segment } from '@/components/ui/segmented';
import { Text } from '@/components/ui/text';
import { Spacing } from '@/constants/theme';
import { saveContract } from '@/data/repository';
import { getOperator } from '@/data/settings';
import { canGoLive, flagsBlockingProjection, openBlockingFlags } from '@/domain/flags';
import type { ContractRecord } from '@/domain/record';
import { setLive } from '@/domain/resolve';
import { useBreakpoint } from '@/hooks/use-breakpoint';
import { useContract } from '@/hooks/use-contracts';
import { useTheme } from '@/hooks/use-theme';

type PaneKey = 'overview' | 'findings' | 'policy' | 'projections' | 'config';

export default function ContractScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isCompact } = useBreakpoint();

  const { contract, loading } = useContract(id);
  const [pane, setPane] = useState<PaneKey>('overview');
  const [operator, setOperatorName] = useState('unattributed');

  /**
   * Local edits are held alongside the id they belong to and derived at render,
   * rather than mirrored into state by an effect. Mirroring would double-render on
   * every load and, worse, leave a previous contract's edits showing after
   * navigating to a different one.
   */
  const [edited, setEdited] = useState<{ id: string; record: ContractRecord } | null>(null);
  const record = edited?.id === id ? edited.record : (contract ?? null);

  useEffect(() => {
    void getOperator().then(setOperatorName);
  }, []);

  /** Persist on every decision — there is no save button, and there should not be. */
  const update = useCallback(
    (next: ContractRecord) => {
      setEdited({ id: next.id, record: next });
      void saveContract(next);
    },
    [],
  );

  if (loading) {
    return (
      <Screen>
        <Card style={styles.pad}>
          <Text variant="subhead" color="textSecondary">
            Loading…
          </Text>
        </Card>
      </Screen>
    );
  }

  if (!record) {
    return (
      <Screen>
        <EmptyState
          title="Contract not found"
          message="It may have been deleted, or this link points at a library on another device."
          action={<Button title="Back to contracts" onPress={() => router.replace('/contracts')} />}
        />
      </Screen>
    );
  }

  const openBlocking = openBlockingFlags(record.flags);
  const projectionBlocked = flagsBlockingProjection(record.flags);
  const readyForLive = canGoLive(record.flags);

  const segments: Segment<PaneKey>[] = [
    { key: 'overview', label: 'Overview' },
    {
      key: 'findings',
      label: 'Findings',
      badge: openBlocking.length,
      badgeTone: theme.danger,
    },
    { key: 'policy', label: 'Policy' },
    { key: 'projections', label: 'Financial Projections', compactLabel: 'Projections' },
    { key: 'config', label: 'JSON' },
  ];

  return (
    <>
      {/* The detail screen sits outside the tab group, so it renders the nav itself
          on wide viewports — losing the whole top bar on drill-in is jarring on
          desktop, where there is room for it. Compact keeps the iOS pattern of a
          back link only. */}
      {!isCompact && <AppNav />}

      <Screen>
        {/* Navigator headers are off app-wide so titles align with content, which
            means this screen supplies its own way back. */}
        <Pressable onPress={() => router.push('/contracts')} hitSlop={8} style={styles.back}>
          <Text variant="body" style={{ color: theme.accent }}>
            ‹ Contracts
          </Text>
        </Pressable>

        <PageHeader
          title={record.config.account.customerName}
          subtitle={`${record.config.ratePlan.name}${
            record.config.account.orderFormNumber
              ? ` · Order form ${record.config.account.orderFormNumber}`
              : ''
          }`}
          /* In the header rather than inside a pane: an invoice is of the whole
             contract, so the action should not be reachable only from one tab. */
          action={
            <GenerateInvoiceButton record={record} operator={operator} onGenerated={update} />
          }
        />

        <SegmentedControl segments={segments} value={pane} onChange={setPane} />

        {pane === 'overview' && <OverviewPane record={record} />}

        {pane === 'findings' && (
          <FindingsPane record={record} operator={operator} onChange={update} />
        )}

        {pane === 'policy' && (
          <PolicyPane record={record} operator={operator} onChange={update} />
        )}

        {pane === 'projections' &&
          (projectionBlocked.length > 0 ? (
            <Card style={[styles.gate, { backgroundColor: theme.dangerMuted }]}>
              <Text variant="headline" style={{ color: theme.danger }}>
                Financial projections unavailable
              </Text>
              <Text variant="footnote" color="textSecondary">
                {projectionBlocked.length} finding
                {projectionBlocked.length === 1 ? '' : 's'} must be resolved before any month can
                be projected from this contract.
              </Text>
              <View style={styles.gateList}>
                {projectionBlocked.map((flag) => (
                  <Text key={flag.id} variant="footnote" weight="600">
                    · {flag.title}
                  </Text>
                ))}
              </View>
              <Button
                title="Go to findings"
                variant="secondary"
                onPress={() => setPane('findings')}
              />
            </Card>
          ) : (
            <FinancialProjectionsPane record={record} />
          ))}

        {pane === 'config' && <ConfigJsonPane record={record} />}

        {/* ---- Go live ---------------------------------------------------- */}
        {pane === 'overview' && (
          <View style={styles.footer}>
            {record.lifecycle === 'live' ? (
              <Card style={[styles.live, { backgroundColor: theme.accentMuted }]}>
                <Text variant="headline" style={{ color: theme.accent }}>
                  Live
                </Text>
                <Text variant="footnote" color="textSecondary">
                  This configuration has been released to billing.
                </Text>
              </Card>
            ) : readyForLive ? (
              <Button
                title="Mark as live"
                onPress={() => update(setLive(record, operator))}
              />
            ) : (
              <Pressable onPress={() => setPane('findings')}>
                <Card style={[styles.gate, { backgroundColor: theme.warningMuted }]}>
                  <Text variant="subhead" weight="600" style={{ color: theme.warning }}>
                    {openBlocking.length} blocking finding
                    {openBlocking.length === 1 ? '' : 's'} before go-live
                  </Text>
                  <Text variant="footnote" color="textSecondary">
                    Each one changes an invoice amount. Resolve or explicitly accept each to
                    release this configuration.
                  </Text>
                </Card>
              </Pressable>
            )}
          </View>
        )}
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  pad: { marginTop: Spacing.three },
  back: { paddingTop: Spacing.four, paddingBottom: Spacing.one },
  gate: { gap: Spacing.two, marginTop: Spacing.three },
  gateList: { gap: 2 },
  footer: { marginTop: Spacing.four },
  live: { gap: Spacing.one },
});

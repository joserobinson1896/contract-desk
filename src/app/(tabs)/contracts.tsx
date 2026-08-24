/**
 * Contracts — the library.
 *
 * Answers two questions on sight: what is blocked, and what is ready.
 *
 * Renders as a table on a wide viewport and as cards on a phone. A table is the
 * right form once there is horizontal room — scanning a column of finding counts
 * down twelve contracts is the actual job — but it collapses badly at phone width,
 * so the same data changes shape rather than shrinking.
 */

import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Chip, StatTile, TileGrid } from '@/components/ui/chip';
import { Card, EmptyState, PageHeader, Screen, Section } from '@/components/ui/layout';
import { ContractFieldGrid } from '@/components/contract/field-grid';
import { Text } from '@/components/ui/text';
import { Hairline, Radius, Spacing, statusColor } from '@/constants/theme';
import { openBlockingFlags, openFlags } from '@/domain/flags';
import type { ContractRecord } from '@/domain/record';
import { STATUS_LABEL, STATUS_ORDER, statusCounts, type ContractStatus } from '@/domain/status';
import { useBreakpoint } from '@/hooks/use-breakpoint';
import { useContracts } from '@/hooks/use-contracts';
import { useTheme } from '@/hooks/use-theme';

/** `all` is a filter state, not a status — kept out of the domain enum. */
type StatusFilter = ContractStatus | 'all';

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* -------------------------------------------------------------------------- */
/* Table (wide)                                                                */
/* -------------------------------------------------------------------------- */

function TableHeader() {
  const theme = useTheme();
  return (
    <View style={[styles.tr, styles.thead, { borderBottomColor: theme.separator }]}>
      {/* Spacer matching the row caret, so headers stay over their columns. */}
      <View style={styles.colCaret} />
      <Text variant="caption" color="textSecondary" style={[styles.th, styles.colCustomer]}>
        CUSTOMER
      </Text>
      <Text variant="caption" color="textSecondary" style={[styles.th, styles.colPlan]}>
        RATE PLAN
      </Text>
      <Text variant="caption" color="textSecondary" style={[styles.th, styles.colNum]}>
        BLOCKING
      </Text>
      <Text variant="caption" color="textSecondary" style={[styles.th, styles.colNum]}>
        OPEN
      </Text>
      <Text variant="caption" color="textSecondary" style={[styles.th, styles.colStatus]}>
        STATUS
      </Text>
    </View>
  );
}

function TableRow({ record, last }: { record: ContractRecord; last: boolean }) {
  const theme = useTheme();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const blocking = openBlockingFlags(record.flags).length;
  const open = openFlags(record.flags).length;
  const tone = statusColor(theme, record.status);

  return (
    <View>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`${record.config.account.customerName} — ${expanded ? 'hide' : 'show'} all fields`}
        style={({ pressed }) => [pressed && { backgroundColor: theme.backgroundSelected }]}
      >
      <View
        style={[
          styles.tr,
          !last && !expanded && { borderBottomWidth: Hairline, borderBottomColor: theme.separator },
        ]}
      >
        {/* Rotating caret, so the row states whether it is open without relying on
            the panel below being in view. */}
        <Text
          variant="footnote"
          weight="600"
          style={[styles.colCaret, { color: expanded ? theme.accent : theme.textTertiary }]}
        >
          {expanded ? '▾' : '▸'}
        </Text>

        <View style={styles.colCustomer}>
          <Text variant="body" weight="600" numberOfLines={1}>
            {record.config.account.customerName}
          </Text>
          <Text variant="caption" color="textSecondary" numberOfLines={1}>
            {record.config.account.orderFormNumber
              ? `${record.config.account.orderFormNumber} · `
              : ''}
            Org {record.config.account.orgIds.join(', ') || '—'}
          </Text>
        </View>

        <Text
          variant="subhead"
          color="textSecondary"
          numberOfLines={1}
          style={styles.colPlan}
        >
          {record.config.ratePlan.name}
        </Text>

        <Text
          variant="body"
          numeric
          weight="600"
          style={[styles.colNum, { color: blocking > 0 ? theme.danger : theme.success }]}
        >
          {blocking}
        </Text>

        <Text variant="body" numeric color="textSecondary" style={styles.colNum}>
          {open}
        </Text>

        <View style={styles.colStatus}>
          <Chip label={STATUS_LABEL[record.status]} fg={tone.fg} bg={tone.bg} />
        </View>
      </View>
      </Pressable>

      {expanded && (
        <View
          style={
            !last && { borderBottomWidth: Hairline, borderBottomColor: theme.separator }
          }
        >
          <ContractFieldGrid
            record={record}
            onOpen={() => router.push(`/contract/${record.id}`)}
          />
        </View>
      )}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Status filter                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Counts live on the chips themselves.
 *
 * A filter that hides how much it would show makes you click each option to find
 * out where anything is. Showing the count turns four clicks into one glance, and
 * makes an empty status visibly empty rather than indistinguishable from a filter
 * that silently matched nothing.
 */
function StatusFilterBar({
  filter,
  onChange,
  counts,
  total,
}: {
  filter: StatusFilter;
  onChange: (next: StatusFilter) => void;
  counts: Record<ContractStatus, number>;
  total: number;
}) {
  const theme = useTheme();

  const options: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: total },
    ...STATUS_ORDER.map((s) => ({ key: s as StatusFilter, label: STATUS_LABEL[s], count: counts[s] })),
  ];

  return (
    <View style={styles.filterBar}>
      {options.map((option) => {
        const active = option.key === filter;
        const tone =
          option.key === 'all' ? null : statusColor(theme, option.key as ContractStatus);
        return (
          <Pressable
            key={option.key}
            onPress={() => onChange(option.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={StyleSheet.flatten([
              styles.filterChip,
              {
                backgroundColor: active ? (tone?.bg ?? theme.backgroundSelected) : 'transparent',
                borderColor: active ? 'transparent' : theme.separatorOpaque,
              },
            ])}
          >
            <Text
              variant="footnote"
              weight={active ? '600' : '400'}
              style={{ color: active ? (tone?.fg ?? theme.text) : theme.textSecondary }}
            >
              {option.label} {option.count}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Card (compact)                                                              */
/* -------------------------------------------------------------------------- */

function ContractCard({ record }: { record: ContractRecord }) {
  const theme = useTheme();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  const blocking = openBlockingFlags(record.flags).length;
  const open = openFlags(record.flags).length;
  const tone = statusColor(theme, record.status);

  return (
    <Pressable
      onPress={() => setExpanded((v) => !v)}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${record.config.account.customerName} — ${expanded ? 'hide' : 'show'} all fields`}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <Card style={styles.card} tone={blocking > 0 ? theme.danger : undefined}>
        <View style={styles.cardHeader}>
          <View style={styles.cardTitle}>
            <Text variant="headline" numberOfLines={1}>
              {record.config.account.customerName}
            </Text>
            <Text variant="footnote" color="textSecondary" numberOfLines={1}>
              {record.config.account.orderFormNumber
                ? `Order form ${record.config.account.orderFormNumber} · `
                : ''}
              Org {record.config.account.orgIds.join(', ') || '—'}
            </Text>
          </View>
          <Chip label={STATUS_LABEL[record.status]} fg={tone.fg} bg={tone.bg} />
        </View>

        <Text variant="subhead" color="textSecondary" numberOfLines={1}>
          {record.config.ratePlan.name}
        </Text>

        <View style={styles.cardFooter}>
          <Text
            variant="footnote"
            weight="600"
            style={{ color: blocking > 0 ? theme.danger : theme.success }}
          >
            {blocking > 0 ? `${blocking} blocking` : 'No blocking issues'}
          </Text>
          {open > blocking && (
            <Text variant="footnote" color="textSecondary">
              {open - blocking} other open
            </Text>
          )}
          <Text variant="footnote" color="textTertiary">
            {expanded ? '▾ Hide fields' : '▸ All fields'}
          </Text>
        </View>

        {expanded && (
          <View style={styles.cardPanel}>
            <ContractFieldGrid
              record={record}
              onOpen={() => router.push(`/contract/${record.id}`)}
            />
          </View>
        )}
      </Card>
    </Pressable>
  );
}

/* -------------------------------------------------------------------------- */

export default function ContractsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { contracts, error, loading } = useContracts();
  const { isCompact } = useBreakpoint();

  const list = contracts ?? [];
  const [filter, setFilter] = useState<StatusFilter>('all');

  const counts = statusCounts(list);
  const visible = filter === 'all' ? list : list.filter((r) => r.status === filter);
  const blockedCount = list.filter((r) => openBlockingFlags(r.flags).length > 0).length;
  const readyCount = list.filter((r) => r.lifecycle === 'verified' || r.lifecycle === 'live').length;
  const totalOpen = list.reduce((n, r) => n + openFlags(r.flags).length, 0);

  /**
   * Contracted floor across the portfolio, using each contract's CURRENT period
   * rather than its first. The first-period figure was misleading on contracts
   * whose opening band is a stub — it reported the portfolio as committing to
   * almost nothing.
   */
  const monthlyFloor = list.reduce((sum, r) => {
    const schedule = r.config.minimumSpend?.schedule ?? [];
    if (schedule.length === 0) return sum;
    const largest = Math.max(...schedule.map((p) => p.amountPerMonth));
    return sum + largest;
  }, 0);

  return (
    <Screen>
      <PageHeader
        title="Contracts"
        subtitle={
          list.length === 0
            ? 'Nothing imported yet'
            : `${list.length} contract${list.length === 1 ? '' : 's'} · ${totalOpen} open finding${totalOpen === 1 ? '' : 's'}`
        }
        action={
          list.length > 0 ? (
            <Button title="Upload" onPress={() => router.push('/import')} />
          ) : undefined
        }
      />

      {error && (
        <Card style={{ backgroundColor: theme.dangerMuted }}>
          <Text variant="footnote" style={{ color: theme.danger }}>
            {error}
          </Text>
        </Card>
      )}

      {list.length > 0 && (
        <Section title="Portfolio">
          <TileGrid>
            <StatTile
              label="Ready for go-live"
              value={`${readyCount}`}
              caption={`of ${list.length}`}
              tone={readyCount === list.length ? theme.success : undefined}
            />
            <StatTile
              label="Blocked"
              value={String(blockedCount)}
              caption={blockedCount === 1 ? 'contract' : 'contracts'}
              tone={blockedCount > 0 ? theme.danger : theme.success}
            />
            <StatTile label="Open findings" value={String(totalOpen)} caption="awaiting a decision" />
            <StatTile
              label="Committed floor"
              value={money(monthlyFloor)}
              caption="peak monthly minimum"
            />
          </TileGrid>
        </Section>
      )}

      {loading ? (
        <Section>
          <Card>
            <Text variant="subhead" color="textSecondary">
              Loading…
            </Text>
          </Card>
        </Section>
      ) : list.length === 0 ? (
        <EmptyState
          glyph="↑"
          title="No contracts yet"
          message="Upload signed order forms. Each one is read, checked for anything ambiguous or contradictory, and added here."
          action={
            <Button
              title="Upload contracts"
              onPress={() => router.push('/import')}
              style={styles.emptyAction}
            />
          }
        />
      ) : (
        <Section
          title="All contracts"
          /* On a phone the five chips and the title cannot share one row — the
             title wraps and the last chip still runs past the edge. Wide keeps
             them inline; compact gives the bar its own row below. */
          action={
            isCompact ? undefined : (
              <StatusFilterBar
                filter={filter}
                onChange={setFilter}
                counts={counts}
                total={list.length}
              />
            )
          }
        >
          {isCompact && (
            <View style={styles.filterRow}>
              <StatusFilterBar
                filter={filter}
                onChange={setFilter}
                counts={counts}
                total={list.length}
              />
            </View>
          )}

          {visible.length === 0 ? (
            <Card>
              <Text variant="subhead" color="textSecondary">
                No {STATUS_LABEL[filter as ContractStatus].toLowerCase()} contracts.
              </Text>
            </Card>
          ) : isCompact ? (
            <View style={styles.list}>
              {visible.map((record) => (
                <ContractCard key={record.id} record={record} />
              ))}
            </View>
          ) : (
            <Card padded={false}>
              <TableHeader />
              {visible.map((record, i) => (
                <TableRow key={record.id} record={record} last={i === visible.length - 1} />
              ))}
            </Card>
          )}
        </Section>
      )}
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  filterBar: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.one },
  filterRow: { marginBottom: Spacing.two },
  filterChip: {
    paddingHorizontal: Spacing.two,
    paddingVertical: 3,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },

  list: { gap: Spacing.two },
  card: { gap: Spacing.two },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  cardTitle: { flex: 1, gap: 2 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  pressed: { opacity: 0.7 },
  emptyAction: { marginTop: Spacing.three, minWidth: 240 },

  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.three,
    minHeight: 60,
  },
  thead: { paddingVertical: Spacing.two, borderBottomWidth: Hairline },
  th: { letterSpacing: 0.6, fontWeight: '600' },
  /* Negative margins let the panel run to the card's edges, so it reads as a
     drawer under the card rather than a box floating inside it. */
  cardPanel: {
    marginHorizontal: -Spacing.four,
    marginBottom: -Spacing.four,
    marginTop: Spacing.two,
    overflow: 'hidden',
  },

  colCaret: { width: 18, textAlign: 'center' },
  colCustomer: { flex: 3, gap: 2 },
  colPlan: { flex: 3 },
  colNum: { width: 72, textAlign: 'right' },
  colStatus: { width: 128, alignItems: 'flex-end' },
});

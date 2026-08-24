/**
 * Overview — the contract at a glance.
 *
 * Ordered by what a person needs first: is this safe to bill, then what does it
 * cost, then what does it commit to. Every extracted value is tappable and opens
 * its source clause, so nobody has to reopen the PDF to answer "why does it say
 * this?" — which was the point of building the config in the first place.
 */

import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { SpendScheduleChart } from '@/components/charts/spend-schedule';
import { ContractInvoices } from '@/components/contract/contract-invoices';
import { Chip, StatTile, TileGrid } from '@/components/ui/chip';
import { Card, Divider, Row, Section } from '@/components/ui/layout';
import { Text } from '@/components/ui/text';
import { Radius, Spacing, statusColor } from '@/constants/theme';
import { openBlockingFlags, openFlags } from '@/domain/flags';
import { provenanceMap, type ContractRecord } from '@/domain/record';
import type { Provenance } from '@/domain/schema';
import { STATUS_DESCRIPTION, STATUS_LABEL } from '@/domain/status';
import { useTheme } from '@/hooks/use-theme';

/* -------------------------------------------------------------------------- */

function money(n: number | null): string {
  if (n === null) return '—';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function rateLabel(rate: { kind: string; amount: number | null }): string {
  if (rate.kind === 'variable') return 'Variable';
  if (rate.kind === 'unstated') return 'Not priced';
  return money(rate.amount);
}

const KIND_LABEL: Record<string, string> = {
  rate_plan: 'Rate plan',
  add_on: 'Add-on',
  support_package: 'Support',
  hardware: 'Hardware',
  fee: 'Fee',
  adjustment: 'Adjustment',
  tax: 'Tax',
  unclassified: 'Unclassified',
};

/* -------------------------------------------------------------------------- */

function SourceSheet({
  entry,
  onClose,
}: {
  entry: { label: string; source: Provenance } | null;
  onClose: () => void;
}) {
  const theme = useTheme();
  return (
    <Modal visible={entry !== null} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme.surface }]} onPress={() => {}}>
          <Text variant="caption" color="textSecondary">
            {entry?.label.toUpperCase()}
          </Text>
          <Text variant="body" style={styles.quote}>
            “{entry?.source.quote}”
          </Text>
          <View style={styles.sheetFooter}>
            <Text variant="footnote" color="textTertiary">
              {entry?.source.page ? `Page ${entry.source.page}` : 'Page unknown'} ·{' '}
              {entry?.source.confidence} confidence
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <Text variant="footnote" style={{ color: theme.accent, fontWeight: '600' }}>
                Close
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * One badge, one sentence.
 *
 * There are genuinely two states underneath — where the contract sits in the
 * billing cycle, and whether its configuration passed QA — but showing both as
 * chips made the reader decide which of two status-looking things to believe.
 * The badge carries the answer people are asking for; the QA state becomes plain
 * English underneath it, saying what it would take to move forward.
 */
function statusExplanation(record: ContractRecord): string {
  const base = STATUS_DESCRIPTION[record.status];
  if (record.status !== 'draft') return base;

  const blocking = openBlockingFlags(record.flags).length;
  if (blocking > 0) {
    return `${base}. ${blocking} blocking finding${blocking === 1 ? '' : 's'} must be resolved before it can go Active.`;
  }
  return `${base}. Everything blocking has been resolved — this contract is ready to go Active.`;
}

export function OverviewPane({ record }: { record: ContractRecord }) {
  const theme = useTheme();
  const [source, setSource] = useState<{ label: string; source: Provenance } | null>(null);

  const provenance = useMemo(() => provenanceMap(record), [record]);
  const blocking = openBlockingFlags(record.flags);
  const open = openFlags(record.flags);
  const tone = statusColor(theme, record.status);

  const show = (label: string, pointer: string) => {
    const src = provenance.get(pointer);
    if (src) setSource({ label, source: src });
  };

  const { config } = record;
  const mrc = config.charges.find((c) => c.unit === 'per_sim' && c.frequency === 'monthly');
  const overage = config.charges.find((c) => c.unit === 'per_mb');

  /** Periods any rule flagged, so the chart can mark them. */
  const flaggedPeriods = useMemo(() => {
    const indexes = new Set<number>();
    for (const flag of record.flags) {
      if (flag.status !== 'open') continue;
      for (const pointer of flag.pointers) {
        const match = /^\/minimumSpend\/schedule\/(\d+)$/.exec(pointer);
        if (match) indexes.add(Number(match[1]));
      }
    }
    return [...indexes];
  }, [record.flags]);

  const billableCharges = config.charges.filter(
    (c) => c.rate.kind !== 'unstated' || c.kind !== 'fee',
  );

  return (
    <>
      {/* ---- Status ------------------------------------------------------ */}
      <Section title="Status" footer={statusExplanation(record)}>
        <Card style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.heroText}>
              <Text variant="title3">{config.account.customerName}</Text>
              <Text variant="footnote" color="textSecondary">
                {config.ratePlan.name}
              </Text>
            </View>
            <Chip label={STATUS_LABEL[record.status]} fg={tone.fg} bg={tone.bg} />
          </View>

          <Divider />

          <View style={styles.heroStats}>
            <View style={styles.heroStat}>
              <Text
                variant="title2"
                numeric
                style={{ color: blocking.length > 0 ? theme.danger : theme.success }}
              >
                {blocking.length}
              </Text>
              <Text variant="caption" color="textSecondary">
                blocking
              </Text>
            </View>
            <View style={styles.heroStat}>
              <Text variant="title2" numeric>
                {open.length}
              </Text>
              <Text variant="caption" color="textSecondary">
                open findings
              </Text>
            </View>
            <View style={styles.heroStat}>
              <Text variant="title2" numeric>
                {record.flags.length - open.length}
              </Text>
              <Text variant="caption" color="textSecondary">
                resolved
              </Text>
            </View>
          </View>

          {record.extraction.reviewPassCompleted === false && (
            <Text variant="caption" color="textSecondary" style={styles.heroNote}>
              Findings from deterministic rules only — the adversarial review pass did not run
              for this contract.
            </Text>
          )}
        </Card>
      </Section>

      {/* ---- Key terms --------------------------------------------------- */}
      {/* Directly under Status: once an invoice exists, "what have we billed
          them" is the next question a reader has, before the terms. */}
      <ContractInvoices contractId={record.id} version={record.updatedAt} />

      <Section title="Key terms">
        <TileGrid>
          <StatTile
            label="Org ID"
            value={config.account.orgIds.join(', ') || '—'}
            caption={config.account.orderFormNumber ?? undefined}
          />
          <StatTile
            label="Recurring"
            value={mrc ? rateLabel(mrc.rate) : '—'}
            caption={mrc ? 'per SIM / month' : undefined}
          />
          <StatTile
            label="Included data"
            value={
              config.ratePlan.includedDataMbPerSim !== null
                ? `${config.ratePlan.includedDataMbPerSim} MB`
                : '—'
            }
            caption={config.ratePlan.pooling ? 'per SIM, pooled' : 'per SIM'}
          />
          <StatTile
            label="Overage"
            value={overage ? rateLabel(overage.rate) : '—'}
            caption={config.ratePlan.overageBasis === 'pool_total' ? 'per MB, pool total' : 'per MB'}
          />
        </TileGrid>
      </Section>

      {/* ---- Minimum spend ----------------------------------------------- */}
      {config.minimumSpend && (
        <Section
          title="Minimum spend"
          footer={
            flaggedPeriods.length > 0
              ? 'Hatched bands have open findings against them — see Findings.'
              : undefined
          }
        >
          <Card>
            <SpendScheduleChart
              schedule={config.minimumSpend.schedule}
              flaggedPeriodIndexes={flaggedPeriods}
              termMonths={config.term.initialTermMonths}
            />
          </Card>
        </Section>
      )}

      {/* ---- Charges ------------------------------------------------------ */}
      <Section
        title="Charges"
        footer="“Counts” marks whether a charge moves the customer toward their minimum spend."
      >
        <Card padded={false}>
          {billableCharges.map((charge, i) => (
            <Row
              key={charge.id}
              label={charge.label}
              detail={`${KIND_LABEL[charge.kind] ?? charge.kind}${
                charge.unit ? ` · ${charge.unit.replace(/_/g, ' ')}` : ''
              }`}
              value={
                <View style={styles.chargeValue}>
                  <Text variant="body" color="textSecondary" numeric>
                    {rateLabel(charge.rate)}
                  </Text>
                  {charge.countsTowardMinimum === 'yes' && (
                    <Chip label="Counts" fg={theme.success} bg={theme.successMuted} />
                  )}
                  {charge.countsTowardMinimum === 'undetermined' && (
                    <Chip label="Undetermined" fg={theme.warning} bg={theme.warningMuted} />
                  )}
                </View>
              }
              onPress={() => show(charge.label, `/charges/${config.charges.indexOf(charge)}`)}
              last={i === billableCharges.length - 1}
            />
          ))}
        </Card>
      </Section>

      {/* ---- Term --------------------------------------------------------- */}
      <Section title="Term">
        <Card padded={false}>
          <Row
            label="Start date"
            value={config.term.startDate ?? '—'}
            onPress={() => show('Start date', '/term/startDate')}
          />
          <Row
            label="Initial term"
            value={config.term.initialTermMonths ? `${config.term.initialTermMonths} months` : '—'}
            onPress={() => show('Initial term', '/term/initialTermMonths')}
          />
          <Row
            label="Renewal"
            value={
              config.term.autoRenew
                ? `Auto, ${config.term.renewalTermMonths ?? '—'} months`
                : 'No auto-renewal'
            }
          />
          <Row
            label="Non-renewal notice"
            value={
              config.term.nonRenewalNoticeDays ? `${config.term.nonRenewalNoticeDays} days` : '—'
            }
          />
          <Row label="Payment terms" value={config.term.paymentTerms ?? '—'} />
          <Row
            label="Billing cycle"
            value={config.term.billingCycle?.replace(/_/g, ' ') ?? '—'}
            onPress={() => show('Billing cycle', '/term/billingCycle')}
            last
          />
        </Card>
      </Section>

      {/* ---- Source ------------------------------------------------------- */}
      <Section title="Source">
        <Card padded={false}>
          <Row label="File" value={record.source.fileName} />
          <Row
            label="Pages"
            value={record.source.pageCount ? String(record.source.pageCount) : '—'}
          />
          <Row
            label="Extracted by"
            value={record.extraction.model ?? 'Transcribed fixture'}
            last
          />
        </Card>
      </Section>

      <SourceSheet entry={source} onClose={() => setSource(null)} />
    </>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  hero: { gap: Spacing.three },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  heroText: { flex: 1, gap: 2 },
  heroStats: { flexDirection: 'row', justifyContent: 'space-around' },
  heroStat: { alignItems: 'center', gap: 2 },
  heroNote: { textAlign: 'center' },
  chargeValue: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    padding: Spacing.four,
  },
  sheet: {
    borderRadius: Radius.large,
    padding: Spacing.four,
    gap: Spacing.two,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
  },
  quote: { fontStyle: 'italic' },
  sheetFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.two,
  },
});

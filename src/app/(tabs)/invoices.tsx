/**
 * Invoices — every generated invoice, across all contracts.
 *
 * A table on a wide viewport, cards on a phone, the same shape shift the contracts
 * library uses. Sorted newest first: an invoice list is read from the top.
 *
 * Marking one paid moves its contract too. Doing that here rather than only on the
 * contract page keeps the receivables workflow in one place — the person chasing
 * payment is working down this list, not opening contracts one at a time.
 */

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Chip, StatTile, TileGrid } from '@/components/ui/chip';
import { Card, EmptyState, PageHeader, Screen, Section } from '@/components/ui/layout';
import { Text } from '@/components/ui/text';
import { Hairline, Spacing } from '@/constants/theme';
import { getContract, saveContract } from '@/data/repository';
import { listInvoices, saveInvoice } from '@/data/invoices';
import { impliedStatus, markPaid, markUnpaid, outstandingTotal, type Invoice } from '@/domain/invoice';
import { setStatus } from '@/domain/resolve';
import { getOperator } from '@/data/settings';
import { openInvoicePdf } from '@/data/invoice-file';
import { useBreakpoint } from '@/hooks/use-breakpoint';
import { useTheme } from '@/hooks/use-theme';

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/* -------------------------------------------------------------------------- */

function PaymentChip({ invoice }: { invoice: Invoice }) {
  const theme = useTheme();
  const paid = invoice.paymentStatus === 'paid';
  return (
    <Chip
      label={paid ? 'Paid' : 'Unpaid'}
      fg={paid ? theme.success : theme.warning}
      bg={paid ? theme.successMuted : theme.warningMuted}
    />
  );
}

/* -------------------------------------------------------------------------- */

export default function InvoicesScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { isCompact } = useBreakpoint();

  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const openPdf = useCallback(async (invoice: Invoice) => {
    const result = await openInvoicePdf(invoice);
    setPdfError(result.ok ? null : result.reason);
  }, []);

  const load = useCallback(() => {
    void listInvoices().then(setInvoices);
  }, []);

  // `useFocusEffect` already fires on mount — a companion useEffect would
  // double-load and trip the set-state-in-effect rule.
  useFocusEffect(load);

  const list = invoices ?? [];
  const outstanding = outstandingTotal(list);
  const unpaid = list.filter((i) => i.paymentStatus === 'unpaid').length;

  /**
   * Toggling payment re-derives the CONTRACT's status from all of its invoices,
   * rather than assuming this was the only one. A contract with three invoices
   * does not become Paid because one of them was settled.
   */
  const togglePaid = useCallback(async (invoice: Invoice) => {
    const by = await getOperator();
    const next =
      invoice.paymentStatus === 'paid' ? markUnpaid(invoice) : markPaid(invoice, by);
    await saveInvoice(next);

    const all = await listInvoices();
    setInvoices(all);

    const record = await getContract(invoice.contractId);
    if (!record) return;

    const implied = impliedStatus(all.filter((i) => i.contractId === invoice.contractId));
    if (!implied || implied === record.status) return;

    const moved = setStatus(record, implied, by, `invoice ${next.number}`);
    if (moved.ok) await saveContract(moved.record);
  }, []);

  return (
    <Screen>
      <PageHeader
        title="Invoices"
        subtitle={
          list.length === 0
            ? 'Nothing generated yet'
            : `${list.length} invoice${list.length === 1 ? '' : 's'} · ${unpaid} unpaid`
        }
      />

      {pdfError && (
        <Card style={{ backgroundColor: theme.dangerMuted }}>
          <Text variant="footnote" style={{ color: theme.danger }}>
            {pdfError}
          </Text>
        </Card>
      )}

      {list.length > 0 && (
        <Section title="Receivables">
          <TileGrid>
            <StatTile label="Invoices" value={String(list.length)} caption="generated" />
            <StatTile
              label="Unpaid"
              value={String(unpaid)}
              caption={unpaid === 1 ? 'invoice' : 'invoices'}
              tone={unpaid > 0 ? theme.warning : theme.success}
            />
            <StatTile label="Outstanding" value={money(outstanding)} caption="awaiting payment" />
          </TileGrid>
        </Section>
      )}

      {invoices === null ? (
        <Section>
          <Card>
            <Text variant="subhead" color="textSecondary">
              Loading…
            </Text>
          </Card>
        </Section>
      ) : list.length === 0 ? (
        <EmptyState
          glyph="§"
          title="No invoices yet"
          message="Open a contract, mark it Active, then use Generate Invoice on its detail page. Invoices are always of a specific contract."
          action={<Button title="Go to contracts" onPress={() => router.push('/contracts')} />}
        />
      ) : isCompact ? (
        <Section title="All invoices">
          <View style={styles.list}>
            {list.map((invoice) => (
              <Card key={invoice.id} style={styles.card}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${invoice.number} as PDF`}
                  onPress={() => void openPdf(invoice)}
                >
                <View style={styles.cardHeader}>
                  <View style={styles.cardTitle}>
                    <Text variant="headline" numberOfLines={1}>
                      {invoice.contractName}
                    </Text>
                    <Text variant="caption" color="textSecondary">
                      {invoice.number} · Month {invoice.month} · {when(invoice.generatedAt)}
                    </Text>
                  </View>
                  <PaymentChip invoice={invoice} />
                </View>
                </Pressable>
                <View style={styles.cardFooter}>
                  <Pressable onPress={() => void openPdf(invoice)}>
                    <Text variant="title3" numeric style={{ color: theme.accent }}>
                      {money(invoice.total)}
                    </Text>
                  </Pressable>
                  <Button
                    title={invoice.paymentStatus === 'paid' ? 'Mark unpaid' : 'Mark paid'}
                    variant="secondary"
                    onPress={() => void togglePaid(invoice)}
                  />
                </View>
              </Card>
            ))}
          </View>
        </Section>
      ) : (
        <Section title="All invoices">
          <Card padded={false}>
            <View style={[styles.tr, styles.thead, { borderBottomColor: theme.separator }]}>
              <Text variant="caption" color="textSecondary" style={styles.colContract}>
                CONTRACT
              </Text>
              <Text variant="caption" color="textSecondary" style={styles.colNumber}>
                INVOICE
              </Text>
              <Text variant="caption" color="textSecondary" style={styles.colDate}>
                GENERATED
              </Text>
              <Text variant="caption" color="textSecondary" style={styles.colAmount}>
                AMOUNT
              </Text>
              <Text variant="caption" color="textSecondary" style={styles.colPay}>
                PAYMENT
              </Text>
              <View style={styles.colAction} />
            </View>

            {list.map((invoice, i) => (
              <View
                key={invoice.id}
                style={[
                  styles.tr,
                  i < list.length - 1 && {
                    borderBottomWidth: Hairline,
                    borderBottomColor: theme.separator,
                  },
                ]}
              >
                {/* The row opens the document. An invoice IS the PDF — making the
                    reader hunt for a separate link to see it is the wrong default. */}
                <Pressable
                  style={styles.rowMain}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${invoice.number} as PDF`}
                  onPress={() => void openPdf(invoice)}
                >
                  <View style={styles.colContract}>
                    <Text variant="body" weight="600" numberOfLines={1}>
                      {invoice.contractName}
                    </Text>
                    <Text variant="caption" color="textSecondary" numberOfLines={1}>
                      Month {invoice.month} · {invoice.activeSims.toLocaleString()} SIMs
                    </Text>
                  </View>

                  <Text variant="footnote" style={[styles.colNumber, { color: theme.accent }]}>
                    {invoice.number}
                  </Text>
                  <Text variant="footnote" color="textSecondary" style={styles.colDate}>
                    {when(invoice.generatedAt)}
                  </Text>
                  <Text variant="body" numeric weight="600" style={styles.colAmount}>
                    {money(invoice.total)}
                  </Text>
                  <View style={styles.colPay}>
                    <PaymentChip invoice={invoice} />
                  </View>
                </Pressable>
                <View style={styles.colAction}>
                  <Button
                    title={invoice.paymentStatus === 'paid' ? 'Unpay' : 'Mark paid'}
                    variant="plain"
                    onPress={() => void togglePaid(invoice)}
                  />
                </View>
              </View>
            ))}
          </Card>
        </Section>
      )}
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
  list: { gap: Spacing.two },
  card: { gap: Spacing.two },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  cardTitle: { flex: 1, gap: 2 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  tr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    minHeight: 56,
  },
  thead: { borderBottomWidth: Hairline, paddingVertical: Spacing.two },

  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  colContract: { flex: 3, gap: 2 },
  colNumber: { width: 96 },
  colDate: { width: 116 },
  colAmount: { width: 108, textAlign: 'right' },
  colPay: { width: 96, alignItems: 'flex-start' },
  colAction: { width: 96, alignItems: 'flex-end' },
});

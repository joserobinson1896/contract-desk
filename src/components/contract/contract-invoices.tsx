/**
 * Invoices raised against this contract.
 *
 * Shown on the contract, not only in the global list. Once an invoice exists it is
 * part of the contract's history, and the person asking "what have we billed them"
 * is already looking at the contract — sending them to a cross-account list to
 * filter back down to where they started is the wrong direction of travel.
 *
 * Absent until there is something to show. An empty "no invoices yet" panel on
 * every draft contract would be noise on the majority of the library.
 */

import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Chip } from '@/components/ui/chip';
import { Card, Section } from '@/components/ui/layout';
import { Text } from '@/components/ui/text';
import { Hairline, Spacing } from '@/constants/theme';
import { openInvoicePdf } from '@/data/invoice-file';
import { listInvoicesForContract } from '@/data/invoices';
import type { Invoice } from '@/domain/invoice';
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

export function ContractInvoices({
  contractId,
  /**
   * Changes whenever the record is written. Generating an invoice happens while
   * this screen is already focused, so `useFocusEffect` alone never re-runs and
   * the section stays empty until you navigate away and back.
   */
  version,
}: {
  contractId: string;
  version: string;
}) {
  const theme = useTheme();
  const router = useRouter();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [error, setError] = useState<string | null>(null);

  // `useFocusEffect` already fires on mount; a companion useEffect would double-load.
  useFocusEffect(
    useCallback(() => {
      void listInvoicesForContract(contractId).then(setInvoices);
    }, [contractId]),
  );

  useEffect(() => {
    // Async, so state is set after the effect rather than during it.
    void listInvoicesForContract(contractId).then(setInvoices);
  }, [contractId, version]);

  if (invoices.length === 0) return null;

  const open = async (invoice: Invoice) => {
    const result = await openInvoicePdf(invoice);
    setError(result.ok ? null : result.reason);
  };

  return (
    <Section
      title="Invoices"
      footer="Opens the invoice as a PDF. Amounts are as issued — they are not recomputed from the current configuration."
      action={
        <Pressable onPress={() => router.push('/invoices')} hitSlop={8}>
          <Text variant="footnote" weight="600" style={{ color: theme.accent }}>
            All invoices →
          </Text>
        </Pressable>
      }
    >
      {error && (
        <Card style={{ backgroundColor: theme.dangerMuted, marginBottom: Spacing.two }}>
          <Text variant="footnote" style={{ color: theme.danger }}>
            {error}
          </Text>
        </Card>
      )}

      <Card padded={false}>
        {invoices.map((invoice, i) => (
          <Pressable
            key={invoice.id}
            onPress={() => void open(invoice)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${invoice.number} as PDF`}
            style={({ pressed }) => [pressed && { backgroundColor: theme.backgroundSelected }]}
          >
            <View
              style={[
                styles.row,
                i < invoices.length - 1 && {
                  borderBottomWidth: Hairline,
                  borderBottomColor: theme.separator,
                },
              ]}
            >
              <View style={styles.main}>
                <Text variant="body" weight="600" style={{ color: theme.accent }}>
                  {invoice.number}
                </Text>
                <Text variant="caption" color="textSecondary">
                  Month {invoice.month} · {when(invoice.generatedAt)} ·{' '}
                  {invoice.activeSims.toLocaleString()} SIMs
                </Text>
              </View>

              <Chip
                label={invoice.paymentStatus === 'paid' ? 'Paid' : 'Unpaid'}
                fg={invoice.paymentStatus === 'paid' ? theme.success : theme.warning}
                bg={invoice.paymentStatus === 'paid' ? theme.successMuted : theme.warningMuted}
              />

              <Text variant="body" numeric weight="600" style={styles.amount}>
                {money(invoice.total)}
              </Text>

              <Text variant="footnote" style={{ color: theme.textTertiary }}>
                PDF ↗
              </Text>
            </View>
          </Pressable>
        ))}
      </Card>
    </Section>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.four,
    minHeight: 56,
  },
  main: { flex: 1, gap: 2 },
  amount: { width: 100, textAlign: 'right' },
});
